"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import styles from "./BulkOperationsPanel.module.css";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Layers3,
  Play,
  Upload,
  WandSparkles,
} from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";
import { downloadTextFile, parseCsv } from "@/lib/csv";
import {
  STUDENT_CSV_COLUMNS,
  STUDENT_OPTIONAL_COLUMNS,
  STUDENT_REQUIRED_COLUMNS,
  buildSampleCsv,
  sampleFileName,
} from "@/lib/student-csv";

type Operation = "students_import" | "marks_import" | "payments_import";
type Preview = {
  previewId: string;
  operation: Operation;
  total: number;
  valid: number;
  invalid: number;
  errors: Array<{ row: number; message: string }>;
  preview: Array<Record<string, unknown>>;
};
type IdCardStudent = Record<string, unknown> & { id: string };
type IdCardRun = {
  rows: IdCardStudent[];
  school: { name: string; logoUrl: string; address: string };
};
function parseCsvFile(text: string) {
  const parsed = parseCsv(text);
  return {
    columns: parsed.columns.filter(Boolean),
    records: parsed.rows as Array<Record<string, unknown>>,
  };
}
function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
function safeLogoUrl(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}
function idCardDate(value: unknown) {
  const raw = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : raw || "—";
}
function downloadRows(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const preferred = filename.startsWith("student")
    ? (STUDENT_CSV_COLUMNS as readonly string[])
    : [];
  const columns = [
    ...preferred.filter((column) => rows.some((row) => column in row)),
    ...new Set(rows.flatMap((row) => Object.keys(row)).filter((key) => !preferred.includes(key))),
  ];
  const flat = (value: unknown) =>
    Array.isArray(value)
      ? value.join("; ")
      : value && typeof value === "object"
        ? JSON.stringify(value)
        : value;
  const csv = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(flat(row[column]))).join(",")),
  ].join("\r\n");
  downloadTextFile(filename, csv);
}
function printRows(title: string, rows: Array<Record<string, unknown>>) {
  const popup = window.open("", "_blank", "width=920,height=760");
  if (!popup) return;
  const escape = (value: unknown) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const cards = rows
    .slice(0, 120)
    .map(
      (row) =>
        `<article><h2>${escape(row.fullName ?? row.studentId ?? "Student")}</h2><p>${escape(row.admissionNumber ?? row.examId ?? row.invoiceId ?? "")}</p><dl>${Object.entries(
          row,
        )
          .slice(0, 8)
          .map(([key, value]) => `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`)
          .join("")}</dl></article>`,
    )
    .join("");
  popup.document.write(
    `<!doctype html><html><head><title>${escape(title)}</title><style>body{font:13px Arial;color:#18243b;padding:24px}h1{margin:0 0 18px}main{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}article{border:1px solid #dce3ef;padding:16px;border-radius:10px;break-inside:avoid}h2{font-size:17px;margin:0 0 4px}p{color:#64718a}dl{display:grid;grid-template-columns:130px 1fr;gap:7px}dt{color:#8290a6;font-size:11px}dd{margin:0;font-weight:600;font-size:11px}@media print{button{display:none}}</style></head><body><h1>${escape(title)}</h1><main>${cards || "<p>No records available.</p>"}</main><button onclick="window.print()">Print / Save PDF</button></body></html>`,
  );
  popup.document.close();
}

