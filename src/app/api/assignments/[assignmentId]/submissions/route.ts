import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import {
  canManageAssignment,
  canViewAssignment,
  guardianLinksForUid,
  notificationRecipientsForStudent,
  queueAssignmentNotification,
  studentRecordsForUid,
} from "@/server/services/assignments";
import {
  SAFE_ASSIGNMENT_FILE_TYPES,
  savePrivateAssignmentFile,
  validateAssignmentFile,
} from "@/server/services/assignment-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type RouteContext = { params: Promise<{ assignmentId: string }> };
const defaultAllowedTypes = Object.keys(SAFE_ASSIGNMENT_FILE_TYPES);

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "School access required" }, { status: 403 });
  const { assignmentId } = await params;
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  const assignmentRef = root.collection("assignments").doc(assignmentId);
  try {
    const assignment = await assignmentRef.get();
    if (
      !assignment.exists ||
      !(await canViewAssignment(root, context, assignmentRef, assignment.data()!))
    )
      return NextResponse.json(
        { error: "Assignment or submission access denied" },
        { status: 403 },
      );
    const manage = await canManageAssignment(root, context, assignment.data()!);
    if (manage || hasPermission(context.permissions, "assignments.read")) {
      const submissions = await assignmentRef.collection("submissions").limit(500).get();
      const rows = await Promise.all(
        submissions.docs.map(async (doc) => {
          const student = await root.collection("students").doc(doc.id).get();
          const attempts = await doc.ref
            .collection("attempts")
            .orderBy("attemptNumber", "desc")
            .limit(20)
            .get();
          const attemptItems = await Promise.all(
            attempts.docs.map(async (item) => {
              const attachments = await item.ref.collection("attachments").limit(5).get();
              return {
                id: item.id,
                ...item.data(),
                attachments: attachments.docs.map((file) => ({
                  id: file.id,
                  name: file.get("name"),
                  contentType: file.get("contentType"),
                  size: file.get("size"),
                })),
              };
            }),
          );
          return {
            id: doc.id,
            student: student.exists
              ? {
                  id: student.id,
                  fullName: student.get("fullName"),
                  admissionNumber: student.get("admissionNumber"),
                  grade: student.get("grade"),
                  className: student.get("className"),
                }
              : null,
            ...doc.data(),
            attempts: attemptItems,
          };
        }),
      );
      return NextResponse.json(
        { items: rows },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    if (context.role === "student" && hasPermission(context.permissions, "assignments.self.read")) {
      const students = await studentRecordsForUid(root, context.uid);
      const submissions = [];
      for (const student of students) {
        if (!(await assignmentRef.collection("recipients").doc(student.id).get()).exists) continue;
        const snapshot = await assignmentRef.collection("submissions").doc(student.id).get();
        if (snapshot.exists) {
          const attempts = await snapshot.ref
            .collection("attempts")
            .orderBy("attemptNumber", "desc")
            .limit(20)
            .get();
          const data = snapshot.data()!;
          const published = data.status === "published";
          submissions.push({
            id: snapshot.id,
            assignmentId: data.assignmentId,
            studentId: data.studentId,
            status: data.status,
            attemptCount: data.attemptCount,
            submittedAt: data.submittedAt ?? null,
            wasLate: data.wasLate === true,
            awardedMarks: published ? (data.awardedMarks ?? null) : null,
            feedback: published ? (data.feedback ?? "") : "",
            attempts: attempts.docs.map((doc) => ({
              id: doc.id,
              attemptNumber: doc.get("attemptNumber"),
              status: doc.get("status"),
              submittedAt: doc.get("submittedAt"),
              wasLate: doc.get("wasLate") === true,
              textResponse: doc.get("textResponse") ?? "",
            })),
          });
        } else
          submissions.push({
            id: student.id,
            studentId: student.id,
            status: "not_started",
            attempts: [],
          });
      }
      return NextResponse.json(
        { items: submissions },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    if (
      context.role === "parent" &&
      hasPermission(context.permissions, "assignments.linked.read")
    ) {
      const links = await guardianLinksForUid(root, context.uid);
      const result = [];
      for (const link of links) {
        const studentId = String(link.get("studentId"));
        if (!(await assignmentRef.collection("recipients").doc(studentId).get()).exists) continue;
        const snapshot = await assignmentRef.collection("submissions").doc(studentId).get();
        const student = await root.collection("students").doc(studentId).get();
        const published = snapshot.exists && snapshot.get("status") === "published";
        result.push({
          studentId,
          studentName: student.get("fullName"),
          status: snapshot.exists ? snapshot.get("status") : "not_started",
          submittedAt: snapshot.get("submittedAt") ?? null,
          awardedMarks: published ? (snapshot.get("awardedMarks") ?? null) : null,
          feedback: published ? (snapshot.get("feedback") ?? "") : "",
        });
      }
      return NextResponse.json(
        { items: result },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    return NextResponse.json({ error: "Submission access denied" }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "Assignment submissions are unavailable" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (
    !context ||
    context.role !== "student" ||
    !hasPermission(context.permissions, "assignments.self.read")
  )
    return NextResponse.json(
      { error: "Only the assigned student account may submit this homework" },
      { status: 403 },
    );
  const { assignmentId } = await params;
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  const assignmentRef = root.collection("assignments").doc(assignmentId);
  const uploadedPaths: string[] = [];
  try {
    const assignment = await assignmentRef.get();
    if (
      !assignment.exists ||
      !(await canViewAssignment(root, context, assignmentRef, assignment.data()!))
    )
      return NextResponse.json({ error: "Assignment not available" }, { status: 404 });
    const students = await studentRecordsForUid(root, context.uid);
    let student: (typeof students)[number] | undefined;
    for (const candidate of students) {
      if (
        candidate.get("grade") !== assignment.get("grade") ||
        candidate.get("className") !== assignment.get("className") ||
        candidate.get("status") === "archived"
      )
        continue;
      if ((await assignmentRef.collection("recipients").doc(candidate.id).get()).exists) {
        student = candidate;
        break;
      }
    }
    if (!student)
      return NextResponse.json(
        { error: "This assignment is not assigned to your student account" },
        { status: 403 },
      );
    const form = await request.formData();
    const intent = form.get("intent") === "draft" ? "draft" : "submit";
    const textResponse = String(form.get("textResponse") ?? "").trim();
    if (textResponse.length > 20000)
      return NextResponse.json(
        { error: "Text response must be 20,000 characters or fewer" },
        { status: 400 },
      );
    const files = form
      .getAll("files")
      .filter((value): value is File => value instanceof File && value.size > 0);
    if (files.length > 5)
      return NextResponse.json(
        { error: "Upload up to five files per submission attempt" },
        { status: 400 },
      );
    if (!textResponse && files.length === 0)
      return NextResponse.json(
        { error: "Enter a text response or attach at least one file" },
        { status: 400 },
      );
    const policy = await root.collection("settings").doc("assignments").get();
    const allowed = (policy.get("allowedFileTypes") as string[] | undefined) ?? defaultAllowedTypes;
    const maxBytes =
      Math.min(20, Math.max(1, Number(policy.get("maxFileSizeMB") ?? 10))) * 1024 * 1024;
    const prepared = await Promise.all(
      files.map(async (file) => ({ file, bytes: Buffer.from(await file.arrayBuffer()) })),
    );
    for (const part of prepared) {
      const error = validateAssignmentFile(part.file, part.bytes, allowed, maxBytes);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }
    const submissionRef = assignmentRef.collection("submissions").doc(student.id);
    const existing = await submissionRef.get();
    const currentStatus = existing.get("status");
    const multiple = assignment.get("allowMultipleAttempts") === true;
    const canResubmit = currentStatus === "resubmission_requested";
    const isDraft = currentStatus === "in_progress";
    if (existing.exists && !isDraft && !canResubmit && !multiple)
      return NextResponse.json(
        { error: "This assignment does not allow another submission attempt" },
        { status: 409 },
      );
    const attemptNumber = isDraft
      ? Number(existing.get("attemptCount") ?? 1)
      : Number(existing.get("attemptCount") ?? 0) + 1;
    const attemptId =
      isDraft && typeof existing.get("latestAttemptId") === "string"
        ? String(existing.get("latestAttemptId"))
        : submissionRef.collection("attempts").doc().id;
    const attemptRef = submissionRef.collection("attempts").doc(attemptId);
    const attachmentRecords: Array<{
      id: string;
      name: string;
      contentType: string;
      size: number;
      storagePath: string;
    }> = [];
    for (const part of prepared) {
      const fileRef = attemptRef.collection("attachments").doc();
      const path = `schools/${context.schoolId}/assignments/${assignmentId}/submissions/${student.id}/${attemptId}/${fileRef.id}`;
      const metadata = await savePrivateAssignmentFile(
        path,
        part.file,
        part.bytes,
        context.schoolId,
        context.uid,
      );
      uploadedPaths.push(path);
      await fileRef.set(metadata);
      attachmentRecords.push({
        id: fileRef.id,
        name: metadata.name,
        contentType: metadata.contentType,
        size: metadata.size,
        storagePath: metadata.storagePath,
      });
    }
    const now = new Date();
    const deadline = Date.parse(String(assignment.get("deadlineAt")));
    const wasLate = Number.isFinite(deadline) && now.getTime() > deadline;
    const status = intent === "draft" ? "in_progress" : wasLate ? "submitted_late" : "submitted";
    await attemptRef.set(
      {
        assignmentId,
        studentId: student.id,
        attemptNumber,
        status,
        textResponse,
        submittedAt: intent === "submit" ? now.toISOString() : null,
        draftSavedAt: intent === "draft" ? now.toISOString() : null,
        wasLate,
        schoolId: context.schoolId,
        updatedBy: context.uid,
        updatedAt: now,
      },
      { merge: true },
    );
    await submissionRef.set(
      {
        assignmentId,
        studentId: student.id,
        schoolId: context.schoolId,
        latestAttemptId: attemptId,
        attemptCount: isDraft ? attemptNumber : attemptNumber,
        status,
        submittedAt: intent === "submit" ? now.toISOString() : null,
        wasLate,
        textResponse,
        updatedAt: now,
        ...(intent === "submit" ? { submittedBy: context.uid } : {}),
      },
      { merge: true },
    );
    await root.collection("auditLogs").add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action:
        intent === "draft"
          ? "assignment.submission.draft_saved"
          : wasLate
            ? "assignment.submission.late"
            : "assignment.submission.created",
      recordType: "assignmentSubmission",
      recordId: `${assignmentId}_${student.id}`,
      attemptId,
      occurredAt: now,
    });
    if (intent === "submit") {
      const targets = await notificationRecipientsForStudent(root, {
        id: student.id,
        ...student.data(),
      });
      if (targets.length)
        await queueAssignmentNotification(
          root,
          context.schoolId,
          `submission_${assignmentId}_${student.id}_${attemptId}`,
          {
            type: "assignment_submitted",
            title: "Homework submitted",
            message: `${String(assignment.get("title"))} was submitted${wasLate ? " after the deadline" : ""}.`,
            assignmentId,
            studentId: student.id,
            targetUids: targets,
          },
        );
      const teacherUids = [
        ...new Set(
          [context.uid, assignment.get("teacherUid"), assignment.get("createdBy")].filter(
            (uid): uid is string => typeof uid === "string",
          ),
        ),
      ];
      await queueAssignmentNotification(
        root,
        context.schoolId,
        `teacher_submission_${assignmentId}_${student.id}_${attemptId}`,
        {
          type: "assignment_submission_received",
          title: "Student submission received",
          message: `${String(student.get("fullName"))} submitted ${String(assignment.get("title"))}.`,
          assignmentId,
          studentId: student.id,
          targetUids: teacherUids,
        },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        status,
        submittedAt: intent === "submit" ? now.toISOString() : null,
        attemptId,
        attemptNumber,
        attachments: attachmentRecords.map(({ storagePath: _, ...item }) => item),
      },
      { status: 201 },
    );
  } catch {
    const { bucket } = getAdminServices();
    await Promise.all(
      uploadedPaths.map((path) =>
        bucket
          .file(path)
          .delete({ ignoreNotFound: true })
          .catch(() => undefined),
      ),
    );
    return NextResponse.json({ error: "Submission could not be saved" }, { status: 500 });
  }
}
