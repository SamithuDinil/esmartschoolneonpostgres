import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { studentCreateSchema } from "@/server/schemas/student";
import { importStudentRows, validateStudentRows } from "@/server/student-import";
import { canonicalizeColumns, canonicalizeRecord } from "@/lib/csv";
import { aliasesFor, columnsFor, type ImportOperation } from "@/lib/student-csv";
import { bulkActionSchema } from "@/server/schemas/bulk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Row = Record<string, unknown>;
type PreviewRow = Row & { rowNumber?: number };
const studentColumns = [
  "fullName",
  "dateOfBirth",
  "gender",
  "grade",
  "className",
  "admissionDate",
  "guardianName",
  "guardianEmail",
  "guardianPhone",
];
const markColumns = ["studentId", "examId", "marks"];
const paymentColumns = ["invoiceId", "amount", "paymentDate", "method", "reference", "verified"];

function rootFor(schoolId: string) {
  return getAdminServices().db.collection("schools").doc(schoolId);
}
function text(value: unknown) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}
function dateValue(value: unknown) {
  return value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof value.toDate === "function"
    ? value.toDate().toISOString()
    : value instanceof Date
      ? value.toISOString()
      : value;
}
function serialize(data: FirebaseFirestore.DocumentData): Row {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, dateValue(value)]));
}
function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}
function normalName(value: unknown) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function requiredFor(operation: string) {
  return operation === "students_import"
    ? studentColumns
    : operation === "marks_import"
      ? markColumns
      : paymentColumns;
}
function duplicateKey(operation: string, record: Row) {
  if (operation === "students_import")
    return `${normalName(record.fullName)}|${text(record.dateOfBirth)}`;
  if (operation === "marks_import") return `${text(record.studentId)}|${text(record.examId)}`;
  return `${text(record.invoiceId)}|${text(record.reference)}|${text(record.paymentDate)}`;
}

async function validateRows(
  schoolRoot: FirebaseFirestore.DocumentReference,
  operation: string,
  columns: string[],
  records: Row[],
  maxMarks = 100,
) {
  const op = operation as ImportOperation;
  const canonicalColumns = canonicalizeColumns(columns, columnsFor(op), aliasesFor(op));
  const required = requiredFor(operation);
  const missing = required.filter((column) => !canonicalColumns.includes(column));
  const errors: Array<{ row: number; message: string }> = [];
  if (missing.length)
    return {
      valid: [] as PreviewRow[],
      errors: [
        {
          row: 1,
          message: `Missing required columns: ${missing.join(", ")}. Use "Download sample CSV" for the exact structure.`,
        },
      ],
    };
  if (operation === "students_import") {
    const checked = await validateStudentRows(
      records.map((values, index) => ({ row: index + 2, values })),
      schoolRoot.id,
    );
    return {
      valid: checked.accepted.map(
        (entry) => ({ ...entry.data, rowNumber: entry.row }) as PreviewRow,
      ),
      errors: checked.issues,
    };
  }
  const valid: PreviewRow[] = [];
  const seen = new Set<string>();
  const normalized = records.map((record) =>
    canonicalizeRecord(record, columnsFor(op), aliasesFor(op)),
  );
  const examIds = [...new Set(normalized.map((record) => text(record.examId)).filter(Boolean))];
  const exams = new Map<string, FirebaseFirestore.DocumentSnapshot>();
  const students = new Map<string, boolean>();
  if (operation === "marks_import") {
    await Promise.all(
      examIds.map(async (id) => {
        exams.set(id, await schoolRoot.collection("exams").doc(id).get());
      }),
    );
    const studentIds = [
      ...new Set(normalized.map((record) => text(record.studentId)).filter(Boolean)),
    ];
    for (let offset = 0; offset < studentIds.length; offset += 50) {
      await Promise.all(
        studentIds.slice(offset, offset + 50).map(async (id) => {
          students.set(id, (await schoolRoot.collection("students").doc(id).get()).exists);
        }),
      );
    }
  }
  for (const [index, record] of normalized.entries()) {
    const row = index + 2;
    const duplicate = duplicateKey(operation, record);
    if (seen.has(duplicate)) {
      errors.push({ row, message: "Duplicate record in this file" });
      continue;
    }
    seen.add(duplicate);
    if (operation === "marks_import") {
      const marks = numberValue(record.marks);
      const exam = exams.get(text(record.examId));
      const limit = exam?.exists ? Number(exam.get("maxMarks") ?? maxMarks) : maxMarks;
      if (!text(record.studentId) || !text(record.examId)) {
        errors.push({ row, message: "studentId and examId are required" });
        continue;
      }
      if (!exam?.exists) {
        errors.push({
          row,
          message: `Examination "${text(record.examId)}" was not found in this school`,
        });
        continue;
      }
      if (!students.get(text(record.studentId))) {
        errors.push({
          row,
          message: `Student "${text(record.studentId)}" was not found in this school`,
        });
        continue;
      }
      if (!Number.isFinite(marks) || marks < 0 || marks > limit) {
        errors.push({ row, message: `Marks must be a number between 0 and ${limit}` });
        continue;
      }
    } else {
      const amount = numberValue(record.amount);
      if (!text(record.invoiceId)) {
        errors.push({ row, message: "invoiceId is required" });
        continue;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        errors.push({ row, message: "Amount must be a positive number" });
        continue;
      }
      if (!/^(true|yes|1)$/i.test(text(record.verified))) {
        errors.push({ row, message: "verified must be true for a payment to be imported" });
        continue;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text(record.paymentDate))) {
        errors.push({ row, message: "paymentDate must use YYYY-MM-DD" });
        continue;
      }
    }
    valid.push({ ...record, rowNumber: row });
  }
  return { valid, errors };
}

