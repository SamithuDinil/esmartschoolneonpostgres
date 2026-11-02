"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";
type Exam = {
  id: string;
  name: string;
  kind: string;
  grade: string;
  className: string;
  subject: string;
  examinationDate: string;
  maxMarks: number;
  status: string;
  academicYearId: string;
  assignedTeacherUid?: string;
};
type Row = {
  id: string;
  fullName: string;
  admissionNumber: string;
  marks: number | null;
  markStatus: string | null;
};
type Year = { id: string; name: string; status: string };
export function ExamsPanel() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [years, setYears] = useState<Year[]>([]);
  const [examId, setExamId] = useState("");
  const [exam, setExam] = useState<Exam | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    name: "",
    kind: "first_term",
    academicYearId: "",
    termId: "",
    grade: "",
    className: "",
    subject: "",
    examinationDate: "",
    maxMarks: "100",
    minimumPassingMarks: "40",
    resultPublicationDate: "",
    assignedTeacherUid: "",
    gradingSchemeId: "",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/exams", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setExams(d.items ?? []);
      if (!examId && d.items?.[0]) setExamId(d.items[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Examinations unavailable");
    }
  }, [examId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void fetch("/api/administration?group=academicYears", { cache: "no-store" }).then(async (r) => {
      if (r.ok) {
        const d = await r.json();
        setYears(d.items ?? []);
      }
    });
  }, []);
  const loadExam = useCallback(async () => {
    if (!examId) return;
    try {
      const r = await fetch(`/api/exams?examId=${encodeURIComponent(examId)}`, {
        cache: "no-store",
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setExam(d.exam);
      setRows(d.students);
      setScores(
        Object.fromEntries(
          d.students.map((s: Row) => [s.id, s.marks == null ? "" : String(s.marks)]),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Exam detail unavailable");
    }
  }, [examId]);
  useEffect(() => {
    void loadExam();
  }, [loadExam]);
  async function send(payload: object) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const csrf = await fetchCsrfToken();
      const r = await fetch("/api/exams", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setNotice("Examination change saved.");
      await load();
      await loadExam();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  function create(e: React.FormEvent) {
    e.preventDefault();
    void send({
      action: "create",
      ...form,
      gradingSchemeId: form.gradingSchemeId || undefined,
      maxMarks: Number(form.maxMarks),
      minimumPassingMarks: Number(form.minimumPassingMarks),
    });
  }
  function saveMarks(status: "draft" | "submitted") {
    if (!exam) return;
    void send({
      action: "save_marks",
      examId,
      records: rows
        .filter((r) => scores[r.id] !== "")
        .map((r) => ({ studentId: r.id, marks: Number(scores[r.id]) })),
      status,
    });
  }
  function exportCsv() {
    const csv = [
      "Admission number,Student name,Marks,Maximum marks,Status",
      ...rows.map((r) =>
        [
          r.admissionNumber,
          r.fullName,
          scores[r.id] ?? "",
          exam?.maxMarks ?? "",
          r.markStatus ?? "",
        ]
          .map((v) => `"${String(v).replaceAll('"', '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${exam?.name ?? "exam"}-results.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">School workspace · Assessments</div>
          <h1>Examination management</h1>
          <p>Schedule exams, enter marks, review submissions and publish results.</p>
        </div>
      </div>
      {error && <p className="login-error">{error}</p>}
      {notice && <p className="login-success">{notice}</p>}
      <div className="content-grid">
        <section className="panel" style={{ padding: 18 }}>
          <h2>Examination schedule</h2>
          <label className="field">
            Select examination
            <select value={examId} onChange={(e) => setExamId(e.target.value)}>
              <option value="">Choose examination</option>
              {exams.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · {x.grade}/{x.className} · {x.subject} · {x.status}
                </option>
              ))}
            </select>
          </label>
          {exam && (
            <>
              <p>
                {exam.examinationDate} · max {exam.maxMarks} · academic year{" "}
                {years.find((y) => y.id === exam.academicYearId)?.name ?? exam.academicYearId}
              </p>
              <p>
                Status: <strong>{exam.status}</strong>
              </p>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => saveMarks("draft")}
                >
                  Save draft marks
                </button>
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => void send({ action: "submit", examId })}
                >
                  Submit for approval
                </button>
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => void send({ action: "approve", examId })}
                >
                  Approve results
                </button>
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => void send({ action: "publish", examId })}
                >
                  Publish results
                </button>
                <button className="btn-secondary" onClick={exportCsv}>
                  Export CSV
                </button>
                <button className="btn-secondary" onClick={() => window.print()}>
                  Print / PDF
                </button>
              </div>
            </>
          )}
        </section>
        <section className="panel" style={{ padding: 18 }}>
          <h2>Create examination</h2>
          <form onSubmit={create}>
            <label className="field">
              Name
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="field">
              Type
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
              >
                {[
                  ["first_term", "First term"],
                  ["second_term", "Second term"],
                  ["third_term", "Third term"],
                  ["monthly_test", "Monthly test"],
                  ["unit_test", "Unit test"],
                  ["mock_exam", "Mock examination"],
                  ["assignment_assessment", "Assignment assessment"],
                  ["custom", "Custom"],
                ].map((x) => (
                  <option key={x[0]} value={x[0]}>
                    {x[1]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Academic year
              <select
                required
                value={form.academicYearId}
                onChange={(e) => setForm({ ...form, academicYearId: e.target.value })}
              >
                <option value="">Select year</option>
                {years
                  .filter((y) => y.status !== "closed")
                  .map((y) => (
                    <option value={y.id} key={y.id}>
                      {y.name} · {y.status}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              Grade
              <input
                required
                value={form.grade}
                onChange={(e) => setForm({ ...form, grade: e.target.value })}
              />
            </label>
            <label className="field">
              Class
              <input
                required
                value={form.className}
                onChange={(e) => setForm({ ...form, className: e.target.value })}
              />
            </label>
            <label className="field">
              Subject
              <input
                required
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </label>
            <label className="field">
              Exam date
              <input
                type="date"
                required
                value={form.examinationDate}
                onChange={(e) => setForm({ ...form, examinationDate: e.target.value })}
              />
            </label>
            <label className="field">
              Maximum marks
              <input
                type="number"
                required
                min="1"
                value={form.maxMarks}
                onChange={(e) => setForm({ ...form, maxMarks: e.target.value })}
              />
            </label>
            <label className="field">
              Passing marks
              <input
                type="number"
                required
                min="0"
                value={form.minimumPassingMarks}
                onChange={(e) => setForm({ ...form, minimumPassingMarks: e.target.value })}
              />
            </label>
            <label className="field">
              Results publish date
              <input
                type="date"
                value={form.resultPublicationDate}
                onChange={(e) => setForm({ ...form, resultPublicationDate: e.target.value })}
              />
            </label>
            <label className="field">
              Assigned teacher UID
              <input
                value={form.assignedTeacherUid}
                onChange={(e) => setForm({ ...form, assignedTeacherUid: e.target.value })}
              />
            </label>
            <label className="field">
              Custom grading scheme ID (optional)
              <input
                placeholder="Leave blank to use school default"
                value={form.gradingSchemeId}
                onChange={(e) => setForm({ ...form, gradingSchemeId: e.target.value })}
              />
            </label>
            <button className="btn-primary" disabled={busy}>
              Create examination
            </button>
          </form>
        </section>
      </div>
      {exam && (
        <section className="panel" style={{ padding: 18, marginTop: 14 }}>
          <h2>Marks register · {exam.subject}</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Admission #</th>
                  <th>Student</th>
                  <th>Marks / {exam.maxMarks}</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.admissionNumber}</td>
                    <td>{r.fullName}</td>
                    <td>
                      <input
                        aria-label={`Marks for ${r.fullName}`}
                        type="number"
                        min="0"
                        max={exam.maxMarks}
                        value={scores[r.id] ?? ""}
                        onChange={(e) => setScores({ ...scores, [r.id]: e.target.value })}
                      />
                    </td>
                    <td>{r.markStatus ?? "Not entered"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
