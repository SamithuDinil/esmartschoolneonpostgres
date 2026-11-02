import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { signatureMatches } from "@/server/services/assignment-files";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type RouteContext = { params: Promise<{ studentId: string }> };
const allowed = new Set(["application/pdf", "image/jpeg", "image/png"]);
export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "documents.write"))
    return NextResponse.json({ error: "Document upload permission required" }, { status: 403 });
  const { studentId } = await params;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      file.size < 1 ||
      file.size > 8 * 1024 * 1024 ||
      !allowed.has(file.type)
    )
      return NextResponse.json({ error: "Upload a PDF, JPEG or PNG up to 8 MB" }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!signatureMatches(file.type, bytes))
      return NextResponse.json(
        { error: "The file content does not match its declared type" },
        { status: 400 },
      );
    const { db, bucket } = getAdminServices();
    const student = await db
      .collection("schools")
      .doc(context.schoolId)
      .collection("students")
      .doc(studentId)
      .get();
    if (!student.exists) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    const docRef = db
      .collection("schools")
      .doc(context.schoolId)
      .collection("students")
      .doc(studentId)
      .collection("documents")
      .doc();
    const path = `schools/${context.schoolId}/students/${studentId}/${docRef.id}`;
    await bucket.file(path).save(bytes, {
      metadata: {
        contentType: file.type,
        metadata: { schoolId: context.schoolId, studentId, uploadedBy: context.uid },
      },
    });
    await docRef.set({
      name: file.name.slice(0, 160),
      contentType: file.type,
      size: file.size,
      storagePath: path,
      uploadedBy: context.uid,
      createdAt: new Date(),
    });
    await db.collection("schools").doc(context.schoolId).collection("auditLogs").add({
      actorUid: context.uid,
      action: "student.document.uploaded",
      recordType: "student",
      recordId: studentId,
      occurredAt: new Date(),
    });
    return NextResponse.json({ id: docRef.id, name: file.name }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Document upload failed" }, { status: 500 });
  }
}
export async function GET(request: NextRequest, { params }: RouteContext) {
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "documents.read"))
    return NextResponse.json({ error: "Document access permission required" }, { status: 403 });
  const { studentId } = await params;
  const id = request.nextUrl.searchParams.get("documentId");
  if (!id) return NextResponse.json({ error: "Document id required" }, { status: 400 });
  try {
    const { db, bucket } = getAdminServices();
    const doc = await db
      .collection("schools")
      .doc(context.schoolId)
      .collection("students")
      .doc(studentId)
      .collection("documents")
      .doc(id)
      .get();
    if (!doc.exists) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const path = doc.get("storagePath");
    if (
      typeof path !== "string" ||
      !path.startsWith(`schools/${context.schoolId}/students/${studentId}/`)
    )
      return NextResponse.json({ error: "Invalid document reference" }, { status: 403 });
    const [url] = await bucket
      .file(path)
      .getSignedUrl({ action: "read", expires: Date.now() + 5 * 60 * 1000 });
    return NextResponse.json(
      { url, name: doc.get("name") },
      { headers: { "Cache-Control": "private,no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Document unavailable" }, { status: 500 });
  }
}
