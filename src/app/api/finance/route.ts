import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, type SchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { safeEqual } from "@/server/secure-compare";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const chargeTypes = [
  "admission",
  "monthly",
  "term",
  "exam",
  "transport",
  "activity",
  "other",
] as const;
const paymentMethods = ["cash", "bank_transfer", "online_verified"] as const;
const expenseCategories = [
  "salaries",
  "utilities",
  "supplies",
  "maintenance",
  "transport",
  "events",
  "technology",
  "other",
] as const;
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD dates")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Invalid date");
const money = z.coerce
  .number()
  .finite()
  .min(0)
  .max(1_000_000_000_000)
  .refine(
    (value) => Math.round(value * 100) === value * 100,
    "Amounts may have at most two decimal places",
  );
const positiveMoney = money.refine((value) => value > 0, "Amount must be greater than zero");
const text = (max: number) => z.string().trim().min(1).max(max);

const feeTypeSchema = z.object({
  action: z.literal("fee_type"),
  id: z.string().trim().min(1).max(120).optional(),
  name: text(80),
  description: z.string().trim().max(240).optional().default(""),
  defaultAmount: money,
  category: z.enum(chargeTypes).default("other"),
  active: z.boolean().default(true),
});
const invoiceSchema = z
  .object({
    action: z.literal("invoice"),
    studentId: text(160),
    chargeType: z.enum(chargeTypes),
    feeTypeId: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(240).optional().default(""),
    amount: positiveMoney,
    discount: money.default(0),
    dueDate: dateSchema,
  })
  .refine((value) => value.discount <= value.amount, {
    message: "Discount cannot exceed the amount",
    path: ["discount"],
  });
const paymentSchema = z.object({
  action: z.literal("payment"),
  invoiceId: text(160),
  amount: positiveMoney,
  method: z.enum(paymentMethods),
  reference: z.string().trim().max(160).optional().default(""),
  notes: z.string().trim().max(240).optional().default(""),
});
const expenseSchema = z.object({
  action: z.literal("expense"),
  category: z.enum(expenseCategories),
  amount: positiveMoney,
  expenseDate: dateSchema,
  vendor: z.string().trim().max(160).optional().default(""),
  description: text(500),
  receiptReference: z.string().trim().max(160).optional().default(""),
});
const expenseDecisionSchema = z.object({
  action: z.literal("expense_decision"),
  expenseId: text(160),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().max(300).optional().default(""),
});
const onlineVerificationSchema = z.object({
  action: z.literal("verify_online_payment"),
  invoiceId: text(160),
  amount: positiveMoney,
  providerReference: text(160),
  notes: z.string().trim().max(240).optional().default(""),
});
const reversalSchema = z.object({
  action: z.literal("reverse_payment"),
  paymentId: text(160),
  reason: text(300),
});
const writeSchema = z.discriminatedUnion("action", [
  feeTypeSchema,
  invoiceSchema,
  paymentSchema,
  expenseSchema,
  expenseDecisionSchema,
  onlineVerificationSchema,
  reversalSchema,
]);

type FirestoreData = Record<string, unknown>;
function serialise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(serialise);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialise(item)]));
  return value;
}
function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
function denied(message = "You do not have permission to use finance records.") {
  return NextResponse.json({ error: message }, { status: 403 });
}
function auditData(
  context: SchoolContext,
  action: string,
  recordType: string,
  recordId: string,
  now: Date,
  extra: FirestoreData = {},
): FirestoreData {
  return {
    schoolId: context.schoolId,
    actorUid: context.uid,
    action,
    recordType,
    recordId,
    occurredAt: now,
    ...extra,
  };
}
function jsonRecord(snapshot: FirebaseFirestore.DocumentSnapshot): FirestoreData {
  return { id: snapshot.id, ...(snapshot.data() ?? {}) };
}

