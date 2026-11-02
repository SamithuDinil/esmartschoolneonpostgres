"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";
import styles from "./AttendancePanel.module.css";
type ClassRow = { id: string; name: string; grade: string; section?: string; teacherId?: string; isClassTeacher?: boolean };
function isWeekendDate(value: string) {
  const day = new Date(`${value}T12:00:00`).getDay();
  return day === 0 || day === 6;
}
function localDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
function latestSchoolDay() {
  const date = new Date();
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() - 1);
  return localDate(date);
}
function classLabel(item: ClassRow) {
  const rawGrade = item.grade.trim().replace(/^grade\s*/i, "").replace(/^0+(?=\d)/, "");
  const grade = /^\d+$/.test(rawGrade) ? `Grade ${rawGrade}` : item.grade.replace(/^Grade 0/, "Grade ");
  return `${grade}-${item.section || item.name}`;
}
type Student = { id: string; fullName: string; admissionNumber: string; status: string | null };
const ATTENDANCE_EDIT_WINDOW_MS = 5 * 60 * 1000;
const statusLabels: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  excused: "Excused",
};
type CoverTeacher = { uid: string; name: string; role: string };
type Cover = { teacherUid: string; teacherName: string; assignedBy?: string; reason?: string };
type Session = {
  id: string;
  classId: string;
  className: string;
  date: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  totalEnrolled: number;
  attendancePercentage: number;
};
type Insights = { sessions: number; atRisk: Array<{ studentId: string; name?: string; grade?: string; className?: string; attendancePercentage: number; absent: number }>; classes: Array<{ name: string; attendancePercentage: number; total: number }> };
const attendanceActions = [
  { value: "present", label: "Present", tone: styles.present },
  { value: "absent", label: "Absent", tone: styles.absent },
  { value: "late", label: "Late", tone: styles.late },
  { value: "excused", label: "Excused", tone: styles.excused },
] as const;
export function AttendancePanel({ canAssignCover, canViewInsights = false, canReviewLeaves = false }: { canAssignCover: boolean; canViewInsights?: boolean; canReviewLeaves?: boolean }) {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classId, setClassId] = useState("");
  const [date, setDate] = useState(() => latestSchoolDay());
  const [coverTeachers, setCoverTeachers] = useState<CoverTeacher[]>([]);
  const [loadingCoverTeachers, setLoadingCoverTeachers] = useState(false);
  const [coverTeacherUid, setCoverTeacherUid] = useState("");
  const [coverReason, setCoverReason] = useState("");
  const [currentCover, setCurrentCover] = useState<Cover | null>(null);
  const [assigningCover, setAssigningCover] = useState(false);
  const [students, setStudents] = useState<Array<Student & { updatedAt?: string | null }>>([]);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [sessions, setSessions] = useState<Session[]>([]);
  const [corrections, setCorrections] = useState<Record<string, unknown>[]>([]);
  const [tab, setTab] = useState("daily");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [leaveRequests, setLeaveRequests] = useState<Record<string, unknown>[]>([]);
  const [clock, setClock] = useState(() => Date.now());
  const loadClasses = useCallback(async () => {
    try {
      const r = await fetch(`/api/attendance?type=classes&date=${encodeURIComponent(date)}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      const availableClasses: ClassRow[] = d.classes ?? [];
      setClasses(availableClasses);
      setClassId((current) => {
        if (current && availableClasses.some((row) => row.id === current)) return current;
        return availableClasses[0]?.id ?? "";
      });
      if (!availableClasses.length) {
        setStudents([]);
        setMarks({});
        setCurrentCover(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load classes");
    }
  }, [date]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkedClassId = params.get("classId");
    const linkedDate = params.get("date");
    if (linkedClassId) setClassId(linkedClassId);
    if (linkedDate && /^\d{4}-\d{2}-\d{2}$/.test(linkedDate)) {
      if (isWeekendDate(linkedDate)) setError("Saturday and Sunday are school holidays. Attendance is available Monday to Friday.");
      else setDate(linkedDate);
    }
  }, []);
  useEffect(() => {
    void loadClasses();
  }, [loadClasses]);
  useEffect(() => {
    if (!canAssignCover) return;
    let active = true;
    setLoadingCoverTeachers(true);
    void (async () => {
      try {
        const r = await fetch("/api/attendance?type=cover_teachers", { cache: "no-store" });
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (active) setCoverTeachers(d.teachers ?? []);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load active teachers");
      } finally {
        if (active) setLoadingCoverTeachers(false);
      }
    })();
    return () => { active = false; };
  }, [canAssignCover]);
  const loadDay = useCallback(async () => {
    if (!classId) return;
    try {
      setError("");
      const r = await fetch(`/api/attendance?classId=${encodeURIComponent(classId)}&date=${date}`, {
        cache: "no-store",
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setStudents(d.students);
      setMarks(Object.fromEntries(d.students.map((s: Student) => [s.id, s.status ?? ""])));
      setCurrentCover(d.cover ?? null);
      setCoverTeacherUid(d.cover?.teacherUid ?? "");
      setCoverReason(d.cover?.reason ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load attendance");
    }
  }, [classId, date]);
  useEffect(() => {
    void loadDay();
  }, [loadDay]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  function isLocked(student: Student & { updatedAt?: string | null }) {
    if (!student.status || !student.updatedAt) return false;
    const markedAt = new Date(student.updatedAt).getTime();
    return Number.isFinite(markedAt) && clock - markedAt >= ATTENDANCE_EDIT_WINDOW_MS;
  }
  async function assignCover() {
    if (!classId || !coverTeacherUid) return;
    setAssigningCover(true);
    setError("");
    setMessage("");
    try {
      const csrf = await fetchCsrfToken();
      const r = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          action: "assign_cover",
          classId,
          date,
          teacherUid: coverTeacherUid,
          reason: coverReason,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage(d.unchanged
        ? `${d.teacherName} is already assigned to this class for ${date}.`
        : `Class cover assigned to ${d.teacherName} for ${date}. An in-app notification has been sent.`);
      await loadDay();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Class cover could not be assigned");
    } finally {
      setAssigningCover(false);
    }
  }
  async function submit() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const csrf = await fetchCsrfToken();
      const records = students
        .filter((s) => marks[s.id])
        .map((s) => ({ studentId: s.id, status: marks[s.id] }));
      const r = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ action: "mark", classId, date, records }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage(`Attendance saved. ${d.changed} status changes recorded.`);
      await loadDay();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Attendance could not be saved");
    } finally {
      setBusy(false);
    }
  }
  async function loadMonth() {
    setError("");
    try {
      const r = await fetch(`/api/attendance?month=${month}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setSessions(d.sessions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Monthly history unavailable");
    }
  }
  async function loadInsights() {
    try {
      const r = await fetch("/api/attendance?type=insights", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setInsights(d);
    } catch (e) { setError(e instanceof Error ? e.message : "Attendance insights unavailable"); }
  }
  async function loadLeaveRequests() {
    const r = await fetch("/api/student-leave", { cache: "no-store" });
    const d = await r.json();
    if (r.ok) setLeaveRequests(d.requests ?? []);
  }
  async function decideLeave(requestId: string, decision: "approved" | "rejected") {
    const csrf = await fetchCsrfToken();
    const r = await fetch("/api/student-leave", { method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ requestId, decision }) });
    if (!r.ok) { const d = await r.json(); setError(d.error ?? "Leave decision failed"); return; }
    setMessage(`Leave request ${decision}.`);
    await loadLeaveRequests();
  }
  async function loadCorrections() {
    try {
      const r = await fetch("/api/attendance?type=corrections", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setCorrections(d.requests ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Correction queue unavailable");
    }
  }
  async function decide(id: string, decision: string) {
    try {
      const csrf = await fetchCsrfToken();
      const r = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ action: "decide_correction", requestId: id, decision }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage(`Correction ${decision}.`);
      await loadCorrections();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Correction decision failed");
    }
  }
  async function requestCorrection(studentId: string) {
    try {
      const csrf = await fetchCsrfToken();
      const r = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          action: "request_correction",
          classId,
          date,
          studentId,
          requestedStatus: marks[studentId],
          reason,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage("Correction request submitted for review.");
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Correction request failed");
    }
  }
  const counts = students.reduce(
    (acc, s) => {
      const x = marks[s.id];
      if (x) acc[x] = (acc[x] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const attended = (counts.present ?? 0) + (counts.late ?? 0);
  const percent = students.length ? Math.round((attended / students.length) * 100) : 0;
  const selectedClass = classes.find((row) => row.id === classId);
  const weekendSelected = isWeekendDate(date);
  const regularTeacherUid = selectedClass?.teacherId;
  const availableCoverTeachers = coverTeachers.filter((teacher) => teacher.uid !== regularTeacherUid);
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">School workspace · Attendance</div>
          <h1>Student attendance</h1>
          <p>Daily class rolls, corrections and monthly attendance summaries.</p>
        </div>
        <button className="btn-secondary" onClick={() => window.print()}>
          Print / PDF
        </button>
      </div>
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="login-success" role="status">
          {message}
        </p>
      )}
      <nav style={{ display: "flex", gap: 8, marginBottom: 14, overflowX: "auto" }}>
        <button
          className={tab === "daily" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("daily")}
        >
          Daily register
        </button>
        <button
          className={tab === "monthly" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("monthly")}
        >
          Monthly reports
        </button>
        <button
          className={tab === "corrections" ? "btn-primary" : "btn-secondary"}
          onClick={() => {
            setTab("corrections");
            void loadCorrections();
          }}
        >
          Correction approvals
        </button>
        {canViewInsights && <button className={tab === "insights" ? "btn-primary" : "btn-secondary"} onClick={() => { setTab("insights"); void loadInsights(); }}>Smart insights</button>}
        {canReviewLeaves && <button className={tab === "leave" ? "btn-primary" : "btn-secondary"} onClick={() => { setTab("leave"); void loadLeaveRequests(); }}>Leave approvals</button>}
      </nav>
      {tab === "insights" && insights && (
        <section className="panel" style={{ padding: 18 }}>
          <h2>Smart attendance insights</h2><p className="panel-subtitle">Last 30 days · classes and students needing attention.</p>
          <div className="stat-grid" style={{ marginTop: 14 }}><article className="stat-card"><span>Sessions reviewed</span><div className="stat-value">{insights.sessions}</div></article><article className="stat-card"><span>Students at risk</span><div className="stat-value">{insights.atRisk.length}</div></article><article className="stat-card"><span>Lowest class</span><div className="stat-value" style={{ fontSize: 18 }}>{insights.classes[0]?.attendancePercentage ?? 0}%</div></article></div>
          <h3 style={{ marginTop: 20 }}>Students needing attention</h3>{insights.atRisk.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Student</th><th>Class</th><th>Attendance</th><th>Absences</th></tr></thead><tbody>{insights.atRisk.map((row) => <tr key={row.studentId}><td>{row.name}</td><td>{row.grade} · {row.className}</td><td><span className="pill pending">{row.attendancePercentage}%</span></td><td>{row.absent}</td></tr>)}</tbody></table></div> : <p className="login-success">No students currently meet the risk threshold.</p>}
          <h3 style={{ marginTop: 20 }}>Class comparison</h3><div className="table-wrap"><table className="data-table"><thead><tr><th>Class</th><th>Attendance</th><th>Records</th></tr></thead><tbody>{insights.classes.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.attendancePercentage}%</td><td>{row.total}</td></tr>)}</tbody></table></div>
        </section>
      )}
      {tab === "leave" && <section className="panel" style={{ padding: 18 }}><h2>Student leave approvals</h2><p className="panel-subtitle">Approve a request to automatically mark matching attendance sessions as excused leave.</p>{leaveRequests.length ? leaveRequests.map((row) => <article key={String(row.id)} style={{ padding: 14, borderBottom: "1px solid #e7ebf0" }}><strong>{String(row.studentName ?? row.studentId)}</strong><p>{String(row.fromDate)} — {String(row.toDate)} · {String(row.reason)}</p><button className="btn-primary" onClick={() => void decideLeave(String(row.id), "approved")}>Approve</button>{" "}<button className="btn-secondary" onClick={() => void decideLeave(String(row.id), "rejected")}>Reject</button></article>) : <p className="empty-state">No pending leave requests.</p>}</section>}
      {tab === "daily" && (
        <>
          <section
            className="panel"
            style={{ padding: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}
          >
            <label className="field">
              Class
              <select value={classId} onChange={(e) => setClassId(e.target.value)}>
                {!classes.length && <option value="">No classes available for this date</option>}
                {classes.map((c) => (
                  <option value={c.id} key={c.id}>
                    {classLabel(c)}{c.isClassTeacher ? " · Your class" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Date
              <input type="date" value={date} onChange={(e) => {
                if (isWeekendDate(e.target.value)) {
                  setError("Saturday and Sunday are school holidays. Choose a weekday (Monday to Friday).");
                  return;
                }
                setError("");
                setDate(e.target.value);
              }} />
              <small>School days: Monday–Friday</small>
            </label>
            <button
              className="btn-secondary"
              disabled={weekendSelected || !students.length}
              onClick={() => setMarks(Object.fromEntries(students.map((s) => [s.id, "present"])))}
            >
              Mark all present
            </button>
            <button
              className="btn-primary"
              disabled={busy || weekendSelected || !students.length}
              onClick={() => void submit()}
            >
              {busy ? "Saving…" : "Save attendance"}
            </button>
          </section>
          {selectedClass?.isClassTeacher && <div className="login-success" role="status"><strong>Class teacher</strong> · You’re assigned to {classLabel(selectedClass)} and can mark this class’s attendance.</div>}
          {canAssignCover && (
            <section className="panel attendance-cover-panel">
              <div className="attendance-cover-heading">
                <div>
                  <span className="eyebrow">Temporary assignment</span>
                  <h2>Temporary class cover</h2>
                  <p>Give another active teacher permission to take this class’s attendance for the selected date.</p>
                </div>
                <span className="attendance-cover-icon" aria-hidden="true">Cover</span>
              </div>
              {currentCover && (
                <div className="attendance-cover-current" role="status">
                  <strong>Current cover: {currentCover.teacherName}</strong>
                  <span>{currentCover.reason || "Temporary cover"} · {date}</span>
                </div>
              )}
              <div className="attendance-cover-controls">
                <label className="field">
                  Cover teacher
                  <select
                    value={coverTeacherUid}
                    onChange={(event) => setCoverTeacherUid(event.target.value)}
                    disabled={!classId || !availableCoverTeachers.length || loadingCoverTeachers}
                  >
                    <option value="">{loadingCoverTeachers ? "Loading active teachers…" : "Select an active teacher"}</option>
                    {currentCover && !availableCoverTeachers.some((teacher) => teacher.uid === currentCover.teacherUid) && (
                      <option value={currentCover.teacherUid}>{currentCover.teacherName} · current cover</option>
                    )}
                    {availableCoverTeachers.map((teacher) => (
                      <option value={teacher.uid} key={teacher.uid}>
                        {teacher.name} · {teacher.role.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Note for the teacher <span>(optional)</span>
                  <input
                    value={coverReason}
                    maxLength={300}
                    onChange={(event) => setCoverReason(event.target.value)}
                    placeholder="e.g. Covering for the class teacher today"
                  />
                </label>
                <button
                  className="btn-primary attendance-cover-submit"
                  type="button"
                  disabled={assigningCover || !classId || !coverTeacherUid}
                  onClick={() => void assignCover()}
                >
                  {assigningCover ? "Assigning…" : currentCover ? "Update cover assignment" : "Assign cover teacher"}
                </button>
              </div>
              {!loadingCoverTeachers && !availableCoverTeachers.length && <p className="attendance-cover-hint">No other active class or subject teacher members are available to assign.</p>}
              <p className="attendance-cover-hint">This assignment applies only to {date}. The regular class-teacher assignment is not changed. The selected teacher receives an in-app notification.</p>
            </section>
          )}
          {!canAssignCover && currentCover && (
            <aside className="attendance-cover-banner" role="status">
              <strong>You’re covering this class</strong>
              <span>{currentCover.teacherName} · {date}. You have temporary permission to record attendance for this class on the selected date.</span>
            </aside>
          )}
          <div className="content-grid" style={{ marginTop: 12 }}>
            {[
              { label: "Enrolled", value: students.length },
              { label: "Present", value: counts.present ?? 0 },
              { label: "Absent", value: counts.absent ?? 0 },
              { label: "Late", value: counts.late ?? 0 },
              { label: "Leave / excused", value: counts.excused ?? 0 },
              { label: "Attendance", value: `${percent}%` },
            ].map((x) => (
              <section className="panel" style={{ padding: 14 }} key={x.label}>
                <small>{x.label}</small>
                <h2>{x.value}</h2>
              </section>
            ))}
          </div>
          <p className={styles.attendanceHint}>Tap a status to mark each student. <strong>Late counts as present</strong> in the attendance rate.</p>
          <section className="panel" style={{ padding: 16, marginTop: 12 }}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Admission #</th>
                    <th>Student</th>
                    <th>Mark attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id}>
                      <td>{s.admissionNumber}</td>
                      <td>{s.fullName}</td>
                      <td>
                        {isLocked(s) ? (
                          <div className={styles.lockedStatus} role="status">
                            <strong>{statusLabels[s.status ?? ""] ?? s.status}</strong>
                            <small>Locked after 5 minutes</small>
                          </div>
                        ) : (
                          <div className={styles.statusActions} role="group" aria-label={`Attendance for ${s.fullName}`}>
                            {attendanceActions.map((action) => {
                              const selected = marks[s.id] === action.value;
                              return (
                                <button
                                  key={action.value}
                                  type="button"
                                  className={`${styles.statusButton} ${action.tone} ${selected ? styles.selected : ""}`}
                                  aria-pressed={selected}
                                  title={action.value === "late" ? "Present, but arrived late. Counts as attended." : action.label}
                                  disabled={weekendSelected}
                                  onClick={() => setMarks((current) => ({
                                    ...current,
                                    [s.id]: current[s.id] === action.value ? "" : action.value,
                                  }))}
                                >
                                  {action.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel" style={{ padding: 16, marginTop: 12 }}>
            <h3>Request a correction</h3>
            <label className="field">
              Reason
              <textarea
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <p className="panel-subtitle">
              Select the requested corrected status in the roster above, then choose a student.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {students
                .filter((s) => marks[s.id])
                .map((s) => (
                  <button
                    className="btn-secondary"
                    key={s.id}
                    onClick={() => void requestCorrection(s.id)}
                  >
                    Request correction · {s.fullName}
                  </button>
                ))}
            </div>
          </section>
        </>
      )}
      {tab === "monthly" && (
        <section className="panel" style={{ padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "end" }}>
            <label className="field">
              Month
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
            <button className="btn-primary" onClick={() => void loadMonth()}>
              Load report
            </button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Class</th>
                  <th>Enrolled</th>
                  <th>Present</th>
                  <th>Absent</th>
                  <th>Late</th>
                  <th>Excused</th>
                  <th>Attendance %</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.date}</td>
                    <td>{s.className}</td>
                    <td>{s.totalEnrolled}</td>
                    <td>{s.present}</td>
                    <td>{s.absent}</td>
                    <td>{s.late}</td>
                    <td>{s.excused}</td>
                    <td>{s.attendancePercentage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="panel-subtitle">
            Frequent absence indicators and month-to-month charts can be generated from this dated
            register; guardian delivery remains queued until messaging is configured.
          </p>
        </section>
      )}
      {tab === "corrections" && (
        <section className="panel" style={{ padding: 16 }}>
          <h2>Pending attendance corrections</h2>
          {corrections.length ? (
            corrections.map((r) => (
              <article
                key={String(r.id)}
                style={{ padding: 12, borderBottom: "1px solid #e7ebf0" }}
              >
                <strong>
                  {String(r.studentId)} · {String(r.date)}
                </strong>
                <p>
                  Requested status: {String(r.requestedStatus)} · {String(r.reason)}
                </p>
                <button
                  className="btn-primary"
                  onClick={() => void decide(String(r.id), "approved")}
                >
                  Approve
                </button>{" "}
                <button
                  className="btn-secondary"
                  onClick={() => void decide(String(r.id), "rejected")}
                >
                  Reject
                </button>
              </article>
            ))
          ) : (
            <p>No pending requests.</p>
          )}
        </section>
      )}
    </main>
  );
}
