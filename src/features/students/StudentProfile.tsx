"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCsrfToken } from "@/lib/firebase/session-client";
type Bundle = {
  student: Record<string, unknown> & {
    id: string;
    fullName: string;
    admissionNumber: string;
    status: string;
  };
  guardians: Array<
    Record<string, unknown> & { id: string; fullName: string; relationship: string }
  >;
  enrollments: Array<Record<string, unknown> & { id: string }>;
  history: Array<Record<string, unknown> & { id: string; action: string }>;
  documents: Array<Record<string, unknown> & { id: string; name: string }>;
  leaveHistory: Array<Record<string, unknown> & {
    id: string;
    date: string;
    className: string;
    grade: string;
    status: string;
    notes: string;
  }>;
  managedRecords: Array<Record<string, unknown> & {
    id: string;
    type: "discipline" | "activity" | "history";
    title: string;
    details: string;
    date: string;
    status?: string;
  }>;
  attendanceSummary: { present: number; absent: number; late: number; excused: number; percentage: number; riskFlags: string[] };
};
const tabs = [
  "360° overview",
  "Personal details",
  "Guardians",
  "Academic history",
  "Attendance",
  "Leave history",
  "Examination results",
  "Payments",
  "Documents",
  "Discipline",
  "Activities",
  "History",
];
export function StudentProfile({
  studentId,
  canLinkAccount = false,
  canManageRecords = false,
}: {
  studentId: string;
  canLinkAccount?: boolean;
  canManageRecords?: boolean;
}) {
  const [data, setData] = useState<Bundle | null>(null);
  const [tab, setTab] = useState(tabs[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [grade, setGrade] = useState("");
  const [className, setClassName] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [recordForm, setRecordForm] = useState({ id: "", type: "discipline" as "discipline" | "activity" | "history", title: "", details: "", date: new Date().toISOString().slice(0, 10), status: "recorded" });
  useEffect(() => {
    void fetch(`/api/students/${studentId}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setData(d);
        setGrade(d.student.grade);
        setClassName(d.student.className);
      })
      .catch((e) => setError(e.message));
  }, [studentId]);
  async function uploadPhoto(file?: File) {
    if (!file) return;
    try {
      const csrf = await fetchCsrfToken();
      const data = new FormData();
      data.append("file", file);
      const r = await fetch(`/api/students/${studentId}/photo`, {
        method: "POST",
        headers: { "X-CSRF-Token": csrf },
        body: data,
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo update failed");
    }
  }
  async function linkAccount() {
    setBusy(true);
    setError("");
    try {
      const csrf = await fetchCsrfToken();
      const r = await fetch(`/api/students/${studentId}/account`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Account linking failed");
    } finally {
      setBusy(false);
    }
  }
  async function unlinkAccount() {
    setBusy(true);
    setError("");
    try {
      const csrf = await fetchCsrfToken();
      const r = await fetch(`/api/students/${studentId}/account`, {
        method: "DELETE",
        headers: { "X-CSRF-Token": csrf },
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Account unlinking failed");
    } finally {
      setBusy(false);
    }
  }
  async function action(action: string) {
    setBusy(true);
    try {
      const csrf = await fetchCsrfToken();
      const r = await fetch(`/api/students/${studentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ action, grade, className, academicYear: year }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }
  function startRecord(type: "discipline" | "activity" | "history", record?: Bundle["managedRecords"][number]) {
    setRecordForm(record ? { id: record.id, type: record.type, title: record.title, details: record.details, date: record.date, status: record.status ?? "recorded" } : { id: "", type, title: "", details: "", date: new Date().toISOString().slice(0, 10), status: "recorded" });
  }
  async function saveRecord() {
    setBusy(true);
    setError("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch(`/api/students/${studentId}`, { method: recordForm.id ? "PUT" : "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(recordForm) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? "Record could not be saved");
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Record could not be saved");
    } finally {
      setBusy(false);
    }
  }
  async function deleteRecord(id: string) {
    if (!window.confirm("Delete this student record? This action is audited.")) return;
    setBusy(true);
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch(`/api/students/${studentId}?recordId=${encodeURIComponent(id)}`, { method: "DELETE", headers: { "X-CSRF-Token": csrf } });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? "Record could not be deleted");
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Record could not be deleted");
    } finally {
      setBusy(false);
    }
  }
  function downloadLeaveHistoryPdf() {
    const popup = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
    if (!popup) {
      setError("Allow pop-ups to create the leave history PDF.");
      return;
    }
    const escape = (value: unknown) => String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
    const rows = data?.leaveHistory.map((item) => `
      <tr><td>${escape(item.date)}</td><td>${escape(item.grade)} · ${escape(item.className)}</td>
      <td>${escape(item.status === "excused" ? "Excused leave" : "Leave")}</td><td>${escape(item.notes || "—")}</td></tr>`).join("") || "";
    popup.document.write(`<!doctype html><html><head><title>Leave history - ${escape(s.fullName)}</title>
      <style>body{font:14px Arial,sans-serif;color:#18243b;padding:42px;max-width:900px;margin:auto}h1{margin:0 0 6px;font-size:26px}p{color:#64718a;margin:5px 0 24px}.meta{display:flex;gap:28px;border-top:1px solid #dce3ef;border-bottom:1px solid #dce3ef;padding:13px 0;margin-bottom:24px}.meta strong{display:block;margin-top:4px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:11px 9px;border-bottom:1px solid #e6ebf2}th{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#697891}button{margin-top:28px;padding:10px 16px;border:0;border-radius:7px;background:#315ee8;color:#fff;font-weight:600}@media print{button{display:none}body{padding:0}}</style>
      </head><body><h1>Student leave history</h1><p>Official attendance record for ${escape(s.fullName)}</p>
      <div class="meta"><div>Admission number<strong>${escape(s.admissionNumber)}</strong></div><div>Grade / class<strong>${escape(String(s.grade ?? ""))} · ${escape(String(s.className ?? ""))}</strong></div><div>Generated<strong>${escape(new Date().toLocaleDateString())}</strong></div></div>
      ${rows ? `<table><thead><tr><th>Date</th><th>Class</th><th>Record</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>No leave records are recorded for this student.</p>"}
      <button onclick="window.print()">Print / Save as PDF</button></body></html>`);
    popup.document.close();
    popup.focus();
  }
  if (error)
    return (
      <main className="page-content">
        <p role="alert" className="login-error">
          {error}
        </p>
        <Link href="/students">Back to students</Link>
      </main>
    );
  if (!data) return <main className="page-content">Loading student profile…</main>;
  const s = data.student;
  const managedType: "discipline" | "activity" | "history" = tab === "Discipline" ? "discipline" : tab === "Activities" ? "activity" : "history";
  const managedRecords = data.managedRecords.filter((record) => record.type === managedType);
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Student record · {s.admissionNumber}</div>
          <h1>{s.fullName}</h1>
          <label className="btn-secondary" style={{ display: "inline-block", cursor: "pointer" }}>
            Update photograph
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => void uploadPhoto(e.target.files?.[0])}
            />
          </label>
          <p>
            {String(s.grade ?? "")} · {String(s.className ?? "")} · {s.status}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {tab === "Leave history" && (
            <button className="btn-primary" onClick={downloadLeaveHistoryPdf}>
              Leave history PDF
            </button>
          )}
          <button className="btn-secondary" onClick={() => window.print()}>
            Print profile
          </button>
          <Link href="/students" className="btn-secondary">
            Directory
          </Link>
        </div>
      </div>
      <section className="panel" style={{ padding: 16, marginBottom: 16 }}>
        <nav style={{ display: "flex", gap: 8, overflowX: "auto" }}>
          {tabs.map((t) => (
            <button
              key={t}
              className={tab === t ? "btn-primary" : "btn-secondary"}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
      </section>
      <section className="panel" style={{ padding: 22 }}>
        {tab === "360° overview" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start" }}>
              <div><h2>Student 360° overview</h2><p className="panel-subtitle">A single view of attendance, leave, conduct, activities, enrollment, and school records.</p></div>
              <span className={`pill ${data.attendanceSummary.riskFlags.length ? "pending" : "active"}`}>{data.attendanceSummary.riskFlags.length ? "Needs attention" : "On track"}</span>
            </div>
            <div className="stat-grid" style={{ marginTop: 16 }}>
              {[
                ["Attendance", `${data.attendanceSummary.percentage}%`],
                ["Present / late", `${data.attendanceSummary.present} / ${data.attendanceSummary.late}`],
                ["Leave records", data.leaveHistory.length],
                ["Activities", data.managedRecords.filter((r) => r.type === "activity").length],
              ].map(([label, value]) => <article className="stat-card" key={String(label)}><div className="stat-top"><span>{label}</span></div><div className="stat-value">{String(value)}</div><div className="stat-note">From authorized school records</div></article>)}
            </div>
            <section style={{ marginTop: 18 }}><h3>Smart alerts</h3>{data.attendanceSummary.riskFlags.length ? data.attendanceSummary.riskFlags.map((flag) => <p className="notice" key={flag}>{flag}</p>) : <p className="login-success">No attendance risk alerts for this student.</p>}</section>
            <div className="form-grid" style={{ marginTop: 18 }}><div><small>ENROLLMENT</small><p>{data.enrollments.length} recorded enrollment{data.enrollments.length === 1 ? "" : "s"}</p></div><div><small>DISCIPLINE</small><p>{data.managedRecords.filter((r) => r.type === "discipline").length} record{data.managedRecords.filter((r) => r.type === "discipline").length === 1 ? "" : "s"}</p></div><div><small>DOCUMENTS</small><p>{data.documents.length} uploaded</p></div><div><small>GUARDIANS</small><p>{data.guardians.length} linked</p></div></div>
          </>
        )}
        {tab === "Personal details" && (
          <>
            <h2>Personal details</h2>
            <div className="form-grid">
              {[
                "nameWithInitials",
                "preferredName",
                "dateOfBirth",
                "gender",
                "nationality",
                "address",
                "admissionDate",
                "admissionCategory",
                "previousSchool",
                "studentEmail",
                "guardianName",
                "guardianEmail",
                "guardianPhone",
              ].map((k) => (
                <div key={k}>
                  <small>{k.replace(/[A-Z]/g, (m) => ` ${m}`).toUpperCase()}</small>
                  <p>{String(s[k] ?? "—")}</p>
                </div>
              ))}
            </div>
            <hr />
            <h3>Enrollment actions</h3>
            <div className="form-grid">
              <label>
                Grade
                <input value={grade} onChange={(e) => setGrade(e.target.value)} />
              </label>
              <label>
                Class
                <input value={className} onChange={(e) => setClassName(e.target.value)} />
              </label>
              <label>
                Academic year
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => void action("transfer")}
              >
                Transfer class
              </button>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => void action("promote")}
              >
                Promote
              </button>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => void action(s.status === "archived" ? "restore" : "archive")}
              >
                {s.status === "archived" ? "Restore record" : "Archive record"}
              </button>
            </div>
            <p className="panel-subtitle">
              Archiving is a reversible status change. Historical enrollments remain retained.
            </p>
            {canLinkAccount && (
              <section style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #e7ebf0" }}>
                <h3>Student login</h3>
                <p>
                  {s.accountUid
                    ? `Linked account: ${String(s.accountEmail ?? s.accountUid)}`
                    : "Link an existing student login using the verified student email on record."}
                </p>
                {s.accountUid ? (
                  <button
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => void unlinkAccount()}
                  >
                    Unlink student account
                  </button>
                ) : (
                  <button
                    className="btn-secondary"
                    disabled={busy || !s.studentEmail}
                    onClick={() => void linkAccount()}
                  >
                    Link verified account
                  </button>
                )}
              </section>
            )}
          </>
        )}
        {tab === "Guardians" && (
          <>
            <h2>Guardian details</h2>
            {data.guardians.length ? (
              data.guardians.map((g) => (
                <article key={g.id} style={{ padding: 12, borderBottom: "1px solid #e7ebf0" }}>
                  <strong>{g.fullName}</strong>
                  <p>
                    {g.relationship} · {String(g.phone ?? "")} · {String(g.email ?? "")}
                  </p>
                </article>
              ))
            ) : (
              <p>No guardian links are recorded.</p>
            )}
          </>
        )}
        {tab === "Academic history" && (
          <>
            <h2>Academic history</h2>
            {data.enrollments.map((e) => (
              <article key={e.id} style={{ padding: 12, borderBottom: "1px solid #e7ebf0" }}>
                Year {String(e.academicYear)} · {String(e.grade)} / {String(e.className)} ·{" "}
                {String(e.status)}
              </article>
            ))}
          </>
        )}
        {tab === "Leave history" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
              <div>
                <h2>Leave history</h2>
                <p className="panel-subtitle">Excused attendance records are shown here as the student’s authorized leave trail.</p>
              </div>
              <span className="pill active">{data.leaveHistory.length} record{data.leaveHistory.length === 1 ? "" : "s"}</span>
            </div>
            {data.leaveHistory.length ? (
              <div className="table-wrap" style={{ marginTop: 14 }}>
                <table className="data-table">
                  <thead><tr><th>Date</th><th>Grade / class</th><th>Record</th><th>Notes</th></tr></thead>
                  <tbody>{data.leaveHistory.map((item) => (
                    <tr key={item.id}>
                      <td>{item.date}</td>
                      <td>{item.grade} · {item.className}</td>
                      <td><span className="pill active">{item.status === "excused" ? "Excused leave" : "Leave"}</span></td>
                      <td>{item.notes || "—"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="empty-state" style={{ marginTop: 14 }}>No leave records are recorded for this student.</p>}
          </>
        )}
        {tab === "Documents" && (
          <>
            <h2>Documents</h2>
            {data.documents.map((d) => (
              <article key={d.id} style={{ padding: 8 }}>
                <button
                  className="text-button"
                  onClick={async () => {
                    const r = await fetch(
                      `/api/students/${studentId}/documents?documentId=${d.id}`,
                    );
                    const x = await r.json();
                    if (r.ok) window.open(x.url, "_blank", "noopener,noreferrer");
                    else setError(x.error);
                  }}
                >
                  {d.name}
                </button>
              </article>
            ))}
          </>
        )}
        {["Discipline", "Activities", "History"].includes(tab) && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
              <div>
                <h2>{tab === "History" ? "Student history" : tab}</h2>
                <p className="panel-subtitle">{canManageRecords ? "Add, edit, or remove records. Every change is saved to the audit history." : "Read-only records visible to your role."}</p>
              </div>
              {canManageRecords && <button className="btn-primary" onClick={() => startRecord(managedType)}>Add {tab === "History" ? "history" : tab.toLowerCase()}</button>}
            </div>
            {canManageRecords && recordForm.type === managedType && (
              <div className="panel" style={{ padding: 14, marginTop: 14, background: "#f8faff" }}>
                <div className="form-grid">
                  <label className="field">Title<input value={recordForm.title} onChange={(e) => setRecordForm({ ...recordForm, title: e.target.value })} placeholder="Short record title" /></label>
                  <label className="field">Date<input type="date" value={recordForm.date} onChange={(e) => setRecordForm({ ...recordForm, date: e.target.value })} /></label>
                  <label className="field">Status<input value={recordForm.status} onChange={(e) => setRecordForm({ ...recordForm, status: e.target.value })} placeholder="e.g. Open, resolved, attended" /></label>
                  <label className="field" style={{ gridColumn: "1 / -1" }}>Details<textarea value={recordForm.details} onChange={(e) => setRecordForm({ ...recordForm, details: e.target.value })} rows={4} placeholder="Add the full details" /></label>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button className="btn-primary" disabled={busy} onClick={() => void saveRecord()}>{busy ? "Saving…" : recordForm.id ? "Save changes" : "Add record"}</button><button className="btn-secondary" onClick={() => setRecordForm({ ...recordForm, id: "" })}>Cancel</button></div>
              </div>
            )}
            {managedRecords.length ? managedRecords.map((record) => (
              <article key={record.id} style={{ padding: 14, borderBottom: "1px solid #e7ebf0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><strong>{record.title}</strong><span className="panel-subtitle">{record.date} · {record.status ?? "recorded"}</span></div>
                <p style={{ whiteSpace: "pre-wrap" }}>{record.details}</p>
                {canManageRecords && <div style={{ display: "flex", gap: 8 }}><button className="btn-secondary" onClick={() => startRecord(record.type, record)}>Edit</button><button className="btn-secondary" onClick={() => void deleteRecord(record.id)}>Delete</button></div>}
              </article>
            )) : <p className="empty-state" style={{ marginTop: 14 }}>No {tab.toLowerCase()} records have been added.</p>}
            {tab === "History" && data.history.length > 0 && <details style={{ marginTop: 18 }}><summary>System history</summary>{data.history.map((h) => <article key={h.id} style={{ padding: 8, borderBottom: "1px solid #e7ebf0" }}>{h.action}</article>)}</details>}
          </>
        )}
        {["Attendance", "Examination results", "Payments"].includes(tab) && <><h2>{tab}</h2><p className="empty-state">No {tab.toLowerCase()} records are currently available in this module.</p></>}
      </section>
    </main>
  );
}
