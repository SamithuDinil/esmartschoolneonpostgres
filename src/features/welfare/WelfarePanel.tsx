"use client";
import { useEffect, useState } from "react";
import {
  ClipboardList,
  Eye,
  FileText,
  History,
  LockKeyhole,
  Plus,
  Search,
  ShieldAlert,
} from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type Incident = {
  id: string;
  studentId?: string;
  incidentDate?: string;
  category?: string;
  summary?: string;
  staffNotes?: string;
  investigationStatus?: string;
  followUpAction?: string;
  resolution?: string;
  updatedAt?: string;
};
type Data = {
  incidents: Incident[];
  report: { total: number; open: number; resolved: number; categories: number };
};
const initial: Data = { incidents: [], report: { total: 0, open: 0, resolved: 0, categories: 0 } };
const categories = [
  "behavior",
  "bullying",
  "safeguarding",
  "attendance",
  "property",
  "academic_integrity",
  "other",
];
function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
function exportCsv(rows: Incident[]) {
  if (!rows.length) return;
  const headers = [
    "studentId",
    "incidentDate",
    "category",
    "summary",
    "investigationStatus",
    "followUpAction",
    "resolution",
  ];
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((key) => csvCell(row[key as keyof Incident])).join(",")),
  ].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = "restricted-welfare-report.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}
