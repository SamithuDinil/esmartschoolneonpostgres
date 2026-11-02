"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";
import { CLASS_OPTIONS, GRADE_OPTIONS, normalizeGradeLabel } from "@/lib/academic-options";
import Link from "next/link";
const sections = [
  { id: "academicYears", title: "Academic years" },
  { id: "terms", title: "School terms" },
  { id: "examinationPeriods", title: "Examination periods" },
  { id: "gradeStructure", title: "Grades & classes" },
  { id: "subjects", title: "Subjects" },
  { id: "workingDays", title: "Working days" },
  { id: "holidays", title: "Holidays" },
  { id: "events", title: "School events" },
  { id: "specialSchedules", title: "Special schedules" },
  { id: "attendancePolicies", title: "Attendance policies" },
  { id: "gradingSchemes", title: "Examination grading" },
  { id: "announcements", title: "Announcements" },
];
const profileFields = [
  "name",
  "registrationNumber",
  "logoUrl",
  "motto",
  "address",
  "province",
  "district",
  "educationalZone",
  "phone",
  "alternatePhone",
  "email",
  "website",
  "principalName",
  "principalContact",
  "schoolType",
  "medium",
  "establishedYear",
];
type Row = {
  id: string;
  name: string;
  code?: string;
  status?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  grade?: string;
  teacherId?: string;
  teacherName?: string;
  room?: string;
  date?: string;
  section?: string;
  capacity?: number;
  enrollmentCount?: number;
  seatsAvailable?: number | null;
  academicYearId?: string;
  subjectCode?: string;
  category?: string;
  optional?: boolean;
  classroomId?: string;
  schoolType?: string;
  streams?: string[];
  combinations?: string[][];
};
type TeacherOption = { uid: string; displayName: string; role: string };
type SubjectOption = { name: string; grade?: string };
type TeachingAssignmentInput = { id: string; teacherUid: string; subject: string };
const initial = {
  name: "",
  code: "",
  status: "active",
  startDate: "",
  endDate: "",
  grade: "",
  teacherId: "",
  room: "",
  description: "",
  date: "",
  section: "",
  capacity: "",
  academicYearId: "",
  subjectCode: "",
  category: "core",
  optional: "false",
  schoolType: "",
  streams: "",
  combinations: "",
};
export function AdministrationPanel() {
  const [active, setActive] = useState("profile"),
    [profile, setProfile] = useState<Record<string, string>>({}),
    [rows, setRows] = useState<Row[]>([]),
    [years, setYears] = useState<Row[]>([]),
    [selectedYear, setSelectedYear] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [err, setErr] = useState(""),
    [form, setForm] = useState(initial);
  const [teacherOptions, setTeacherOptions] = useState<TeacherOption[]>([]);
  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);
  const [teachingAssignments, setTeachingAssignments] = useState<TeachingAssignmentInput[]>([]);
  const [classSectionsText, setClassSectionsText] = useState("A-F");
  const load = useCallback(async () => {
    setErr("");
    try {
      const tasks = [
        fetch("/api/administration?group=academicYears", { cache: "no-store" }),
        active === "profile"
          ? fetch("/api/administration", { cache: "no-store" })
          : fetch(`/api/administration?group=${active === "gradeStructure" ? "classes" : active}`, { cache: "no-store" }),
      ];
      const [yr, main] = await Promise.all(tasks);
      const yd = await yr.json();
      if (!yr.ok) throw Error(yd.error);
      setYears(yd.items ?? []);
      if (active === "profile") {
        const d = await main.json();
        if (!main.ok) throw Error(d.error);
        setProfile(
          Object.fromEntries(
            profileFields.map((k) => [k, d.profile?.[k] == null ? "" : String(d.profile[k])]),
          ),
        );
      } else {
        const d = await main.json();
        if (!main.ok) throw Error(d.error);
        setRows(d.items ?? []);
        setTeacherOptions(active === "gradeStructure" ? d.teacherOptions ?? [] : []);
        setSubjectOptions(active === "classes" ? d.subjectOptions ?? [] : []);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unable to load settings");
    }
  }, [active]);
  useEffect(() => {
    void load();
  }, [load]);
  async function send(method: string, body: object, url = "/api/administration"): Promise<boolean> {
    setBusy(true);
    setErr("");
    setNotice("");
    try {
      const csrf = await fetchCsrfToken();
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) {
        const detail = d.fields
          ? Object.entries(d.fields as Record<string, string[]>)
              .map(([k, v]) => `${k}: ${v.join(", ")}`)
              .join("; ")
          : "";
        throw Error(detail ? `${d.error} (${detail})` : d.error);
      }
      setNotice("Saved. This change is recorded in school audit history.");
      await load();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    void send("PATCH", {
      ...profile,
      establishedYear: profile.establishedYear ? Number(profile.establishedYear) : undefined,
    });
  }
  function saveRecord(e: React.FormEvent) {
    e.preventDefault();
    if (active === "gradeStructure") {
      const input = classSectionsText.trim();
      const range = input.match(/^([A-Za-z])\s*-\s*([A-Za-z])$/);
      const sections = range
        ? Array.from({ length: Math.abs(range[2].toUpperCase().charCodeAt(0) - range[1].toUpperCase().charCodeAt(0)) + 1 }, (_, i) => String.fromCharCode(Math.min(range[1].toUpperCase().charCodeAt(0), range[2].toUpperCase().charCodeAt(0)) + i))
        : input.split(",").map((item) => item.trim()).filter(Boolean);
      if (!form.grade || !sections.length || sections.length > 40) {
        setErr("Choose a grade and enter one or more class names (for example A-F or Blue, Red, Green).");
        return;
      }
      if (new Set(sections.map((item) => item.toLowerCase())).size !== sections.length || sections.some((item) => item.length > 30)) {
        setErr("Class names must be unique and no longer than 30 characters.");
        return;
      }
      void send("POST", { grade: form.grade, sections, academicYearId: form.academicYearId || undefined }, "/api/administration?group=gradeStructure");
      return;
    }
    const incompleteAssignment = active === "classes" && teachingAssignments.some(
      (assignment) => Boolean(assignment.teacherUid || assignment.subject) &&
        !(assignment.teacherUid && assignment.subject),
    );
    if (incompleteAssignment) {
      setErr("Choose both a teacher and a subject for each teaching assignment, or remove the unfinished row.");
      return;
    }
    const payload: Record<string, unknown> = {
      ...form,
      capacity: form.capacity ? Number(form.capacity) : undefined,
      optional: form.optional === "true",
      streams: form.streams
        ? form.streams
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : undefined,
      combinations: form.combinations
        ? form.combinations.split(";").map((x) =>
            x
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
          )
        : undefined,
    };
    if (active === "grades") {
      const gradeNumber = Number(form.name.replace(/^grade\s*/i, ""));
      payload.name = `Grade ${String(gradeNumber).padStart(2, "0")}`;
    }
    if (active === "classes") {
      payload.name = form.section;
      payload.section = form.section;
      payload.teacherId = form.teacherId || undefined;
      payload.teacherAssignments = teachingAssignments
        .filter((assignment) => assignment.teacherUid && assignment.subject)
        .map(({ teacherUid, subject }) => ({ teacherUid, subject }));
    }
    void send("POST", payload, `/api/administration?group=${active}`).then((ok) => {
      if (ok) {
        setForm(initial);
        setTeachingAssignments([]);
      }
    });
  }
  function yearAction(id: string, status: "active" | "closed") {
    void send("PATCH", { scope: "configuration", group: "academicYears", id, status });
  }
  const gradeOptions = GRADE_OPTIONS;
  const classOptions = CLASS_OPTIONS;
  const applicableSubjects = subjectOptions.filter(
    (subject) => !subject.grade || normalizeGradeLabel(subject.grade) === form.grade,
  );
  const listed = rows.filter(
    (r) =>
      !selectedYear ||
      active === "academicYears" ||
      active === "gradeStructure" ||
      !r.academicYearId ||
      r.academicYearId === selectedYear,
  );
  function field(name: keyof typeof initial, label: string, type = "text", required = false) {
    return (
      <label className="field" key={name}>
        {label}
        <input
          type={type}
          required={required}
          value={form[name]}
          onChange={(e) => setForm({ ...form, [name]: e.target.value })}
        />
      </label>
    );
  }
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">School workspace · Administration</div>
          <h1>School administration</h1>
          <p>Manage identity, calendar, grade structure, class sections and subjects.</p>
        </div>
      </div>
      {err && (
        <div className="login-error" role="alert">
          {err}
        </div>
      )}
      {notice && (
        <div className="login-success" role="status">
          {notice}
        </div>
      )}
      <div
        style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 12, marginBottom: 12 }}
      >
        <button
          className={active === "profile" ? "btn-primary" : "btn-secondary"}
          onClick={() => setActive("profile")}
        >
          School profile
        </button>
        {sections.map((s) => (
          <button
            key={s.id}
            className={active === s.id ? "btn-primary" : "btn-secondary"}
            onClick={() => setActive(s.id)}
          >
            {s.title}
          </button>
        ))}
      </div>
      {active === "profile" ? (
        <section className="panel" style={{ padding: 20 }}>
          <h2>School profile</h2>
          <p className="panel-subtitle">
            Profile changes are retained on the school record with change history.
          </p>
          <form onSubmit={saveProfile}>
            <div className="form-grid">
              {profileFields.map((key) => (
                <label className="field" key={key}>
                  {key.replace(/[A-Z]/g, (m) => ` ${m}`).replace(/^./, (m) => m.toUpperCase())}
                  <input
                    type={
                      key === "email"
                        ? "email"
                        : key === "website"
                          ? "url"
                          : key === "establishedYear"
                            ? "number"
                            : "text"
                    }
                    value={profile[key] ?? ""}
                    onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <button className="btn-primary" disabled={busy} style={{ marginTop: 16 }}>
              Save school profile
            </button>
          </form>
        </section>
      ) : active === "gradeStructure" ? (
        <div className="administration-config-grid">
          <section className="panel" style={{ padding: 20 }}>
            <h2>Set up grades and classes</h2>
            <p className="panel-subtitle">Choose a grade once, then generate all its classes together. Use a range such as A-F or type names separated by commas.</p>
            <form onSubmit={saveRecord} className="form-grid">
              <label className="field">Grade<select required value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })}><option value="">Choose grade</option>{gradeOptions.map((g) => <option key={g} value={g}>{g.replace(/^Grade 0/, "Grade ")}</option>)}</select></label>
              <label className="field">Class sections or names<input required value={classSectionsText} onChange={(e) => setClassSectionsText(e.target.value)} placeholder="A-F or Blue, Red, Green" /><small>Examples: A-F creates six classes; North, South creates two named classes.</small></label>
              <label className="field">Academic year (optional)<select value={form.academicYearId} onChange={(e) => setForm({ ...form, academicYearId: e.target.value })}><option value="">School-wide/current</option>{years.filter((y) => y.status !== "closed").map((y) => <option value={y.id} key={y.id}>{y.name}</option>)}</select></label>
              <button className="btn-primary" disabled={busy || !form.grade}>{busy ? "Creating classes…" : "Generate classes"}</button>
            </form>
          </section>
          <section className="panel" style={{ padding: 20 }}>
            <div className="panel-header"><div><h2>Classes and class teachers</h2><p className="panel-subtitle">Assign a class teacher from the dropdown beside each class. Changes save immediately.</p></div></div>
            {listed.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Grade</th><th>Class</th><th>Class teacher</th></tr></thead><tbody>{listed.map((row) => <tr key={row.id}><td>{row.grade}</td><td><strong>{row.section ?? row.name}</strong></td><td>{row.teacherId && <div style={{ marginBottom: 6 }}><span className="pill active">Class teacher</span>{row.teacherName && <span className="panel-subtitle" style={{ marginLeft: 7 }}>{row.teacherName}</span>}</div>}<select aria-label={`Class teacher for ${row.grade} ${row.section ?? row.name}`} value={row.teacherId ?? ""} disabled={busy} onChange={(e) => void send("PATCH", { action: "assign_class_teacher", classId: row.id, teacherId: e.target.value })}><option value="">Assign later</option>{teacherOptions.map((teacher) => <option key={teacher.uid} value={teacher.uid}>{teacher.displayName}</option>)}</select></td></tr>)}</tbody></table></div> : <div className="empty-state"><h3>No classes created</h3><p>Create grades and sections above to get started.</p></div>}
          </section>
        </div>
      ) : (
        <div className="administration-config-grid">
          <section className="panel" style={{ padding: 20 }}>
            <div className="panel-header">
              <div>
                <h2>{sections.find((s) => s.id === active)?.title}</h2>
                <p className="panel-subtitle">
                  Academic year history is retained. Closed-year records are read-only.
                </p>
              </div>
              {!["academicYears", "grades", "classes", "subjects"].includes(active) && (
                <select
                  aria-label="View academic year"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                >
                  <option value="">All academic years</option>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name} · {y.status}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {listed.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Details</th>
                      <th>Status / capacity</th>
                      <th>Dates</th>
                      {active === "academicYears" && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {listed.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>
                            {active === "classes" ? (
                              <Link href={`/classes/${row.id}`}>
                                {row.grade} – {row.section ?? row.name}
                              </Link>
                            ) : (
                              row.name
                            )}
                          </strong>
                          {row.academicYearId && (
                            <div className="panel-subtitle">
                              Year:{" "}
                              {years.find((y) => y.id === row.academicYearId)?.name ??
                                row.academicYearId}
                            </div>
                          )}
                        </td>
                        <td>
                          {active === "classes" ? (
                            <>
                              <div>{row.teacherName ? `Class teacher: ${row.teacherName}` : "Class teacher not assigned"}</div>
                              {row.room && <div className="panel-subtitle">Room {row.room}</div>}
                            </>
                          ) : (
                            <>
                              {row.subjectCode ?? row.code ?? row.grade ?? row.section ?? row.room ?? row.category ?? "—"}
                              {row.optional ? " · Optional" : ""}
                            </>
                          )}
                          {row.enrollmentCount !== undefined && (
                            <div>{row.enrollmentCount} enrolled</div>
                          )}
                        </td>
                        <td>
                          {active === "classes" && row.capacity ? (
                            <>
                              <div>{row.enrollmentCount ?? 0} / {row.capacity} enrolled</div>
                              <span className={`pill ${(row.seatsAvailable ?? 0) > 0 ? "active" : "pending"}`}>
                                {(row.seatsAvailable ?? 0) > 0
                                  ? `${row.seatsAvailable} seat${row.seatsAvailable === 1 ? "" : "s"} available`
                                  : "Class full"}
                              </span>
                            </>
                          ) : active === "classes" ? (
                            <>
                              <div>{row.enrollmentCount ?? 0} enrolled</div>
                              <span className="pill">Capacity not set</span>
                            </>
                          ) : (row.status ?? "active")}
                        </td>
                        <td>
                          {row.startDate ?? row.date ?? ""}
                          {row.endDate ? ` — ${row.endDate}` : ""}
                        </td>
                        {active === "academicYears" && (
                          <td>
                            {row.status !== "active" && row.status !== "closed" && (
                              <button
                                className="btn-secondary"
                                onClick={() => yearAction(row.id, "active")}
                              >
                                Activate
                              </button>
                            )}
                            {row.status === "active" && (
                              <button
                                className="btn-secondary"
                                onClick={() => yearAction(row.id, "closed")}
                              >
                                Close year
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-state">No records configured for this selection.</p>
            )}
          </section>
          <section className="panel" style={{ padding: 20 }}>
            <h2>{active === "classes" ? "Create a class" : "Add configuration"}</h2>
            {active === "classes" && (
              <p className="panel-subtitle">
                Set up a class such as Grade 02 – B, choose its class teacher, and add several subject teachers in one step.
              </p>
            )}
            <form onSubmit={saveRecord}>
              {active === "classes" ? (
                <label className="field">
                  Class section (A–G)
                  <select
                    required
                    value={form.section}
                    onChange={(e) => setForm({ ...form, name: e.target.value, section: e.target.value })}
                  >
                    <option value="">Choose a section</option>
                    {classOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
              ) : (
                field(
                  "name",
                  active === "grades" ? "Grade number (1–13)" : "Name",
                  active === "grades" ? "number" : "text",
                  true,
                )
              )}
              {active !== "classes" && field("code", "Code / identifier")}
              {[
                "academicYears",
                "terms",
                "examinationPeriods",
                "holidays",
                "specialSchedules",
              ].includes(active) && (
                <>
                  {field("startDate", "Start date", "date", true)}
                  {field("endDate", "End date", "date", true)}
                  {active !== "academicYears" && (
                    <label className="field">
                      Academic year
                      <select
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
                  )}
                  {active === "academicYears" && (
                    <label className="field">
                      Initial status
                      <select
                        value={form.status}
                        onChange={(e) => setForm({ ...form, status: e.target.value })}
                      >
                        <option value="draft">Draft</option>
                        <option value="active">Activate (closes previous year)</option>
                      </select>
                    </label>
                  )}
                </>
              )}
              {active === "grades" && (
                <>
                  {field("section", "Grade sections (comma-separated)")}
                  {field("capacity", "Default student capacity", "number")}
                  {field("room", "Default classroom")}
                </>
              )}
              {active === "classes" && (
                <>
                  <label className="field">
                    Grade
                    <select
                      required
                      value={form.grade}
                      onChange={(e) => {
                        setForm({ ...form, grade: e.target.value });
                        setTeachingAssignments((current) => current.map((assignment) => ({ ...assignment, subject: "" })));
                      }}
                    >
                      <option value="">Select grade</option>
                      {gradeOptions.map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                    </select>
                  </label>
                  {field("capacity", "Student capacity (optional)", "number")}
                  <label className="field">
                    Class teacher <span>(optional)</span>
                    <select
                      value={form.teacherId}
                      onChange={(event) => {
                        const teacherUid = event.target.value;
                        setForm({ ...form, teacherId: teacherUid });
                        setTeachingAssignments((current) => {
                          if (!teacherUid) return current;
                          if (!current.length)
                            return [{ id: `${Date.now()}-${Math.random()}`, teacherUid, subject: "" }];
                          return current.map((assignment, index) =>
                            index === 0 && (!assignment.teacherUid || assignment.teacherUid === form.teacherId)
                              ? { ...assignment, teacherUid }
                              : assignment,
                          );
                        });
                      }}
                    >
                      <option value="">Assign later</option>
                      {teacherOptions.map((teacher) => (
                        <option key={teacher.uid} value={teacher.uid}>
                          {teacher.displayName} · {teacher.role.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                    <small>
                      {teacherOptions.length
                        ? "Choose an active teacher by name. Their account ID is saved securely in the background."
                        : "No active teacher accounts are available yet. Add or activate teachers in Staff & HR first."}
                    </small>
                  </label>
                  {field("room", "Classroom")}
                  {
                    <label className="field">
                      Academic year
                      <select
                        value={form.academicYearId}
                        onChange={(e) => setForm({ ...form, academicYearId: e.target.value })}
                      >
                        <option value="">Current school-wide configuration</option>
                        {years
                          .filter((y) => y.status !== "closed")
                          .map((y) => (
                            <option value={y.id} key={y.id}>
                              {y.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  }
                  <div className="class-teaching-setup">
                    <div>
                      <strong>Teaching subjects</strong>
                      <p className="panel-subtitle">Add a subject for the class teacher, then add any other teachers who will teach this class.</p>
                    </div>
                    {!teacherOptions.length && (
                      <p className="panel-subtitle">
                        No active teacher accounts are available. <Link className="link-button" href="/workforce">Open Staff &amp; HR</Link>
                      </p>
                    )}
                    {teachingAssignments.map((assignment, index) => (
                      <div className="class-teaching-row" key={assignment.id}>
                        <label className="field">
                          Teacher
                          <select
                            required={Boolean(assignment.teacherUid || assignment.subject)}
                            value={assignment.teacherUid}
                            onChange={(event) => setTeachingAssignments((current) => current.map((item) => item.id === assignment.id ? { ...item, teacherUid: event.target.value } : item))}
                          >
                            <option value="">Choose teacher</option>
                            {teacherOptions.map((teacher) => (
                              <option key={teacher.uid} value={teacher.uid}>{teacher.displayName}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          Subject
                          <select
                            required={Boolean(assignment.teacherUid || assignment.subject)}
                            value={assignment.subject}
                            disabled={!form.grade}
                            onChange={(event) => setTeachingAssignments((current) => current.map((item) => item.id === assignment.id ? { ...item, subject: event.target.value } : item))}
                          >
                            <option value="">Choose subject</option>
                            {applicableSubjects.map((subject) => (
                                <option key={`${subject.grade ?? "all"}-${subject.name}`} value={subject.name}>
                                  {subject.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <button
                          className="icon-button"
                          type="button"
                          aria-label={`Remove teaching assignment ${index + 1}`}
                          onClick={() => setTeachingAssignments((current) => current.filter((item) => item.id !== assignment.id))}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {form.grade && !applicableSubjects.length && (
                      <p className="panel-subtitle">
                        No subjects are set up for {form.grade}.{" "}
                        <button className="link-button" type="button" onClick={() => setActive("subjects")}>Add subjects first</button>
                      </p>
                    )}
                    <button
                      className="btn-secondary"
                      type="button"
                      disabled={!form.grade || !teacherOptions.length || !applicableSubjects.length}
                      onClick={() => setTeachingAssignments((current) => [...current, { id: `${Date.now()}-${Math.random()}`, teacherUid: form.teacherId, subject: "" }])}
                    >
                      + Add another teacher and subject
                    </button>
                  </div>
                </>
              )}
              {active === "subjects" && (
                <>
                  <label className="field">
                    Grade / level
                    <select
                      value={form.grade}
                      onChange={(e) => setForm({ ...form, grade: e.target.value })}
                    >
                      <option value="">Select grade/level</option>
                      {gradeOptions.map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                      <option>A/L</option>
                    </select>
                  </label>
                  {field("subjectCode", "Subject code")}
                  {
                    <label className="field">
                      Category
                      <select
                        value={form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value })}
                      >
                        <option value="core">Core</option>
                        <option value="optional">Optional</option>
                        <option value="a_level">A/L</option>
                        <option value="religion">Religion</option>
                        <option value="language">Language</option>
                        <option value="vocational">Vocational</option>
                      </select>
                    </label>
                  }
                  {
                    <label className="field">
                      School type
                      <select
                        value={form.schoolType}
                        onChange={(e) => setForm({ ...form, schoolType: e.target.value })}
                      >
                        <option value="">General</option>
                        <option value="national">National</option>
                        <option value="provincial">Provincial</option>
                        <option value="national_school">National school</option>
                        <option value="provincial_school">Provincial school</option>
                      </select>
                    </label>
                  }
                  {field("streams", "A/L streams (comma-separated)")}
                  {field(
                    "combinations",
                    "Allowed A/L combinations (use semicolon between combos, comma between subjects)",
                  )}
                </>
              )}
              {active === "classrooms" && (
                <>
                  {field("room", "Room identifier", "text", true)}
                  {field("capacity", "Room capacity", "number")}
                </>
              )}
              {active === "events" && field("date", "Date", "date")}
              {active === "specialSchedules" && field("description", "Schedule details")}
              {["announcements", "attendancePolicies", "gradingSchemes", "workingDays"].includes(
                active,
              ) && (
                <label className="field">
                  Details
                  <textarea
                    rows={4}
                    maxLength={1000}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </label>
              )}
              {!["academicYears"].includes(active) && (
                <label className="field">
                  Status
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="draft">Draft</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              )}
              <button className="btn-primary" disabled={busy} style={{ marginTop: 12 }}>
                {busy ? "Saving…" : "Save configuration"}
              </button>
            </form>
          </section>
        </div>
      )}
      <p className="panel-subtitle" style={{ marginTop: 18 }}>
        Class, grade and subject configuration is school-scoped. Historical academic years are
        retained and closed-year-linked records cannot be changed through the administration API.
      </p>
    </main>
  );
}
