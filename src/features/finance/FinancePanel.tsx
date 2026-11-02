"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type Student = {
  id: string;
  fullName: string;
  admissionNumber?: string;
  grade?: string;
  className?: string;
  status?: string;
};
type FeeType = {
  id: string;
  name: string;
  description?: string;
  defaultAmount?: number;
  category?: string;
  active?: boolean;
};
type Invoice = {
  id: string;
  invoiceNumber?: string;
  studentId?: string;
  studentName?: string;
  admissionNumber?: string;
  chargeType?: string;
  description?: string;
  amount?: number;
  discount?: number;
  total?: number;
  paidAmount?: number;
  balance?: number;
  status?: string;
  dueDate?: string;
  createdAt?: string;
};
type Payment = {
  id: string;
  receiptNumber?: string;
  invoiceNumber?: string;
  studentId?: string;
  amount?: number;
  method?: string;
  reference?: string;
  createdAt?: string;
  status?: string;
};
type Expense = {
  id: string;
  receiptAttachments?: Array<{ id: string; name: string; size: number }>;
  category?: string;
  amount?: number;
  expenseDate?: string;
  vendor?: string;
  description?: string;
  receiptReference?: string;
  status?: string;
  createdAt?: string;
};
type FinanceData = {
  school?: { name?: string; currency?: string };
  feeTypes: FeeType[];
  invoices: Invoice[];
  expenses: Expense[];
  payments: Payment[];
  students: Student[];
  metrics: {
    totalInvoiced: number;
    totalCollected: number;
    monthlyRevenue: number;
    outstanding: number;
    overdueInvoices: number;
    approvedExpenses: number;
    netFinancial: number;
    invoiceCount: number;
    pendingExpenses: number;
  };
};

type Props = { canManage: boolean; canApprove: boolean; currency?: string };
const initialData: FinanceData = {
  feeTypes: [],
  invoices: [],
  expenses: [],
  payments: [],
  students: [],
  metrics: {
    totalInvoiced: 0,
    totalCollected: 0,
    monthlyRevenue: 0,
    outstanding: 0,
    overdueInvoices: 0,
    approvedExpenses: 0,
    netFinancial: 0,
    invoiceCount: 0,
    pendingExpenses: 0,
  },
};
const chargeTypes = ["admission", "monthly", "term", "exam", "transport", "activity", "other"];
const expenseCategories = [
  "salaries",
  "utilities",
  "supplies",
  "maintenance",
  "transport",
  "events",
  "technology",
  "other",
];

function money(value: unknown, currency: string) {
  return `${currency} ${Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function printReceipt(payment: Payment, currency: string) {
  const escape = (value: unknown) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  const receipt = window.open("", "_blank", "width=720,height=800");
  if (!receipt) return;
  receipt.opener = null;
  receipt.document.write(
    `<!doctype html><html><head><title>Fee receipt ${escape(payment.receiptNumber)}</title><style>body{font:15px Arial,sans-serif;padding:42px;color:#17233b}h1{font-size:24px}main{max-width:640px;margin:auto;border:1px solid #ccd3df;padding:28px}dl{display:grid;grid-template-columns:180px 1fr;gap:12px}dt{color:#5e6b7e}dd{margin:0;font-weight:600}.amount{font-size:22px;border-top:1px solid #ccd3df;padding-top:16px;margin-top:20px}@media print{button{display:none}}</style></head><body><main><h1>Payment receipt</h1><p>${escape(payment.receiptNumber)}</p><dl><dt>Invoice</dt><dd>${escape(payment.invoiceNumber)}</dd><dt>Student ID</dt><dd>${escape(payment.studentId)}</dd><dt>Date</dt><dd>${escape(payment.createdAt ? new Date(payment.createdAt).toLocaleString() : "")}</dd><dt>Method</dt><dd>${escape(payment.method)}</dd><dt>Reference</dt><dd>${escape(payment.reference)}</dd></dl><p class="amount">Amount received: ${escape(money(payment.amount, currency))}</p><button onclick="window.print()">Print / Save PDF</button></main></body></html>`,
  );
  receipt.document.close();
}

