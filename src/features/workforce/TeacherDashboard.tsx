"use client";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import {
  Bell,
  BookOpenCheck,
  CalendarDays,
  ClipboardCheck,
  FileText,
  GraduationCap,
} from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";
import { hasPermission } from "@/server/permissions";

type Row = Record<string, unknown> & { id: string };
const text = (value: unknown) => String(value ?? "—");

export function TeacherDashboard({ permissions }: { permissions: readonly string[] }) {
  const can = (...names: string[]) => names.some((name) => hasPermission(permissions, name));
  const canMarkAttendance = can("attendance.mark", "attendance.mark.assigned");
  const canCreateAssignment = can("assignments.manage", "assignments.manage.assigned");
  const canEnterMarks = can("marks.enter", "marks.enter.assigned");
  const canViewTimetable = can("academics.read", "academics.manage", "teachers.self.read");
  const [assignments, setAssignments] = useState<Row[]>([]);
  const [leaves, setLeaves] = useState<Row[]>([]);
  const [homework, setHomework] = useState<Row[]>([]);
  const [exams, setExams] = useState<Row[]>([]);
  const [announcements, setAnnouncements] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    try {
      const responses = await Promise.all([
        fetch("/api/workforce?type=assignments", { cache: "no-store" }),
        fetch("/api/workforce?type=leaves", { cache: "no-store" }),
        fetch("/api/assignments", { cache: "no-store" }),
        fetch("/api/exams", { cache: "no-store" }),
        fetch("/api/communication", { cache: "no-store" }),
      ]);
      const bodies = await Promise.all(
        responses.map((response) => response.json().catch(() => ({}))),
      );
      const failedIndex = responses.findIndex((response) => !response.ok);
      if (failedIndex >= 0) throw new Error(bodies[failedIndex]?.error ?? "Dashboard unavailable");
      setAssignments(bodies[0].items ?? []);
      setLeaves(bodies[1].items ?? []);
      setHomework(bodies[2].assignments ?? bodies[2].items ?? []);
      setExams(bodies[3].exams ?? bodies[3].items ?? []);
      setAnnouncements(bodies[4].announcements ?? bodies[4].items ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dashboard unavailable");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function requestLeave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/workforce", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          action: "request_leave",
          startDate: form.get("startDate"),
          endDate: form.get("endDate"),
          leaveType: form.get("leaveType"),
          reason: form.get("reason"),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setNotice("Leave request submitted.");
      event.currentTarget.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Leave request failed");
    }
  }
  return (
    <main className="page-content teacher-dashboard">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Teacher workspace</div>
          <h1>Teaching dashboard</h1>
          <p>Your assigned classes, daily teaching queues and authorized school updates.</p>
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
      <section className="stat-grid">
        <article className="stat-card">
          <div className="stat-top">
            <span>Assigned classes</span>
            <span className="stat-icon">
              <GraduationCap size={15} />
            </span>
          </div>
          <div className="stat-value">{assignments.length}</div>
          <div className="stat-note">Active teacher assignments</div>
        </article>
        <article className="stat-card">
          <div className="stat-top">
            <span>Pending assignments</span>
            <span className="stat-icon">
              <FileText size={15} />
            </span>
          </div>
          <div className="stat-value">
            {homework.filter((row) => !["closed", "graded"].includes(String(row.status))).length}
          </div>
          <div className="stat-note">Authorized assignment queue</div>
        </article>
        <article className="stat-card">
          <div className="stat-top">
            <span>Upcoming examinations</span>
            <span className="stat-icon">
              <CalendarDays size={15} />
            </span>
          </div>
          <div className="stat-value">{exams.length}</div>
          <div className="stat-note">Visible examination schedules</div>
        </article>
        <article className="stat-card">
          <div className="stat-top">
            <span>Announcements</span>
            <span className="stat-icon">
              <Bell size={15} />
            </span>
          </div>
          <div className="stat-value">{announcements.length}</div>
          <div className="stat-note">Authorized school messages</div>
        </article>
      </section>
      <div className="dashboard-actions teacher-quick-actions">
        {canMarkAttendance && (
          <Link href="/attendance" className="quick-action">
            <span className="stat-icon">
              <ClipboardCheck size={14} />
            </span>
            <span>Mark attendance</span>
          </Link>
        )}
        {canCreateAssignment && (
          <Link href="/assignments" className="quick-action">
            <span className="stat-icon">
              <FileText size={14} />
            </span>
            <span>Create assignment</span>
          </Link>
        )}
        {canEnterMarks && (
          <Link href="/results" className="quick-action">
            <span className="stat-icon">
              <BookOpenCheck size={14} />
            </span>
            <span>Enter marks</span>
          </Link>
        )}
        {canViewTimetable && (
          <Link href="/timetable" className="quick-action">
            <span className="stat-icon">
              <CalendarDays size={14} />
            </span>
            <span>View timetable</span>
          </Link>
        )}
        {![canMarkAttendance, canCreateAssignment, canEnterMarks, canViewTimetable].some(
          Boolean,
        ) && <span className="panel-subtitle">No quick actions are available for this role.</span>}
      </div>
      <div className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Today’s classes and assigned subjects</div>
              <div className="panel-subtitle">
                Only classes and subjects assigned to your account are shown.
              </div>
            </div>
          </div>
          {assignments.length ? (
            <div className="activity-list">
              {assignments.slice(0, 8).map((assignment) => (
                <div className="activity-item" key={assignment.id}>
                  <div className="activity-dot" />
                  <div>
                    <div className="activity-copy">
                      <strong>{text(assignment.subject)}</strong> · {text(assignment.grade)}{" "}
                      {text(assignment.className)}
                    </div>
                    <div className="activity-time">
                      {text(assignment.day ?? "Schedule not set")} ·{" "}
                      {text(assignment.period ?? "Period TBD")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ minHeight: 150 }}>
              <p>No active classes are currently assigned to your account.</p>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Upcoming work</div>
              <div className="panel-subtitle">Assignment, examination and announcement queues.</div>
            </div>
          </div>
          <div className="mini-status-row">
            <span>
              <FileText size={13} />
              Assignments awaiting action
            </span>
            <strong>{homework.length}</strong>
          </div>
          <div className="mini-status-row">
            <span>
              <CalendarDays size={13} />
              Scheduled examinations
            </span>
            <strong>{exams.length}</strong>
          </div>
          <div className="mini-status-row">
            <span>
              <Bell size={13} />
              Recent announcements
            </span>
            <strong>{announcements.length}</strong>
          </div>
          {announcements.slice(0, 2).map((announcement) => (
            <div className="portal-message" key={announcement.id}>
              <strong>{text(announcement.title)}</strong>
              <p>{text(announcement.message)}</p>
            </div>
          ))}
        </section>
      </div>
      <div className="content-grid" style={{ marginTop: 16 }}>
        <section className="panel">
          <h2>My leave requests</h2>
          {leaves.length ? (
            leaves.slice(0, 6).map((leave) => (
              <div className="mini-status-row" key={leave.id}>
                <span>
                  {text(leave.leaveType)} · {text(leave.startDate)} – {text(leave.endDate)}
                </span>
                <strong className={`leave-status leave-status-${text(leave.status).toLowerCase()}`}>
                  {text(leave.status).toUpperCase()}
                </strong>
                {leave.decisionReason ? (
                  <small className="panel-subtitle" style={{ display: "block", marginTop: 4 }}>
                    Admin note: {text(leave.decisionReason)}
                  </small>
                ) : null}
              </div>
            ))
          ) : (
            <p className="panel-subtitle">No leave requests recorded.</p>
          )}
        </section>
        <section className="panel">
          <h2>Request leave</h2>
          <form className="teacher-leave-form" onSubmit={requestLeave}>
            <label className="field">
              Type
              <input name="leaveType" required />
            </label>
            <label className="field">
              Start
              <input name="startDate" type="date" required />
            </label>
            <label className="field">
              End
              <input name="endDate" type="date" required />
            </label>
            <label className="field">
              Reason
              <textarea name="reason" maxLength={1000} />
            </label>
            <button className="btn-primary">Submit request</button>
          </form>
        </section>
      </div>
    </main>
  );
}
