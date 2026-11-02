import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { canManageAssignment, canViewAssignment } from "@/server/services/assignments";
import {
  SAFE_ASSIGNMENT_FILE_TYPES,
  savePrivateAssignmentFile,
  validateAssignmentFile,
} from "@/server/services/assignment-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type RouteContext = { params: Promise<{ assignmentId: string }> };
const maxFileCount = 5;
const defaultAllowedTypes = Object.keys(SAFE_ASSIGNMENT_FILE_TYPES);

export async function GET(request: NextRequest, { params }: RouteContext) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "School access required" }, { status: 403 });
  const { assignmentId } = await params;
  const { db, bucket } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  try {
    const assignmentRef = root.collection("assignments").doc(assignmentId);
    const assignment = await assignmentRef.get();
    if (!assignment.exists)
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    if (!(await canViewAssignment(root, context, assignmentRef, assignment.data()!)))
      return NextResponse.json({ error: "Assignment material access denied" }, { status: 403 });
    const submissionStudentId = request.nextUrl.searchParams.get("submissionStudentId");
    const attemptId = request.nextUrl.searchParams.get("attemptId");
    const submissionAttachmentId = request.nextUrl.searchParams.get("submissionAttachmentId");
    if (submissionStudentId && attemptId && submissionAttachmentId) {
      if (
        !hasPermission(context.permissions, "assignments.read") &&
        !(await canManageAssignment(root, context, assignment.data()!))
      )
        return NextResponse.json({ error: "Submission file access denied" }, { status: 403 });
      const recipient = await assignmentRef.collection("recipients").doc(submissionStudentId).get();
      if (!recipient.exists)
        return NextResponse.json({ error: "Submission file not found" }, { status: 404 });
      const attempt = await assignmentRef
        .collection("submissions")
        .doc(submissionStudentId)
        .collection("attempts")
        .doc(attemptId)
        .get();
      if (!attempt.exists)
        return NextResponse.json({ error: "Submission attempt not found" }, { status: 404 });
      const file = await attempt.ref.collection("attachments").doc(submissionAttachmentId).get();
      if (!file.exists)
        return NextResponse.json({ error: "Submission attachment not found" }, { status: 404 });
      const path = file.get("storagePath");
      const prefix = `schools/${context.schoolId}/assignments/${assignmentId}/submissions/${submissionStudentId}/${attemptId}/`;
      if (typeof path !== "string" || !path.startsWith(prefix))
        return NextResponse.json(
          { error: "Invalid private submission reference" },
          { status: 403 },
        );
      const name = String(file.get("name") ?? "student-submission").replace(/[\r\n"\\]/g, "_");
      const [url] = await bucket.file(path).getSignedUrl({
        action: "read",
        expires: Date.now() + 5 * 60 * 1000,
        responseDisposition: `attachment; filename="${name}"`,
      });
      return NextResponse.json(
        { url, name, contentType: file.get("contentType") },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    const attachmentId = request.nextUrl.searchParams.get("attachmentId");
    if (attachmentId) {
      const item = await assignmentRef.collection("attachments").doc(attachmentId).get();
      if (!item.exists)
        return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
      const path = item.get("storagePath");
      if (
        typeof path !== "string" ||
        !path.startsWith(`schools/${context.schoolId}/assignments/${assignmentId}/attachments/`)
      )
        return NextResponse.json(
          { error: "Invalid private attachment reference" },
          { status: 403 },
        );
      const name = String(item.get("name") ?? "assignment-material").replace(/[\r\n"\\]/g, "_");
      const [url] = await bucket.file(path).getSignedUrl({
        action: "read",
        expires: Date.now() + 5 * 60 * 1000,
        responseDisposition: `attachment; filename="${name}"`,
      });
      return NextResponse.json(
        { url, name, contentType: item.get("contentType") },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    const items = await assignmentRef
      .collection("attachments")
      .orderBy("uploadedAt", "desc")
      .limit(50)
      .get();
    return NextResponse.json(
      {
        items: items.docs.map((doc) => ({
          id: doc.id,
          name: doc.get("name"),
          contentType: doc.get("contentType"),
          size: doc.get("size"),
          uploadedAt: doc.get("uploadedAt"),
        })),
      },
      { headers: { "Cache-Control": "private,no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Assignment materials are unavailable" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "School access required" }, { status: 403 });
  const { assignmentId } = await params;
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  try {
    const assignmentRef = root.collection("assignments").doc(assignmentId);
    const assignment = await assignmentRef.get();
    if (!assignment.exists)
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    if (!(await canManageAssignment(root, context, assignment.data()!)))
      return NextResponse.json(
        { error: "Assignment authoring permission required" },
        { status: 403 },
      );
    if (["published", "archived"].includes(String(assignment.get("status"))))
      return NextResponse.json(
        { error: "Materials may be changed only before publication" },
        { status: 409 },
      );
    const form = await request.formData();
    const files = form
      .getAll("files")
      .filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length || files.length > maxFileCount)
      return NextResponse.json(
        { error: `Choose between 1 and ${maxFileCount} files.` },
        { status: 400 },
      );
    const policy = await root.collection("settings").doc("assignments").get();
    const allowed = (policy.get("allowedFileTypes") as string[] | undefined) ?? defaultAllowedTypes;
    const maxBytes =
      Math.min(20, Math.max(1, Number(policy.get("maxFileSizeMB") ?? 10))) * 1024 * 1024;
    const created: Array<{ id: string; name: string; storagePath: string }> = [];
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const invalid = validateAssignmentFile(file, bytes, allowed, maxBytes);
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
      const doc = assignmentRef.collection("attachments").doc();
      const path = `schools/${context.schoolId}/assignments/${assignmentId}/attachments/${doc.id}`;
      const metadata = await savePrivateAssignmentFile(
        path,
        file,
        bytes,
        context.schoolId,
        context.uid,
      );
      await doc.set(metadata);
      created.push({ id: doc.id, name: metadata.name, storagePath: path });
    }
    await root.collection("auditLogs").add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: "assignment.materials.uploaded",
      recordId: assignmentId,
      attachmentIds: created.map((item) => item.id),
      occurredAt: new Date(),
    });
    return NextResponse.json(
      { items: created.map(({ storagePath: _, ...item }) => item) },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { error: "Assignment materials could not be uploaded" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (
    !context ||
    (!hasPermission(context.permissions, "assignments.manage") &&
      !hasPermission(context.permissions, "assignments.manage.assigned"))
  )
    return NextResponse.json(
      { error: "Assignment authoring permission required" },
      { status: 403 },
    );
  const { assignmentId } = await params;
  const attachmentId = request.nextUrl.searchParams.get("attachmentId");
  if (!attachmentId) return NextResponse.json({ error: "Attachment id required" }, { status: 400 });
  const { db, bucket } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  try {
    const assignmentRef = root.collection("assignments").doc(assignmentId);
    const assignment = await assignmentRef.get();
    if (!assignment.exists || !(await canManageAssignment(root, context, assignment.data()!)))
      return NextResponse.json({ error: "Assignment not found or inaccessible" }, { status: 404 });
    if (["published", "archived"].includes(String(assignment.get("status"))))
      return NextResponse.json(
        { error: "Published assignment materials are retained" },
        { status: 409 },
      );
    const item = assignmentRef.collection("attachments").doc(attachmentId);
    const snapshot = await item.get();
    if (!snapshot.exists)
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    const path = snapshot.get("storagePath");
    if (
      typeof path === "string" &&
      path.startsWith(`schools/${context.schoolId}/assignments/${assignmentId}/attachments/`)
    )
      await bucket.file(path).delete({ ignoreNotFound: true });
    await item.delete();
    await root.collection("auditLogs").add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: "assignment.material.removed",
      recordId: assignmentId,
      attachmentId,
      occurredAt: new Date(),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Assignment material could not be removed" },
      { status: 500 },
    );
  }
}
