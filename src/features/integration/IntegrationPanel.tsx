"use client";
import { useEffect, useState } from "react";
import { Activity, CheckCircle2, CircleAlert, RefreshCw, Workflow } from "lucide-react";

type Check = {
  id: string;
  label: string;
  status: "verified" | "pending" | "attention";
  count: number;
  detail: string;
};
type Health = {
  generatedAt: string;
  checks: Check[];
  workflowStatus: Record<string, string>;
  counts: Record<string, number>;
};
const statusLabels: Record<string, string> = {
  verified: "Verified",
  pending: "Pending data",
  attention: "Needs attention",
};

export function IntegrationPanel() {
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/integration", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setHealth(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Integration health could not be loaded.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const overall = health?.checks.some((item) => item.status === "attention")
    ? "attention"
    : health?.checks.every((item) => item.status === "verified")
      ? "verified"
      : "pending";
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Unified database · Read-only diagnostics</div>
          <h1>Integration health</h1>
          <p>
            Trace how the school tenant connects registration, academics, finance, attendance and
            communication.
          </p>
        </div>
        <button className="btn-secondary" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={15} className={busy ? "spin" : ""} />
          Refresh
        </button>
      </div>
      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}
      <section className="integration-overview">
        <div className={`integration-score ${overall}`}>
          <Activity size={20} />
          <div>
            <span>Overall connection state</span>
            <strong>{statusLabels[overall]}</strong>
          </div>
        </div>
        <div className="workflow-strip">
          {health &&
            Object.entries(health.workflowStatus).map(([key, value]) => (
              <div className="workflow-node" key={key}>
                <span
                  className={`status-dot ${value === "verified" ? "status-dot-success" : value === "attention" ? "status-dot-danger" : "status-dot-warning"}`}
                />
                <span>{key.replace(/([A-Z])/g, " $1")}</span>
                <b>{statusLabels[value] ?? value}</b>
              </div>
            ))}
        </div>
      </section>
      <section className="panel integration-panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Evidence ledger</div>
            <h2>Cross-module connections</h2>
          </div>
          <Workflow size={20} />
        </div>
        {busy && !health ? (
          <div className="loading-state">Checking tenant-scoped collections…</div>
        ) : (
          <div className="integration-list">
            {health?.checks.map((item) => (
              <div className="integration-row" key={item.id}>
                <div className={`integration-icon ${item.status}`}>
                  {item.status === "verified" ? (
                    <CheckCircle2 size={17} />
                  ) : (
                    <CircleAlert size={17} />
                  )}
                </div>
                <div className="integration-copy">
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </div>
                <div className="integration-count">
                  <b>{item.count}</b>
                  <small>records</small>
                </div>
                <span className={`status-badge ${item.status}`}>{statusLabels[item.status]}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      {health && (
        <div className="panel integration-footnote">
          <div>
            <div className="eyebrow">Data boundary</div>
            <p>
              Every check above is read from the active school tenant. No global cross-school query
              is used, and no diagnostic record exposes student-level personal details.
            </p>
          </div>
          <span className="panel-subtitle">
            Updated {new Date(health.generatedAt).toLocaleString()}
          </span>
        </div>
      )}
    </main>
  );
}
