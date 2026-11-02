"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { FileDown, Plus, Search, UserRound, X } from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";
import { downloadTextFile } from "@/lib/csv";
import { buildSampleCsv, sampleFileName } from "@/lib/student-csv";
import { buildClassOptions, buildGradeOptions, normalizeGradeLabel } from "@/lib/academic-options";
import Link from "next/link";

type Student = {
  id: string;
  fullName: string;
  preferredName?: string;
  admissionNumber: string;
  grade: string;
  className: string;
  status: string;
  admissionDate: string;
  photoPath?: string;
};

type StudentForm = {
  admissionNumber: string;
  fullName: string;
  nameWithInitials: string;
  preferredName: string;
  dateOfBirth: string;
  gender: string;
  nationality: string;
  address: string;
  grade: string;
  className: string;
  admissionDate: string;
  admissionCategory: string;
  previousSchool: string;
  studentEmail: string;
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelationship: string;
  workflowState: string;
};
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const initialForm: StudentForm = {
  admissionNumber: "",
  fullName: "",
  nameWithInitials: "",
  preferredName: "",
  dateOfBirth: "",
  gender: "undisclosed",
  nationality: "",
  address: "",
  grade: "Grade 01",
  className: "A",
  admissionDate: "",
  admissionCategory: "regular",
  previousSchool: "",
  studentEmail: "",
  guardianName: "",
  guardianEmail: "",
  guardianPhone: "",
  emergencyName: "",
  emergencyPhone: "",
  emergencyRelationship: "",
  workflowState: "submitted",
};

