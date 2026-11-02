"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type Option = {
  id?: string;
  uid?: string;
  name?: string;
  fullName?: string;
  grade?: string;
  className?: string;
  academicYearId?: string;
  startDate?: string;
  endDate?: string;
};
type Progress = {
  status: string;
  awardedMarks?: number | null;
  feedback?: string;
  submittedAt?: string | null;
  studentName?: string;
  textResponse?: string;
  wasLate?: boolean;
};
type Assignment = {
  id: string;
  title: string;
  instructions: string;
  academicYearId: string;
  grade: string;
  className: string;
  subject: string;
  deadlineAt: string;
  publishAt?: string | null;
  status: string;
  maxMarks: number;
  allowMultipleAttempts: boolean;
  referenceLinks?: string[];
  myStatus?: string;
  myProgress?: Progress;
  childrenProgress?: Record<string, Progress>;
  stats?: { recipients: number; submissions: number; late: number; missing: number };
};
type Attachment = { id: string; name: string; contentType: string; size: number };
type Submission = {
  id: string;
  student?: {
    id: string;
    fullName?: string;
    admissionNumber?: string;
    grade?: string;
    className?: string;
  } | null;
  status: string;
  awardedMarks?: number;
  feedback?: string;
  wasLate?: boolean;
  submittedAt?: string;
  latestAttemptId?: string;
  attempts?: Array<{
    id: string;
    attemptNumber: number;
    status: string;
    textResponse?: string;
    wasLate?: boolean;
    attachments?: Attachment[];
  }>;
};
type Policy = {
  allowedFileTypes: string[];
  maxFileSizeMB: number;
  defaultAllowMultipleAttempts: boolean;
};
type ModuleData = {
  items: Assignment[];
  notifications: Array<{ id: string; title?: string; message?: string; createdAt?: string }>;
  options: { academicYears: Option[]; classes: Option[]; subjects: Option[]; teachers: Option[] };
  settings: Policy;
};
type Analytics = {
  summary: {
    totalAssignments: number;
    publishedAssignments: number;
    pendingSubmissions: number;
    completedSubmissions: number;
    lateSubmissions: number;
    missingSubmissions: number;
    averageMarks: number | null;
    submissionCompletionPercent: number;
  };
  groups: Array<{
    subject: string;
    grade: string;
    className: string;
    total: number;
    submitted: number;
    late: number;
    missing: number;
    completionPercent: number;
    averageMarks: number | null;
  }>;
};

const MIME_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/msword": "Word (.doc)",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word (.docx)",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "text/plain": "Text (.txt)",
  "text/csv": "CSV",
};
const MIME_ACCEPT: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "image/jpeg": ".jpg,.jpeg",
  "image/png": ".png",
  "image/webp": ".webp",
  "text/plain": ".txt",
  "text/csv": ".csv",
};
const formatStatus = (value?: string) =>
  (value ?? "not_started").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const dateLabel = (value?: string) =>
  value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Not set";