export function WelfarePanel({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<Data>(initial);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  async function load() {
    setError("");
    try {
      const response = await fetch(
        `/api/welfare${search ? `?studentId=${encodeURIComponent(search)}` : ""}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Restricted welfare records could not be loaded.");
      setData(body as Data);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Restricted welfare records could not be loaded.",
      );
    }
  }
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/welfare", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ ...payload, action: "create" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The incident could not be saved.");
      setNotice("Restricted incident saved and added to the modification history.");
      setShowForm(false);
      event.currentTarget.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The incident could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  async function updateIncident(incident: Incident) {
    const status = window.prompt(
      "Investigation status: open, investigating, resolved or closed",
      incident.investigationStatus ?? "open",
    );
    if (!status) return;
    const resolution = window.prompt("Resolution or follow-up note", incident.resolution ?? "");
    if (resolution === null) return;
    setBusy(true);
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/welfare", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          action: "update",
          incidentId: incident.id,
          investigationStatus: status,
          resolution,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The incident could not be updated.");
      setNotice("Status and resolution updated; the previous state was retained in history.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The incident could not be updated.");
    } finally {
      setBusy(false);
    }
  }
  const incidents = data.incidents.filter((incident) =>
    [incident.studentId, incident.summary, incident.category]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Module 25 · Restricted records</div>
          <h1>Student welfare</h1>
          <p>
            Keep the welfare trail restricted, accountable and separate from general student
            dashboards.
          </p>
        </div>
        <div className="portal-access-note">
          <LockKeyhole size={14} />
          Authorized welfare personnel only
        </div>
      </div>
      {(error || notice) && (
        <div className={error ? "login-error" : "login-success"} style={{ marginBottom: 14 }}>
          {error || notice}
        </div>
      )}
      <div className="notice" style={{ marginBottom: 16 }}>
        <ShieldAlert size={18} color="#b56e22" />
        <div>
          <h3>Confidential by design</h3>
          <p>
            Every read is logged. Every change keeps a modification history. This collection is
            never queried by parent, student or general student dashboard routes.
          </p>
        </div>
      </div>
      <section className="stat-grid" style={{ marginBottom: 16 }}>
        {[
          ["Restricted incidents", data.report.total],
          ["Open investigations", data.report.open],
          ["Resolved / closed", data.report.resolved],
          ["Categories in use", data.report.categories],
        ].map(([label, value]) => (
          <article className="stat-card" key={String(label)}>
            <div className="stat-top">
              <span>{label}</span>
              <span className="stat-icon">
                <LockKeyhole size={14} />
              </span>
            </div>
            <div className="stat-value">{String(value)}</div>
            <div className="stat-note">Access log entry created on read</div>
          </article>
        ))}
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Incident register</div>
            <div className="panel-subtitle">
              Student ID, date, category and status are visible only within this restricted
              workspace.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {canManage && (
              <button className="btn-primary" onClick={() => setShowForm(true)}>
                <Plus size={14} />
                Record incident
              </button>
            )}
            <button className="btn-secondary" onClick={() => exportCsv(incidents)}>
              <FileText size={13} />
              Restricted CSV
            </button>
          </div>
        </div>
        <div className="search-box" style={{ width: "100%", marginBottom: 12 }}>
          <Search size={14} />
          <input
            aria-label="Filter welfare records"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by student ID, category or summary"
            style={{ border: 0, outline: 0, background: "transparent", width: "100%" }}
          />
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Date</th>
                <th>Category</th>
                <th>Summary</th>
                <th>Investigation</th>
                <th>Updated</th>
                <th>History</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => (
                <tr key={incident.id}>
                  <td>{incident.studentId}</td>
                  <td>{incident.incidentDate}</td>
                  <td>
                    <span className="pill pending">{incident.category}</span>
                  </td>
                  <td>{incident.summary}</td>
                  <td>
                    <span
                      className={`pill ${["resolved", "closed"].includes(incident.investigationStatus ?? "") ? "active" : "pending"}`}
                    >
                      {incident.investigationStatus}
                    </span>
                  </td>
                  <td>
                    {incident.updatedAt ? new Date(incident.updatedAt).toLocaleDateString() : "—"}
                  </td>
                  <td>
                    {canManage && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void updateIncident(incident)}
                      >
                        <History size={13} /> Update
                      </button>
                    )}
                    <button
                      className="text-button"
                      title="Restricted detail is visible only inside this workspace"
                      onClick={() =>
                        window.alert(
                          `Restricted notes: ${incident.staffNotes || "No staff note recorded."}\n\nFollow-up: ${incident.followUpAction || "No follow-up recorded."}\n\nResolution: ${incident.resolution || "Open."}`,
                        )
                      }
                    >
                      <Eye size={13} /> View
                    </button>
                  </td>
                </tr>
              ))}
              {!incidents.length && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <div>
                        <div className="empty-icon">
                          <ClipboardList size={17} />
                        </div>
                        <h3>No restricted incidents</h3>
                        <p>Authorized records will appear here after they are saved.</p>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {showForm && (
        <div className="modal-backdrop">
          <section className="modal-card">
            <div className="panel-header">
              <div>
                <div className="panel-title">Record restricted incident</div>
                <div className="panel-subtitle">
                  This record is visible only to welfare-authorized personnel.
                </div>
              </div>
              <button className="icon-button" onClick={() => setShowForm(false)} aria-label="Close">
                ×
              </button>
            </div>
            <form className="form-grid" onSubmit={submit}>
              <label className="field">
                <span>Student ID</span>
                <input name="studentId" required placeholder="student document ID" />
              </label>
              <label className="field">
                <span>Incident date</span>
                <input name="incidentDate" type="date" required />
              </label>
              <label className="field">
                <span>Category</span>
                <select name="category" defaultValue="behavior">
                  {categories.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Investigation status</span>
                <select name="investigationStatus" defaultValue="open">
                  <option>open</option>
                  <option>investigating</option>
                  <option>resolved</option>
                  <option>closed</option>
                </select>
              </label>
              <label className="field full">
                <span>Incident summary</span>
                <textarea
                  name="summary"
                  rows={3}
                  required
                  placeholder="Concise factual description"
                />
              </label>
              <label className="field full">
                <span>Authorized staff notes</span>
                <textarea
                  name="staffNotes"
                  rows={4}
                  placeholder="Restricted notes, witnesses or evidence reference"
                />
              </label>
              <label className="field full">
                <span>Follow-up action</span>
                <textarea
                  name="followUpAction"
                  rows={3}
                  placeholder="Meeting, monitoring plan or referral"
                />
              </label>
              <label className="field full">
                <span>Resolution</span>
                <textarea name="resolution" rows={3} placeholder="Leave blank while unresolved" />
              </label>
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button className="btn-primary" disabled={busy}>
                  {busy ? "Saving…" : "Save restricted record"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