async function confirmPreview(
  context: Awaited<ReturnType<typeof getSchoolContext>>,
  previewId: string,
) {
  if (!context) throw new Error("AUTHENTICATION_REQUIRED");
  const { db } = getAdminServices();
  const ref = db
    .collection("schools")
    .doc(context.schoolId)
    .collection("bulkImportPreviews")
    .doc(previewId);
  const snapshot = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (
      !current.exists ||
      current.get("actorUid") !== context.uid ||
      current.get("status") !== "preview"
    )
      throw new Error("PREVIEW_UNAVAILABLE");
    const expiresAt = current.get("expiresAt");
    const expiresMs =
      expiresAt && typeof expiresAt.toMillis === "function"
        ? expiresAt.toMillis()
        : new Date(expiresAt ?? 0).getTime();
    if (!expiresMs || expiresMs < Date.now()) throw new Error("PREVIEW_EXPIRED");
    transaction.update(ref, { status: "processing", confirmedAt: FieldValue.serverTimestamp() });
    return current;
  });
  return { ref, data: snapshot.data() ?? {} };
}

async function commitMarks(
  context: NonNullable<Awaited<ReturnType<typeof getSchoolContext>>>,
  records: PreviewRow[],
) {
  const { db } = getAdminServices();
  const root = rootFor(context.schoolId);
  const errors: Array<{ row: number; message: string }> = [];
  const byExam = new Map<string, PreviewRow[]>();
  for (const record of records) {
    const key = text(record.examId);
    byExam.set(key, [...(byExam.get(key) ?? []), record]);
  }
  let processed = 0;
  for (const [examId, rows] of byExam) {
    const examRef = root.collection("exams").doc(examId);
    const exam = await examRef.get();
    if (!exam.exists) {
      rows.forEach((row) =>
        errors.push({ row: Number(row.rowNumber ?? 0), message: "Examination not found" }),
      );
      continue;
    }
    const locked = ["approved", "published"].includes(String(exam.get("status")));
    if (locked && !hasPermission(context.permissions, "marks.approved.update")) {
      rows.forEach((row) =>
        errors.push({
          row: Number(row.rowNumber ?? 0),
          message: "Approved or published marks need correction permission",
        }),
      );
      continue;
    }
    const now = new Date();
    for (let offset = 0; offset < rows.length; offset += 400) {
      const batch = db.batch();
      const chunk = rows.slice(offset, offset + 400);
      chunk.forEach((record) => {
        batch.set(
          examRef.collection("marks").doc(text(record.studentId)),
          {
            studentId: text(record.studentId),
            marks: numberValue(record.marks),
            remarks: "",
            status: locked ? "approved" : "draft",
            source: "bulk_import",
            updatedAt: now,
            updatedBy: context.uid,
            schoolId: context.schoolId,
          },
          { merge: true },
        );
      });
      await batch.commit();
      processed += chunk.length;
    }
    await examRef.set(
      { status: locked ? exam.get("status") : "marks_entry", marksUpdatedAt: now, updatedAt: now },
      { merge: true },
    );
    await root.collection("auditLogs").add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: "exam.marks.bulk_imported",
      recordType: "exam",
      recordId: examId,
      count: rows.length,
      occurredAt: now,
    });
  }
  return { processed, errors };
}