async function readDashboard(context: SchoolContext) {
  const root = getAdminServices().db.collection("schools").doc(context.schoolId);
  const [school, feeTypes, invoices, expenses, students, payments, receipts] = await Promise.all([
    root.get(),
    root.collection("feeTypes").limit(100).get(),
    root.collection("invoices").limit(500).get(),
    root.collection("expenses").limit(500).get(),
    root.collection("students").limit(500).get(),
    root.collection("payments").limit(1000).get(),
    root.collection("receipts").limit(1000).get(),
  ]);
  const invoiceRows = invoices.docs
    .map(jsonRecord)
    .sort((a, b) => String(b["createdAt"] ?? "").localeCompare(String(a["createdAt"] ?? "")));
  const expenseRows = expenses.docs
    .map(jsonRecord)
    .sort((a, b) => String(b["createdAt"] ?? "").localeCompare(String(a["createdAt"] ?? "")));
  const feeTypeRows = feeTypes.docs
    .map(jsonRecord)
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  const receiptNumbers = new Map(
    receipts.docs.map((receipt) => [
      receipt.id,
      String(receipt.get("receiptNumber") ?? receipt.id),
    ]),
  );
  const paymentRows: FirestoreData[] = payments.docs.map((doc) => ({
    ...jsonRecord(doc),
    receiptNumber: receiptNumbers.get(String(doc.get("receiptId") ?? "")) ?? "",
  }));
  paymentRows.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  const studentRows = students.docs
    .map((snapshot) => {
      const data = snapshot.data();
      return {
        id: snapshot.id,
        fullName: data.fullName ?? data.preferredName ?? "Unnamed student",
        admissionNumber: data.admissionNumber ?? "",
        grade: data.grade ?? "",
        className: data.className ?? "",
        status: data.status ?? "",
      };
    })
    .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
  const totalInvoiced = invoiceRows.reduce(
    (sum, row) => sum + Number(row.total ?? row.amount ?? 0),
    0,
  );
  const totalCollected = invoiceRows.reduce((sum, row) => sum + Number(row.paidAmount ?? 0), 0);
  const outstanding = invoiceRows.reduce((sum, row) => sum + Number(row.balance ?? 0), 0);
  const totalExpenses = expenseRows
    .filter((row) => row.status === "approved")
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const monthlyRevenue = payments.docs.reduce((sum, payment) => {
    const raw = payment.get("createdAt");
    const date =
      raw instanceof Date
        ? raw
        : raw && typeof raw === "object" && "toDate" in raw && typeof raw.toDate === "function"
          ? raw.toDate()
          : new Date(String(raw ?? ""));
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 7) === monthPrefix
      ? sum + Number(payment.get("amount") ?? 0)
      : sum;
  }, 0);
  const overdueInvoices = invoiceRows.filter(
    (row) =>
      Number(row.balance ?? 0) > 0 &&
      typeof row.dueDate === "string" &&
      row.dueDate < new Date().toISOString().slice(0, 10),
  ).length;
  return serialise({
    school: {
      id: school.id,
      name: school.data()?.name ?? "School",
      currency: school.data()?.currency ?? "LKR",
    },
    feeTypes: feeTypeRows,
    invoices: invoiceRows,
    expenses: expenseRows,
    payments: paymentRows,
    students: studentRows,
    metrics: {
      totalInvoiced: roundMoney(totalInvoiced),
      totalCollected: roundMoney(totalCollected),
      monthlyRevenue: roundMoney(monthlyRevenue),
      outstanding: roundMoney(outstanding),
      overdueInvoices,
      approvedExpenses: roundMoney(totalExpenses),
      netFinancial: roundMoney(totalCollected - totalExpenses),
      invoiceCount: invoiceRows.length,
      pendingExpenses: expenseRows.filter((row) => row.status === "pending").length,
    },
  });
}

