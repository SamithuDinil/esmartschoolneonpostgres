import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import {
  canManageAssignment,
  notificationRecipientsForStudent,
  queueAssignmentNotification,
} from "@/server/services/assignments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type RouteContext = { params: Promise<{ assignmentId: string; studentId: string }> };
const schema = z.object({
  status: z.enum(["under_review", "reviewed", "published", "resubmission_requested"]),
  awardedMarks: z.number().min(0).optional(),
  feedback: z.string().max(5000).optional(),
});

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "School access required" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid review update", fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  const { assignmentId, studentId } = await params;
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  const assignmentRef = root.collection("assignments").doc(assignmentId);
  const submissionRef = assignmentRef.collection("submissions").doc(studentId);
  try {
    const [assignment, recipient, submission] = await Promise.all([
      assignmentRef.get(),
      assignmentRef.collection("recipients").doc(studentId).get(),
      submissionRef.get(),
    ]);
    if (!assignment.exists || !recipient.exists || !submission.exists)
      return NextResponse.json({ error: "Assignment submission not found" }, { status: 404 });
    if (!(await canManageAssignment(root, context, assignment.data()!)))
      return NextResponse.json(
        { error: "You are not assigned to review this class and subject" },
        { status: 403 },
      );
    if (!["published", "archived"].includes(String(assignment.get("status"))))
      return NextResponse.json(
        { error: "Submissions may be reviewed only after assignment publication" },
        { status: 409 },
      );
    const data = parsed.data;
    const before = submission.data()!;
    const publishedCorrection = before.status === "published";
    if (publishedCorrection && !hasPermission(context.permissions, "assignments.grade.correct"))
      return NextResponse.json(
        { error: "Correcting a published grade requires explicit grade-correction permission" },
        { status: 403 },
      );
    if (
      ![
        "submitted",
        "submitted_late",
        "under_review",
        "reviewed",
        "published",
        "resubmission_requested",
      ].includes(String(before.status))
    )
      return NextResponse.json(
        { error: "A student must submit work before it can be reviewed" },
        { status: 409 },
      );
    if (
      data.awardedMarks !== undefined &&
      data.awardedMarks > Number(assignment.get("maxMarks") ?? 0)
    )
      return NextResponse.json(
        {
          error: `Marks cannot exceed the configured maximum of ${Number(assignment.get("maxMarks") ?? 0)}`,
        },
        { status: 400 },
      );
    if (
      data.status === "published" &&
      Number(assignment.get("maxMarks") ?? 0) > 0 &&
      data.awardedMarks === undefined &&
      typeof before.awardedMarks !== "number"
    )
      return NextResponse.json(
        { error: "Enter a mark before publishing this result" },
        { status: 400 },
      );
    const changes = {
      status: data.status,
      ...(data.awardedMarks !== undefined ? { awardedMarks: data.awardedMarks } : {}),
      ...(data.feedback !== undefined ? { feedback: data.feedback.trim() } : {}),
      reviewedBy: context.uid,
      reviewedAt: new Date(),
      ...(data.status === "published"
        ? { resultPublishedAt: new Date(), resultPublishedBy: context.uid }
        : {}),
      updatedAt: new Date(),
    };
    await submissionRef.update(changes);
    const attemptId = before.latestAttemptId;
    if (typeof attemptId === "string")
      await submissionRef
        .collection("attempts")
        .doc(attemptId)
        .set(
          { status: data.status, updatedAt: new Date(), reviewedBy: context.uid },
          { merge: true },
        );
    const student = await root.collection("students").doc(studentId).get();
    if (["resubmission_requested", "published"].includes(data.status) && student.exists) {
      const targets = await notificationRecipientsForStudent(root, {
        id: studentId,
        ...student.data(),
      });
      if (targets.length)
        await queueAssignmentNotification(
          root,
          context.schoolId,
          `${data.status}_${assignmentId}_${studentId}_${Date.now()}`,
          {
            type:
              data.status === "published"
                ? "assignment_result_published"
                : "assignment_resubmission_requested",
            title: data.status === "published" ? "Homework result published" : "Revision requested",
            message:
              data.status === "published"
                ? `Feedback for ${String(assignment.get("title"))} is available.`
                : `Please revise ${String(assignment.get("title"))} and submit again.`,
            assignmentId,
            studentId,
            targetUids: targets,
          },
        );
    }
    await root.collection("auditLogs").add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: publishedCorrection
        ? "assignment.grade.corrected"
        : `assignment.submission.${data.status}`,
      recordType: "assignmentSubmission",
      recordId: `${assignmentId}_${studentId}`,
      previousStatus: before.status,
      nextStatus: data.status,
      ...(before.awardedMarks !== data.awardedMarks && data.awardedMarks !== undefined
        ? { previousMarks: before.awardedMarks ?? null, newMarks: data.awardedMarks }
        : {}),
      occurredAt: new Date(),
    });
    return NextResponse.json({
      ok: true,
      status: data.status,
      ...(data.status === "published"
        ? {
            awardedMarks: data.awardedMarks ?? before.awardedMarks ?? null,
            feedback: data.feedback ?? before.feedback ?? "",
          }
        : {}),
    });
  } catch {
    return NextResponse.json({ error: "Submission review could not be saved" }, { status: 500 });
  }
}
