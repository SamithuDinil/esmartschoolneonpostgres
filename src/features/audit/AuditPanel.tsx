"use client";
import { useCallback, useEffect, useState } from "react";
import { Filter, History, Search, ShieldCheck } from "lucide-react";
type Entry = {
  id: string;
  actorUid?: string;
  action?: string;
  recordType?: string;
  recordId?: string;
  changeSummary?: string;
  changedFields?: string[];
  occurredAt?: string | null;
  requestMetadata?: { ip?: string | null; userAgent?: string | null } | null;
  [key: string]: unknown;
};
function when(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
export function AuditPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [recordTypes, setRecordTypes] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [recordType, setRecordType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "300" });
      if (q) params.set("q", q);
      if (action) params.set("action", action);
      if (recordType) params.set("recordType", recordType);
      const response = await fetch(`/api/audit?${params.toString()}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Audit history unavailable");
      setEntries(body.entries ?? []);
      setActions(body.actionOptions ?? []);
      setRecordTypes(body.recordTypes ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Audit history unavailable");
    } finally {
      setLoading(false);
    }
  }, [q, action, recordType]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Governance · append-only history</div>
          <h1>Audit history</h1>
          <p>
            Search school activity without exposing mutation controls. Ordinary users cannot edit or
            delete these records.
          </p>
        </div>
        <div className="portal-access-note">
          <ShieldCheck size={13} /> Administrator access
        </div>
      </div>
      <section className="panel">
        <div className="audit-toolbar">
          <label className="audit-search">
            <Search size={14} />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search action, actor, record or summary"
              aria-label="Search audit history"
            />
          </label>
          <label className="field">
            <span>Action</span>
            <select value={action} onChange={(event) => setAction(event.target.value)}>
              <option value="">All actions</option>
              {actions.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Record type</span>
            <select value={recordType} onChange={(event) => setRecordType(event.target.value)}>
              <option value="">All records</option>
              {recordTypes.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <button className="btn-secondary" onClick={() => void load()}>
            <Filter size={13} />
            Refresh
          </button>
        </div>
      </section>
      {error && (
        <div className="login-error" style={{ marginTop: 14 }}>
          {error}
        </div>
      )}
      <section className="panel" style={{ marginTop: 14 }}>
        <div className="panel-header">
          <div>
            <div className="panel-title">Activity stream</div>
            <div className="panel-subtitle">
              {entries.length} matching event{entries.length === 1 ? "" : "s"} · school-scoped
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
              <h3>Loading audit history</h3>
              <p>Reading authorized events from the school audit collection.</p>
            </div>
          </div>
        ) : !entries.length ? (
          <div className="empty-state">
            <div>
              <div className="empty-icon">
                <History size={17} />
              </div>
              <h3>No matching events</h3>
              <p>Try a wider search or wait for new activity to be recorded.</p>
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table audit-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Affected record</th>
                  <th>Change summary</th>
                  <th>Request metadata</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{when(entry.occurredAt)}</td>
                    <td>
                      <span className="pill active">{entry.action ?? "activity"}</span>
                    </td>
                    <td className="mono-cell">{entry.actorUid ?? "system"}</td>
                    <td>
                      {entry.recordType ?? "—"}
                      {entry.recordId ? (
                        <div className="panel-subtitle">{entry.recordId}</div>
                      ) : null}
                    </td>
                    <td>
                      {entry.changeSummary ??
                        (Array.isArray(entry.changedFields)
                          ? `Fields: ${entry.changedFields.join(", ")}`
                          : "Recorded activity")}
                    </td>
                    <td className="mono-cell">{entry.requestMetadata?.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="portal-footnote">
        <ShieldCheck size={13} /> Audit records are append-only in application workflows; this page
        exposes no edit or delete endpoint.
      </div>
    </main>
  );
}