export function BulkOperationsPanel() {
  const [operation, setOperation] = useState<Operation>("students_import");
  const [columns, setColumns] = useState<string[]>([]);
  const [records, setRecords] = useState<Array<Record<string, unknown>>>([]);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [tab, setTab] = useState<"imports" | "outputs" | "finance">("imports");
  const [resultErrors, setResultErrors] = useState<Array<{ row: number; message: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [idCardRun, setIdCardRun] = useState<IdCardRun | null>(null);
  useEffect(() => {
    if (!idCardRun) return;
    const closeAfterPrint = () => setIdCardRun(null);
    window.addEventListener("afterprint", closeAfterPrint);
    const timer = window.setTimeout(() => window.print(), 600);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", closeAfterPrint);
    };
  }, [idCardRun]);
  const [studentIds, setStudentIds] = useState("");
  const [invoiceIds, setInvoiceIds] = useState("");
  const [batchForm, setBatchForm] = useState({
    grade: "",
    className: "",
    amount: "",
    dueDate: new Date().toISOString().slice(0, 10),
    description: "",
    examId: "",
  });
  function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setMessage("");
    setError("");
    file
      .text()
      .then((text) => {
        const parsed = parseCsvFile(text);
        if (parsed.records.length > 1000)
          setError(
            `This file has ${parsed.records.length.toLocaleString()} rows. Only the first 1,000 will be previewed; split the rest into another file.`,
          );
        setColumns(parsed.columns);
        setRecords(parsed.records.slice(0, 1000));
      })
      .catch(() => setError("The CSV file could not be read."));
    event.target.value = "";
  }
  async function post(payload: Record<string, unknown>) {
    const csrf = await fetchCsrfToken();
    const response = await fetch("/api/bulk", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Bulk operation failed.");
    return body as Record<string, unknown>;
  }
  async function previewImport() {
    if (!records.length) {
      setError("Choose a CSV file before previewing.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    setResultErrors([]);
    try {
      const body = await post({ action: "preview", operation, columns, records, maxMarks: 100 });
      setPreview(body as unknown as Preview);
      setMessage("Validation preview ready. Nothing has been written yet.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  }
  async function confirmImport() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const body = await post({ action: "confirm", previewId: preview.previewId });
      const failed = Array.isArray(body.errors)
        ? (body.errors as Array<{ row: number; message: string }>)
        : [];
      setResultErrors(failed);
      setMessage(
        `${Number(body.processed ?? 0).toLocaleString()} records committed. ${failed.length} rows need review.`,
      );
      setPreview(null);
      setRecords([]);
      setColumns([]);
      setFileName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Confirmation failed.");
    } finally {
      setBusy(false);
    }
  }
  async function exportType(type: "students" | "marks" | "payments", filename: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/bulk?export=${type}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Export failed.");
      const rows = (body.rows ?? []) as Array<Record<string, unknown>>;
      downloadRows(filename, rows);
      setMessage(`${rows.length.toLocaleString()} records prepared for export.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }
  async function printExport(type: "students" | "marks", title: string) {
    try {
      const response = await fetch(`/api/bulk?export=${type}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Report could not be generated.");
      printRows(title, (body.rows ?? []) as Array<Record<string, unknown>>);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Report could not be generated.");
    }
  }
  async function generateIdCards() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/bulk?export=students", { cache: "no-store" });
      const body = (await response.json()) as {
        error?: string;
        rows?: IdCardStudent[];
        school?: Partial<IdCardRun["school"]>;
      };
      if (!response.ok) throw new Error(body.error ?? "ID cards could not be generated.");
      const rows = (body.rows ?? []).filter((row) =>
        String(row.admissionNumber || row.id || "").trim(),
      );
      if (!rows.length) throw new Error("No student records with an admission ID were found.");
      const school = body.school ?? {};
      setIdCardRun({
        rows,
        school: {
          name: String(school.name ?? "School"),
          logoUrl: String(school.logoUrl ?? ""),
          address: String(school.address ?? ""),
        },
      });
      setMessage(`${rows.length.toLocaleString()} student ID cards prepared.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ID cards could not be generated.");
    } finally {
      setBusy(false);
    }
  }
  async function runBatch(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    try {
      const body = await post(payload);
      setMessage(
        `${success} ${JSON.stringify(body).includes("created") ? Number(body.created ?? 0).toLocaleString() : Number(body.updated ?? body.generated ?? body.processed ?? 0).toLocaleString()} records.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }
  const operationTitle =
    operation === "students_import"
      ? "student records"
      : operation === "marks_import"
        ? "examination marks"
        : "verified payments";
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Operations · high volume</div>
          <h1>Bulk operations</h1>
          <p>
            Preview every change set, commit only valid records, and keep an auditable import
            summary.
          </p>
        </div>
        <div className="portal-access-note">
          <Layers3 size={13} /> History retained
        </div>
      </div>
      {(error || message) && (
        <div className={error ? "login-error" : "login-success"} style={{ marginBottom: 14 }}>
          {error || message}
        </div>
      )}
      {resultErrors.length > 0 && (
        <section className="panel" style={{ marginBottom: 14, padding: 16 }}>
          <div className="panel-subtitle" style={{ marginBottom: 7 }}>
            Rows that were not imported
          </div>
          <div className="table-wrap" style={{ maxHeight: 260, overflowY: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Issue</th>
                </tr>
              </thead>
              <tbody>
                {resultErrors.slice(0, 200).map((item) => (
                  <tr key={`${item.row}-${item.message}`}>
                    <td>{item.row}</td>
                    <td>{item.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="module-tabs">
        {(
          [
            ["imports", "Validate & import"],
            ["outputs", "Export & generate"],
            ["finance", "Finance batches"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "btn-primary" : "btn-secondary"}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "imports" && (
        <div className="content-grid" style={{ alignItems: "start" }}>
          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Step 1 · Choose an import</div>
                <div className="panel-subtitle">
                  CSV format is checked before any database write.
                </div>
              </div>
              <FileSpreadsheet size={20} color="#315ee8" />
            </div>
            <div className="form-grid">
              <div className="field full">
                <label htmlFor="bulk-operation">Import type</label>
                <select
                  id="bulk-operation"
                  value={operation}
                  onChange={(event) => {
                    setOperation(event.target.value as Operation);
                    setPreview(null);
                  }}
                >
                  <option value="students_import">Student records</option>
                  <option value="marks_import">Examination marks</option>
                  <option value="payments_import">Verified payment records</option>
                </select>
              </div>
              <div className="field full">
                <label
                  className="btn-secondary"
                  style={{ cursor: "pointer", justifyContent: "flex-start" }}
                >
                  <Upload size={14} />
                  Choose CSV
                  <input type="file" accept=".csv,text/csv" hidden onChange={chooseFile} />
                </label>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ marginLeft: 8 }}
                  onClick={() =>
                    downloadTextFile(sampleFileName(operation), buildSampleCsv(operation))
                  }
                >
                  <Download size={14} />
                  Download sample CSV
                </button>
                {fileName && (
                  <div className="panel-subtitle">
                    {fileName} · {records.length.toLocaleString()} rows read
                  </div>
                )}
              </div>
            </div>
            <div className="notice" style={{ marginTop: 16 }}>
              <div>
                <h3>Required columns for {operationTitle}</h3>
                <p>
                  {operation === "students_import"
                    ? `${STUDENT_REQUIRED_COLUMNS.join(", ")}. Optional: ${STUDENT_OPTIONAL_COLUMNS.join(", ")}. Dates use YYYY-MM-DD (DD/MM/YYYY is also accepted); gender is female, male, other or undisclosed. Delete the SAMPLE rows from the downloaded file before importing.`
                    : operation === "marks_import"
                      ? "studentId, examId, marks"
                      : "invoiceId, amount, paymentDate, method, reference, verified=true"}
                </p>
              </div>
            </div>
            <button
              className="btn-primary"
              disabled={busy || !records.length}
              style={{ marginTop: 16 }}
              onClick={() => void previewImport()}
            >
              <Play size={14} />
              Preview validation
            </button>
          </section>
          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Step 2 · Review preview</div>
                <div className="panel-subtitle">
                  Confirmation is required before valid rows are committed.
                </div>
              </div>
              <WandSparkles size={20} color="#7656e8" />
            </div>
            {!preview ? (
              <div className="empty-state">
                <div>
                  <div className="empty-icon">
                    <FileSpreadsheet size={17} />
                  </div>
                  <h3>No preview yet</h3>
                  <p>
                    Choose a CSV, then preview its required columns, duplicates and invalid values.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="report-list">
                  <div>
                    <strong>{preview.total}</strong>
                    <span>Rows received</span>
                  </div>
                  <div>
                    <strong style={{ color: "#25795d" }}>{preview.valid}</strong>
                    <span>Valid rows</span>
                  </div>
                  <div>
                    <strong style={{ color: "#a83846" }}>{preview.invalid}</strong>
                    <span>Needs review</span>
                  </div>
                </div>
                {preview.errors.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div className="panel-subtitle" style={{ marginBottom: 7 }}>
                      Validation errors
                    </div>
                    <div className="table-wrap" style={{ maxHeight: 320, overflowY: "auto" }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Row</th>
                            <th>Issue</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.errors.slice(0, 100).map((item) => (
                            <tr key={`${item.row}-${item.message}`}>
                              <td>{item.row}</td>
                              <td>{item.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                <button
                  className="btn-primary"
                  disabled={busy || preview.valid === 0}
                  style={{ marginTop: 16 }}
                  onClick={() => void confirmImport()}
                >
                  <CheckCircle2 size={14} />
                  Confirm and commit {preview.valid} valid rows
                </button>
              </>
            )}
          </section>
        </div>
      )}
      {tab === "outputs" && (
        <div className="content-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Export records</div>
                <div className="panel-subtitle">
                  Exports are generated from the authorized school database.
                </div>
              </div>
              <Download size={20} color="#315ee8" />
            </div>
            <div className="activity-list">
              <div className="mini-status-row">
                <span>Student information</span>
                <button
                  className="btn-secondary"
                  onClick={() => void exportType("students", "student-information.csv")}
                >
                  CSV
                </button>
              </div>
              <div className="mini-status-row">
                <span>Examination results and marks</span>
                <button
                  className="btn-secondary"
                  onClick={() => void exportType("marks", "examination-marks.csv")}
                >
                  CSV
                </button>
              </div>
              <div className="mini-status-row">
                <span>Payment histories</span>
                <button
                  className="btn-secondary"
                  onClick={() => void exportType("payments", "payment-history.csv")}
                >
                  CSV
                </button>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Generate print-ready documents</div>
                <div className="panel-subtitle">
                  Use the same school-scoped records to create operational print runs.
                </div>
              </div>
              <FileText size={20} color="#7656e8" />
            </div>
            <div className="activity-list">
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => void generateIdCards()}
              >
                {busy ? "Preparing cards…" : "Generate ID cards"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => void printExport("students", "Student report cards")}
              >
                Generate report cards
              </button>
              <button
                className="btn-secondary"
                onClick={() => void printExport("marks", "Class examination report")}
              >
                Generate class reports
              </button>
              <button
                className="btn-secondary"
                onClick={() =>
                  void runBatch(
                    { action: "generate_results", examId: batchForm.examId },
                    "Results generated for",
                  )
                }
                disabled={!batchForm.examId}
              >
                <WandSparkles size={14} />
                Generate results
              </button>
              <input
                className="field"
                placeholder="Exam ID for result generation"
                value={batchForm.examId}
                onChange={(event) => setBatchForm({ ...batchForm, examId: event.target.value })}
              />
            </div>
          </section>
        </div>
      )}
      {tab === "finance" && (
        <div className="content-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Recurring invoices</div>
                <div className="panel-subtitle">
                  Enter authorized student IDs separated by commas.
                </div>
              </div>
            </div>
            <div className="form-grid">
              <div className="field full">
                <label>Student IDs</label>
                <textarea
                  rows={3}
                  value={studentIds}
                  onChange={(event) => setStudentIds(event.target.value)}
                  placeholder="student-id-1, student-id-2"
                />
              </div>
              <div className="field">
                <label>Charge type</label>
                <input value="monthly" readOnly />
              </div>
              <div className="field">
                <label>Amount</label>
                <input
                  type="number"
                  min="0.01"
                  value={batchForm.amount}
                  onChange={(event) => setBatchForm({ ...batchForm, amount: event.target.value })}
                />
              </div>
              <div className="field">
                <label>Due date</label>
                <input
                  type="date"
                  value={batchForm.dueDate}
                  onChange={(event) => setBatchForm({ ...batchForm, dueDate: event.target.value })}
                />
              </div>
              <div className="field full">
                <label>Description</label>
                <input
                  value={batchForm.description}
                  onChange={(event) =>
                    setBatchForm({ ...batchForm, description: event.target.value })
                  }
                />
              </div>
              <button
                className="btn-primary"
                disabled={!studentIds || !batchForm.amount || busy}
                onClick={() =>
                  void runBatch(
                    {
                      action: "recurring_invoices",
                      studentIds: studentIds
                        .split(",")
                        .map((id) => id.trim())
                        .filter(Boolean),
                      chargeType: "monthly",
                      amount: Number(batchForm.amount),
                      dueDate: batchForm.dueDate,
                      description: batchForm.description,
                    },
                    "Invoices created for",
                  )
                }
              >
                Generate recurring invoices
              </button>
            </div>
          </section>
          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Class updates & fee reminders</div>
                <div className="panel-subtitle">Each action is explicit and recorded.</div>
              </div>
            </div>
            <div className="form-grid">
              <div className="field full">
                <label>Student IDs for class update</label>
                <textarea
                  rows={2}
                  value={studentIds}
                  onChange={(event) => setStudentIds(event.target.value)}
                />
              </div>
              <div className="field">
                <label>Destination grade</label>
                <input
                  value={batchForm.grade}
                  onChange={(event) => setBatchForm({ ...batchForm, grade: event.target.value })}
                />
              </div>
              <div className="field">
                <label>Destination class</label>
                <input
                  value={batchForm.className}
                  onChange={(event) =>
                    setBatchForm({ ...batchForm, className: event.target.value })
                  }
                />
              </div>
              <button
                className="btn-secondary"
                disabled={!studentIds || !batchForm.grade || !batchForm.className || busy}
                onClick={() =>
                  void runBatch(
                    {
                      action: "class_update",
                      studentIds: studentIds
                        .split(",")
                        .map((id) => id.trim())
                        .filter(Boolean),
                      grade: batchForm.grade,
                      className: batchForm.className,
                    },
                    "Class assignments updated for",
                  )
                }
              >
                Update class assignments
              </button>
              <div className="field full">
                <label>Invoice IDs for fee reminders</label>
                <textarea
                  rows={2}
                  value={invoiceIds}
                  onChange={(event) => setInvoiceIds(event.target.value)}
                  placeholder="invoice-id-1, invoice-id-2"
                />
              </div>
              <button
                className="btn-secondary"
                disabled={!invoiceIds || busy}
                onClick={() =>
                  void runBatch(
                    {
                      action: "fee_reminders",
                      invoiceIds: invoiceIds
                        .split(",")
                        .map((id) => id.trim())
                        .filter(Boolean),
                      channel: "in_app",
                    },
                    "Fee reminders created for",
                  )
                }
              >
                Generate fee reminders
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="portal-footnote">
        <CheckCircle2 size={13} /> Bulk writes use server validation and retain an import summary in
        the database.
      </div>
      {idCardRun && (
        <section
          className={styles.printRoot}
          id="student-id-card-print"
          aria-label="Student ID cards"
        >
          <div className={styles.printToolbar}>
            <div>
              <strong>{idCardRun.rows.length.toLocaleString()} cards ready</strong>
              <span>QR codes contain admission numbers only.</span>
            </div>
            <button className="btn-secondary" onClick={() => window.print()}>
              Print ID cards
            </button>
            <button className="btn-secondary" onClick={() => setIdCardRun(null)}>
              Close
            </button>
          </div>
          <div className={styles.cardGrid}>
            {idCardRun.rows.map((row) => {
              const admissionNumber = String(row.admissionNumber || row.id).trim();
              const logoUrl = safeLogoUrl(idCardRun.school.logoUrl);
              return (
                <article className={styles.idCard} key={row.id}>
                  <header className={styles.cardHeader}>
                    {logoUrl ? (
                      <Image
                        src={logoUrl}
                        alt=""
                        width={46}
                        height={46}
                        unoptimized
                        className={styles.schoolLogo}
                      />
                    ) : (
                      <div className={styles.logoPlaceholder} aria-hidden="true">
                        {idCardRun.school.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <strong>{idCardRun.school.name}</strong>
                      {idCardRun.school.address && <small>{idCardRun.school.address}</small>}
                    </div>
                  </header>
                  <div className={styles.cardBody}>
                    <div className={styles.qrWrap}>
                      <QRCodeSVG
                        value={admissionNumber}
                        size={82}
                        level="M"
                        marginSize={1}
                        title={`Admission ID ${admissionNumber}`}
                      />
                    </div>
                    <dl className={styles.studentDetails}>
                      <div>
                        <dt>Name</dt>
                        <dd>{String(row.fullName ?? row.name ?? "—")}</dd>
                      </div>
                      <div>
                        <dt>Date of birth</dt>
                        <dd>{idCardDate(row.dateOfBirth)}</dd>
                      </div>
                      <div>
                        <dt>Address</dt>
                        <dd>{String(row.address ?? "—")}</dd>
                      </div>
                      <div>
                        <dt>Admission ID</dt>
                        <dd>{admissionNumber}</dd>
                      </div>
                    </dl>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
