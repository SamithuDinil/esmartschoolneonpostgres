"use client";
import { useCallback, useEffect, useState } from "react";
import { BriefcaseBusiness, GraduationCap, Search, UserRound, Users } from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";
const tabs = [
  { id: "teachers", name: "Teachers" },
  { id: "staff", name: "Staff & HR" },
  { id: "assignments", name: "Teaching assignments" },
  { id: "leaves", name: "Leave requests" },
  { id: "attendance", name: "Attendance" },
  { id: "payroll", name: "Payroll" },
];
type Row = Record<string, unknown> & { id: string };
type TeacherMember = {
  uid: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
  profileRegistered: boolean;
};
export function WorkforcePanel({
  canManageTeachers,
  canManageStaff,
}: {
  canManageTeachers: boolean;
  canManageStaff: boolean;
}) {
  const [tab, setTab] = useState(canManageTeachers ? "teachers" : "staff");
  const [items, setItems] = useState<Row[]>([]);
  const [teacherMembers, setTeacherMembers] = useState<TeacherMember[]>([]);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const visibleTabs = tabs.filter((item) =>
    item.id === "teachers" ? canManageTeachers : item.id === "staff" ? canManageStaff : true,
  );
  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const r = await fetch(`/api/workforce?type=${tab}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setItems(d.items ?? []);
      setTeacherMembers(tab === "teachers" ? d.teacherMembers ?? [] : []);
      setEnabled(Boolean(d.enabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load workforce data");
    } finally {
      setLoading(false);
    }
  }, [tab]);
  useEffect(() => {
    void load();
  }, [load]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const action =
        tab === "teachers"
          ? "create_teacher"
          : tab === "staff"
            ? "create_employee"
            : tab === "assignments"
              ? "assign_teacher"
              : tab === "leaves"
                ? "request_leave"
                : tab === "attendance"
                  ? "mark_attendance"
                  : "payroll_period";
      const payload: Record<string, unknown> = { action, ...fields };
      if (tab === "teachers") {
        payload.uid = fields.uid || undefined;
        payload.subjects = (fields.subjects ?? "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        payload.grades = (fields.grades ?? "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        payload.classes = (fields.classes ?? "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        payload.status = fields.status || "active";
      }
      if (tab === "staff") payload.status = fields.status || "active";
      if (tab === "assignments") payload.classTeacher = fields.classTeacher === "true";
      if (tab === "attendance") payload.status = fields.status || "present";
      if (tab === "payroll") payload.salaryStructure = {};
      const csrf = await fetchCsrfToken();
      const r = await fetch("/api/workforce", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setNotice(
        d.employeeNumber ? `Saved. Employee number ${d.employeeNumber}.` : "Saved successfully.",
      );
      setFields({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save record");
    } finally {
      setBusy(false);
    }
  }
  async function decide(id: string, decision: string) {
    try {
      const csrf = await fetchCsrfToken();
      const r = await fetch("/api/workforce", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ action: "decide_leave", id, decision }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setNotice(`Leave ${decision}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decision failed");
    }
  }
  function input(name: string, label: string, type = "text", required = false) {
    return (
      <label className="field" key={name}>
        {label}
        <input
          required={required}
          type={type}
          autoComplete={name === "fullName" ? "name" : name === "email" ? "email" : name === "phone" ? "tel" : undefined}
          value={fields[name] ?? ""}
          onChange={(e) => setFields((current) => ({ ...current, [name]: e.target.value }))}
        />
      </label>
    );
  }
  const displays =
    tab === "teachers"
      ? [
          "employeeNumber",
          "fullName",
          "email",
          "phone",
          "memberRole",
          "membershipStatus",
          "profileStatus",
          "subjects",
          "grades",
          "classes",
          "employmentDate",
          "status",
        ]
      : tab === "staff"
        ? [
            "employeeNumber",
            "fullName",
            "department",
            "position",
            "phone",
            "employmentDate",
            "status",
          ]
        : tab === "assignments"
          ? ["teacherUid", "subject", "grade", "className", "day", "period", "room", "classTeacher"]
          : tab === "leaves"
            ? [
                "employeeUid",
                "leaveType",
                "startDate",
                "endDate",
                "reason",
                "status",
                "decisionReason",
              ]
            : tab === "attendance"
              ? ["employeeUid", "date", "status", "notes"]
              : ["name", "startDate", "endDate", "status"];
  const columnLabels: Record<string, string> = {
    employeeNumber: "Employee no.",
    fullName: "Name",
    email: "Email",
    phone: "Phone",
    memberRole: "Teacher role",
    membershipStatus: "Account",
    profileStatus: "Teacher profile",
    employmentDate: "Start date",
    employeeUid: "Employee",
    teacherUid: "Teacher account",
    className: "Class",
    classTeacher: "Class teacher",
    startDate: "Start date",
    endDate: "End date",
    decisionReason: "Decision note",
    salaryStructure: "Salary structure",
  };
  const visibleItems = items.filter((row) =>
    !directoryQuery.trim() || displays.some((key) =>
      String(row[key] ?? "").toLocaleLowerCase().includes(directoryQuery.trim().toLocaleLowerCase()),
    ),
  );
  const unregisteredTeacherCount = items.filter((item) => item.profileStatus === "Profile needed").length;
  function cellValue(key: string, value: unknown) {
    if (Array.isArray(value)) return value.join(", ") || "—";
    if (key === "memberRole")
      return String(value ?? "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    if (key === "department") {
      const departments: Record<string, string> = {
        office: "Office & administration",
        accounting: "Accounting",
        library: "Library",
        laboratory: "Laboratory",
        maintenance: "Maintenance",
        security: "Security",
        transport: "Transport",
        other: "Other",
      };
      return departments[String(value)] ?? String(value ?? "—");
    }
    if (key === "status" && value === "on_leave") return "On leave";
    return String(value ?? "—");
  }
  return (
    <main className="page-content workforce-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">School workspace · People</div>
          <h1>Teacher & staff management</h1>
          <p>
            Manage teacher accounts, staff profiles and school workforce tasks in one place.
          </p>
        </div>
      </div>
      {error && <p className="login-error">{error}</p>}
      {notice && <p className="login-success">{notice}</p>}
      <nav className="workforce-tabs" aria-label="Workforce sections">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            className={`workforce-tab${tab === t.id ? " is-active" : ""}`}
            type="button"
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => {
              setTab(t.id);
              setItems([]);
              setTeacherMembers([]);
              setDirectoryQuery("");
              setFields({});
              setNotice("");
            }}
          >
            {t.name}
          </button>
        ))}
      </nav>
      {tab === "payroll" && !enabled && (
        <p className="notice">
          Payroll is disabled for this school. Salary-period actions will remain unavailable until
          payroll has been explicitly enabled under a reviewed school policy.
        </p>
      )}
      {tab === "teachers" && (
        <div className="workforce-metrics" aria-label="Teacher membership summary">
          <div className="workforce-metric"><span><Users size={16} /></span><div><strong>{teacherMembers.length}</strong><small>Active teacher members</small></div></div>
          <div className="workforce-metric"><span><GraduationCap size={16} /></span><div><strong>{items.length - unregisteredTeacherCount}</strong><small>Teacher profiles</small></div></div>
          <div className="workforce-metric"><span><UserRound size={16} /></span><div><strong>{unregisteredTeacherCount}</strong><small>Need a profile</small></div></div>
        </div>
      )}
      <div className="workforce-grid">
        <section className="panel workforce-table-panel" aria-busy={loading}>
          <div className="workforce-section-heading">
            <div>
              <h2>{tab === "staff" ? "Staff directory" : tabs.find((t) => t.id === tab)?.name}</h2>
              <p>{tab === "teachers" ? "Teacher profiles and active teacher accounts in this school." : tab === "staff" ? "Find and review your school’s staff records." : "Review and manage school workforce records."}</p>
            </div>
            <span className="workforce-record-count">{visibleItems.length} {visibleItems.length === 1 ? "record" : "records"}</span>
          </div>
          {(tab === "teachers" || tab === "staff") && (
            <label className="workforce-search">
              <Search size={16} aria-hidden="true" />
              <input
                value={directoryQuery}
                onChange={(event) => setDirectoryQuery(event.target.value)}
                placeholder={tab === "teachers" ? "Find a teacher, email or employee number" : "Find a staff member or department"}
                aria-label={`Search ${tab === "teachers" ? "teachers" : "staff"}`}
              />
            </label>
          )}
          {loading ? (
            <div className="workforce-loading" role="status">Loading school records…</div>
          ) : visibleItems.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {displays.map((k) => (
                      <th key={k}>{columnLabels[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())}</th>
                    ))}
                    {tab === "leaves" && <th>Decision</th>}
                    {tab === "teachers" && canManageTeachers && <th>Next step</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((row) => (
                    <tr key={row.id}>
                      {displays.map((k) => (
                        <td key={k}>
                          {k === "profileStatus" ? (
                            <span className={`workforce-status ${row[k] === "Profile needed" ? "is-pending" : "is-complete"}`}>{String(row[k] ?? "—")}</span>
                          ) : k === "status" || k === "membershipStatus" ? (
                            <span className={`workforce-status ${String(row[k] ?? "").toLowerCase() === "active" ? "is-complete" : "is-pending"}`}>{cellValue(k, row[k])}</span>
                          ) : cellValue(k, row[k])}
                        </td>
                      ))}
                      {tab === "teachers" && canManageTeachers && (
                        <td>
                          {row.profileStatus === "Profile needed" ? (
                            <button
                              className="workforce-complete-button"
                              type="button"
                              onClick={() => {
                                setFields({
                                  uid: String(row.uid ?? ""),
                                  fullName: String(row.fullName ?? ""),
                                  email: String(row.email ?? ""),
                                  status: "active",
                                });
                                document.getElementById("workforce-registration")?.scrollIntoView({ behavior: "smooth", block: "center" });
                              }}
                            >Complete profile</button>
                          ) : "—"}
                        </td>
                      )}
                      {tab === "leaves" && (
                        <td>
                          {row.status === "pending" ? (
                            <>
                              <button
                                className="btn-secondary"
                                onClick={() => void decide(row.id, "approved")}
                              >
                                Approve
                              </button>{" "}
                              <button
                                className="btn-secondary"
                                onClick={() => void decide(row.id, "rejected")}
                              >
                                Reject
                              </button>
                            </>
                          ) : (
                            <strong>{String(row.status ?? "—").toUpperCase()}</strong>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="workforce-empty-state">
              <span>{tab === "teachers" ? <GraduationCap size={21} /> : <Users size={21} />}</span>
              <strong>{directoryQuery ? "No matching records" : tab === "teachers" ? "No teachers listed yet" : tab === "staff" ? "No staff records yet" : "No records available"}</strong>
              <p>{directoryQuery ? "Try a different name, email, department or employee number." : tab === "teachers" ? "Active class and subject teacher members will appear here automatically. You can add a teacher profile from the form." : tab === "staff" ? "Register your first staff member using the simple form." : "Records will appear here when they are added."}</p>
            </div>
          )}
        </section>
        <section className="panel workforce-form-panel" id="workforce-registration">
          <div className="workforce-form-heading">
            <span className="workforce-form-icon">{tab === "teachers" ? <GraduationCap size={20} /> : tab === "staff" ? <BriefcaseBusiness size={19} /> : <Users size={19} />}</span>
            <div>
              <h2>
            {tab === "teachers"
              ? "Register teacher"
              : tab === "staff"
                ? "Register employee"
                : tab === "assignments"
                  ? "Assign subject/class"
                  : tab === "leaves"
                    ? "Request leave"
                    : tab === "attendance"
                      ? "Record attendance"
                      : "Create payroll period"}
              </h2>
              <p>{tab === "teachers" ? "Add a teacher profile in a few simple steps." : tab === "staff" ? "Add an employee to your school directory." : "Enter the details below to continue."}</p>
            </div>
          </div>
          <form onSubmit={submit}>
            {tab === "teachers" && (
              <>
                <div className="workforce-form-grid">
                  <div className="field workforce-member-field">
                    <label htmlFor="teacher-member-link">Link an active teacher account <span>(optional)</span></label>
                    <select
                      id="teacher-member-link"
                      value={fields.uid ?? ""}
                      onChange={(event) => {
                        const uid = event.target.value;
                        const member = teacherMembers.find((item) => item.uid === uid);
                        setFields((current) => ({
                          ...current,
                          uid,
                          ...(member ? { fullName: member.displayName, email: member.email } : {}),
                        }));
                      }}
                    >
                      <option value="">Register without linking an account</option>
                      {teacherMembers.filter((member) => !member.profileRegistered).map((member) => (
                        <option key={member.uid} value={member.uid}>
                          {member.displayName} · {member.role.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                    <small>Choose an active class or subject teacher member to fill their name and email automatically.</small>
                  </div>
                  {input("fullName", "Teacher full name", "text", true)}
                  {input("email", "Email address (optional)", "email")}
                  {input("phone", "Phone number (optional)", "tel")}
                  {input("employmentDate", "Employment start date", "date", true)}
                </div>
                <details className="workforce-optional-details">
                  <summary>Teaching details (optional)</summary>
                  <div className="workforce-form-grid">
                    {input("qualifications", "Qualifications")}
                    {input("subjects", "Subjects (separate with commas)")}
                    {input("grades", "Grades taught (separate with commas)")}
                    {input("classes", "Classes taught (separate with commas)")}
                    {input("address", "Address")}
                  </div>
                </details>
                <label className="field">
                  Employment status
                  <select
                    value={fields.status ?? "active"}
                    onChange={(e) => setFields({ ...fields, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="on_leave">On leave</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              </>
            )}
            {tab === "staff" && (
              <>
                <div className="workforce-form-grid">
                  {input("fullName", "Full name", "text", true)}
                  {input("position", "Job title", "text", true)}
                  {input("email", "Email address (optional)", "email")}
                  {input("phone", "Phone number (optional)", "tel")}
                  <label className="field">
                    Department
                    <select required value={fields.department ?? ""} onChange={(event) => setFields({ ...fields, department: event.target.value })}>
                      <option value="">Choose a department</option>
                      <option value="office">Office & administration</option>
                      <option value="accounting">Accounting</option>
                      <option value="library">Library</option>
                      <option value="laboratory">Laboratory</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="security">Security</option>
                      <option value="transport">Transport</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  {input("employmentDate", "Employment start date", "date", true)}
                </div>
                <details className="workforce-optional-details">
                  <summary>Additional details (optional)</summary>
                  {input("address", "Residential or contact address")}
                </details>
                <label className="field">
                  Employment status
                  <select
                    value={fields.status ?? "active"}
                    onChange={(e) => setFields({ ...fields, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="on_leave">On leave</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              </>
            )}
            {tab === "assignments" && (
              <>
                {input("teacherUid", "Teacher account UID", "text", true)}
                {input("subject", "Subject", "text", true)}
                {input("grade", "Grade", "text", true)}
                {input("className", "Class", "text", true)}
                {input("day", "Day")}
                {input("period", "Period")}
                {input("room", "Classroom")}
                <label>
                  <input
                    type="checkbox"
                    checked={fields.classTeacher === "true"}
                    onChange={(e) =>
                      setFields({ ...fields, classTeacher: String(e.target.checked) })
                    }
                  />{" "}
                  Class teacher responsibility
                </label>
              </>
            )}
            {tab === "leaves" && (
              <>
                {input("startDate", "Start date", "date", true)}
                {input("endDate", "End date", "date", true)}
                {input("leaveType", "Leave type", "text", true)}
                {input("reason", "Reason")}
              </>
            )}
            {tab === "attendance" && (
              <>
                {input("date", "Date", "date", true)}
                <label className="field">
                  Attendance status
                  <select
                    value={fields.status ?? "present"}
                    onChange={(e) => setFields({ ...fields, status: e.target.value })}
                  >
                    <option>present</option>
                    <option>absent</option>
                    <option>late</option>
                    <option>leave</option>
                  </select>
                </label>
                {input("employeeUid", "Employee UID (manager only)")}
                {input("notes", "Notes")}
              </>
            )}
            {tab === "payroll" && (
              <>
                {input("name", "Payroll period name", "text", true)}
                {input("startDate", "Start date", "date", true)}
                {input("endDate", "End date", "date", true)}
              </>
            )}
            {tab !== "payroll" || enabled ? (
              <button className="btn-primary workforce-submit" disabled={busy}>
                {busy ? "Saving…" : tab === "teachers" ? "Register teacher" : tab === "staff" ? "Add staff member" : "Save"}
              </button>
            ) : null}
          </form>
        </section>
      </div>
      <p className="panel-subtitle" style={{ marginTop: 16 }}>
        Payroll recording and calculations require explicit school enablement and a separately
        reviewed policy. This app does not claim legal compliance or calculate pay until configured.
      </p>
    </main>
  );
}
