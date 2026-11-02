"use client";
import { useEffect, useState } from "react";
import { BrainCircuit, CheckCircle2, Database, LockKeyhole, Sparkles } from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

const suggestions = [
  "How many students were absent today?",
  "Which classes have low attendance?",
  "What is the average examination performance?",
  "Which invoices are overdue?",
  "What events are scheduled this week?",
];
type State = { enabled: boolean; modelExplanation?: boolean; questions?: string[] };
type Result = {
  answer: string;
  status?: string;
  aiUsed?: boolean;
  sources?: string[];
  snapshot?: {
    attendanceToday: { absent: number; percentage: number };
    overdueInvoices: { count: number; balance: number };
    examination: { average: number; publishedExams: number };
    eventsThisWeek: Array<{ title: string }>;
  };
};

export function AiAssistantPanel() {
  const [state, setState] = useState<State | null>(null);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/ai", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw Error(data.error);
        setState(data);
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "AI settings could not be loaded."),
      );
  }, []);
  async function ask(value = question) {
    if (!value.trim()) return;
    setBusy(true);
    setError("");
    setQuestion(value);
    setResult(null);
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ question: value }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setResult(data);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The authorized summary could not be prepared.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Optional intelligence · Role-scoped</div>
          <h1>Ask the records</h1>
          <p>
            Natural-language summaries from authorized school aggregates. AI never edits records.
          </p>
        </div>
        <div className="status-pill">
          <span
            className={`status-dot ${state?.enabled ? "status-dot-success" : "status-dot-warning"}`}
          />
          {state?.enabled ? "AI enabled" : "AI disabled by default"}
        </div>
      </div>
      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}
      <section className="ai-hero panel">
        <div className="ai-hero-copy">
          <div className="ai-orbit">
            <Sparkles size={22} />
          </div>
          <div>
            <div className="eyebrow">Evidence-first assistant</div>
            <h2>Ask from the records you are allowed to see.</h2>
            <p>
              Only tenant-scoped, aggregate operational data is used. Student names, contact details
              and confidential welfare records are never sent to the optional model.
            </p>
          </div>
        </div>
        <div className="ai-guardrail">
          <LockKeyhole size={15} />
          <span>Authorized school data only</span>
        </div>
      </section>
      <section className="ai-layout">
        <div className="panel ai-question-panel">
          <div className="panel-header">
            <div>
              <h2>What do you need to know?</h2>
              <p className="panel-subtitle">Choose a prompt or ask your own question.</p>
            </div>
            <BrainCircuit size={20} />
          </div>
          <div className="ai-suggestions">
            {suggestions.map((item) => (
              <button
                key={item}
                className="chip-button"
                onClick={() => void ask(item)}
                disabled={busy}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="ai-input-row">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void ask();
              }}
              placeholder="e.g. Which classes have low attendance?"
              aria-label="Ask the school assistant"
            />
            <button
              className="btn-primary"
              onClick={() => void ask()}
              disabled={busy || !question.trim()}
            >
              {busy ? "Reviewing…" : "Ask"}
            </button>
          </div>
          {!state?.enabled && (
            <div className="inline-status pending">
              <LockKeyhole size={15} />
              <div>
                <strong>AI is currently disabled</strong>
                <span>
                  The core platform remains fully functional. An authorized administrator can enable
                  aggregate summaries in System settings.
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="panel ai-answer-panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Answer</div>
              <h2>
                {busy
                  ? "Reviewing authorized data…"
                  : result
                    ? "Summary ready"
                    : "Your answer will appear here"}
              </h2>
            </div>
            <Database size={20} />
          </div>
          {result ? (
            <>
              <p className="ai-answer">{result.answer}</p>
              <div className="source-chips">
                {(result.sources ?? ["authorized school aggregates"]).map((source) => (
                  <span key={source} className="source-chip">
                    <CheckCircle2 size={13} />
                    {source}
                  </span>
                ))}
              </div>
              {result.snapshot && (
                <div className="ai-evidence-grid">
                  <div>
                    <strong>{result.snapshot.attendanceToday.absent}</strong>
                    <span>absent today</span>
                  </div>
                  <div>
                    <strong>{result.snapshot.attendanceToday.percentage}%</strong>
                    <span>attendance today</span>
                  </div>
                  <div>
                    <strong>{result.snapshot.examination.average}</strong>
                    <span>average mark</span>
                  </div>
                  <div>
                    <strong>{result.snapshot.overdueInvoices.count}</strong>
                    <span>overdue invoices</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              Ask one of the suggested questions to produce a source-labelled summary.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
