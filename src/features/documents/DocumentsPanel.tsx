"use client";
import { useEffect, useState } from "react";
import {
  Archive,
  Download,
  FileLock2,
  FilePlus2,
  History,
  Pencil,
  ShieldCheck,
} from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type DocumentRow = {
  id: string;
  name?: string;
  category?: string;
  recordType?: string;
  recordId?: string | null;
  visibility?: string;
  contentType?: string;
  size?: number;
  createdAt?: string;
  status?: string;
};
const labels: Record<string, string> = {
  student_admission: "Student admission",
  teacher_qualification: "Teacher qualifications",
  school_certificate: "School certificates",
  examination: "Examination documents",
  financial_receipt: "Financial receipts",
  administrative: "Administrative documents",
  school_circular: "School circulars",
};
function size(value: unknown) {
  const bytes = Number(value ?? 0);
  return bytes > 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
export function DocumentsPanel() {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [categories, setCategories] = useState<string[]>(Object.keys(labels));
  const [category, setCategory] = useState("student_admission");
  const [recordType, setRecordType] = useState("student");
  const [recordId, setRecordId] = useState("");
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState("restricted");
  const [file, setFile] = useState<File | null>(null);
  const [replaceId, setReplaceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/documents", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Documents could not be loaded.");
      setDocuments(body.documents ?? []);
      setCategories(body.categories ?? Object.keys(labels));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Documents could not be loaded.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Choose a document file first.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const csrf = await fetchCsrfToken();
      const form = new FormData();
      form.append("file", file);
      form.append("category", category);
      form.append("recordType", recordType);
      form.append("recordId", recordId);
      form.append("name", name || file.name);
      form.append("visibility", visibility);
      if (replaceId) form.append("documentId", replaceId);
      const response = await fetch("/api/documents", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrf },
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Upload failed.");
      setMessage(
        replaceId
          ? "Private document replaced and history retained."
          : "Private document uploaded.",
      );
      setFile(null);
      setName("");
      setReplaceId("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }
  async function action(documentId: string, actionName: "archive" | "rename") {
    const row = documents.find((item) => item.id === documentId);
    if (!row) return;
    const nextName =
      actionName === "rename" ? window.prompt("New document name", row.name ?? "") : undefined;
    if (actionName === "rename" && !nextName) return;
    setError("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/documents", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ documentId, action: actionName, name: nextName }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Document update failed.");
      setMessage(actionName === "archive" ? "Document archived." : "Document renamed.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Document update failed.");
    }
  }
  async function download(documentId: string) {
    try {
      const response = await fetch(`/api/documents?documentId=${encodeURIComponent(documentId)}`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Signed download unavailable.");
      window.open(body.url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Signed download unavailable.");
    }
  }
  function report() {
    const rows = documents.map((row) => ({
      name: row.name,
      category: labels[row.category ?? ""] ?? row.category,
      recordType: row.recordType,
      recordId: row.recordId,
      visibility: row.visibility,
      contentType: row.contentType,
      size: row.size,
      createdAt: row.createdAt,
    }));
    if (!rows.length) return;
    const columns = Object.keys(rows[0]);
    const csv = [
      columns.map(csvCell).join(","),
      ...rows.map((row) =>
        columns.map((column) => csvCell(row[column as keyof typeof row])).join(","),
      ),
    ].join("\n");
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    anchor.download = "document-report.csv";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Records · private storage</div>
          <h1>Document management</h1>
          <p>
            One controlled archive for admission, qualification, examination, finance and school
            documents.
          </p>
        </div>
        <button className="btn-secondary" onClick={report}>
          <Download size={14} />
          Document report
        </button>
      </div>
      {(error || message) && (
        <div className={error ? "login-error" : "login-success"} style={{ marginBottom: 14 }}>
          {error || message}
        </div>
      )}
      <div className="content-grid" style={{ alignItems: "start" }}>
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Private upload</div>
              <div className="panel-subtitle">
                Files are stored under the current school and served with short-lived signed URLs.
              </div>
            </div>
            <FileLock2 size={20} color="#315ee8" />
          </div>
          <form className="form-grid" onSubmit={upload}>
            <div className="field full">
              <label>File</label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,application/pdf,image/*"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="field">
              <label>Category</label>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {labels[item] ?? item}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Visibility</label>
              <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
                <option value="restricted">Restricted</option>
                <option value="staff">Authorized staff</option>
                <option value="school">School-wide</option>
              </select>
            </div>
            <div className="field">
              <label>Record type</label>
              <input
                value={recordType}
                onChange={(event) => setRecordType(event.target.value)}
                placeholder="student, teacher, finance"
              />
            </div>
            <div className="field">
              <label>Record ID</label>
              <input
                value={recordId}
                onChange={(event) => setRecordId(event.target.value)}
                placeholder="Optional linked record"
              />
            </div>
            <div className="field full">
              <label>Display name</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={file?.name ?? "Admission certificate"}
              />
            </div>
            <div className="field full">
              <label>Replace existing document (optional)</label>
              <select value={replaceId} onChange={(event) => setReplaceId(event.target.value)}>
                <option value="">Upload new document</option>
                {documents.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn-primary" disabled={busy || !file} type="submit">
              <FilePlus2 size={14} />
              {busy ? "Saving…" : replaceId ? "Replace document" : "Upload document"}
            </button>
          </form>
          <div className="portal-footnote">
            <ShieldCheck size={13} /> Private storage · authorized download only · upload history
            retained
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Document register</div>
              <div className="panel-subtitle">
                {documents.length.toLocaleString()} active document
                {documents.length === 1 ? "" : "s"}
              </div>
            </div>
            <History size={20} color="#7656e8" />
          </div>
          {loading ? (
            <div className="empty-state">
              <div>
                <div className="empty-icon">
                  <History size={17} />
                </div>
                <h3>Loading archive</h3>
                <p>Reading authorized document metadata.</p>
              </div>
            </div>
          ) : !documents.length ? (
            <div className="empty-state">
              <div>
                <div className="empty-icon">
                  <FileLock2 size={17} />
                </div>
                <h3>No documents yet</h3>
                <p>Upload a school document to create the first private record.</p>
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Category</th>
                    <th>Record</th>
                    <th>Size</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.name}</strong>
                        <div className="panel-subtitle">{row.contentType}</div>
                      </td>
                      <td>{labels[row.category ?? ""] ?? row.category}</td>
                      <td>
                        {row.recordType}
                        {row.recordId ? ` · ${row.recordId}` : ""}
                      </td>
                      <td>{size(row.size)}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn-secondary" onClick={() => void download(row.id)}>
                            <Download size={12} />
                            Open
                          </button>
                          <button
                            className="btn-secondary"
                            onClick={() => void action(row.id, "rename")}
                            aria-label={`Rename ${row.name}`}
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            className="btn-secondary"
                            onClick={() => void action(row.id, "archive")}
                            aria-label={`Archive ${row.name}`}
                          >
                            <Archive size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
