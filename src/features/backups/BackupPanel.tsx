"use client";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArchiveRestore,
  DatabaseBackup,
  LockKeyhole,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";
type Config = {
  enabled: boolean;
  scheduleCron: string;
  retentionDays: number;
  scheduleTaskUid?: string | null;
  providerStatus?: string;
};
type Run = {
  id: string;
  type?: string;
  trigger?: string;
  status?: string;
  encryption?: string;
  storageAccess?: string;
  note?: string;
  createdAt?: string;
  failureResolvedAt?: string | null;
};
function when(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
export function BackupPanel({ canManage }: { canManage: boolean }) {
  const [config, setConfig] = useState<Config>({
    enabled: false,
    scheduleCron: "0 0 2 * * *",
    retentionDays: 30,
    scheduleTaskUid: "",
  });
  const [runs, setRuns] = useState<Run[]>([]);
  const [recovery, setRecovery] = useState<string[]>([]);
  const [failures, setFailures] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/backups", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Backup status unavailable");
      setConfig({
        enabled: false,
        scheduleCron: "0 0 2 * * *",
        retentionDays: 30,
        ...(body.config ?? {}),
      });
      setRuns(body.runs ?? []);
      setFailures(body.failures ?? 0);
      setRecovery(body.recovery ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Backup status unavailable");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/backups", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          enabled: config.enabled,
          scheduleCron: config.scheduleCron,
          retentionDays: Number(config.retentionDays),
          scheduleTaskUid: config.scheduleTaskUid || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Backup configuration failed");
      setNotice(
        body.providerStatus === "not_configured"
          ? "Schedule saved. A private backup provider still needs to be configured before encrypted artifacts can be created."
          : "Backup configuration saved.",
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Backup configuration failed");
    } finally {
      setBusy(false);
    }
  }
  async function action(actionName: "request_backup" | "restore_test", runId?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/backups", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ action: actionName, runId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Backup action failed");
      setNotice(
        actionName === "restore_test"
          ? "Restoration test recorded for operator validation."
          : body.status === "pending_provider_configuration"
            ? "Backup request recorded, pending private provider configuration."
            : "Backup request queued.",
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Backup action failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Resilience · controlled storage</div>
          <h1>Backup & recovery</h1>
          <p>
            Monitor backup intent, retention and restoration readiness without storing public or
            unencrypted artifacts.
          </p>
        </div>
        <div className="portal-access-note">
          <LockKeyhole size={13} /> Private access only
        </div>
      </div>
      {(error || notice) && (
        <div className={error ? "login-error" : "login-success"} style={{ marginBottom: 14 }}>
          {error || notice}
        </div>
      )}
      <section className="stat-grid">
        <article className="stat-card">
          <div className="stat-top">
            Schedule <DatabaseBackup size={15} />
          </div>
          <div className="stat-value">{config.enabled ? "Enabled" : "Off"}</div>
          <div className="stat-note">UTC cron: {config.scheduleCron}</div>
        </article>
        <article className="stat-card">
          <div className="stat-top">
            Provider <LockKeyhole size={15} />
          </div>
          <div className="stat-value" style={{ fontSize: 18 }}>
            {config.providerStatus === "provider_configured" ? "Configured" : "Pending"}
          </div>
          <div className="stat-note">Encrypted private artifact provider</div>
        </article>
        <article className="stat-card">
          <div className="stat-top">
            Retention <ArchiveRestore size={15} />
          </div>
          <div className="stat-value">{config.retentionDays}d</div>
          <div className="stat-note">Configured retention window</div>
        </article>
        <article className="stat-card">
          <div className="stat-top">
            Alerts <AlertTriangle size={15} />
          </div>
          <div className="stat-value">{failures}</div>
          <div className="stat-note">Unresolved failed runs</div>
        </article>
      </section>
      <div className="content-grid backup-grid" style={{ alignItems: "start" }}>
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Backup schedule</div>
              <div className="panel-subtitle">
                Heartbeat cron uses six UTC fields. Register the returned schedule task UID after
                creating the platform schedule.
              </div>
            </div>
            <RefreshCw size={20} color="#315ee8" />
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Enabled</span>
              <select
                disabled={!canManage}
                value={String(config.enabled)}
                onChange={(event) =>
                  setConfig({ ...config, enabled: event.target.value === "true" })
                }
              >
                <option value="false">Disabled</option>
                <option value="true">Enabled</option>
              </select>
            </label>
            <label className="field">
              <span>Retention days</span>
              <input
                disabled={!canManage}
                type="number"
                min={1}
                max={3650}
                value={config.retentionDays}
                onChange={(event) =>
                  setConfig({ ...config, retentionDays: Number(event.target.value) })
                }
              />
            </label>
            <label className="field full">
              <span>UTC cron expression</span>
              <input
                disabled={!canManage}
                value={config.scheduleCron}
                onChange={(event) => setConfig({ ...config, scheduleCron: event.target.value })}
                placeholder="0 0 2 * * *"
              />
            </label>
            <label className="field full">
              <span>Platform schedule task UID</span>
              <input
                disabled={!canManage}
                value={config.scheduleTaskUid ?? ""}
                onChange={(event) => setConfig({ ...config, scheduleTaskUid: event.target.value })}
                placeholder="Stored after schedule registration"
              />
            </label>
            <div className="form-actions">
              <button
                className="btn-secondary"
                disabled={busy || !canManage}
                onClick={() => void action("request_backup")}
              >
                <DatabaseBackup size={13} />
                Request backup
              </button>
              <button
                className="btn-primary"
                disabled={busy || !canManage}
                onClick={() => void save()}
              >
                <Save size={13} />
                Save schedule
              </button>
            </div>
          </div>
          <div className="notice" style={{ marginTop: 16 }}>
            <ShieldCheck size={17} color="#315ee8" />
            <div>
              <h3>
                Encrypted provider status:{" "}
                {config.providerStatus === "provider_configured" ? "configured" : "not configured"}
              </h3>
              <p>
                E-SmartSchool.lk never exposes backup artifacts publicly. Until the approved private
                export provider is configured, runs remain explicitly pending rather than being
                reported as successful.
              </p>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Disaster recovery playbook</div>
              <div className="panel-subtitle">Operator guidance and restoration-test evidence.</div>
            </div>
            <ArchiveRestore size={20} color="#7656e8" />
          </div>
          <ol className="recovery-list">
            {recovery.map((item, index) => (
              <li key={item}>
                <span>{index + 1}</span>
                {item}
              </li>
            ))}
          </ol>
          <button
            className="btn-secondary"
            disabled={busy || !canManage}
            onClick={() => void action("restore_test")}
          >
            <ArchiveRestore size={13} />
            Record restoration test
          </button>
        </section>
      </div>
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header">
          <div>
            <div className="panel-title">Backup run history</div>
            <div className="panel-subtitle">
              {loading ? "Loading…" : `${runs.length} recorded run${runs.length === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>
        {!loading && !runs.length ? (
          <div className="empty-state">
            <div>
              <div className="empty-icon">
                <DatabaseBackup size={17} />
              </div>
              <h3>No backup runs yet</h3>
              <p>Enable a schedule or request a controlled run to begin the history.</p>
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Type</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th>Security</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{when(run.createdAt)}</td>
                    <td>{run.type ?? "database_backup"}</td>
                    <td>{run.trigger ?? "manual"}</td>
                    <td>
                      <span
                        className={`pill ${String(run.status).includes("failed") ? "pending" : run.status === "queued_for_managed_export" ? "active" : "pending"}`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td>
                      {run.encryption ?? "—"}
                      <div className="panel-subtitle">{run.storageAccess ?? "—"}</div>
                    </td>
                    <td>{run.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="portal-footnote">
        <LockKeyhole size={13} /> Backup configuration, access and recovery actions are
        school-scoped and written to audit history.
      </div>
    </main>
  );
}