async function commitPayments(
  context: NonNullable<Awaited<ReturnType<typeof getSchoolContext>>>,
  records: PreviewRow[],
) {
  const { db } = getAdminServices();
  let processed = 0;
  const errors: Array<{ row: number; message: string }> = [];
  for (const record of records) {
    const invoiceId = text(record.invoiceId);
    try {
      await db.runTransaction(async (transaction) => {
        const invoiceRef = rootFor(context.schoolId).collection("invoices").doc(invoiceId);
        const invoice = await transaction.get(invoiceRef);
        if (!invoice.exists) throw new Error("Invoice not found");
        const data = invoice.data() ?? {};
        const balance = Math.max(0, Number(data.balance ?? data.total ?? 0));
        const amount = numberValue(record.amount);
        if (amount > balance && balance > 0) throw new Error("Payment exceeds invoice balance");
        const paymentRef = rootFor(context.schoolId).collection("payments").doc();
        const remaining = Math.max(0, balance - amount);
        transaction.create(paymentRef, {
          schoolId: context.schoolId,
          invoiceId,
          invoiceNumber: data.invoiceNumber ?? invoiceId,
          studentId: data.studentId ?? null,
          amount,
          paymentDate: text(record.paymentDate),
          method: text(record.method) || "verified_import",
          reference: text(record.reference),
          verified: true,
          source: "bulk_import",
          createdBy: context.uid,
          createdAt: FieldValue.serverTimestamp(),
        });
        transaction.update(invoiceRef, {
          balance: remaining,
          paidAmount: Number(data.paidAmount ?? 0) + amount,
          status: remaining <= 0 ? "paid" : "partially_paid",
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      processed++;
    } catch (cause) {
      errors.push({
        row: Number(record.rowNumber ?? 0),
        message: cause instanceof Error ? cause.message : "Payment could not be committed",
      });
    }
  }
  return { processed, errors };
}

async function commitStudents(
  context: NonNullable<Awaited<ReturnType<typeof getSchoolContext>>>,
  records: PreviewRow[],
) {
  const errors: Array<{ row: number; message: string }> = [];
  const rows: Array<{ row: number; data: ReturnType<typeof studentCreateSchema.parse> }> = [];
  for (const record of records) {
    const parsed = studentCreateSchema.safeParse(record);
    if (!parsed.success) {
      errors.push({
        row: Number(record.rowNumber ?? 0),
        message: "Student validation failed during confirmation",
      });
      continue;
    }
    rows.push({ row: Number(record.rowNumber ?? 0), data: parsed.data });
  }
  const written = await importStudentRows(context, rows);
  return { processed: written.imported, errors: [...errors, ...written.issues] };
}

async function commitPreview(
  context: NonNullable<Awaited<ReturnType<typeof getSchoolContext>>>,
  data: Row,
) {
  const records = Array.isArray(data.validRecords) ? (data.validRecords as PreviewRow[]) : [];
  const operation = text(data.operation);
  if (operation === "students_import") return commitStudents(context, records);
  if (operation === "marks_import") return commitMarks(context, records);
  return commitPayments(context, records);
}

export async function GET(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const exportType = request.nextUrl.searchParams.get("export");
  if (!exportType) return NextResponse.json({ error: "Export type required." }, { status: 400 });
  const allowed =
    exportType === "students"
      ? hasPermission(context.permissions, "students.read")
      : exportType === "marks"
        ? hasPermission(context.permissions, "exams.read")
        : exportType === "payments"
          ? hasPermission(context.permissions, "finance.read")
          : false;
  if (!allowed) return NextResponse.json({ error: "Export permission required." }, { status: 403 });
  const collection =
    exportType === "students" ? "students" : exportType === "marks" ? "marks" : "payments";
  const schoolRoot = rootFor(context.schoolId);
  const [snapshot, schoolSnapshot] = await Promise.all([
    schoolRoot.collection(collection).limit(2000).get(),
    exportType === "students" ? schoolRoot.get() : Promise.resolve(null),
  ]);
  const schoolData = schoolSnapshot?.data() ?? {};
  return NextResponse.json({
    exportType,
    rows: snapshot.docs.map((doc) => ({ id: doc.id, ...serialize(doc.data()) })),
    ...(exportType === "students"
      ? {
          school: {
            name: schoolData.name ?? "School",
            logoUrl: schoolData.logoUrl ?? "",
            address: schoolData.address ?? "",
          },
        }
      : {}),
    generatedAt: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(context.permissions, "bulk.manage"))
    return NextResponse.json({ error: "Bulk management permission required." }, { status: 403 });
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const parsed = bulkActionSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "The bulk operation is invalid.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  const action = parsed.data;
  const schoolRoot = rootFor(context.schoolId);
  try {
    if (action.action === "preview") {
      const checked = await validateRows(
        schoolRoot,
        action.operation,
        action.columns,
        action.records,
        action.maxMarks ?? 100,
      );
      const previewRef = schoolRoot.collection("bulkImportPreviews").doc();
      await previewRef.create({
        schoolId: context.schoolId,
        actorUid: context.uid,
        operation: action.operation,
        columns: action.columns,
        validRecords: checked.valid,
        errors: checked.errors,
        status: "preview",
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });
      return NextResponse.json({
        previewId: previewRef.id,
        operation: action.operation,
        total: action.records.length,
        valid: checked.valid.length,
        invalid: checked.errors.length,
        errors: checked.errors.slice(0, 100),
        preview: checked.valid.slice(0, 25),
      });
    }
    if (action.action === "confirm") {
      const claimed = await confirmPreview(context, action.previewId);
      try {
        const result = await commitPreview(context, claimed.data);
        await claimed.ref.update({
          status: "completed",
          processed: result.processed,
          errors: result.errors,
          completedAt: FieldValue.serverTimestamp(),
        });
        return NextResponse.json({ ok: true, operation: claimed.data.operation, ...result });
      } catch (cause) {
        await claimed.ref
          .update({ status: "failed", failedAt: FieldValue.serverTimestamp() })
          .catch(() => undefined);
        throw cause;
      }
    }
    if (action.action === "class_update") {
      const root = schoolRoot;
      const snapshots = await Promise.all(
        action.studentIds.map((id) => root.collection("students").doc(id).get()),
      );
      let updated = 0;
      for (let offset = 0; offset < snapshots.length; offset += 200) {
        const batch = getAdminServices().db.batch();
        snapshots.slice(offset, offset + 200).forEach((student) => {
          if (!student.exists) return;
          const history = root.collection("enrollmentHistory").doc();
          batch.update(student.ref, {
            grade: action.grade,
            className: action.className,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: context.uid,
          });
          batch.create(history, {
            schoolId: context.schoolId,
            studentId: student.id,
            action: "class_assignment_updated",
            grade: action.grade,
            className: action.className,
            actorUid: context.uid,
            occurredAt: FieldValue.serverTimestamp(),
          });
          updated++;
        });
        await batch.commit();
      }
      return NextResponse.json({ ok: true, updated });
    }
    if (action.action === "generate_results") {
      const examRef = schoolRoot.collection("exams").doc(action.examId);
      const exam = await examRef.get();
      if (!exam.exists)
        return NextResponse.json(
          { error: "Examination not found in this school." },
          { status: 404 },
        );
      const maxMarks = Number(exam.get("maxMarks") ?? 100) || 100;
      const marks = await examRef.collection("marks").limit(2000).get();
      for (let offset = 0; offset < marks.docs.length; offset += 200) {
        const batch = getAdminServices().db.batch();
        marks.docs.slice(offset, offset + 200).forEach((mark) => {
          const data = mark.data();
          const percentage = Math.round((Number(data.marks ?? 0) / maxMarks) * 10000) / 100;
          const grade =
            percentage >= 75
              ? "A"
              : percentage >= 65
                ? "B"
                : percentage >= 50
                  ? "C"
                  : percentage >= 35
                    ? "S"
                    : "W";
          const result = schoolRoot
            .collection("results")
            .doc(`${action.examId}_${text(data.studentId || mark.id)}`);
          batch.set(
            result,
            {
              schoolId: context.schoolId,
              examId: action.examId,
              studentId: data.studentId || mark.id,
              marks: data.marks,
              maxMarks,
              percentage,
              grade,
              resultStatus: "generated",
              generatedBy: context.uid,
              generatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          batch.update(mark.ref, {
            resultStatus: "generated",
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
        await batch.commit();
      }
      return NextResponse.json({ ok: true, generated: marks.size });
    }
    if (action.action === "recurring_invoices") {
      const students = await Promise.all(
        action.studentIds.map((id) => schoolRoot.collection("students").doc(id).get()),
      );
      let created = 0;
      for (let offset = 0; offset < students.length; offset += 400) {
        const batch = getAdminServices().db.batch();
        students.slice(offset, offset + 400).forEach((student, index) => {
          if (!student.exists) return;
          const ref = schoolRoot.collection("invoices").doc();
          batch.create(ref, {
            schoolId: context.schoolId,
            studentId: student.id,
            studentName: student.get("fullName") ?? "",
            admissionNumber: student.get("admissionNumber") ?? "",
            invoiceNumber: `BULK-${new Date().getFullYear()}-${String(offset + index + 1).padStart(4, "0")}`,
            chargeType: action.chargeType,
            description: action.description || "Recurring invoice",
            amount: action.amount,
            total: action.amount,
            paidAmount: 0,
            balance: action.amount,
            status: "open",
            dueDate: action.dueDate,
            createdBy: context.uid,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          created++;
        });
        await batch.commit();
      }
      return NextResponse.json({ ok: true, created });
    }
    if (action.action === "fee_reminders") {
      let created = 0;
      for (const invoiceId of action.invoiceIds) {
        const invoice = await schoolRoot.collection("invoices").doc(invoiceId).get();
        if (!invoice.exists) continue;
        const data = invoice.data() ?? {};
        const studentId = text(data.studentId);
        const student = studentId
          ? await schoolRoot.collection("students").doc(studentId).get()
          : null;
        const recipientUid = text(
          data.recipientUid || student?.get("accountUid") || student?.get("userUid"),
        );
        if (!recipientUid) continue;
        const notification = schoolRoot.collection("notifications").doc();
        await notification.set({
          schoolId: context.schoolId,
          recipientUid,
          category: "Finance",
          title: "Fee reminder",
          message: `Invoice ${data.invoiceNumber ?? invoiceId} has an outstanding balance.`,
          deepLink: "/finance",
          channel: action.channel,
          read: false,
          archived: false,
          createdAt: FieldValue.serverTimestamp(),
        });
        created++;
      }
      return NextResponse.json({ ok: true, created });
    }
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "";
    if (code === "PREVIEW_UNAVAILABLE")
      return NextResponse.json(
        {
          error:
            "This preview was already confirmed or is not available. Upload the file and preview it again.",
        },
        { status: 409 },
      );
    if (code === "PREVIEW_EXPIRED")
      return NextResponse.json(
        { error: "This preview expired after 30 minutes. Upload the file and preview it again." },
        { status: 410 },
      );
    return NextResponse.json(
      {
        error:
          code && !/^[A-Z_]+$/.test(code)
            ? code
            : "Bulk operation failed. Nothing further was written; review the import history and try again.",
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ error: "Unsupported bulk operation." }, { status: 400 });
}