export function FinancePanel({ canManage, canApprove, currency = "LKR" }: Props) {
  const [data, setData] = useState<FinanceData>(initialData);
  const [tab, setTab] = useState<"overview" | "invoices" | "expenses" | "settings">("overview");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [invoiceForm, setInvoiceForm] = useState({
    studentId: "",
    chargeType: "monthly",
    feeTypeId: "",
    amount: "",
    discount: "0",
    dueDate: today(),
    description: "",
  });
  const [paymentForm, setPaymentForm] = useState({
    invoiceId: "",
    amount: "",
    method: "cash",
    reference: "",
    notes: "",
  });
  const [expenseForm, setExpenseForm] = useState({
    category: "supplies",
    amount: "",
    expenseDate: today(),
    vendor: "",
    description: "",
    receiptReference: "",
  });
  const [feeForm, setFeeForm] = useState({
    name: "",
    description: "",
    defaultAmount: "",
    category: "other",
  });
  const [expenseReceiptFile, setExpenseReceiptFile] = useState<File | null>(null);

  const activeFeeTypes = useMemo(
    () => data.feeTypes.filter((fee) => fee.active !== false),
    [data.feeTypes],
  );
  const selectedInvoice = data.invoices.find((invoice) => invoice.id === paymentForm.invoiceId);

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/finance", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Finance records could not be loaded.");
      setData(body as FinanceData);
      if (!paymentForm.invoiceId && body.invoices?.length)
        setPaymentForm((form) => ({ ...form, invoiceId: body.invoices[0].id }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Finance records could not be loaded.");
    }
  }
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function write(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fetch("/api/auth/csrf", { credentials: "same-origin" });
      const token =
        document.cookie
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("edusphere_csrf="))
          ?.split("=")
          .slice(1)
          .join("=") ?? "";
      const response = await fetch("/api/finance", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(token) },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Finance record could not be saved.");
      setMessage("Saved successfully.");
      await load();
      return body as Record<string, unknown>;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Finance record could not be saved.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function submitInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await write({
      action: "invoice",
      ...invoiceForm,
      feeTypeId: invoiceForm.feeTypeId || undefined,
      amount: Number(invoiceForm.amount),
      discount: Number(invoiceForm.discount),
    });
    if (ok) setInvoiceForm((form) => ({ ...form, amount: "", discount: "0", description: "" }));
  }
  async function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await write({
      action: "payment",
      ...paymentForm,
      amount: Number(paymentForm.amount),
    });
    if (ok) setPaymentForm((form) => ({ ...form, amount: "", reference: "", notes: "" }));
  }
  async function submitExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await write({
      action: "expense",
      ...expenseForm,
      amount: Number(expenseForm.amount),
    });
    const expense = result?.expense as { id?: string } | undefined;
    if (expense?.id && expenseReceiptFile) {
      try {
        const token = await fetchCsrfToken();
        const form = new FormData();
        form.append("file", expenseReceiptFile);
        const response = await fetch(`/api/finance/expenses/${expense.id}/receipt`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "X-CSRF-Token": token },
          body: form,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Receipt upload failed");
        setMessage("Expense and receipt saved successfully.");
        setExpenseReceiptFile(null);
        await load();
      } catch (cause) {
        setError(
          cause instanceof Error
            ? `Expense saved, but receipt upload failed: ${cause.message}`
            : "Expense saved, but receipt upload failed.",
        );
      }
    }
    if (expense?.id)
      setExpenseForm((form) => ({
        ...form,
        amount: "",
        vendor: "",
        description: "",
        receiptReference: "",
      }));
  }
  async function submitFeeType(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await write({
      action: "fee_type",
      ...feeForm,
      defaultAmount: Number(feeForm.defaultAmount),
    });
    if (ok) setFeeForm({ name: "", description: "", defaultAmount: "", category: "other" });
  }
  async function reversePayment(payment: Payment) {
    if (
      !window.confirm(
        `Reverse receipt ${payment.receiptNumber ?? payment.id}? This will restore the invoice balance.`,
      )
    )
      return;
    const reason = window
      .prompt("Enter the reversal reason:", "Correction requested by finance office")
      ?.trim();
    if (!reason) return;
    await write({ action: "reverse_payment", paymentId: payment.id, reason });
  }
  async function decideExpense(expenseId: string, decision: "approved" | "rejected") {
    await write({ action: "expense_decision", expenseId, decision });
  }

  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">FINANCE CONTROL</span>
          <h1>Fees & finance</h1>
          <p className="page-subtitle">
            Invoices, collections, expenses and auditable school finance records.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn-secondary"
            onClick={() =>
              downloadCsv(
                "finance-invoices.csv",
                data.invoices.map((invoice) => ({
                  invoiceNumber: invoice.invoiceNumber,
                  student: invoice.studentName,
                  charge: invoice.chargeType,
                  total: invoice.total,
                  paid: invoice.paidAmount,
                  balance: invoice.balance,
                  status: invoice.status,
                  dueDate: invoice.dueDate,
                })),
              )
            }
          >
            Export invoices
          </button>
          <button
            className="btn-secondary"
            onClick={() =>
              downloadCsv(
                "finance-expenses.csv",
                data.expenses.map((expense) => ({
                  date: expense.expenseDate,
                  category: expense.category,
                  vendor: expense.vendor,
                  amount: expense.amount,
                  status: expense.status,
                  receipt: expense.receiptReference,
                })),
              )
            }
          >
            Export expenses
          </button>
        </div>
      </div>
      {(error || message) && (
        <div className={error ? "login-error" : "login-success"} style={{ marginBottom: 14 }}>
          {error || message}
        </div>
      )}
      {!canManage && (
        <div className="notice" style={{ marginBottom: 16 }}>
          <div>
            <h3>Read-only finance access</h3>
            <p>
              You can review actual school records and export reports. Creating invoices, recording
              payments, expenses, and fee configuration requires finance management permission.
            </p>
          </div>
        </div>
      )}
      <div className="stat-grid" style={{ marginBottom: 18 }}>
        <div className="stat-card">
          <div className="stat-top">TOTAL INVOICED</div>
          <div className="stat-value">{money(data.metrics.totalInvoiced, currency)}</div>
          <div className="stat-foot">{data.metrics.invoiceCount} invoices</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">COLLECTED</div>
          <div className="stat-value">{money(data.metrics.totalCollected, currency)}</div>
          <div className="stat-foot">Recorded payments</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">OUTSTANDING</div>
          <div className="stat-value">{money(data.metrics.outstanding, currency)}</div>
          <div className="stat-foot">Open invoice balance</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">MONTHLY REVENUE</div>
          <div className="stat-value">{money(data.metrics.monthlyRevenue, currency)}</div>
          <div className="stat-foot">Payments received this month</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">OVERDUE INVOICES</div>
          <div className="stat-value">{data.metrics.overdueInvoices}</div>
          <div className="stat-foot">With an outstanding balance</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">APPROVED EXPENSES</div>
          <div className="stat-value">{money(data.metrics.approvedExpenses, currency)}</div>
          <div className="stat-foot">{data.metrics.pendingExpenses} awaiting review</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">NET FINANCIAL</div>
          <div className="stat-value">{money(data.metrics.netFinancial, currency)}</div>
          <div className="stat-foot">Collected minus approved expenses</div>
        </div>
      </div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        {(["overview", "invoices", "expenses", "settings"] as const).map((item) => (
          <button
            key={item}
            className={tab === item ? "tab active" : "tab"}
            onClick={() => setTab(item)}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div
          className="content-grid"
          style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(300px,.8fr)" }}
        >
          <section className="panel" style={{ padding: 18 }}>
            <div className="panel-heading">
              <div>
                <h2>Recent invoices</h2>
                <p>Collections are calculated from the school invoice ledger.</p>
              </div>
              <button className="btn-secondary" onClick={() => setTab("invoices")}>
                View all
              </button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Student</th>
                    <th>Total</th>
                    <th>Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.slice(0, 8).map((invoice) => (
                    <tr key={invoice.id}>
                      <td>{invoice.invoiceNumber ?? invoice.id}</td>
                      <td>{invoice.studentName ?? invoice.studentId}</td>
                      <td>{money(invoice.total, currency)}</td>
                      <td>{money(invoice.balance, currency)}</td>
                      <td>
                        <span
                          className={`pill ${invoice.status === "paid" ? "active" : "pending"}`}
                        >
                          {invoice.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!data.invoices.length && (
                    <tr>
                      <td colSpan={5}>No invoices have been created.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel" style={{ padding: 18 }}>
            <div className="panel-heading">
              <div>
                <h2>Expense review</h2>
                <p>Separate approval permission is required.</p>
              </div>
              <button className="btn-secondary" onClick={() => setTab("expenses")}>
                Open
              </button>
            </div>
            {data.expenses
              .filter((expense) => expense.status === "pending")
              .slice(0, 5)
              .map((expense) => (
                <div
                  key={expense.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "12px 0",
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <div>
                    <strong style={{ fontSize: 12 }}>{expense.description}</strong>
                    <div className="muted">
                      {expense.category} · {expense.expenseDate}
                    </div>
                  </div>
                  <b style={{ fontSize: 12 }}>{money(expense.amount, currency)}</b>
                </div>
              ))}
            {!data.expenses.some((expense) => expense.status === "pending") && (
              <p className="muted">No expenses are awaiting review.</p>
            )}
          </section>
        </div>
      )}
      {tab === "overview" && (
        <section className="panel" style={{ padding: 18, marginTop: 16 }}>
          <h2>Recent receipts</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Invoice</th>
                  <th>Method</th>
                  <th>Paid</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.slice(0, 20).map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.receiptNumber || payment.id}</td>
                    <td>{payment.invoiceNumber || payment.id}</td>
                    <td>{payment.method}</td>
                    <td>{money(payment.amount, currency)}</td>
                    <td>
                      <button
                        className="btn-secondary"
                        onClick={() => printReceipt(payment, currency)}
                      >
                        Print receipt
                      </button>
                      {canManage && (
                        <button
                          className="btn-secondary"
                          disabled={payment.status === "reversed"}
                          onClick={() => void reversePayment(payment)}
                        >
                          {payment.status === "reversed" ? "Reversed" : "Reverse"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!data.payments.length && (
                  <tr>
                    <td colSpan={5}>No payment receipts have been generated.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "invoices" && (
        <div
          className="content-grid"
          style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(290px,.7fr)" }}
        >
          <section className="panel" style={{ padding: 18 }}>
            <div className="panel-heading">
              <div>
                <h2>Invoice ledger</h2>
                <p>Every invoice is scoped to this school and gets a transaction-safe number.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Student</th>
                    <th>Charge</th>
                    <th>Due</th>
                    <th>Total</th>
                    <th>Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>{invoice.invoiceNumber}</td>
                      <td>{invoice.studentName}</td>
                      <td>{invoice.chargeType}</td>
                      <td>{invoice.dueDate}</td>
                      <td>{money(invoice.total, currency)}</td>
                      <td>{money(invoice.balance, currency)}</td>
                      <td>
                        <span
                          className={`pill ${invoice.status === "paid" ? "active" : "pending"}`}
                        >
                          {invoice.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!data.invoices.length && (
                    <tr>
                      <td colSpan={7}>No invoices have been created.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          {canManage && (
            <div style={{ display: "grid", gap: 16 }}>
              <section className="panel" style={{ padding: 18 }}>
                <h2>Create invoice</h2>
                <p className="muted">Use a configured fee type or enter a current amount.</p>
                <form className="form-grid" onSubmit={submitInvoice}>
                  <label className="field full">
                    <span>Student</span>
                    <select
                      required
                      value={invoiceForm.studentId}
                      onChange={(event) =>
                        setInvoiceForm({ ...invoiceForm, studentId: event.target.value })
                      }
                    >
                      <option value="">Choose a student</option>
                      {data.students
                        .filter((student) => student.status !== "archived")
                        .map((student) => (
                          <option key={student.id} value={student.id}>
                            {student.fullName}{" "}
                            {student.admissionNumber ? `· ${student.admissionNumber}` : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Charge type</span>
                    <select
                      value={invoiceForm.chargeType}
                      onChange={(event) =>
                        setInvoiceForm({ ...invoiceForm, chargeType: event.target.value })
                      }
                    >
                      {chargeTypes.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Fee type</span>
                    <select
                      value={invoiceForm.feeTypeId}
                      onChange={(event) => {
                        const fee = activeFeeTypes.find((item) => item.id === event.target.value);
                        setInvoiceForm({
                          ...invoiceForm,
                          feeTypeId: event.target.value,
                          amount:
                            fee?.defaultAmount != null
                              ? String(fee.defaultAmount)
                              : invoiceForm.amount,
                          chargeType: fee?.category ?? invoiceForm.chargeType,
                        });
                      }}
                    >
                      <option value="">Manual amount</option>
                      {activeFeeTypes.map((fee) => (
                        <option key={fee.id} value={fee.id}>
                          {fee.name} · {money(fee.defaultAmount, currency)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Amount</span>
                    <input
                      required
                      min="0.01"
                      step="0.01"
                      type="number"
                      value={invoiceForm.amount}
                      onChange={(event) =>
                        setInvoiceForm({ ...invoiceForm, amount: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Discount</span>
                    <input
                      min="0"
                      step="0.01"
                      type="number"
                      value={invoiceForm.discount}
                      onChange={(event) =>
                        setInvoiceForm({ ...invoiceForm, discount: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Due date</span>
                    <input
                      required
                      type="date"
                      value={invoiceForm.dueDate}
                      onChange={(event) =>
                        setInvoiceForm({ ...invoiceForm, dueDate: event.target.value })
                      }
                    />
                  </label>
                  <label className="field full">
                    <span>Description</span>
                    <input
                      value={invoiceForm.description}
                      onChange={(event) =>
                        setInvoiceForm({ ...invoiceForm, description: event.target.value })
                      }
                      placeholder="Term 1 tuition"
                    />
                  </label>
                  <button className="btn-primary" disabled={busy} type="submit">
                    Create invoice
                  </button>
                </form>
              </section>
              <section className="panel" style={{ padding: 18 }}>
                <h2>Record payment</h2>
                <p className="muted">
                  Cash and bank transfer are recorded here. Online payments require the server
                  verification flow.
                </p>
                <form className="form-grid" onSubmit={submitPayment}>
                  <label className="field full">
                    <span>Invoice</span>
                    <select
                      required
                      value={paymentForm.invoiceId}
                      onChange={(event) =>
                        setPaymentForm({
                          ...paymentForm,
                          invoiceId: event.target.value,
                          amount: String(
                            data.invoices.find((invoice) => invoice.id === event.target.value)
                              ?.balance ?? "",
                          ),
                        })
                      }
                    >
                      <option value="">Choose an open invoice</option>
                      {data.invoices
                        .filter((invoice) => Number(invoice.balance ?? 0) > 0)
                        .map((invoice) => (
                          <option key={invoice.id} value={invoice.id}>
                            {invoice.invoiceNumber} · {invoice.studentName} ·{" "}
                            {money(invoice.balance, currency)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Amount</span>
                    <input
                      required
                      min="0.01"
                      max={selectedInvoice?.balance}
                      step="0.01"
                      type="number"
                      value={paymentForm.amount}
                      onChange={(event) =>
                        setPaymentForm({ ...paymentForm, amount: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Method</span>
                    <select
                      value={paymentForm.method}
                      onChange={(event) =>
                        setPaymentForm({ ...paymentForm, method: event.target.value })
                      }
                    >
                      <option value="cash">Cash</option>
                      <option value="bank_transfer">Bank transfer</option>
                    </select>
                  </label>
                  <label className="field full">
                    <span>Reference</span>
                    <input
                      value={paymentForm.reference}
                      onChange={(event) =>
                        setPaymentForm({ ...paymentForm, reference: event.target.value })
                      }
                      placeholder="Receipt or bank reference"
                    />
                  </label>
                  <button className="btn-primary" disabled={busy} type="submit">
                    Record payment
                  </button>
                </form>
              </section>
            </div>
          )}
        </div>
      )}

      {tab === "expenses" && (
        <div
          className="content-grid"
          style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(290px,.7fr)" }}
        >
          <section className="panel" style={{ padding: 18 }}>
            <div className="panel-heading">
              <div>
                <h2>Expense register</h2>
                <p>
                  Receipts are stored privately under this school and accessible only to finance
                  readers.
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Receipt</th>
                    <th>Status</th>
                    {canApprove && <th>Decision</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.expenses.map((expense) => (
                    <tr key={expense.id}>
                      <td>{expense.expenseDate}</td>
                      <td>{expense.category}</td>
                      <td>
                        {expense.description}
                        <div className="muted">
                          {expense.vendor || expense.receiptReference || ""}
                        </div>
                      </td>
                      <td>{money(expense.amount, currency)}</td>
                      <td>
                        {expense.receiptAttachments?.map((attachment) => (
                          <button
                            key={attachment.id}
                            className="text-button"
                            onClick={async () => {
                              const response = await fetch(
                                `/api/finance/expenses/${expense.id}/receipt?attachmentId=${encodeURIComponent(attachment.id)}`,
                                { cache: "no-store" },
                              );
                              const result = await response.json();
                              if (response.ok)
                                window.open(result.url, "_blank", "noopener,noreferrer");
                              else setError(result.error ?? "Receipt unavailable");
                            }}
                          >
                            {attachment.name}
                          </button>
                        ))}
                      </td>
                      <td>
                        <span
                          className={`pill ${expense.status === "approved" ? "active" : "pending"}`}
                        >
                          {expense.status}
                        </span>
                      </td>
                      {canApprove && (
                        <td>
                          {expense.status === "pending" && (
                            <>
                              <button
                                className="btn-secondary"
                                onClick={() => void decideExpense(expense.id, "approved")}
                              >
                                Approve
                              </button>{" "}
                              <button
                                className="btn-secondary"
                                onClick={() => void decideExpense(expense.id, "rejected")}
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {!data.expenses.length && (
                    <tr>
                      <td colSpan={canApprove ? 7 : 6}>No expenses have been entered.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          {canManage && (
            <section className="panel" style={{ padding: 18 }}>
              <h2>New expense</h2>
              <p className="muted">New expenses remain pending until separately approved.</p>
              <form className="form-grid" onSubmit={submitExpense}>
                <label className="field">
                  <span>Category</span>
                  <select
                    value={expenseForm.category}
                    onChange={(event) =>
                      setExpenseForm({ ...expenseForm, category: event.target.value })
                    }
                  >
                    {expenseCategories.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Amount</span>
                  <input
                    required
                    min="0.01"
                    step="0.01"
                    type="number"
                    value={expenseForm.amount}
                    onChange={(event) =>
                      setExpenseForm({ ...expenseForm, amount: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Date</span>
                  <input
                    required
                    type="date"
                    value={expenseForm.expenseDate}
                    onChange={(event) =>
                      setExpenseForm({ ...expenseForm, expenseDate: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Vendor</span>
                  <input
                    value={expenseForm.vendor}
                    onChange={(event) =>
                      setExpenseForm({ ...expenseForm, vendor: event.target.value })
                    }
                  />
                </label>
                <label className="field full">
                  <span>Description</span>
                  <input
                    required
                    value={expenseForm.description}
                    onChange={(event) =>
                      setExpenseForm({ ...expenseForm, description: event.target.value })
                    }
                  />
                </label>
                <label className="field full">
                  <span>Receipt reference</span>
                  <input
                    value={expenseForm.receiptReference}
                    onChange={(event) =>
                      setExpenseForm({ ...expenseForm, receiptReference: event.target.value })
                    }
                    placeholder="Voucher number or storage reference"
                  />
                </label>
                <label className="field full">
                  <span>Receipt file (PDF or image, up to 10 MB)</span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                    onChange={(event) => setExpenseReceiptFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <button className="btn-primary" disabled={busy} type="submit">
                  Save expense
                </button>
              </form>
            </section>
          )}
        </div>
      )}

      {tab === "settings" && (
        <div
          className="content-grid"
          style={{ gridTemplateColumns: "minmax(0,1fr) minmax(280px,.7fr)" }}
        >
          <section className="panel" style={{ padding: 18 }}>
            <div className="panel-heading">
              <div>
                <h2>Configured fee types</h2>
                <p>Use these defaults when creating student invoices.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Default</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.feeTypes.map((fee) => (
                    <tr key={fee.id}>
                      <td>
                        {fee.name}
                        <div className="muted">{fee.description}</div>
                      </td>
                      <td>{fee.category}</td>
                      <td>{money(fee.defaultAmount, currency)}</td>
                      <td>
                        <span className={`pill ${fee.active === false ? "pending" : "active"}`}>
                          {fee.active === false ? "inactive" : "active"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!data.feeTypes.length && (
                    <tr>
                      <td colSpan={4}>No fee types configured.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          {canManage && (
            <section className="panel" style={{ padding: 18 }}>
              <h2>Add fee type</h2>
              <form className="form-grid" onSubmit={submitFeeType}>
                <label className="field full">
                  <span>Name</span>
                  <input
                    required
                    value={feeForm.name}
                    onChange={(event) => setFeeForm({ ...feeForm, name: event.target.value })}
                    placeholder="Monthly tuition"
                  />
                </label>
                <label className="field">
                  <span>Category</span>
                  <select
                    value={feeForm.category}
                    onChange={(event) => setFeeForm({ ...feeForm, category: event.target.value })}
                  >
                    {chargeTypes.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Default amount</span>
                  <input
                    required
                    min="0"
                    step="0.01"
                    type="number"
                    value={feeForm.defaultAmount}
                    onChange={(event) =>
                      setFeeForm({ ...feeForm, defaultAmount: event.target.value })
                    }
                  />
                </label>
                <label className="field full">
                  <span>Description</span>
                  <input
                    value={feeForm.description}
                    onChange={(event) =>
                      setFeeForm({ ...feeForm, description: event.target.value })
                    }
                  />
                </label>
                <button className="btn-primary" disabled={busy} type="submit">
                  Save fee type
                </button>
              </form>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
