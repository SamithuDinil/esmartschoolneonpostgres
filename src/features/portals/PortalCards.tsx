"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Download,
  FileText,
  GraduationCap,
  HeartHandshake,
  MessageCircle,
  NotebookPen,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type Row = Record<string, unknown> & { id: string };
type PortalData = {
  mode: string;
  students: Row[];
  selectedStudentId: string | null;
  attendance: Row[];
  leaveRequests: Row[];
  results: Row[];
  examinations: Row[];
  invoices: Row[];
  payments: Row[];
  reports: Row[];
  assignments: Row[];
  timetable: Row[];
  events: Row[];
  messages: Row[];
  notifications: Row[];
  announcements: Row[];
};
const text = (value: unknown) => String(value ?? "—");
function metric(items: Row[], keys: string[]) {
  const row = items.find((item) => keys.some((key) => item[key] !== undefined));
  return row ? Number(row[keys.find((key) => row[key] !== undefined) ?? keys[0]] ?? 0) : null;
}
function Section({
  icon: Icon,
  title,
  subtitle,
  id,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel portal-section" id={id}>
      <div className="panel-header">
        <div className="portal-section-heading">
          <span className="portal-icon">
            <Icon size={15} />
          </span>
          <div>
            <div className="panel-title">{title}</div>
            <div className="panel-subtitle">{subtitle}</div>
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}
function Empty({ icon: Icon, title, copy }: { icon: LucideIcon; title: string; copy: string }) {
  return (
    <div className="empty-state" style={{ minHeight: 145 }}>
      <div>
        <div className="empty-icon">
          <Icon size={17} />
        </div>
        <h3>{title}</h3>
        <p>{copy}</p>
      </div>
    </div>
  );
}

export function PortalView({ mode }: { mode: "parent" | "student" }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [leaveForm, setLeaveForm] = useState({ fromDate: "", toDate: "", reason: "" });
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [setupForm, setSetupForm] = useState({ admissionNumber: "", childName: "", address: "" });
  const [setupBusy, setSetupBusy] = useState(false);
  const load = useCallback(
    async (studentId?: string) => {
      setError("");
      try {
        const query = new URLSearchParams({ portal: mode });
        if (studentId) query.set("studentId", studentId);
        const response = await fetch(`/api/portals?${query.toString()}`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Portal data could not be loaded.");
        setData(body as PortalData);
        setSelectedId(
          (current) => current ?? body.selectedStudentId ?? body.students?.[0]?.id ?? null,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Portal data could not be loaded.");
      }
    },
    [mode],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const selected = useMemo(
    () => data?.students.find((student) => student.id === selectedId) ?? data?.students[0],
    [data, selectedId],
  );
  const attendancePercent = metric(data?.attendance ?? [], ["percentage", "attendancePercentage"]);
  const name = text(
    selected?.preferredName ??
      selected?.fullName ??
      (mode === "parent" ? "Linked children" : "Student profile"),
  );
  async function submitLeave() {
    if (!selected?.id) return;
    setLeaveBusy(true);
    setError("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/student-leave", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ studentId: selected.id, ...leaveForm }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Leave request failed");
      setLeaveForm({ fromDate: "", toDate: "", reason: "" });
      setNotice("Leave request submitted for school review.");
      await load(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Leave request failed");
    } finally {
      setLeaveBusy(false);
    }
  }
  async function submitParentSetup() {
    setSetupBusy(true);
    setError("");
    setNotice("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/parent-setup", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(setupForm) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Parent setup could not be completed.");
      setSetupForm({ admissionNumber: "", childName: "", address: "" });
      setNotice("Your child was verified and linked. Loading the parent portal…");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Parent setup could not be completed.");
    } finally {
      setSetupBusy(false);
    }
  }
  return (
    <main className={`page-content portal-page portal-page-${mode}`}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Module {mode === "parent" ? "23" : "24"} · Personal portal</div>
              <h1>{mode === "parent" ? `Good day, ${text(selected?.guardianName ?? "parent").split(" ")[0]}` : "Student portal"}</h1>
          <p>
            {mode === "parent"
              ? "Everything important about your child’s school life, in one simple place."
              : "Your school day, learning resources and published progress in one place."}
          </p>
        </div>
        <div className="portal-access-note">
          <ShieldCheck size={14} />
          {mode === "parent" ? "Linked children only" : "Your records only"}
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
      {mode === "parent" && data && data.students.length === 0 && (
        <section className="panel parent-setup-card" aria-labelledby="parent-setup-title">
          <div className="panel-header">
            <div>
              <div className="panel-title" id="parent-setup-title">Configure your parent account</div>
              <div className="panel-subtitle">Enter the details the school already has on file. Admission number is used first; name and address are checked flexibly to allow small spelling differences.</div>
            </div>
            <span className="pill pending">One-time setup</span>
          </div>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submitParentSetup(); }}>
            <label className="field"><span>Child admission number</span><input required value={setupForm.admissionNumber} onChange={(event) => setSetupForm({ ...setupForm, admissionNumber: event.target.value })} placeholder="e.g. STU-2026-014" autoComplete="off" /></label>
            <label className="field"><span>Child full name</span><input required value={setupForm.childName} onChange={(event) => setSetupForm({ ...setupForm, childName: event.target.value })} placeholder="Name as registered at school" /></label>
            <label className="field full"><span>Home address</span><textarea required rows={3} value={setupForm.address} onChange={(event) => setSetupForm({ ...setupForm, address: event.target.value })} placeholder="Address used in the school record" /></label>
            <div className="form-actions"><button className="btn-primary" type="submit" disabled={setupBusy}>{setupBusy ? "Checking school records…" : "Verify and link my child"}</button></div>
          </form>
          <p className="panel-subtitle" style={{ marginTop: 12 }}>Your signed-in email must match the parent email recorded by the school. If verification fails, contact the school office to correct the record.</p>
        </section>
      )}
      {mode === "parent" && data?.students.length ? (
        <div className="child-switcher" role="tablist" aria-label="Switch linked child">
          {data.students.map((student) => (
            <button
              key={student.id}
              className={student.id === selected?.id ? "child-tab active" : "child-tab"}
              onClick={() => {
                setSelectedId(student.id);
                void load(student.id);
              }}
              role="tab"
              aria-selected={student.id === selected?.id}
            >
              <span className="avatar">
                {text(student.preferredName ?? student.fullName)
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <span>
                <strong>{text(student.preferredName ?? student.fullName)}</strong>
                <small>
                  {text(student.grade)} · {text(student.className)}
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {mode === "parent" && data?.students.length ? (
        <section className="parent-welcome-card" aria-label="Parent overview shortcuts">
          <div className="parent-welcome-copy">
            <div className="eyebrow">Parent overview</div>
            <h2>How is {text(selected?.preferredName ?? selected?.fullName ?? "your child")} doing?</h2>
            <p>Use the shortcuts below for the information parents check most often.</p>
          </div>
          <div className="parent-quick-actions">
            <Link href="#parent-attendance" className="parent-quick-action"><span className="parent-quick-icon"><ClipboardCheck size={16} /></span><span><strong>Attendance</strong><small>View daily record</small></span></Link>
            <Link href="#parent-results" className="parent-quick-action"><span className="parent-quick-icon"><FileText size={16} /></span><span><strong>Results</strong><small>See published marks</small></span></Link>
            <Link href="#parent-fees" className="parent-quick-action"><span className="parent-quick-icon"><CreditCard size={16} /></span><span><strong>Fees</strong><small>Check payments</small></span></Link>
            <Link href="#parent-calendar" className="parent-quick-action"><span className="parent-quick-icon"><CalendarDays size={16} /></span><span><strong>Calendar</strong><small>Upcoming dates</small></span></Link>
          </div>
        </section>
      ) : null}
      <section className="portal-hero">
        <div>
          <div className="eyebrow">{mode === "parent" ? "Selected child" : "Your profile"}</div>
          <h2>{name}</h2>
          <p>
            {text(selected?.grade)} · {text(selected?.className)} ·{" "}
            {text(selected?.admissionNumber ?? "School account")}
          </p>
        </div>
        <div className="portal-hero-mark">
          <GraduationCap size={24} />
        </div>
      </section>
      <section className="stat-grid portal-stats">
        {(
          [
            {
              label: "Attendance",
              value: attendancePercent === null ? "—" : `${attendancePercent}%`,
              icon: ClipboardCheck,
              color: "#e9f8f0",
            },
            {
              label: "Published results",
              value: data?.results.length ?? 0,
              icon: CheckCircle2,
              color: "#edf2ff",
            },
            {
              label: mode === "parent" ? "Outstanding fees" : "Assignments",
              value:
                mode === "parent" ? (data?.invoices.length ?? 0) : (data?.assignments.length ?? 0),
              icon: mode === "parent" ? CreditCard : NotebookPen,
              color: "#fff2d8",
            },
            {
              label: "Notifications",
              value: data?.notifications.length ?? 0,
              icon: Bell,
              color: "#f1edff",
            },
          ] as Array<{ label: string; value: string | number; icon: LucideIcon; color: string }>
        ).map(({ label, value, icon: Icon, color }) => (
          <article className="stat-card" key={label}>
            <div className="stat-top">
              <span>{label}</span>
              <span className="stat-icon" style={{ background: color }}>
                <Icon size={15} />
              </span>
            </div>
            <div className="stat-value">{String(value)}</div>
            <div className="stat-note">Visible within your authorized portal scope</div>
          </article>
        ))}
      </section>
      <section className="portal-grid">
        <div className="portal-column">
          <Section id={mode === "parent" ? "parent-attendance" : undefined} icon={ClipboardCheck} title="Attendance" subtitle="History and percentage">
            <div className="portal-list">
              {data?.attendance.length ? (
                data.attendance.slice(0, 8).map((item) => (
                  <div className="portal-row" key={item.id}>
                    <span>{text(item.date)}</span>
                    <span
                      className={`pill ${item.status === "present" ? "active" : item.status === "absent" ? "pending" : ""}`}
                    >
                      {text(item.status)}
                    </span>
                  </div>
                ))
              ) : (
                <Empty
                  icon={ClipboardCheck}
                  title="No attendance records yet"
                  copy="Attendance will appear when the school publishes authorized records."
                />
              )}
            </div>
          </Section>
          <div className="portal-progress">
            <div className="portal-progress-top">
              <span>Attendance progress</span>
              <strong>
                {attendancePercent === null ? "Not recorded" : `${attendancePercent}%`}
              </strong>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${Math.max(0, Math.min(100, attendancePercent ?? 0))}%` }}
              />
            </div>
          </div>
          <Section
            id={mode === "parent" ? "parent-calendar" : undefined}
            icon={CalendarDays}
            title="Today’s timetable"
            subtitle="Your authorized classes and subjects"
          >
            <div className="portal-list">
              {data?.timetable.length ? (
                data.timetable.slice(0, 6).map((item) => (
                  <div className="portal-row" key={item.id}>
                    <div>
                      <strong>{text(item.subject ?? item.name ?? "Class")}</strong>
                      <small>{text(item.className ?? item.grade)}</small>
                    </div>
                    <span>{text(item.period ?? item.start ?? "Scheduled")}</span>
                  </div>
                ))
              ) : (
                <Empty
                  icon={CalendarDays}
                  title="No timetable published"
                  copy="Your timetable will appear when the school publishes an authorized schedule."
                />
              )}
            </div>
          </Section>
          <Section
            id={mode === "parent" ? "parent-results" : undefined}
            icon={FileText}
            title="Recent results"
            subtitle="Published examination results only"
          >
            <div className="portal-list">
              {data?.results.length ? (
                data.results.slice(0, 6).map((item) => (
                  <div className="portal-row" key={item.id}>
                    <div>
                      <strong>{text(item.subject ?? item.examName ?? "Published result")}</strong>
                      <small>{text(item.examName ?? item.examination)}</small>
                    </div>
                    <span className="pill active">
                      {text(item.grade ?? item.mark ?? "Published")}
                    </span>
                  </div>
                ))
              ) : (
                <Empty
                  icon={FileText}
                  title="No published results"
                  copy="Draft and confidential marks stay hidden until the school publishes them."
                />
              )}
            </div>
          </Section>
          <Section
            icon={CalendarDays}
            title="Upcoming examinations & events"
            subtitle="Plan the next school moments"
          >
            <div className="portal-list">
              {[...(data?.examinations ?? []), ...(data?.events ?? [])].slice(0, 6).map((item) => (
                <div className="portal-row" key={item.id}>
                  <span>{text(item.name ?? item.title)}</span>
                  <small>{text(item.date ?? item.startDate ?? item.examDate)}</small>
                </div>
              ))}
              {!(data?.examinations.length || data?.events.length) && (
                <Empty
                  icon={CalendarDays}
                  title="No upcoming dates"
                  copy="Examinations and events will appear when the school publishes them."
                />
              )}
            </div>
          </Section>
        </div>
        <div className="portal-column">
          <Section icon={Bell} title="Announcements" subtitle="Messages addressed to you">
            <div className="portal-list">
              {data?.announcements.length ? (
                data.announcements.slice(0, 5).map((item) => (
                  <div className="portal-message" key={item.id}>
                    <strong>{text(item.title)}</strong>
                    <p>{text(item.message)}</p>
                    <small>{text(item.createdAt)}</small>
                  </div>
                ))
              ) : (
                <Empty
                  icon={Bell}
                  title="No announcements"
                  copy="Authorized school announcements will appear here."
                />
              )}
            </div>
          </Section>
          {mode === "parent" ? (
            <>
              <Section
                id="parent-fees"
                icon={CreditCard}
                title="Fees & payment history"
                subtitle="Linked-child finance records"
              >
                <div className="portal-list">
                  {data?.invoices.length ? (
                    data.invoices.slice(0, 5).map((item) => (
                      <div className="portal-row" key={item.id}>
                        <div>
                          <strong>{text(item.invoiceNumber ?? item.name ?? "Invoice")}</strong>
                          <small>{text(item.dueDate)}</small>
                        </div>
                        <span>{text(item.balance ?? item.amount ?? "—")}</span>
                      </div>
                    ))
                  ) : (
                    <Empty
                      icon={CreditCard}
                      title="No fee records"
                      copy="Outstanding fees and payment history appear only for linked children."
                    />
                  )}
                </div>
                <div className="form-actions">
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      setNotice(
                        "Report-card and receipt downloads will open when a published private document is linked.",
                      )
                    }
                  >
                    <Download size={13} />
                    Download report card
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      setNotice("Receipt downloads will open when a verified receipt is linked.")
                    }
                  >
                    <Download size={13} />
                    Download receipt
                  </button>
                </div>
              </Section>
              <Section icon={HeartHandshake} title="Leave requests" subtitle="Submit and track authorized student leave">
                <div className="portal-list">
                  {(data?.leaveRequests ?? []).slice(0, 5).map((item) => (
                    <div className="portal-row" key={item.id}><div><strong>{text(item.fromDate)} — {text(item.toDate)}</strong><small>{text(item.reason)}</small></div><span className={`pill ${item.status === "approved" ? "active" : item.status === "rejected" ? "pending" : ""}`}>{text(item.status)}</span></div>
                  ))}
                  {!data?.leaveRequests.length && <p className="empty-state">No leave requests for this child.</p>}
                </div>
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <label className="field">From<input type="date" value={leaveForm.fromDate} onChange={(e) => setLeaveForm({ ...leaveForm, fromDate: e.target.value })} /></label>
                  <label className="field">To<input type="date" value={leaveForm.toDate} onChange={(e) => setLeaveForm({ ...leaveForm, toDate: e.target.value })} /></label>
                  <label className="field" style={{ gridColumn: "1 / -1" }}>Reason<textarea rows={3} value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} placeholder="Explain the reason for leave" /></label>
                </div>
                <button className="btn-primary" disabled={leaveBusy || !leaveForm.fromDate || !leaveForm.toDate || !leaveForm.reason} onClick={() => void submitLeave()}>{leaveBusy ? "Submitting…" : "Request leave"}</button>
              </Section>
              <Section
                icon={MessageCircle}
                title="Teacher messages & meetings"
                subtitle="Contact authorized teachers"
              >
                <div className="portal-list">
                  {data?.messages.length ? (
                    data.messages.slice(0, 5).map((item) => (
                      <div className="portal-message" key={item.id}>
                        <strong>{text(item.subject ?? "Teacher message")}</strong>
                        <p>{text(item.message ?? item.body)}</p>
                      </div>
                    ))
                  ) : (
                    <Empty
                      icon={MessageCircle}
                      title="No teacher messages"
                      copy="Teacher contact is available only through authorized school messaging."
                    />
                  )}
                </div>
                <div className="form-actions">
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      setNotice(
                        "Meeting request saved for the school’s authorized follow-up queue.",
                      )
                    }
                  >
                    <HeartHandshake size={13} />
                    Request a meeting
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      setNotice("Contact request is limited to authorized teachers for this child.")
                    }
                  >
                    <MessageCircle size={13} />
                    Contact teacher
                  </button>
                </div>
              </Section>
            </>
          ) : (
            <>
              <Section
                icon={NotebookPen}
                title="Assignments & learning resources"
                subtitle="Your assigned work"
              >
                <div className="portal-list">
                  {data?.assignments.length ? (
                    data.assignments.slice(0, 6).map((item) => (
                      <div className="portal-row" key={item.id}>
                        <div>
                          <strong>{text(item.title ?? item.name ?? "Assignment")}</strong>
                          <small>{text(item.deadlineAt ?? item.dueDate)}</small>
                        </div>
                        <span className="pill pending">{text(item.status ?? "Open")}</span>
                      </div>
                    ))
                  ) : (
                    <Empty
                      icon={NotebookPen}
                      title="No assignments yet"
                      copy="Assignments and learning resources will appear when your teachers publish them."
                    />
                  )}
                </div>
                <div className="form-actions">
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      setNotice(
                        "Homework submission opens when a published assignment accepts submissions.",
                      )
                    }
                  >
                    <BookOpen size={13} />
                    Submit homework
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      setNotice("Learning resources are available from published class materials.")
                    }
                  >
                    <FileText size={13} />
                    Open resources
                  </button>
                </div>
              </Section>
              <Section
                icon={MessageCircle}
                title="Notifications"
                subtitle="Your personal school updates"
              >
                <div className="portal-list">
                  {data?.notifications.length ? (
                    data.notifications.slice(0, 6).map((item) => (
                      <div className="portal-message" key={item.id}>
                        <strong>{text(item.title ?? "School notification")}</strong>
                        <p>{text(item.message)}</p>
                      </div>
                    ))
                  ) : (
                    <Empty
                      icon={Bell}
                      title="No notifications"
                      copy="Important school updates will be delivered to your account."
                    />
                  )}
                </div>
              </Section>
            </>
          )}
        </div>
      </section>
      <div className="portal-footnote">
        <ShieldCheck size={14} />
        Official academic records are read-only in this portal. Access is limited to verified self
        or linked-child records.
      </div>
    </main>
  );
}
