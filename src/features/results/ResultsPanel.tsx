"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type ExamOption = {
  id: string;
  name: string;
  grade: string;
  className: string;
  subject: string;
  examinationDate: string;
  academicYearId: string;
};
type Result = {
  id: string;
  fullName: string;
  admissionNumber: string;
  photoUrl: string | null;
  marks: number | null;
  grade: string | null;
  pass: boolean | null;
  rank: number | null;
  subjectResults: {
    examId: string;
    subject: string;
    marks: number | null;
    maxMarks: number;
    grade: string | null;
    pass: boolean | null;
  }[];
  totalMarks: number | null;
  average: number | null;
  remarks: string;
  teacherComment: string;
  principalComment: string;
  attendanceSummary: { percentage?: number } | null;
};
type ResultData = {
  exam: {
    id: string;
    name: string;
    grade: string;
    className: string;
    subject: string;
    academicYearId: string;
    academicYearName: string;
    examinationDate: string;
    maxMarks: number;
    minimumPassingMarks: number;
    status: string;
  };
  school: { name: string; logoUrl: string | null };
  scheme: { min: number; max: number; label: string }[];
  settings: { rankingsEnabled: boolean; rankingPolicy: string };
  summary: null | {
    students: number;
    entered: number;
    totalMarks: number;
    average: number;
    classAverage: number;
    subjectAverage: number;
    highest: number | null;
    lowest: number | null;
    passCount: number;
    failCount: number;
    trends?: { name: string; date: string; average: number }[];
  };
  results: Result[];
};
const starterBands = [
  { min: 75, max: 100, label: "A" },
  { min: 65, max: 74.99, label: "B" },
  { min: 50, max: 64.99, label: "C" },
  { min: 35, max: 49.99, label: "S" },
  { min: 0, max: 34.99, label: "W" },
];

