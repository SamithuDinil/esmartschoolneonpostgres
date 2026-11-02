import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { validateAssignmentFile } from "@/server/services/assignment-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ expenseId: string }> };
const receiptMimes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function POST(request: NextRequest, { params }: Context) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "finance.manage"))
    return NextResponse.json({ error: "Finance management permission required" }, { status: 403 });
  const { expenseId } = await params;
  const { db, bucket } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  const expenseRef = root.collection("expenses").doc(expenseId);
  const expense = await expenseRef.get();
  if (!expense.exists) return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File))
    return NextResponse.json({ error: "Select a receipt file" }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const validationError = validateAssignmentFile(file, bytes, receiptMimes, 10 * 1024 * 1024);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const attachmentRef = expenseRef.collection("receipts").doc();
  const storagePath = `schools/${context.schoolId}/finance/expenses/${expenseId}/receipts/${attachmentRef.id}`;
  const metadata = {
    id: attachmentRef.id,
    expenseId,
    name: file.name.split(/[\\/]/).pop()?.slice(0, 150) ?? "receipt",
    contentType: file.type,
    size: file.size,
    storagePath,
    uploadedBy: context.uid,
    uploadedAt: new Date(),
    schoolId: context.schoolId,
  };
  try {
    await bucket.file(storagePath).save(bytes, {
      resumable: false,
      metadata: {
        contentType: file.type,
        cacheControl: "private, no-store",
        metadata: { schoolId: context.schoolId, uploadedBy: context.uid },
      },
    });
    await db.runTransaction(async (tx) => {
      const latest = await tx.get(expenseRef);
      if (!latest.exists) throw new Error("EXPENSE_NOT_FOUND");
      const current = (latest.get("receiptAttachments") as Array<{ id: string }> | undefined) ?? [];
      if (current.length >= 10) throw new Error("RECEIPT_LIMIT");
      tx.create(attachmentRef, metadata);
      tx.update(expenseRef, {
        receiptAttachments: FieldValue.arrayUnion(metadata),
        updatedAt: new Date(),
        updatedBy: context.uid,
      });
      tx.set(root.collection("auditLogs").doc(), {
        schoolId: context.schoolId,
        actorUid: context.uid,
        action: "finance.expense.receipt.uploaded",
        recordType: "expense",
        recordId: expenseId,
        attachmentId: attachmentRef.id,
        occurredAt: new Date(),
      });
    });
    const { storagePath: _path, schoolId: _schoolId, ...safe } = metadata;
    return NextResponse.json({ attachment: safe }, { status: 201 });
  } catch (error) {
    await bucket
      .file(storagePath)
      .delete({ ignoreNotFound: true })
      .catch(() => undefined);
    if (error instanceof Error && error.message === "RECEIPT_LIMIT")
      return NextResponse.json(
        { error: "This expense already has the maximum of 10 receipt attachments" },
        { status: 409 },
      );
    return NextResponse.json(
      { error: "Receipt could not be attached to the expense" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest, { params }: Context) {
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "finance.read"))
    return NextResponse.json({ error: "Finance read permission required" }, { status: 403 });
  const attachmentId = request.nextUrl.searchParams.get("attachmentId");
  if (!attachmentId)
    return NextResponse.json({ error: "Receipt attachment ID is required" }, { status: 400 });
  const { expenseId } = await params;
  const root = getAdminServices().db.collection("schools").doc(context.schoolId);
  try {
    const attachment = await root
      .collection("expenses")
      .doc(expenseId)
      .collection("receipts")
      .doc(attachmentId)
      .get();
    const path = attachment.get("storagePath");
    if (
      !attachment.exists ||
      typeof path !== "string" ||
      !path.startsWith(`schools/${context.schoolId}/finance/expenses/${expenseId}/receipts/`)
    )
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    const [url] = await getAdminServices()
      .bucket.file(path)
      .getSignedUrl({ action: "read", expires: Date.now() + 5 * 60 * 1000 });
    return NextResponse.json(
      { url, name: attachment.get("name"), expiresInSeconds: 300 },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Receipt could not be retrieved" }, { status: 500 });
  }
}