export async function GET() {
  const context = await getSchoolContext();
  if (!context)
    return NextResponse.json(
      { error: "School access is not active for this account." },
      { status: 403 },
    );
  if (!hasPermission(context.permissions, "finance.read")) return denied();
  try {
    return NextResponse.json(await readDashboard(context), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Finance records could not be loaded." }, { status: 500 });
  }
}

async function createInvoice(context: SchoolContext, data: z.infer<typeof invoiceSchema>) {
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  const counterRef = root.collection("counters").doc("invoices");
  const invoiceRef = root.collection("invoices").doc();
  const studentRef = root.collection("students").doc(data.studentId);
  const feeTypeRef = data.feeTypeId ? root.collection("feeTypes").doc(data.feeTypeId) : null;
  const now = new Date();
  let result: FirestoreData = {};
  await db.runTransaction(async (tx) => {
    const [counterSnap, studentSnap, feeTypeSnap] = await Promise.all([
      tx.get(counterRef),
      tx.get(studentRef),
      feeTypeRef ? tx.get(feeTypeRef) : Promise.resolve(null),
    ]);
    if (!studentSnap.exists) throw new Error("STUDENT_NOT_FOUND");
    if (feeTypeRef && (!feeTypeSnap || !feeTypeSnap.exists)) throw new Error("FEE_TYPE_NOT_FOUND");
    if (feeTypeSnap?.exists && feeTypeSnap.get("active") === false)
      throw new Error("FEE_TYPE_INACTIVE");
    const previous = Number(counterSnap?.get("value") ?? 0);
    const next = Number.isInteger(previous) && previous >= 0 ? previous + 1 : 1;
    const total = roundMoney(data.amount - data.discount);
    const student = studentSnap.data() ?? {};
    result = {
      id: invoiceRef.id,
      invoiceNumber: `INV-${new Date().getUTCFullYear()}-${String(next).padStart(6, "0")}`,
      studentId: data.studentId,
      studentName: student.fullName ?? student.preferredName ?? "Unnamed student",
      admissionNumber: student.admissionNumber ?? "",
      chargeType: data.chargeType,
      feeTypeId: data.feeTypeId ?? "",
      description: data.description,
      amount: data.amount,
      discount: data.discount,
      total,
      paidAmount: 0,
      balance: total,
      status: "unpaid",
      dueDate: data.dueDate,
      schoolId: context.schoolId,
      createdBy: context.uid,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(counterRef, { value: next, updatedAt: now, updatedBy: context.uid }, { merge: true });
    tx.set(invoiceRef, result);
    tx.set(
      root.collection("auditLogs").doc(),
      auditData(context, "finance.invoice.created", "invoice", invoiceRef.id, now, {
        invoiceNumber: result.invoiceNumber,
        amount: total,
      }),
    );
  });
  return result;
}

async function createPayment(
  context: SchoolContext,
  invoiceId: string,
  amount: number,
  method: (typeof paymentMethods)[number],
  reference: string,
  notes: string,
  verification?: { providerReference: string },
) {
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  const invoiceRef = root.collection("invoices").doc(invoiceId);
  const paymentRef = root.collection("payments").doc();
  const receiptRef = root.collection("receipts").doc();
  const now = new Date();
  let result: FirestoreData = {};
  await db.runTransaction(async (tx) => {
    const invoiceSnap = await tx.get(invoiceRef);
    if (!invoiceSnap.exists) throw new Error("INVOICE_NOT_FOUND");
    const invoice = invoiceSnap.data() ?? {};
    const balance = roundMoney(
      Number(invoice.balance ?? Number(invoice.total ?? 0) - Number(invoice.paidAmount ?? 0)),
    );
    if (amount > balance) throw new Error("PAYMENT_EXCEEDS_BALANCE");
    const paidAmount = roundMoney(Number(invoice.paidAmount ?? 0) + amount);
    const remaining = roundMoney(balance - amount);
    const status = remaining === 0 ? "paid" : "partially_paid";
    result = {
      id: paymentRef.id,
      invoiceId,
      receiptId: receiptRef.id,
      invoiceNumber: invoice.invoiceNumber ?? "",
      studentId: invoice.studentId ?? "",
      amount,
      method,
      reference,
      notes,
      schoolId: context.schoolId,
      createdBy: context.uid,
      createdAt: now,
      ...(verification
        ? {
            verifiedMarker: "server_verified",
            providerReference: verification.providerReference,
            verifiedBy: context.uid,
            verifiedAt: now,
          }
        : {}),
    };
    tx.update(invoiceRef, {
      paidAmount,
      balance: remaining,
      status,
      updatedAt: now,
      lastPaymentAt: now,
    });
    tx.create(paymentRef, result);
    tx.create(receiptRef, {
      id: receiptRef.id,
      receiptNumber: `RCT-${String(invoice.invoiceNumber ?? invoiceId).replace(/[^A-Za-z0-9-]/g, "-")}-${paymentRef.id.slice(0, 8).toUpperCase()}`,
      paymentId: paymentRef.id,
      invoiceId,
      studentId: invoice.studentId ?? "",
      amount,
      method,
      schoolId: context.schoolId,
      issuedBy: context.uid,
      issuedAt: now,
      immutable: true,
      ...(verification ? { verifiedMarker: "server_verified" } : {}),
    });
    tx.set(
      root.collection("auditLogs").doc(),
      auditData(context, "finance.payment.recorded", "payment", paymentRef.id, now, {
        invoiceId,
        amount,
        method,
        status,
      }),
    );
    tx.set(
      root.collection("integrationEvents").doc(`fee-payment-${paymentRef.id}`),
      {
        schoolId: context.schoolId,
        eventType: "fee_payment_recorded",
        recordId: paymentRef.id,
        invoiceId,
        receiptId: receiptRef.id,
        studentId: invoice.studentId ?? "",
        amount,
        verificationState: verification ? "server_verified" : "recorded",
        occurredAt: now,
        actorUid: context.uid,
      },
      { merge: true },
    );
  });
  return result;
}

async function reversePayment(context: SchoolContext, paymentId: string, reason: string) {
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  const paymentRef = root.collection("payments").doc(paymentId);
  const now = new Date();
  await db.runTransaction(async (tx) => {
    const paymentSnap = await tx.get(paymentRef);
    if (!paymentSnap.exists) throw new Error("PAYMENT_NOT_FOUND");
    if (paymentSnap.get("reversedAt")) throw new Error("PAYMENT_ALREADY_REVERSED");
    const invoiceId = String(paymentSnap.get("invoiceId") ?? "");
    const invoiceRef = root.collection("invoices").doc(invoiceId);
    const invoiceSnap = await tx.get(invoiceRef);
    if (!invoiceSnap.exists) throw new Error("INVOICE_NOT_FOUND");
    const amount = roundMoney(Number(paymentSnap.get("amount") ?? 0));
    const total = roundMoney(Number(invoiceSnap.get("total") ?? 0));
    const paidAmount = roundMoney(Math.max(0, Number(invoiceSnap.get("paidAmount") ?? 0) - amount));
    const balance = roundMoney(Math.max(0, total - paidAmount));
    tx.update(paymentRef, {
      reversedAt: now,
      reversedBy: context.uid,
      reversalReason: reason,
      status: "reversed",
    });
    tx.update(invoiceRef, {
      paidAmount,
      balance,
      status: balance === 0 ? "paid" : paidAmount > 0 ? "partially_paid" : "unpaid",
      updatedAt: now,
      updatedBy: context.uid,
    });
    tx.create(root.collection("financeAdjustments").doc(), {
      schoolId: context.schoolId,
      type: "payment_reversal",
      paymentId,
      invoiceId,
      amount,
      reason,
      createdBy: context.uid,
      createdAt: now,
    });
    tx.set(
      root.collection("auditLogs").doc(),
      auditData(context, "finance.payment.reversed", "payment", paymentId, now, {
        invoiceId,
        amount,
        reason,
      }),
    );
  });
}
export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json(
      { error: "This secure request expired. Please reload and retry." },
      { status: 403 },
    );
  const context = await getSchoolContext();
  if (!context)
    return NextResponse.json(
      { error: "School access is not active for this account." },
      { status: 403 },
    );
  if (!hasPermission(context.permissions, "finance.manage"))
    return denied("Finance management permission required.");
  const raw = await request.json().catch(() => null);
  const parsed = writeSchema.safeParse(raw);
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "Please check the finance information and try again.",
        fields: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  const data = parsed.data;
  try {
    if (data.action === "fee_type") {
      const { db } = getAdminServices();
      const root = db.collection("schools").doc(context.schoolId);
      const ref = data.id
        ? root.collection("feeTypes").doc(data.id)
        : root.collection("feeTypes").doc();
      const now = new Date();
      const payload = {
        schoolId: context.schoolId,
        name: data.name,
        description: data.description,
        defaultAmount: data.defaultAmount,
        category: data.category,
        active: data.active,
        updatedAt: now,
        updatedBy: context.uid,
      };
      await db.runTransaction(async (tx) => {
        tx.set(ref, { ...payload, createdAt: now, createdBy: context.uid }, { merge: true });
        tx.set(
          root.collection("auditLogs").doc(),
          auditData(context, "finance.fee_type.saved", "feeType", ref.id, now, { name: data.name }),
        );
      });
      const safePayload = serialise(payload) as FirestoreData;
      return NextResponse.json({ id: ref.id, ...safePayload }, { status: 201 });
    }
    if (data.action === "invoice") {
      const result = await createInvoice(context, data);
      return NextResponse.json(serialise({ invoice: result }), { status: 201 });
    }
    if (data.action === "payment") {
      if (data.method === "online_verified")
        return NextResponse.json(
          {
            error:
              "Browser requests cannot mark online payments verified. Use the server-side verification flow documented in the finance API (x-finance-verification-token plus finance.payments.verify).",
          },
          { status: 403 },
        );
      const result = await createPayment(
        context,
        data.invoiceId,
        data.amount,
        data.method,
        data.reference,
        data.notes,
      );
      return NextResponse.json(serialise({ payment: result }), { status: 201 });
    }
    if (data.action === "reverse_payment") {
      await reversePayment(context, data.paymentId, data.reason);
      return NextResponse.json({ ok: true });
    }
    if (data.action === "verify_online_payment") {
      const configuredToken = process.env.FINANCE_ONLINE_VERIFICATION_TOKEN;
      const suppliedToken = request.headers.get("x-finance-verification-token");
      if (
        !configuredToken ||
        !suppliedToken ||
        !safeEqual(suppliedToken, configuredToken) ||
        !hasPermission(context.permissions, "finance.payments.verify")
      )
        return denied("Privileged server-side online payment verification is required.");
      const result = await createPayment(
        context,
        data.invoiceId,
        data.amount,
        "online_verified",
        data.providerReference,
        data.notes,
        { providerReference: data.providerReference },
      );
      return NextResponse.json(serialise({ payment: result }), { status: 201 });
    }
    if (data.action === "expense") {
      const { db } = getAdminServices();
      const root = db.collection("schools").doc(context.schoolId);
      const ref = root.collection("expenses").doc();
      const now = new Date();
      const payload = {
        id: ref.id,
        schoolId: context.schoolId,
        category: data.category,
        amount: data.amount,
        expenseDate: data.expenseDate,
        vendor: data.vendor,
        description: data.description,
        receiptReference: data.receiptReference,
        status: "pending",
        createdBy: context.uid,
        createdAt: now,
        updatedAt: now,
      };
      await db.runTransaction(async (tx) => {
        tx.create(ref, payload);
        tx.set(
          root.collection("auditLogs").doc(),
          auditData(context, "finance.expense.created", "expense", ref.id, now, {
            amount: data.amount,
            category: data.category,
          }),
        );
      });
      return NextResponse.json(serialise({ expense: payload }), { status: 201 });
    }
    if (data.action === "expense_decision") {
      if (!hasPermission(context.permissions, "finance.expenses.approve"))
        return denied("Separate expense approval permission required.");
      const { db } = getAdminServices();
      const root = db.collection("schools").doc(context.schoolId);
      const ref = root.collection("expenses").doc(data.expenseId);
      const now = new Date();
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new Error("EXPENSE_NOT_FOUND");
        if (snapshot.get("status") !== "pending") throw new Error("EXPENSE_ALREADY_DECIDED");
        tx.update(ref, {
          status: data.decision,
          decisionReason: data.reason,
          decidedBy: context.uid,
          decidedAt: now,
          updatedAt: now,
        });
        tx.set(
          root.collection("auditLogs").doc(),
          auditData(context, `finance.expense.${data.decision}`, "expense", ref.id, now, {
            reason: data.reason,
          }),
        );
      });
      return NextResponse.json({ ok: true, status: data.decision });
    }
    return NextResponse.json({ error: "Unsupported finance operation." }, { status: 400 });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "";
    if (code === "STUDENT_NOT_FOUND")
      return NextResponse.json({ error: "Student was not found in this school." }, { status: 404 });
    if (code === "FEE_TYPE_NOT_FOUND")
      return NextResponse.json(
        { error: "Fee type was not found in this school." },
        { status: 404 },
      );
    if (code === "FEE_TYPE_INACTIVE")
      return NextResponse.json({ error: "This fee type is inactive." }, { status: 409 });
    if (code === "INVOICE_NOT_FOUND")
      return NextResponse.json({ error: "Invoice was not found in this school." }, { status: 404 });
    if (code === "PAYMENT_EXCEEDS_BALANCE")
      return NextResponse.json(
        { error: "Payment cannot exceed the invoice balance." },
        { status: 409 },
      );
    if (code === "PAYMENT_NOT_FOUND")
      return NextResponse.json({ error: "Payment was not found in this school." }, { status: 404 });
    if (code === "PAYMENT_ALREADY_REVERSED")
      return NextResponse.json(
        { error: "This payment has already been reversed." },
        { status: 409 },
      );
    if (code === "EXPENSE_NOT_FOUND")
      return NextResponse.json({ error: "Expense was not found in this school." }, { status: 404 });
    if (code === "EXPENSE_ALREADY_DECIDED")
      return NextResponse.json(
        { error: "This expense has already been decided." },
        { status: 409 },
      );
    return NextResponse.json({ error: "Finance record could not be saved." }, { status: 500 });
  }
}
