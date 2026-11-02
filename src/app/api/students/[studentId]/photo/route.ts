import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { signatureMatches } from "@/server/services/assignment-files";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Ctx = { params: Promise<{ studentId: string }> };
export async function POST(req: NextRequest, { params }: Ctx) {
  if (!hasValidCsrf(req))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const c = await getSchoolContext();
  if (!c || !hasPermission(c.permissions, "students.update"))
    return NextResponse.json({ error: "Student update permission required" }, { status: 403 });
  const { studentId } = await params;
  try {
    const form = await req.formData(),
      file = form.get("file");
    if (
      !(file instanceof File) ||
      !new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type) ||
      file.size > 5 * 1024 * 1024
    )
      return NextResponse.json(
        { error: "Upload a JPEG, PNG or WebP image up to 5 MB" },
        { status: 400 },
      );
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!signatureMatches(file.type, bytes))
      return NextResponse.json(
        { error: "The file content does not match its declared image type" },
        { status: 400 },
      );
    const { db, bucket } = getAdminServices();
    const ref = db.collection("schools").doc(c.schoolId).collection("students").doc(studentId);
    if (!(await ref.get()).exists)
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    const path = `schools/${c.schoolId}/students/${studentId}/profile-photo`;
    await bucket.file(path).save(bytes, {
      metadata: { contentType: file.type, metadata: { schoolId: c.schoolId, studentId } },
    });
    await ref.update({
      photoPath: path,
      photoContentType: file.type,
      updatedAt: new Date(),
      updatedBy: c.uid,
    });
    return NextResponse.json({ ok: true, url: `/api/students/${studentId}/photo` });
  } catch {
    return NextResponse.json({ error: "Photo upload failed" }, { status: 500 });
  }
}
export async function GET(_req: NextRequest, { params }: Ctx) {
  const c = await getSchoolContext();
  if (!c || !hasPermission(c.permissions, "students.read"))
    return NextResponse.json({ error: "Student access denied" }, { status: 403 });
  const { studentId } = await params;
  try {
    const { db, bucket } = getAdminServices();
    const snap = await db
      .collection("schools")
      .doc(c.schoolId)
      .collection("students")
      .doc(studentId)
      .get();
    const path = snap.get("photoPath");
    if (
      !snap.exists ||
      typeof path !== "string" ||
      !path.startsWith(`schools/${c.schoolId}/students/${studentId}/`)
    )
      return new NextResponse(null, { status: 404 });
    const [bytes] = await bucket.file(path).download();
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new NextResponse(body, {
      headers: {
        "Content-Type": snap.get("photoContentType") ?? "image/jpeg",
        "Cache-Control": "private,no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Photo unavailable" }, { status: 404 });
  }
}