export function StudentRegistry({
  canCreate,
  canApprove = false,
}: {
  canCreate: boolean;
  canApprove?: boolean;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortAsc, setSortAsc] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [importErrors, setImportErrors] = useState<Array<{ row: number; message: string }>>([]);
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState<StudentForm>(() => ({ ...initialForm, admissionDate: today() }));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/students?limit=50${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load student records.");
      setStudents(payload.items as Student[]);
      setTotal(payload.total as number);
      setCursor(payload.nextCursor as string | null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load student records.");
    } finally {
      setLoading(false);
    }
  }, [query]);
  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setError("");
    try {
      const response = await fetch(
        `/api/students?limit=50&after=${encodeURIComponent(cursor)}${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load more student records.");
      setStudents((current) => [...current, ...(payload.items as Student[])]);
      setCursor(payload.nextCursor as string | null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more student records.");
    }
  }, [cursor, query]);

  const gradeOptions = useMemo(
    () => buildGradeOptions(students.map((student) => student.grade)),
    [students],
  );
  const classOptions = useMemo(
    () => buildClassOptions(students.map((student) => student.className)),
    [students],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return students
      .filter((student) => {
        const searchable =
          `${student.fullName} ${student.preferredName ?? ""} ${student.admissionNumber} ${student.grade} ${student.className}`.toLowerCase();
        return (
          (!normalized || searchable.includes(normalized)) &&
          (!gradeFilter || normalizeGradeLabel(student.grade) === gradeFilter) &&
          (!classFilter || student.className === classFilter) &&
          (!statusFilter || student.status === statusFilter)
        );
      })
      .sort((a, b) =>
        sortAsc ? a.fullName.localeCompare(b.fullName) : b.fullName.localeCompare(a.fullName),
      );
  }, [students, query, gradeFilter, classFilter, statusFilter, sortAsc]);

  async function importCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setSuccess("");
    setImportErrors([]);
    setImporting(true);
    try {
      const csrf = await fetchCsrfToken();
      const data = new FormData();
      data.append("file", file);
      const response = await fetch("/api/students/import", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrf },
        body: data,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "CSV import failed");
      const errors = (result.errors ?? []) as Array<{ row: number; message: string }>;
      setImportErrors(errors);
      if (result.imported > 0)
        setSuccess(
          `${result.imported} of ${result.total} students imported${errors.length ? `; ${errors.length} rows need review (listed below)` : ""}.`,
        );
      else setError(`No students were imported. ${errors.length} rows need review (listed below).`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CSV import failed");
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  }

  async function decide(studentId: string, decision: string) {
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/students", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ studentId, decision }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setSuccess(`Admission ${decision.replace("_", " ")}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update application");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const csrfToken = await fetchCsrfToken();
      const response = await fetch("/api/students", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Registration failed.");
      setSuccess(
        `Admission application submitted. Admission number ${payload.student.admissionNumber}.`,
      );
      setForm({ ...initialForm, admissionDate: today() });
      setOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Registration failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Core management · Students</div>
          <h1>Student directory</h1>
          <p>School-scoped student records with a recorded enrollment history.</p>
        </div>
        {canCreate && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="btn-secondary"
              type="button"
              onClick={() =>
                downloadTextFile(
                  sampleFileName("students_import"),
                  buildSampleCsv("students_import"),
                )
              }
            >
              <FileDown size={14} />
              Sample CSV
            </button>
            <label className="btn-secondary" style={{ cursor: importing ? "wait" : "pointer" }}>
              {importing ? "Importing…" : "Import CSV"}
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={importCsv}
                disabled={importing}
                hidden
              />
            </label>
            <button
              className="btn-primary"
              onClick={() => {
                setError("");
                setOpen(true);
              }}
            >
              <Plus size={15} />
              Register student
            </button>
          </div>
        )}
      </div>
      {success && (
        <div className="login-success" role="status" style={{ marginBottom: 14 }}>
          {success}
        </div>
      )}
      {importErrors.length > 0 && (
        <section className="panel" style={{ padding: 16, marginBottom: 14 }}>
          <div className="panel-subtitle" style={{ marginBottom: 7 }}>
            Rows that were not imported (row numbers match the spreadsheet)
          </div>
          <div className="table-wrap" style={{ maxHeight: 260, overflowY: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Issue</th>
                </tr>
              </thead>
              <tbody>
                {importErrors.slice(0, 300).map((item) => (
                  <tr key={`${item.row}-${item.message}`}>
                    <td>{item.row}</td>
                    <td>{item.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Enrolled students</div>
            <div className="panel-subtitle">
              {total.toLocaleString()} record{total === 1 ? "" : "s"} ·{" "}
              {students.length.toLocaleString()} loaded
            </div>
          </div>
          <button className="btn-secondary" type="button" onClick={() => window.print()}>
            <FileDown size={14} />
            Print
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 13 }}>
          <div className="search-box" style={{ flex: "1 1 260px" }}>
            <Search size={14} />
            <input
              aria-label="Search displayed students"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or admission number"
              style={{
                border: 0,
                background: "transparent",
                outline: "none",
                width: "100%",
                fontSize: 11,
              }}
            />
          </div>
          <select
            aria-label="Filter grade"
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
          >
            <option value="">All grades</option>
            {gradeOptions.map((grade) => (
              <option key={grade} value={grade}>{grade}</option>
            ))}
          </select>
          <select
            aria-label="Filter class"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
          >
            <option value="">All classes</option>
            {classOptions.map((className) => (
              <option key={className} value={className}>{className}</option>
            ))}
          </select>
          <select
            aria-label="Filter enrollment status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {Array.from(new Set(students.map((x) => x.status))).map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <button className="btn-secondary" onClick={() => setSortAsc(!sortAsc)}>
            Sort {sortAsc ? "A–Z" : "Z–A"}
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              const csv = [
                "admissionNumber,fullName,grade,className,status,admissionDate",
                ...filtered.map((s) =>
                  [s.admissionNumber, s.fullName, s.grade, s.className, s.status, s.admissionDate]
                    .map((v) => `"${String(v ?? "").replaceAll(/"/g, '""')}"`)
                    .join(","),
                ),
              ].join("\n");
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
              a.download = "students.csv";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Export CSV
          </button>
        </div>
        {error && (
          <div className="login-error" role="alert" style={{ marginBottom: 13 }}>
            {error}
          </div>
        )}
        {loading ? (
          <div className="empty-state">
            <div>
              <div className="empty-icon">
                <UserRound size={17} />
              </div>
              <h3>Loading student records</h3>
              <p>Retrieving school-authorized records from Firestore.</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div>
              <div className="empty-icon">
                <UserRound size={17} />
              </div>
              <h3>{query ? "No matching students" : "No student records yet"}</h3>
              <p>
                {query
                  ? "Try another search term."
                  : canCreate
                    ? "Register a student to start building this school's directory."
                    : "There are no records available in this view."}
              </p>
              {canCreate && !query && (
                <button
                  className="btn-primary"
                  style={{ marginTop: 12 }}
                  onClick={() => setOpen(true)}
                >
                  <Plus size={14} />
                  Register first student
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Photo</th>
                  <th>Student</th>
                  <th>Admission no.</th>
                  <th>Grade / class</th>
                  <th>Guardian contact</th>
                  <th>Admission date</th>
                  <th>Status</th>
                  {canApprove && <th>Application</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((student) => (
                  <tr key={student.id}>
                    <td>
                      {student.photoPath ? (
                        <img
                          src={`/api/students/${student.id}/photo`}
                          alt=""
                          width={32}
                          height={32}
                          style={{ borderRadius: "50%", objectFit: "cover" }}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <Link href={`/students/${student.id}`}>
                        <strong style={{ fontWeight: 650 }}>{student.fullName}</strong>
                      </Link>
                      {student.preferredName && (
                        <span style={{ color: "#8793a7" }}> · {student.preferredName}</span>
                      )}
                    </td>
                    <td>{student.admissionNumber}</td>
                    <td>
                      {student.grade} · {student.className}
                    </td>
                    <td>
                      {(student as Student & { guardianPhone?: string }).guardianPhone ?? "—"}
                    </td>
                    <td>{student.admissionDate}</td>
                    <td>
                      <span
                        className={`pill ${student.status === "active" ? "active" : "pending"}`}
                      >
                        {student.status}
                      </span>
                    </td>
                    {canApprove && (
                      <td>
                        {["pending_review", "waiting_list"].includes(student.status) && (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              className="btn-secondary"
                              onClick={() => void decide(student.id, "approve")}
                            >
                              Approve
                            </button>
                            <button
                              className="btn-secondary"
                              onClick={() => void decide(student.id, "reject")}
                            >
                              Reject
                            </button>
                            <button
                              className="btn-secondary"
                              onClick={() => void decide(student.id, "waiting_list")}
                            >
                              Waitlist
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {cursor && (
        <div style={{ marginTop: 12, textAlign: "right" }}>
          <button className="btn-secondary" onClick={loadMore}>
            Load next page
          </button>
        </div>
      )}
      {open && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10,
            background: "rgba(23,35,59,.42)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="student-modal-title"
            className="panel"
            style={{
              width: "min(650px,100%)",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 30px 90px rgba(17,29,54,.25)",
            }}
          >
            <div className="panel-header">
              <div>
                <div className="eyebrow">Student enrollment</div>
                <h2 id="student-modal-title" style={{ margin: "6px 0 0", fontSize: 19 }}>
                  Register a student
                </h2>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={submit}>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="student-admission-number">Admission ID</label>
                  <input
                    id="student-admission-number"
                    maxLength={80}
                    pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,79}"
                    value={form.admissionNumber}
                    onChange={(e) =>
                      setForm({ ...form, admissionNumber: e.target.value.toUpperCase() })
                    }
                    placeholder="Leave blank to generate automatically"
                  />
                  <small className="panel-subtitle">
                    When supplied, this becomes the student record key. Admission IDs must be unique
                    within this school.
                  </small>
                </div>
                <div className="field">
                  <label htmlFor="student-name">Full name *</label>
                  <input
                    id="student-name"
                    required
                    maxLength={120}
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="student-initials">Name with initials</label>
                  <input
                    id="student-initials"
                    maxLength={120}
                    value={form.nameWithInitials}
                    onChange={(e) => setForm({ ...form, nameWithInitials: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="student-preferred">Preferred name</label>
                  <input
                    id="student-preferred"
                    maxLength={80}
                    value={form.preferredName}
                    onChange={(e) => setForm({ ...form, preferredName: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="student-dob">Date of birth *</label>
                  <input
                    id="student-dob"
                    type="date"
                    required
                    value={form.dateOfBirth}
                    onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="student-gender">Gender *</label>
                  <select
                    id="student-gender"
                    value={form.gender}
                    onChange={(e) => setForm({ ...form, gender: e.target.value })}
                  >
                    <option value="undisclosed">Undisclosed</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="student-nationality">Nationality</label>
                  <input
                    id="student-nationality"
                    value={form.nationality}
                    onChange={(e) => setForm({ ...form, nationality: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="student-address">Address</label>
                  <input
                    id="student-address"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="student-grade">Grade *</label>
                  <select
                    id="student-grade"
                    value={form.grade}
                    onChange={(e) => setForm({ ...form, grade: e.target.value })}
                  >
                    {Array.from({ length: 13 }, (_, index) => (
                      <option key={index + 1}>Grade {String(index + 1).padStart(2, "0")}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="student-class">Class *</label>
                  <select
                    id="student-class"
                    required
                    value={form.className}
                    onChange={(e) => setForm({ ...form, className: e.target.value })}
                  >
                    {Array.from("ABCDEFG").map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="student-admission">Admission date *</label>
                  <input
                    id="student-admission"
                    type="date"
                    required
                    value={form.admissionDate}
                    onChange={(e) => setForm({ ...form, admissionDate: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="student-category">Admission category</label>
                  <select
                    id="student-category"
                    value={form.admissionCategory}
                    onChange={(e) => setForm({ ...form, admissionCategory: e.target.value })}
                  >
                    <option value="regular">Regular</option>
                    <option value="transfer">Transfer</option>
                    <option value="scholarship">Scholarship</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="student-previous">Previous school</label>
                  <input
                    id="student-previous"
                    value={form.previousSchool}
                    onChange={(e) => setForm({ ...form, previousSchool: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="student-email">Student email (for account linking)</label>
                  <input
                    id="student-email"
                    type="email"
                    maxLength={254}
                    value={form.studentEmail}
                    onChange={(e) => setForm({ ...form, studentEmail: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="guardian-name">Guardian name *</label>
                  <input
                    id="guardian-name"
                    required
                    maxLength={120}
                    value={form.guardianName}
                    onChange={(e) => setForm({ ...form, guardianName: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="guardian-email">Guardian email *</label>
                  <input
                    id="guardian-email"
                    type="email"
                    required
                    maxLength={254}
                    value={form.guardianEmail}
                    onChange={(e) => setForm({ ...form, guardianEmail: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="guardian-phone">Guardian phone *</label>
                  <input
                    id="guardian-phone"
                    type="tel"
                    required
                    maxLength={24}
                    value={form.guardianPhone}
                    onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="emergency-name">Emergency contact</label>
                  <input
                    id="emergency-name"
                    value={form.emergencyName}
                    onChange={(e) => setForm({ ...form, emergencyName: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="emergency-phone">Emergency phone</label>
                  <input
                    id="emergency-phone"
                    value={form.emergencyPhone}
                    onChange={(e) => setForm({ ...form, emergencyPhone: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="emergency-relationship">Relationship</label>
                  <input
                    id="emergency-relationship"
                    value={form.emergencyRelationship}
                    onChange={(e) => setForm({ ...form, emergencyRelationship: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="application-status">Application status</label>
                  <select
                    id="application-status"
                    value={form.workflowState}
                    onChange={(e) => setForm({ ...form, workflowState: e.target.value })}
                  >
                    <option value="submitted">Submit for review</option>
                    <option value="waiting_list">Waiting list</option>
                  </select>
                </div>
              </div>
              <p className="panel-subtitle" style={{ lineHeight: 1.6, margin: "14px 0" }}>
                The supplied Admission ID is used as the student&apos;s primary record key. If left
                blank, the system generates a unique admission number.
              </p>
              {error && (
                <div className="login-error" role="alert" style={{ marginBottom: 12 }}>
                  {error}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? "Saving…" : "Save student"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