export function ResultsPanel({ canConfigure = false }: { canConfigure?: boolean }) {
  const [exams, setExams] = useState<ExamOption[]>([]);
  const [examId, setExamId] = useState("");
  const [data, setData] = useState<ResultData | null>(null);
  const [error, setError] = useState("");
  const [rankings, setRankings] = useState(false);
  const [policy, setPolicy] = useState("competition");
  const [bands, setBands] = useState(JSON.stringify(starterBands, null, 2));
  const [showSettings, setShowSettings] = useState(false);
  const [schemes, setSchemes] = useState<
    { id: string; name: string; bands: { min: number; max: number; label: string }[] }[]
  >([]);
  const [schemeId, setSchemeId] = useState("");
  const [schemeName, setSchemeName] = useState("");
  const [schemeBands, setSchemeBands] = useState(JSON.stringify(starterBands, null, 2));
  const loadExams = useCallback(async () => {
    try {
      const r = await fetch("/api/results", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setExams(d.items ?? []);
      setExamId((old) => old || d.items?.[0]?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Examinations unavailable");
    }
  }, []);
  useEffect(() => {
    void loadExams();
  }, [loadExams]);
  useEffect(() => {
    if (canConfigure)
      void fetch("/api/results?schemes=1", { cache: "no-store" }).then(async (r) => {
        if (r.ok) {
          const d = await r.json();
          setSchemes(d.items ?? []);
          const defaultScheme = d.items?.find((x: { id: string }) => x.id === "default");
          if (defaultScheme?.bands) setBands(JSON.stringify(defaultScheme.bands, null, 2));
        }
      });
  }, [canConfigure]);
  useEffect(() => {
    if (!examId) {
      setData(null);
      return;
    }
    let alive = true;
    void fetch(`/api/results?examId=${encodeURIComponent(examId)}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (alive) {
          setData(d);
          setRankings(d.settings?.rankingsEnabled ?? false);
          setPolicy(d.settings?.rankingPolicy ?? "competition");
          setShowSettings(false);
        }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Results unavailable"));
    return () => {
      alive = false;
    };
  }, [examId]);
  async function savePolicy() {
    try {
      const token = await fetchCsrfToken();
      const r = await fetch("/api/results", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify({
          action: "policy",
          rankingsEnabled: rankings,
          rankingPolicy: policy,
          bands: JSON.parse(bands),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setError("Grading and ranking settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save policy");
    }
  }
  async function saveScheme() {
    try {
      const token = await fetchCsrfToken();
      const r = await fetch("/api/results", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify({
          action: "scheme",
          schemeId,
          name: schemeName,
          bands: JSON.parse(schemeBands),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setSchemes((old) => [
        ...old.filter((x) => x.id !== schemeId),
        { id: schemeId, name: schemeName, bands: JSON.parse(schemeBands) },
      ]);
      setError("Custom grading scheme saved. Select its ID when creating an examination.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save grading scheme");
    }
  }
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Assessment intelligence</div>
          <h1>Results & performance</h1>
          <p>
            Calculated marks, configurable grades, achievement summaries and published-result
            access.
          </p>
        </div>
      </div>
      {error && (
        <div className="notice" style={{ marginBottom: 12 }}>
          <p>{error}</p>
        </div>
      )}
      <section className="panel">
        <label className="field">
          Examination
          <select
            value={examId}
            onChange={(e) => {
              setError("");
              setExamId(e.target.value);
            }}
          >
            <option value="">Choose published examination</option>
            {exams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · Grade {x.grade} {x.className} · {x.subject}
              </option>
            ))}
          </select>
        </label>
      </section>
      {data && (
        <>
          <section className="stat-grid" style={{ marginTop: 14 }}>
            {[
              ["Students", data.summary?.students ?? data.results.length],
              ["Average", data.summary ? data.summary.average.toFixed(1) : "—"],
              ["Highest", data.summary?.highest ?? "—"],
              [
                "Pass / fail",
                data.summary ? `${data.summary.passCount} / ${data.summary.failCount}` : "—",
              ],
            ].map(([label, value]) => (
              <article className="stat-card" key={label}>
                <div className="stat-top">{label}</div>
                <div className="stat-value">{value}</div>
              </article>
            ))}
          </section>
          <section className="panel" style={{ marginTop: 14 }}>
            <div className="panel-header">
              <div>
                <div className="panel-title">
                  {data.exam.name} · Grade {data.exam.grade} {data.exam.className} ·{" "}
                  {data.exam.subject}
                </div>
                <div className="panel-subtitle">
                  Status: {data.exam.status}. Results are not exposed to students or guardians until
                  published.
                </div>
              </div>
              <a
                className="btn-secondary"
                href={`/reports?examId=${encodeURIComponent(data.exam.id)}`}
              >
                Report cards
              </a>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Admission number</th>
                    <th>Student</th>
                    <th>Subject total</th>
                    <th>Overall average</th>
                    <th>Grade</th>
                    <th>Outcome</th>
                    {data.settings.rankingsEnabled && <th>Rank</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((r) => (
                    <tr key={r.id}>
                      <td>{r.admissionNumber}</td>
                      <td>{r.fullName}</td>
                      <td>{r.totalMarks}</td>
                      <td>{r.average === null ? "Pending" : `${r.average.toFixed(1)}%`}</td>
                      <td>{r.grade ?? "—"}</td>
                      <td>{r.pass === null ? "—" : r.pass ? "Pass" : "Fail"}</td>
                      {data.settings.rankingsEnabled && <td>{r.rank ?? "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {data.summary?.trends?.length ? (
            <section className="panel" style={{ marginTop: 14 }}>
              <div className="panel-title">Published subject performance trend</div>
              {data.summary.trends.map((x) => (
                <div
                  key={`${x.name}-${x.date}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(120px,1fr) 3fr 55px",
                    alignItems: "center",
                    gap: 10,
                    marginTop: 10,
                    fontSize: 11,
                  }}
                >
                  <span>
                    {x.name} · {x.date}
                  </span>
                  <span style={{ height: 8, background: "#edf1fa", borderRadius: 10 }}>
                    <span
                      style={{
                        display: "block",
                        width: `${Math.max(2, Math.min(100, x.average))}%`,
                        height: "100%",
                        background: "#315ee8",
                        borderRadius: 10,
                      }}
                    />
                  </span>
                  <b>{x.average.toFixed(1)}</b>
                </div>
              ))}
            </section>
          ) : null}
          {data.summary && canConfigure && (
            <section className="panel" style={{ marginTop: 14 }}>
              <div className="panel-title">Grading and ranking policy</div>
              <div className="panel-subtitle">
                Use separate named schemes for examination-specific grading; otherwise the school
                default applies.
              </div>
              <button
                className="btn-secondary"
                style={{ marginTop: 12 }}
                onClick={() => setShowSettings(!showSettings)}
              >
                {showSettings ? "Close settings" : "Configure policy"}
              </button>
              {showSettings && (
                <div className="form-grid" style={{ marginTop: 14 }}>
                  <div>
                    <label className="field">
                      School default grade bands · 0–100
                      <textarea rows={9} value={bands} onChange={(e) => setBands(e.target.value)} />
                    </label>
                    <label className="field">
                      Ranking policy
                      <select value={policy} onChange={(e) => setPolicy(e.target.value)}>
                        <option value="competition">Competition ranks</option>
                        <option value="dense">Dense ranks</option>
                        <option value="ordinal">Ordinal ranks</option>
                      </select>
                    </label>
                    <label style={{ display: "flex", gap: 8, margin: "14px 0", fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={rankings}
                        onChange={(e) => setRankings(e.target.checked)}
                      />
                      Enable rankings where school policy permits
                    </label>
                    <button className="btn-primary" onClick={() => void savePolicy()}>
                      Save default and ranking policy
                    </button>
                  </div>
                  <div>
                    <div className="panel-title">Custom grading schemes</div>
                    <div className="panel-subtitle">
                      Use a scheme ID when creating an examination.
                    </div>
                    <label className="field">
                      Scheme ID
                      <input
                        value={schemeId}
                        onChange={(e) => setSchemeId(e.target.value)}
                        placeholder="e.g. junior-grades"
                      />
                    </label>
                    <label className="field">
                      Scheme name
                      <input
                        value={schemeName}
                        onChange={(e) => setSchemeName(e.target.value)}
                        placeholder="Junior grades"
                      />
                    </label>
                    <label className="field">
                      Grade bands JSON
                      <textarea
                        rows={9}
                        value={schemeBands}
                        onChange={(e) => setSchemeBands(e.target.value)}
                      />
                    </label>
                    <button
                      className="btn-secondary"
                      disabled={!schemeId || !schemeName}
                      onClick={() => void saveScheme()}
                    >
                      Save custom scheme
                    </button>
                    <ul>
                      {schemes.map((x) => (
                        <li key={x.id}>
                          {x.name} — ID: {x.id}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}

export function ReportCardsPanel({ canEditComments = false }: { canEditComments?: boolean }) {
  const [exams, setExams] = useState<ExamOption[]>([]);
  const [examId, setExamId] = useState("");
  const [data, setData] = useState<ResultData | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [comments, setComments] = useState({ teacherComment: "", principalComment: "" });
  useEffect(() => {
    void fetch("/api/results?reportCards=1", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setExams(d.items ?? []);
        const queryId = new URLSearchParams(window.location.search).get("examId");
        setExamId(queryId || d.items?.[0]?.id || "");
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!examId) return;
    let alive = true;
    void fetch(
      `/api/results?examId=${encodeURIComponent(examId)}&includeAttendance=1&reportCards=1`,
      { cache: "no-store" },
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (alive) setData(d);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [examId]);
  async function saveComment(student: Result) {
    try {
      const token = await fetchCsrfToken();
      const r = await fetch("/api/results", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify({ action: "comments", examId, studentId: student.id, ...comments }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setEditing(null);
      setData(
        (old) =>
          old && {
            ...old,
            results: old.results.map((x) => (x.id === student.id ? { ...x, ...comments } : x)),
          },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Comment save failed");
    }
  }
  return (
    <main className="page-content">
      <div className="page-heading no-print">
        <div>
          <div className="eyebrow">A4 · print-ready</div>
          <h1>Report cards</h1>
          <p>
            Individual or whole-class report cards. Use Print / Save as PDF for a downloadable copy.
          </p>
        </div>
        <button className="btn-primary" onClick={() => window.print()} disabled={!data}>
          Print / Save PDF
        </button>
      </div>
      <div className="panel no-print">
        <label className="field">
          Examination
          <select value={examId} onChange={(e) => setExamId(e.target.value)}>
            <option value="">Choose examination</option>
            {exams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · Grade {x.grade} {x.className} · {x.subject}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="login-error no-print">{error}</p>}
      {data?.results.map((student) => (
        <article className="report-card" key={student.id}>
          <header className="report-header">
            {data.school.logoUrl ? (
              <img src={data.school.logoUrl} alt="School logo" />
            ) : (
              <div className="report-seal">ES</div>
            )}
            <div>
              <div className="eyebrow">Official student record</div>
              <h1>{data.school.name}</h1>
              <h2>Student Report Card</h2>
            </div>
            {student.photoUrl && (
              <img
                className="report-photo"
                src={student.photoUrl}
                alt={`Portrait of ${student.fullName}`}
              />
            )}
          </header>
          <div className="report-meta">
            <div>
              <b>Student</b>
              <span>{student.fullName}</span>
            </div>
            <div>
              <b>Admission no.</b>
              <span>{student.admissionNumber}</span>
            </div>
            <div>
              <b>Grade / Class</b>
              <span>
                {data.exam.grade} / {data.exam.className}
              </span>
            </div>
            <div>
              <b>Academic year</b>
              <span>{data.exam.academicYearName || data.exam.academicYearId}</span>
            </div>
            <div>
              <b>Examination</b>
              <span>{data.exam.name}</span>
            </div>
            <div>
              <b>Date</b>
              <span>{data.exam.examinationDate}</span>
            </div>
          </div>
          <table className="report-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Marks</th>
                <th>Grade</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {student.subjectResults.map((subject) => (
                <tr key={subject.examId}>
                  <td>{subject.subject}</td>
                  <td>
                    {subject.marks ?? "Pending"} / {subject.maxMarks}
                  </td>
                  <td>{subject.grade ?? "—"}</td>
                  <td>{subject.pass === null ? "—" : subject.pass ? "Pass" : "Fail"}</td>
                </tr>
              ))}
              <tr>
                <th>Total marks</th>
                <td>{student.totalMarks}</td>
                <th>Average</th>
                <td>{student.average === null ? "—" : `${student.average.toFixed(1)}%`}</td>
              </tr>
            </tbody>
          </table>
          <div className="report-block">
            <b>Attendance summary</b>
            <p>
              {student.attendanceSummary?.percentage != null
                ? `${student.attendanceSummary.percentage}% attendance`
                : "Attendance summary not recorded for this report."}
            </p>
          </div>
          <div className="report-comments">
            <div>
              <b>Teacher comments</b>
              <p>{student.teacherComment || student.remarks || "—"}</p>
            </div>
            <div>
              <b>Principal comments</b>
              <p>{student.principalComment || "—"}</p>
            </div>
          </div>
          {editing === student.id && (
            <div className="no-print form-grid">
              <label className="field">
                Teacher comments
                <textarea
                  rows={3}
                  value={comments.teacherComment}
                  onChange={(e) => setComments({ ...comments, teacherComment: e.target.value })}
                />
              </label>
              <label className="field">
                Principal comments
                <textarea
                  rows={3}
                  value={comments.principalComment}
                  onChange={(e) => setComments({ ...comments, principalComment: e.target.value })}
                />
              </label>
              <button className="btn-primary" onClick={() => void saveComment(student)}>
                Save comments
              </button>
            </div>
          )}
          <footer className="report-signatures">
            <span>Class teacher signature</span>
            <span>Principal signature</span>
            <span>Parent / guardian signature</span>
          </footer>
          <div className="no-print report-actions">
            {canEditComments && (
              <button
                className="btn-secondary"
                onClick={() => {
                  setEditing(editing === student.id ? null : student.id);
                  setComments({
                    teacherComment: student.teacherComment,
                    principalComment: student.principalComment,
                  });
                }}
              >
                Edit comments
              </button>
            )}
            <button className="btn-secondary" onClick={() => window.print()}>
              Print this card
            </button>
          </div>
        </article>
      ))}
    </main>
  );
}
