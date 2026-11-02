import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasValidCsrf } from "@/server/csrf";
import { canManageAssignment } from "@/server/services/assignments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type RouteContext = { params: Promise<{ assignmentId: string }> };
const time = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const updateSchema = z
  .object({
    title: z.string().trim().min(3).max(140).optional(),
    instructions: z.string().trim().min(3).max(10000).optional(),
    deadlineAt: time.optional(),
    publishAt: time.nullable().optional(),
    allowMultipleAttempts: z.boolean().optional(),
    maxMarks: z.number().min(0).max(10000).optional(),
    referenceLinks: z
      .array(
        z
          .string()
          .url()
          .refine((url) => url.startsWith("https://")),
      )
      .max(12)
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "No fields to update");

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "School access required" }, { status: 403 });
  const { assignmentId } = await params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid assignment update", fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  const ref = root.collection("assignments").doc(assignmentId);
  try {
    const snapshot = await ref.get();
    if (!snapshot.exists)
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    const current = snapshot.data()!;
    if (!(await canManageAssignment(root, context, current)))
      return NextResponse.json(
        { error: "You are not assigned to edit this assignment" },
        { status: 403 },
      );
    if (!["draft", "scheduled"].includes(String(current.status)))
      return NextResponse.json(
        { error: "Published assignments cannot be edited; archive them and create a new version" },
        { status: 409 },
      );
    const year = await root.collection("academicYears").doc(String(current.academicYearId)).get();
    if (!year.exists || year.get("status") === "closed")
      return NextResponse.json(
        { error: "Assignment's academic year is closed or unavailable" },
        { status: 409 },
      );
    const changes = parsed.data;
    const deadlineAt = changes.deadlineAt ?? String(current.deadlineAt);
    if (Date.parse(deadlineAt) <= Date.now())
      return NextResponse.json(
        { error: "Assignment deadline must remain in the future" },
        { status: 400 },
      );
    if (changes.publishAt && Date.parse(changes.publishAt) <= Date.now())
      return NextResponse.json(
        { error: "Scheduled publication time must be in the future" },
        { status: 400 },
      );
    const status =
      changes.publishAt === null ? "draft" : changes.publishAt ? "scheduled" : current.status;
    const update = {
      ...changes,
      status,
      ...(changes.publishAt === null ? { publishAt: null } : {}),
      updatedAt: new Date(),
      updatedBy: context.uid,
    };
    await ref.update(update);
    await root.collection("auditLogs").add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: "assignment.updated",
      recordId: assignmentId,
      changedFields: Object.keys(changes),
      occurredAt: new Date(),
    });
    return NextResponse.json({ ok: true, status });
  } catch {
    return NextResponse.json({ error: "Assignment could not be updated" }, { status: 500 });
  }
}
