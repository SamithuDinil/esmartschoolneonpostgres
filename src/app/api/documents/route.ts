import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { signatureMatches } from "@/server/services/assignment-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const categories = [
  "student_admission",
  "teacher_qualification",
  "school_certificate",
  "examination",
  "financial_receipt",
  "administrative",
  "school_circular",
] as const;
const allowedTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
function rootFor(schoolId: string) {
  return getAdminServices().db.collection("schools").doc(schoolId);
}
function serialize(data: FirebaseFirestore.DocumentData) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function"
        ? value.toDate().toISOString()
        : value instanceof Date
          ? value.toISOString()
          : value,
    ]),
  );
}
function safeName(value: string) {
  return (
    value
      .replace(/[\\/\0\r\n]/g, "_")
      .trim()
      .slice(0, 160) || "document"
  );
}
function allowedPath(path: unknown, schoolId: string, documentId: string) {
  return typeof path === "string" && path.startsWith(`schools/${schoolId}/documents/${documentId}`);
}
function canViewDocument(
  data: FirebaseFirestore.DocumentData,
  context: Awaited<ReturnType<typeof getSchoolContext>>,
) {
  if (!context) return false;
  if (data.visibility === "restricted" && !hasPermission(context.permissions, "documents.write"))
    return false;
  return true;
}

export async function GET(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(context.permissions, "documents.read"))
    return NextResponse.json({ error: "Document access permission required." }, { status: 403 });
  const root = rootFor(context.schoolId);
  const documentId = request.nextUrl.searchParams.get("documentId");
  try {
    if (documentId) {
      const doc = await root.collection("documents").doc(documentId).get();
      if (
        !doc.exists ||
        doc.get("status") === "archived" ||
        !canViewDocument(doc.data() ?? {}, context)
      )
        return NextResponse.json({ error: "Document not found." }, { status: 404 });
      const storagePath = doc.get("storagePath");
      if (!allowedPath(storagePath, context.schoolId, documentId))
        return NextResponse.json({ error: "Invalid private document reference." }, { status: 403 });
      const [url] = await getAdminServices()
        .bucket.file(storagePath as string)
        .getSignedUrl({ action: "read", expires: Date.now() + 5 * 60 * 1000 });
      await root.collection("documentHistory").add({
        schoolId: context.schoolId,
        documentId,
        action: "downloaded",
        actorUid: context.uid,
        occurredAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json(
        { url, name: doc.get("name"), expiresInSeconds: 300 },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    const category = request.nextUrl.searchParams.get("category");
    const snapshot = await root
      .collection("documents")
      .orderBy("createdAt", "desc")
      .limit(300)
      .get()
      .catch(() => root.collection("documents").limit(300).get());
    const documents = snapshot.docs
      .filter(
        (doc) => doc.get("status") !== "archived" && canViewDocument(doc.data() ?? {}, context),
      )
      .map((doc): Record<string, unknown> & { id: string } => ({
        id: doc.id,
        ...serialize(doc.data()),
      }))
      .filter((doc) => !category || doc.category === category);
    return NextResponse.json({ documents, categories });
  } catch {
    return NextResponse.json({ error: "Documents could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(context.permissions, "documents.write"))
    return NextResponse.json({ error: "Document write permission required." }, { status: 403 });
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      file.size < 1 ||
      file.size > 15 * 1024 * 1024 ||
      !allowedTypes.has(file.type)
    )
      return NextResponse.json(
        { error: "Upload a supported PDF, image, DOCX or XLSX file up to 15 MB." },
        { status: 400 },
      );
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!signatureMatches(file.type, bytes))
      return NextResponse.json(
        { error: "The file content does not match its declared type." },
        { status: 400 },
      );
    const category = String(form.get("category") ?? "");
    if (!categories.includes(category as (typeof categories)[number]))
      return NextResponse.json({ error: "Choose a valid document category." }, { status: 400 });
    const root = rootFor(context.schoolId);
    const requestedId = String(form.get("documentId") ?? "").trim();
    const ref = requestedId
      ? root.collection("documents").doc(requestedId)
      : root.collection("documents").doc();
    const previous = requestedId ? await ref.get() : null;
    if (
      requestedId &&
      (!previous?.exists ||
        !allowedPath(previous.get("storagePath"), context.schoolId, requestedId))
    )
      return NextResponse.json({ error: "Document to replace was not found." }, { status: 404 });
    const storagePath = `schools/${context.schoolId}/documents/${ref.id}/${safeName(file.name)}`;
    const bucket = getAdminServices().bucket;
    await bucket.file(storagePath).save(bytes, {
      metadata: {
        contentType: file.type,
        metadata: { schoolId: context.schoolId, documentId: ref.id, uploadedBy: context.uid },
      },
    });
    if (
      previous?.exists &&
      previous.get("storagePath") &&
      previous.get("storagePath") !== storagePath
    )
      await bucket
        .file(previous.get("storagePath"))
        .delete()
        .catch(() => undefined);
    const record = {
      schoolId: context.schoolId,
      name: safeName(String(form.get("name") ?? file.name)),
      originalName: file.name.slice(0, 160),
      category,
      recordType: String(form.get("recordType") ?? "administrative").slice(0, 80),
      recordId: String(form.get("recordId") ?? "").slice(0, 160) || null,
      visibility: String(form.get("visibility") ?? "restricted").slice(0, 40),
      contentType: file.type,
      size: file.size,
      storagePath,
      status: "active",
      uploadedBy: context.uid,
      updatedAt: FieldValue.serverTimestamp(),
      ...(previous?.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    };
    await ref.set(record, { merge: true });
    await root.collection("documentHistory").add({
      schoolId: context.schoolId,
      documentId: ref.id,
      action: previous?.exists ? "replaced" : "uploaded",
      actorUid: context.uid,
      fileName: record.name,
      occurredAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json(
      { ok: true, document: { id: ref.id, name: record.name, category: record.category } },
      { status: previous?.exists ? 200 : 201 },
    );
  } catch {
    return NextResponse.json({ error: "Document upload failed." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(context.permissions, "documents.write"))
    return NextResponse.json({ error: "Document write permission required." }, { status: 403 });
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as {
    documentId?: string;
    action?: string;
    name?: string;
    category?: string;
    visibility?: string;
  } | null;
  if (!body?.documentId || !["rename", "archive", "metadata"].includes(body.action ?? ""))
    return NextResponse.json({ error: "A valid document action is required." }, { status: 400 });
  const root = rootFor(context.schoolId);
  const ref = root.collection("documents").doc(body.documentId);
  const existing = await ref.get();
  if (
    !existing.exists ||
    !allowedPath(existing.get("storagePath"), context.schoolId, body.documentId)
  )
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  const patch =
    body.action === "archive"
      ? { status: "archived", archivedAt: FieldValue.serverTimestamp(), archivedBy: context.uid }
      : {
          ...(body.name ? { name: safeName(body.name) } : {}),
          ...(body.category && categories.includes(body.category as (typeof categories)[number])
            ? { category: body.category }
            : {}),
          ...(body.visibility ? { visibility: body.visibility.slice(0, 40) } : {}),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
        };
  await ref.update(patch);
  await root.collection("documentHistory").add({
    schoolId: context.schoolId,
    documentId: body.documentId,
    action: body.action,
    actorUid: context.uid,
    occurredAt: FieldValue.serverTimestamp(),
  });
  return NextResponse.json({ ok: true });
}