const dateInput = (value?: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";

async function csrfFetch(url: string, init: RequestInit = {}) {
  const token = await fetchCsrfToken();
  const headers = new Headers(init.headers);
  headers.set("X-CSRF-Token", token);
  return fetch(url, { ...init, headers, cache: "no-store" });
}

export function AssignmentsPanel({
  role,
  canManage,
  isStudent,
  isParent,
}: {
  role: string;
  canManage: boolean;
  isStudent: boolean;
  isParent: boolean;
}) {
  const [data, setData] = useState<ModuleData | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [academicYearId, setAcademicYearId] = useState("");
  const [grade, setGrade] = useState("");
  const [className, setClassName] = useState("");
  const [subject, setSubject] = useState("");
  const [teacherUid, setTeacherUid] = useState("");
  const [deadlineAt, setDeadlineAt] = useState("");
  const [publishAt, setPublishAt] = useState("");
  const [maxMarks, setMaxMarks] = useState("100");
  const [allowMultipleAttempts, setAllowMultipleAttempts] = useState(false);
  const [referenceText, setReferenceText] = useState("");
  const [materialFiles, setMaterialFiles] = useState<File[]>([]);
  const [responseText, setResponseText] = useState<Record<string, string>>({});
  const [submissionFiles, setSubmissionFiles] = useState<Record<string, File[]>>({});
  const [uploadConfigTypes, setUploadConfigTypes] = useState<string[]>([]);
  const [maxFileSizeMB, setMaxFileSizeMB] = useState(10);
  const [defaultMultiple, setDefaultMultiple] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/assignments", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Assignment records could not be loaded");
      const payload = result as ModuleData;
      setData(payload);
      setUploadConfigTypes(payload.settings?.allowedFileTypes ?? Object.keys(MIME_LABELS));
      setMaxFileSizeMB(payload.settings?.maxFileSizeMB ?? 10);
      setDefaultMultiple(payload.settings?.defaultAllowMultipleAttempts ?? false);
      setResponseText((current) => {
        const next = { ...current };
        for (const item of payload.items)
          if (next[item.id] === undefined && item.myProgress?.textResponse)
            next[item.id] = String(item.myProgress.textResponse);
        return next;
      });
      if (!academicYearId && payload.options?.academicYears?.[0])
        setAcademicYearId(payload.options.academicYears[0].id ?? "");
      if (!teacherUid && payload.options?.teachers?.[0])
        setTeacherUid(payload.options.teachers[0].uid ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Assignment records could not be loaded");
    }
  }, [academicYearId, teacherUid]);
  useEffect(() => {
    void load();
  }, [load]);

  const classOptions = useMemo(
    () =>
      (data?.options.classes ?? []).filter(
        (item) =>
          (!item.grade || !grade || item.grade === grade) &&
          (!item.academicYearId || !academicYearId || item.academicYearId === academicYearId),
      ),
    [data, grade, academicYearId],
  );
  const subjectOptions = useMemo(
    () =>
      (data?.options.subjects ?? []).filter(
        (item) => !item.grade || !grade || item.grade === grade,
      ),
    [data, grade],
  );
  const filtered = useMemo(
    () =>
      (data?.items ?? []).filter(
        (item) =>
          (filter === "all" || item.status === filter || item.myStatus === filter) &&
          `${item.title} ${item.subject} ${item.grade} ${item.className}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [data, filter, query],
  );
  const totals = useMemo(
    () =>
      (data?.items ?? []).reduce(
        (acc, item) => ({
          assigned: acc.assigned + (item.stats?.recipients ?? 0),
          submitted: acc.submitted + (item.stats?.submissions ?? 0),
          late: acc.late + (item.stats?.late ?? 0),
          missing: acc.missing + (item.stats?.missing ?? 0),
        }),
        { assigned: 0, submitted: 0, late: 0, missing: 0 },
      ),
    [data],
  );

  function resetForm() {
    setEditingId("");
    setTitle("");
    setInstructions("");
    setGrade("");
    setClassName("");
    setSubject("");
    setDeadlineAt("");
    setPublishAt("");
    setMaxMarks("100");
    setAllowMultipleAttempts(defaultMultiple);
    setReferenceText("");
    setMaterialFiles([]);
  }

  function startEdit(item: Assignment) {
    setEditingId(item.id);
    setSelected(item);
    setTitle(item.title);
    setInstructions(item.instructions);
    setAcademicYearId(item.academicYearId);
    setGrade(item.grade);
    setClassName(item.className);
    setSubject(item.subject);
    setDeadlineAt(dateInput(item.deadlineAt));
    setPublishAt(dateInput(item.publishAt ?? undefined));
    setMaxMarks(String(item.maxMarks));
    setAllowMultipleAttempts(item.allowMultipleAttempts);
    setReferenceText((item.referenceLinks ?? []).join("\n"));
    setMaterialFiles([]);
    setError("");
    setNotice("");
  }

  async function uploadMaterials(assignmentId: string) {
    if (!materialFiles.length) return;
    const form = new FormData();
    materialFiles.forEach((file) => form.append("files", file));
    const response = await csrfFetch(`/api/assignments/${assignmentId}/attachments`, {
      method: "POST",
      body: form,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Assignment files could not be uploaded");
    setMaterialFiles([]);
  }

  async function saveAssignment(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        title,
        instructions,
        academicYearId,
        grade,
        className,
        subject,
        deadlineAt: new Date(deadlineAt).toISOString(),
        maxMarks: Number(maxMarks),
        allowMultipleAttempts,
        referenceLinks: referenceText
          .split(/\n|,/)
          .map((value) => value.trim())
          .filter(Boolean),
        ...(canManage && teacherUid ? { teacherUid } : {}),
      };
      let id = editingId;
      if (editingId) {
        const response = await csrfFetch(`/api/assignments/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            publishAt: publishAt ? new Date(publishAt).toISOString() : null,
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Assignment could not be updated");
      } else {
        const response = await csrfFetch("/api/assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            ...payload,
            ...(publishAt ? { publishAt: new Date(publishAt).toISOString() } : {}),
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Assignment could not be created");
        id = result.id;
      }
      if (id) await uploadMaterials(id);
      setNotice(
        editingId
          ? "Draft assignment updated."
          : "Assignment saved. Publish it when it is ready for students.",
      );
      resetForm();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Assignment could not be saved");
    } finally {
      setBusy(false);
    }
  }

  async function assignmentAction(item: Assignment, action: "publish" | "archive" | "duplicate") {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { action, assignmentId: item.id };
      if (action === "publish" && publishAt) payload.publishAt = new Date(publishAt).toISOString();
      const response = await csrfFetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Assignment action failed");
      setNotice(
        action === "publish"
          ? result.status === "scheduled"
            ? "Assignment publication scheduled."
            : "Assignment published to its class."
          : action === "duplicate"
            ? "A draft copy was created."
            : "Assignment archived. Historical submissions are retained.",
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Assignment action failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadSubmissions(item: Assignment) {
    setSelected(item);
    setSubmissions([]);
    setError("");
    try {
      const response = await fetch(`/api/assignments/${item.id}/submissions`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Submissions unavailable");
      setSubmissions(result.items ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Submissions unavailable");
    }
  }

  async function submitWork(item: Assignment, intent: "draft" | "submit") {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("intent", intent);
      form.set("textResponse", responseText[item.id] ?? "");
      (submissionFiles[item.id] ?? []).forEach((file) => form.append("files", file));
      const response = await csrfFetch(`/api/assignments/${item.id}/submissions`, {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Submission failed");
      setNotice(
        intent === "draft"
          ? "Your work was saved as a draft."
          : `Submission received${result.status === "submitted_late" ? " (late)" : ""}.`,
      );
      setSubmissionFiles((current) => ({ ...current, [item.id]: [] }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  }

  async function openMaterial(item: Assignment, file: Attachment) {
    const response = await fetch(
      `/api/assignments/${item.id}/attachments?attachmentId=${encodeURIComponent(file.id)}`,
      { cache: "no-store" },
    );
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "File unavailable");
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  async function loadAnalytics() {
    try {
      const response = await fetch(
        `/api/assignments?analytics=1${academicYearId ? `&academicYearId=${encodeURIComponent(academicYearId)}` : ""}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Analytics unavailable");
      setAnalytics(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Analytics unavailable");
    }
  }

  function exportAnalytics() {
    if (!analytics) return;
    const rows = [
      [
        "Grade",
        "Class",
        "Subject",
        "Assigned",
        "Submitted",
        "Late",
        "Missing",
        "Completion %",
        "Average Marks",
      ],
      ...analytics.groups.map((row) => [
        row.grade,
        row.className,
        row.subject,
        row.total,
        row.submitted,
        row.late,
        row.missing,
        row.completionPercent,
        row.averageMarks ?? "",
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "assignment-analytics.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function updatePolicy(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await csrfFetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "configure",
          allowedFileTypes: uploadConfigTypes,
          maxFileSizeMB,
          defaultAllowMultipleAttempts: defaultMultiple,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Policy update failed");
      setNotice("Assignment file policy saved.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Policy update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Academic workspace · Homework</div>
          <h1>Assignments</h1>
          <p>Manage class work, due dates, submissions and feedback in one place.</p>
        </div>
      </div>
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="login-success" role="status">
          {notice}
        </p>
      )}
      {data?.notifications?.length ? (
        <section className="panel" style={{ padding: 16, marginBottom: 14 }}>
          <strong>Assignment updates</strong>
          {data.notifications.slice(0, 4).map((item) => (
            <p key={item.id} style={{ margin: "8px 0 0" }}>
              <b>{item.title}</b> · {item.message}
            </p>
          ))}
        </section>
      ) : null}

      {!isStudent && !isParent && (
        <section className="panel" style={{ padding: 18, marginBottom: 14 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2 style={{ marginTop: 0 }}>Class performance</h2>
              <p>
                Counts, late work, missing work and average published marks from actual class
                submissions.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-secondary" onClick={() => void loadAnalytics()}>
                Load analytics
              </button>
              {analytics && (
                <button className="btn-secondary" onClick={exportAnalytics}>
                  Export CSV
                </button>
              )}
            </div>
          </div>
          {analytics && (
            <>
              <div className="stat-grid" style={{ margin: "14px 0" }}>
                {[
                  ["Assignments", analytics.summary.totalAssignments],
                  ["Submitted", analytics.summary.completedSubmissions],
                  ["Late", analytics.summary.lateSubmissions],
                  ["Missing", analytics.summary.missingSubmissions],
                  ["Completion", `${analytics.summary.submissionCompletionPercent}%`],
                  ["Average mark", analytics.summary.averageMarks?.toFixed(1) ?? "—"],
                ].map(([label, value]) => (
                  <div className="stat-card" key={String(label)}>
                    <small>{label}</small>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Grade / class</th>
                      <th>Subject</th>
                      <th>Assigned</th>
                      <th>Submitted</th>
                      <th>Late</th>
                      <th>Missing</th>
                      <th>Completion</th>
                      <th>Average marks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.groups.map((g) => (
                      <tr key={`${g.grade}-${g.className}-${g.subject}`}>
                        <td>
                          {g.grade} / {g.className}
                        </td>
                        <td>{g.subject}</td>
                        <td>{g.total}</td>
                        <td>{g.submitted}</td>
                        <td>{g.late}</td>
                        <td>{g.missing}</td>
                        <td>{g.completionPercent}%</td>
                        <td>{g.averageMarks?.toFixed(1) ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {canManage && (
        <section className="panel" style={{ padding: 18, marginBottom: 14 }}>
          <h2>{editingId ? "Edit unpublished assignment" : "Create an assignment"}</h2>
          <p>
            Published assignments are retained as historical records; create a copy to issue a
            revised version.
          </p>
          <form
            onSubmit={saveAssignment}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
              gap: 12,
            }}
          >
            <label className="field">
              Title
              <input
                required
                minLength={3}
                maxLength={140}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              Academic year
              <select
                required
                value={academicYearId}
                onChange={(e) => setAcademicYearId(e.target.value)}
              >
                <option value="">Choose active year</option>
                {data?.options.academicYears.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Grade
              <select
                required
                value={grade}
                onChange={(e) => {
                  setGrade(e.target.value);
                  setClassName("");
                  setSubject("");
                }}
              >
                <option value="">Choose grade</option>
                {[...new Set(classOptions.map((o) => o.grade).filter(Boolean) as string[])].map(
                  (g) => (
                    <option key={g}>{g}</option>
                  ),
                )}
              </select>
            </label>
            <label className="field">
              Class
              <select required value={className} onChange={(e) => setClassName(e.target.value)}>
                <option value="">Choose class</option>
                {classOptions
                  .filter((o) => !grade || o.grade === grade)
                  .map((o, i) => (
                    <option key={`${o.className}-${i}`} value={o.className}>
                      {o.className}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              Subject
              <select required value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">Choose subject</option>
                {subjectOptions
                  .filter((o) => !grade || !o.grade || o.grade === grade)
                  .map((o, i) => (
                    <option key={`${o.name}-${i}`} value={o.name}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </label>
            {canManage && data?.options.teachers.length ? (
              <label className="field">
                Responsible teacher
                <select required value={teacherUid} onChange={(e) => setTeacherUid(e.target.value)}>
                  <option value="">Choose teacher</option>
                  {data.options.teachers.map((o) => (
                    <option key={o.uid} value={o.uid}>
                      {o.fullName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="field">
              Due date and time
              <input
                required
                type="datetime-local"
                value={deadlineAt}
                onChange={(e) => setDeadlineAt(e.target.value)}
              />
            </label>
            <label className="field">
              Schedule publication (optional)
              <input
                type="datetime-local"
                value={publishAt}
                onChange={(e) => setPublishAt(e.target.value)}
              />
            </label>
            <label className="field">
              Maximum marks
              <input
                type="number"
                min="0"
                max="10000"
                value={maxMarks}
                onChange={(e) => setMaxMarks(e.target.value)}
              />
            </label>
            <label className="field">
              Assignment materials
              <input
                type="file"
                multiple
                accept={
                  uploadConfigTypes
                    .map((type) => MIME_ACCEPT[type])
                    .filter(Boolean)
                    .join(",") || undefined
                }
                onChange={(e) => setMaterialFiles(Array.from(e.target.files ?? []))}
              />
              <small>
                Up to five files; {maxFileSizeMB} MB each. Files are private to authorized school
                users.
              </small>
            </label>
            <label className="field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={allowMultipleAttempts}
                onChange={(e) => setAllowMultipleAttempts(e.target.checked)}
              />
              Allow additional attempts
            </label>
            <label className="field" style={{ gridColumn: "1/-1" }}>
              Instructions
              <textarea
                required
                rows={4}
                maxLength={10000}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </label>
            <label className="field" style={{ gridColumn: "1/-1" }}>
              Reference links (one HTTPS link per line)
              <textarea
                rows={2}
                value={referenceText}
                onChange={(e) => setReferenceText(e.target.value)}
              />
            </label>
            <div style={{ gridColumn: "1/-1", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-primary" disabled={busy}>
                {busy ? "Saving…" : editingId ? "Save draft changes" : "Save assignment"}
              </button>
              {editingId && (
                <button type="button" className="btn-secondary" onClick={resetForm}>
                  Cancel edit
                </button>
              )}
            </div>
          </form>
        </section>
      )}

      {canManage && ["school_admin", "school_owner"].includes(role) && (
        <details className="panel" style={{ padding: 18, marginBottom: 14 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Assignment upload policy</summary>
          <form onSubmit={updatePolicy} style={{ marginTop: 14 }}>
            <p>
              Choose school-approved formats. Each file is validated by extension and content
              signature, stored privately, and shared by short-lived download links.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                gap: 8,
              }}
            >
              {Object.entries(MIME_LABELS).map(([type, label]) => (
                <label key={type} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={uploadConfigTypes.includes(type)}
                    onChange={(e) =>
                      setUploadConfigTypes((current) =>
                        e.target.checked
                          ? [...new Set([...current, type])]
                          : current.filter((item) => item !== type),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <label className="field" style={{ maxWidth: 220 }}>
              Maximum file size (MB)
              <input
                type="number"
                min="1"
                max="20"
                value={maxFileSizeMB}
                onChange={(e) => setMaxFileSizeMB(Number(e.target.value))}
              />
            </label>
            <label className="field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={defaultMultiple}
                onChange={(e) => setDefaultMultiple(e.target.checked)}
              />
              Allow multiple attempts by default
            </label>
            <button className="btn-primary" disabled={busy || uploadConfigTypes.length === 0}>
              Save upload policy
            </button>
          </form>
        </details>
      )}

      <section className="panel" style={{ padding: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0 }}>
            {isParent
              ? "Assignments for linked children"
              : isStudent
                ? "My assignments"
                : "Assignment list"}
          </h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              aria-label="Search assignments"
              placeholder="Search title, subject, class"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="Filter by assignment status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              {[
                "draft",
                "scheduled",
                "published",
                "archived",
                "not_started",
                "in_progress",
                "submitted",
                "submitted_late",
                "under_review",
                "reviewed",
                "published",
                "resubmission_requested",
                "missing",
              ].map((status, i) => (
                <option value={status} key={`${status}-${i}`}>
                  {formatStatus(status)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!isStudent && !isParent && (
          <div className="stat-grid" style={{ margin: "12px 0" }}>
            {[
              ["Assigned seats", totals.assigned],
              ["Submission records", totals.submitted],
              ["Late", totals.late],
              ["Missing", totals.missing],
            ].map(([label, value]) => (
              <div className="stat-card" key={String(label)}>
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        )}
        {filtered.length === 0 ? (
          <p className="empty-state">
            {data ? "No assignments match this view." : "Loading assignments…"}
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
            {filtered.map((item) => (
              <AssignmentCard
                key={item.id}
                item={item}
                isStudent={isStudent}
                isParent={isParent}
                canManage={canManage}
                busy={busy}
                onAction={assignmentAction}
                onEdit={startEdit}
                onSubmit={submitWork}
                textValue={responseText[item.id] ?? ""}
                onTextChange={(value) =>
                  setResponseText((current) => ({ ...current, [item.id]: value }))
                }
                files={submissionFiles[item.id] ?? []}
                onFilesChange={(files) =>
                  setSubmissionFiles((current) => ({ ...current, [item.id]: files }))
                }
                onReview={loadSubmissions}
                onOpenMaterial={openMaterial}
                fileSizeMB={maxFileSizeMB}
                allowedTypes={uploadConfigTypes}
              />
            ))}
          </div>
        )}
      </section>

      {selected && !isStudent && !isParent && submissions.length > 0 && (
        <section className="panel" style={{ padding: 18, marginTop: 14 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div>
              <h2 style={{ marginTop: 0 }}>Submissions · {selected.title}</h2>
              <p>Draft marks and feedback remain private until explicitly published.</p>
            </div>
            <button
              className="btn-secondary"
              onClick={() => {
                setSelected(null);
                setSubmissions([]);
              }}
            >
              Close
            </button>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {submissions.map((submission) => (
              <ReviewSubmission
                key={submission.id}
                assignment={selected}
                submission={submission}
                onSaved={() => void loadSubmissions(selected)}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function AssignmentCard({
  item,
  isStudent,
  isParent,
  canManage,
  busy,
  onAction,
  onEdit,
  onSubmit,
  textValue,
  onTextChange,
  files,
  onFilesChange,
  onReview,
  onOpenMaterial,
  fileSizeMB,
  allowedTypes,
}: {
  item: Assignment;
  isStudent: boolean;
  isParent: boolean;
  canManage: boolean;
  busy: boolean;
  onAction: (item: Assignment, action: "publish" | "archive" | "duplicate") => void;
  onEdit: (item: Assignment) => void;
  onSubmit: (item: Assignment, intent: "draft" | "submit") => void;
  textValue: string;
  onTextChange: (value: string) => void;
  files: File[];
  onFilesChange: (files: File[]) => void;
  onReview: (item: Assignment) => void;
  onOpenMaterial: (item: Assignment, file: Attachment) => void;
  fileSizeMB: number;
  allowedTypes: string[];
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showMaterials, setShowMaterials] = useState(false);
  const [extraError, setExtraError] = useState("");
  async function loadMaterials() {
    setExtraError("");
    if (showMaterials) {
      setShowMaterials(false);
      return;
    }
    const response = await fetch(`/api/assignments/${item.id}/attachments`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) {
      setExtraError(result.error ?? "Materials unavailable");
      return;
    }
    setAttachments(result.items ?? []);
    setShowMaterials(true);
  }
  const status = isStudent ? (item.myProgress?.status ?? item.myStatus) : item.status;
  const canSubmit =
    (isStudent &&
      item.status === "published" &&
      !["submitted", "submitted_late", "under_review", "reviewed", "published"].includes(
        String(status),
      )) ||
    (isStudent && item.status === "published" && status === "resubmission_requested");
  return (
    <article className="panel" style={{ padding: 16, border: "1px solid #e7eaf0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ minWidth: 240, flex: 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <h3 style={{ margin: "0 0 4px" }}>{item.title}</h3>
            <span className="status-pill">{formatStatus(status)}</span>
            {item.myProgress?.wasLate && <span className="status-pill">Late</span>}
          </div>
          <p style={{ margin: "6px 0" }}>
            {item.grade} · {item.className} · {item.subject} · {item.maxMarks} marks
          </p>
          <small>
            Due {dateLabel(item.deadlineAt)} · {item.academicYearId}
          </small>
          <p style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{item.instructions}</p>
          {item.referenceLinks?.map((url) => (
            <p key={url}>
              <a href={url} target="_blank" rel="noreferrer">
                Reference: {url}
              </a>
            </p>
          ))}
          {isStudent && item.myProgress?.status === "published" && (
            <div className="notice">
              <b>
                Result: {item.myProgress.awardedMarks ?? "—"} / {item.maxMarks}
              </b>
              <p>{item.myProgress.feedback || "No written feedback."}</p>
            </div>
          )}
          {isParent &&
            item.childrenProgress &&
            Object.entries(item.childrenProgress).map(([studentId, progress]) => (
              <div className="notice" key={studentId} style={{ marginTop: 8 }}>
                <b>
                  {progress.studentName ?? "Linked child"} · {formatStatus(progress.status)}
                </b>
                {progress.status === "published" && (
                  <p>
                    {progress.awardedMarks ?? "—"} / {item.maxMarks} ·{" "}
                    {progress.feedback || "No written feedback."}
                  </p>
                )}
              </div>
            ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
          <button className="btn-secondary" onClick={() => void loadMaterials()}>
            Learning materials
          </button>
          {!isStudent && !isParent && canManage && item.status === "published" && (
            <button className="btn-secondary" onClick={() => onReview(item)}>
              Review submissions
            </button>
          )}
          {!isStudent && !isParent && canManage && ["draft", "scheduled"].includes(item.status) && (
            <>
              <button className="btn-secondary" onClick={() => onEdit(item)}>
                Edit
              </button>
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => onAction(item, "publish")}
              >
                {item.status === "scheduled" ? "Publish now" : "Publish"}
              </button>
            </>
          )}
          {!isStudent && !isParent && canManage && item.status !== "archived" && (
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => onAction(item, "archive")}
            >
              Archive
            </button>
          )}
          {!isStudent && !isParent && canManage && (
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => onAction(item, "duplicate")}
            >
              Duplicate
            </button>
          )}
        </div>
      </div>
      {showMaterials && (
        <div style={{ marginTop: 12, padding: 12, background: "#f6f8fb", borderRadius: 8 }}>
          <b>Private materials</b>
          {attachments.length ? (
            attachments.map((file) => (
              <p key={file.id} style={{ margin: "6px 0" }}>
                <button className="text-button" onClick={() => onOpenMaterial(item, file)}>
                  {file.name}
                </button>{" "}
                · {Math.ceil(file.size / 1024)} KB
              </p>
            ))
          ) : (
            <p>No uploaded files.</p>
          )}
        </div>
      )}
      {extraError && <p className="login-error">{extraError}</p>}
      {canSubmit && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e7eaf0" }}>
          <h4>Your work</h4>
          <label className="field">
            Text response
            <textarea
              rows={3}
              maxLength={20000}
              value={textValue}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder="Enter your answer or notes"
            />
          </label>
          <label className="field">
            Attach up to five files
            <input
              type="file"
              multiple
              accept={allowedTypes
                .map((type) => MIME_ACCEPT[type])
                .filter(Boolean)
                .join(",")}
              onChange={(e) => onFilesChange(Array.from(e.target.files ?? []))}
            />
            <small>Up to {fileSizeMB} MB each. Uploaded privately.</small>
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => onSubmit(item, "draft")}
            >
              Save draft
            </button>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => onSubmit(item, "submit")}
            >
              Submit homework
            </button>
          </div>
        </div>
      )}
      {isStudent &&
        status &&
        [
          "submitted",
          "submitted_late",
          "under_review",
          "reviewed",
          "published",
          "resubmission_requested",
        ].includes(status) && (
          <p style={{ marginBottom: 0 }}>
            Submission status: <b>{formatStatus(status)}</b>
            {item.myProgress?.submittedAt ? ` · ${dateLabel(item.myProgress.submittedAt)}` : ""}
          </p>
        )}
      {!isStudent && !isParent && canManage && item.stats && (
        <p style={{ marginBottom: 0 }}>
          Class progress: {item.stats.submissions}/{item.stats.recipients} submitted ·{" "}
          {item.stats.late} late · {item.stats.missing} missing
        </p>
      )}
    </article>
  );
}

function ReviewSubmission({
  assignment,
  submission,
  onSaved,
}: {
  assignment: Assignment;
  submission: Submission;
  onSaved: () => void;
}) {
  const [marks, setMarks] = useState(
    submission.awardedMarks === undefined ? "" : String(submission.awardedMarks),
  );
  const [feedback, setFeedback] = useState(submission.feedback ?? "");
  const [status, setStatus] = useState(submission.status);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(nextStatus: string) {
    setBusy(true);
    setError("");
    try {
      const response = await csrfFetch(
        `/api/assignments/${assignment.id}/submissions/${submission.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: nextStatus,
            ...(marks !== "" ? { awardedMarks: Number(marks) } : {}),
            feedback,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Review update failed");
      setStatus(nextStatus);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review update failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="panel" style={{ padding: 14, border: "1px solid #e7eaf0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <strong>{submission.student?.fullName ?? submission.id}</strong>
          <p>
            {submission.student?.admissionNumber ?? ""} · {submission.student?.grade}{" "}
            {submission.student?.className} · {formatStatus(status)}
            {submission.wasLate ? " · Late" : ""}
          </p>
          {submission.attempts?.map((attempt) => (
            <div
              key={attempt.id}
              style={{ padding: 8, background: "#f6f8fb", marginBottom: 6, borderRadius: 6 }}
            >
              <b>
                Attempt {attempt.attemptNumber} · {formatStatus(attempt.status)}
              </b>
              <p style={{ whiteSpace: "pre-wrap" }}>{attempt.textResponse || "No text response"}</p>
              {attempt.attachments?.map((file) => (
                <SubmissionFile
                  key={file.id}
                  assignmentId={assignment.id}
                  studentId={submission.id}
                  attemptId={attempt.id}
                  file={file}
                />
              ))}
            </div>
          ))}
        </div>
        <div style={{ minWidth: 230, flex: 1 }}>
          <label className="field">
            Marks (max {assignment.maxMarks})
            <input
              type="number"
              min="0"
              max={assignment.maxMarks}
              value={marks}
              onChange={(e) => setMarks(e.target.value)}
            />
          </label>
          <label className="field">
            Feedback
            <textarea
              rows={3}
              maxLength={5000}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => void save("under_review")}
            >
              Under review
            </button>
            <button className="btn-secondary" disabled={busy} onClick={() => void save("reviewed")}>
              Save private feedback
            </button>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => void save("resubmission_requested")}
            >
              Request revision
            </button>
            <button className="btn-primary" disabled={busy} onClick={() => void save("published")}>
              Publish result
            </button>
          </div>
        </div>
      </div>
      {error && <p className="login-error">{error}</p>}
    </article>
  );
}

function SubmissionFile({
  assignmentId,
  studentId,
  attemptId,
  file,
}: {
  assignmentId: string;
  studentId: string;
  attemptId: string;
  file: Attachment;
}) {
  const [error, setError] = useState("");
  async function open() {
    const url = `/api/assignments/${assignmentId}/attachments?submissionStudentId=${encodeURIComponent(studentId)}&attemptId=${encodeURIComponent(attemptId)}&submissionAttachmentId=${encodeURIComponent(file.id)}`;
    const response = await fetch(url, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "File unavailable");
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }
  return (
    <div>
      <button className="text-button" onClick={() => void open()}>
        Open / preview {file.name}
      </button>{" "}
      · {Math.ceil(file.size / 1024)} KB{error && <p className="login-error">{error}</p>}
    </div>
  );
}
