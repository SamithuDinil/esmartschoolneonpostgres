"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, CheckCircle2, History, UsersRound } from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type Student = {
  id: string;
  fullName?: string;
  admissionNumber?: string;
  grade?: string;
  className?: string;
  status?: string;
};
type Preview = {
  eligible: Student[];
  count: number;
  capacity: number;
  currentTargetCount: number;
  remaining: number;
  canProceed: boolean;
};
export function PromotionPanel() {
  const [years, setYears] = useState<Array<{ id: string; name?: string; status?: string }>>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [form, setForm] = useState({
    academicYearId: "",
    grade: "",
    className: "",
    destinationGrade: "",
    destinationClass: "",
    outcome: "promote",
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/promotion", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Promotion options could not be loaded.");
        setYears(body.academicYears ?? []);
        setGrades(body.grades ?? []);
        setClasses(body.classes ?? []);
        const active = (body.academicYears ?? []).find(
          (year: { status?: string }) => year.status === "active",
        );
        setForm((current) => ({
          ...current,
          academicYearId: active?.id ?? body.academicYears?.[0]?.id ?? "",
          grade: body.grades?.[0] ?? "",
          destinationGrade: body.grades?.[1] ?? body.grades?.[0] ?? "",
          className: body.classes?.[0] ?? "",
          destinationClass: body.classes?.[0] ?? "",
        }));
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "Promotion options could not be loaded."),
      );
  }, []);
  async function post(payload: Record<string, unknown>) {
    const csrf = await fetchCsrfToken();
    const response = await fetch("/api/promotion", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Promotion operation failed.");
    return body;
  }
  async function previewPromotion() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = await post({ action: "preview", ...form });
      setPreview(body);
      setSelectedIds((body.eligible ?? []).map((student: Student) => student.id));
      setMessage("Eligibility preview ready. No enrollment records have changed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  }
  async function confirmPromotion() {
    if (!preview?.eligible.length || !selectedIds.length) return;
    setBusy(true);
    setError("");
    try {
      const body = await post({
        action: "confirm",
        academicYearId: form.academicYearId,
        studentIds: selectedIds,
        destinationGrade: form.destinationGrade,
        destinationClass: form.destinationClass,
        outcome: form.outcome,
      });
      setMessage(
        `${body.processed} students processed. Historical class assignments and academic records were retained.`,
      );
      setPreview(null);
      setSelectedIds([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Promotion failed.");
    } finally {
      setBusy(false);
    }
  }
  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const capacityOkay =
    !preview ||
    ["graduation", "completion", "transfer"].includes(form.outcome) ||
    selectedIds.length <= preview.remaining;
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Enrollment · controlled transition</div>
          <h1>Promotion engine</h1>
          <p>
            Preview eligible students, validate destination capacity, then commit a historical
            enrollment transition.
          </p>
        </div>
        <div className="portal-access-note">
          <History size={13} /> Academic history retained
        </div>
      </div>
      {(error || message) && (
        <div className={error ? "login-error" : "login-success"} style={{ marginBottom: 14 }}>
          {error || message}
        </div>
      )}
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Step 1 · Select the transition</div>
            <div className="panel-subtitle">
              Graduation, transfer and completion preserve the source enrollment without changing
              marks or attendance.
            </div>
          </div>
          <ArrowUpRight size={20} color="#315ee8" />
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Current academic year</label>
            <select
              value={form.academicYearId}
              onChange={(event) => update("academicYearId", event.target.value)}
            >
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name ?? year.id} {year.status === "active" ? "· active" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Current grade</label>
            <select value={form.grade} onChange={(event) => update("grade", event.target.value)}>
              <option value="">Choose grade</option>
              {grades.map((grade) => (
                <option key={grade}>{grade}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Current class</label>
            <select
              value={form.className}
              onChange={(event) => update("className", event.target.value)}
            >
              <option value="">Choose class</option>
              {classes.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Outcome</label>
            <select
              value={form.outcome}
              onChange={(event) => update("outcome", event.target.value)}
            >
              <option value="promote">Promote</option>
              <option value="repeat">Grade repetition</option>
              <option value="transfer">School transfer</option>
              <option value="graduation">Graduation</option>
              <option value="completion">Enrollment completion</option>
            </select>
          </div>
          <div className="field">
            <label>Destination grade</label>
            <select
              value={form.destinationGrade}
              onChange={(event) => update("destinationGrade", event.target.value)}
            >
              <option value="">Choose grade</option>
              {grades.map((grade) => (
                <option key={grade}>{grade}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Destination class</label>
            <select
              value={form.destinationClass}
              onChange={(event) => update("destinationClass", event.target.value)}
            >
              <option value="">Choose class</option>
              {classes.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div className="form-actions">
            <button
              className="btn-primary"
              disabled={
                busy ||
                !form.academicYearId ||
                !form.grade ||
                !form.className ||
                !form.destinationGrade ||
                !form.destinationClass
              }
              onClick={() => void previewPromotion()}
            >
              <UsersRound size={14} />
              Load eligible students
            </button>
          </div>
        </div>
      </section>
      {preview && (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">Step 2 · Review and confirm</div>
              <div className="panel-subtitle">
                {preview.count} eligible students · {selectedIds.length} selected · destination has{" "}
                {preview.remaining} available place{preview.remaining === 1 ? "" : "s"} of{" "}
                {preview.capacity}
              </div>
            </div>
            <span className={`pill ${capacityOkay ? "active" : "pending"}`}>
              {preview.canProceed || selectedIds.length < preview.count
                ? "Capacity available"
                : "Capacity blocked"}
            </span>
          </div>
          <div className="report-list">
            <div>
              <strong>{preview.count}</strong>
              <span>Eligible students</span>
            </div>
            <div>
              <strong>{preview.currentTargetCount}</strong>
              <span>Current destination count</span>
            </div>
            <div>
              <strong>{selectedIds.length}</strong>
              <span>Selected for transition</span>
            </div>
          </div>
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Student</th>
                  <th>Admission no.</th>
                  <th>Current placement</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.eligible.map((student) => (
                  <tr key={student.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(student.id)}
                        onChange={(event) =>
                          setSelectedIds((current) =>
                            event.target.checked
                              ? [...current, student.id]
                              : current.filter((id) => id !== student.id),
                          )
                        }
                      />
                    </td>
                    <td>{student.fullName}</td>
                    <td>{student.admissionNumber ?? "—"}</td>
                    <td>
                      {student.grade} · {student.className}
                    </td>
                    <td>
                      <span className="pill active">Eligible</span>
                    </td>
                  </tr>
                ))}
                {!preview.eligible.length && (
                  <tr>
                    <td colSpan={5}>No eligible students found for this class.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="notice" style={{ marginTop: 16 }}>
            <CheckCircle2 size={17} color="#315ee8" />
            <div>
              <h3>Historical records are preserved</h3>
              <p>
                The source enrollment is completed with an outcome, a history record is created, and
                only the destination enrollment is added. Attendance, examination results and
                academic records are not deleted or overwritten.
              </p>
            </div>
          </div>
          <button
            className="btn-primary"
            disabled={busy || !capacityOkay || !selectedIds.length}
            style={{ marginTop: 16 }}
            onClick={() => void confirmPromotion()}
          >
            <CheckCircle2 size={14} />
            Confirm {form.outcome} for {selectedIds.length} student
            {selectedIds.length === 1 ? "" : "s"}
          </button>
        </section>
      )}
      <div className="portal-footnote">
        <History size={13} /> Every transition is written to enrollment history with actor, source
        year, destination and outcome.
      </div>
    </main>
  );
}
