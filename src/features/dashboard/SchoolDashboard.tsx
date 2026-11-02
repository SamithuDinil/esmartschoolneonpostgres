import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  ClipboardCheck,
  CreditCard,
  GraduationCap,
  Megaphone,
  Receipt,
  Users,
} from "lucide-react";
import { getAdminServices } from "@/lib/firebase/admin";
import { AppShell } from "@/components/AppShell";
import { SchoolSwitcher } from "@/components/SchoolSwitcher";
import { ParentWorkspaceActivation } from "@/features/portals/ParentWorkspaceActivation";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";

export const dynamic = "force-dynamic";

type Point = { label: string; value: number | null };
const dateValue = (value: unknown) =>
  value && typeof (value as { toDate?: unknown }).toDate === "function"
    ? (value as { toDate: () => Date }).toDate()
    : value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const monthKey = (date: Date) => date.toISOString().slice(0, 7);

async function countCollection(schoolId: string, name: string) {
  try {
    const { db } = getAdminServices();
    return (await db.collection("schools").doc(schoolId).collection(name).count().get()).data().count;
  } catch (error) {
    console.error("[dashboard] count failed", name, error instanceof Error ? error.message : error);
    return null;
  }
}

async function listRecentActivity(schoolId: string) {
  try {
    const { db } = getAdminServices();
    const result = await db
      .collection("schools")
      .doc(schoolId)
      .collection("auditLogs")
      .orderBy("occurredAt", "desc")
      .limit(6)
      .get();
    return result.docs.map((item) => {
      const data = item.data();
      const occurredAt = dateValue(data.occurredAt);
      return {
        id: item.id,
        action: String(data.action ?? "Record updated").replaceAll(".", " "),
        recordType: String(data.recordType ?? "school"),
        time: occurredAt
          ? new Intl.DateTimeFormat("en-LK", { dateStyle: "medium", timeStyle: "short" }).format(
              occurredAt,
            )
          : "Just now",
      };
    });
  } catch (error) {
    console.error("[dashboard] activity failed:", error instanceof Error ? error.message : error);
    return [];
  }
}

function trendPoints<T extends Record<string, unknown>>(
  rows: T[],
  field: string,
  formatter: (row: T) => Date | null,
  aggregate: (rows: T[]) => number,
): Point[] {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    return { key: monthKey(date), label: date.toLocaleDateString("en-LK", { month: "short" }) };
  });
  return months.map((month) => ({
    label: month.label,
    value: rows.some((row) => formatter(row) && monthKey(formatter(row)!) === month.key)
      ? aggregate(rows.filter((row) => formatter(row) && monthKey(formatter(row)!) === month.key))
      : 0,
  }));
}

function TrendCard({
  title,
  subtitle,
  points,
  suffix = "",
}: {
  title: string;
  subtitle: string;
  points: Point[];
  suffix?: string;
}) {
  const max = Math.max(1, ...points.map((point) => point.value ?? 0));
  return (
    <section className="panel trend-card">
      <div className="panel-header">
        <div>
          <div className="panel-title">{title}</div>
          <div className="panel-subtitle">{subtitle}</div>
        </div>
        <Activity size={15} />
      </div>
      <div className="trend-bars">
        {points.map((point) => (
          <div className="trend-column" key={point.label}>
            <div className="trend-bar-track">
              <div
                className="trend-bar"
                style={{ height: `${Math.max(4, ((point.value ?? 0) / max) * 100)}%` }}
                title={`${point.value ?? 0}${suffix}`}
              />
            </div>
            <small>{point.label}</small>
            <strong>
              {point.value ?? 0}
              {suffix}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function SchoolDashboard(props: { roleRoute?: string } = {}) {
  const roleRoute = props.roleRoute;
  try {
  const uid = await getSessionUid();
  if (!uid) redirect("/");
  // Isolated-schools redesign: system owners use the same school dashboard / setup flow.
  const context = await getSchoolContext();
  if (context?.role === "principal" && roleRoute !== "principal") redirect("/principal/dashboard");
  if (!roleRoute && context?.role === "parent") redirect("/parent-portal");
  if (
    !roleRoute &&
    context &&
    ["teacher", "class_teacher", "subject_teacher"].includes(context.role)
  )
    redirect("/teacher/dashboard");
  if (!roleRoute && context?.role === "student") redirect("/student/dashboard");
  if (roleRoute && context?.role !== roleRoute) redirect("/dashboard");
  if (!context) {
    const { db } = getAdminServices();
    const user = await db.collection("users").doc(uid).get();
    const activeSchoolId =
      typeof user.get("activeSchoolId") === "string" ? String(user.get("activeSchoolId")) : "";
    const inactiveSchool = activeSchoolId
      ? await db.collection("schools").doc(activeSchoolId).get()
      : null;
    const status = inactiveSchool?.exists ? String(inactiveSchool.get("status") ?? "") : "";
    const unavailable = ["suspended", "archived", "deletion_pending"].includes(status);
    return (
      <main className="page-content">
        <div className="notice">
          <div>
            <div className="stat-icon">
              <ClipboardCheck size={16} />
            </div>
            <h3>
              {unavailable
                ? `School access ${status.replaceAll("_", " ")}`
                : "No active school workspace is linked to this account"}
            </h3>
            <p>
              {unavailable
                ? `Your selected school${inactiveSchool?.get("name") ? ` (${inactiveSchool.get("name")})` : ""} is ${status.replaceAll("_", " ")}. School data remains protected. If you belong to another active school, select it below; otherwise contact the school administration or System Owner.`
                : "Ask your school principal or administrator for a school invitation, or create your own school workspace."}
            </p>
            <SchoolSwitcher
              schoolName={
                unavailable
                  ? String(inactiveSchool?.get("name") ?? "School unavailable")
                  : "Choose school workspace"
              }
            />
            <p style={{ marginTop: 14, display: "flex", gap: 16, flexWrap: "wrap" }}>
              <Link href="/setup">Create a new school</Link>
              <Link href="/registration/pending">Check my registration request</Link>
            </p>
            <ParentWorkspaceActivation />
          </div>
        </div>
      </main>
    );
  }

  const canStudents = hasPermission(context.permissions, "students.read");
  const canTeachers = hasPermission(context.permissions, "teachers.read");
  const canStaff = hasPermission(context.permissions, "staff.read");
  const canAcademics =
    hasPermission(context.permissions, "academics.read") ||
    hasPermission(context.permissions, "academics.manage");
  const canAttendance = hasPermission(context.permissions, "attendance.read");
  const canAssignments =
    hasPermission(context.permissions, "assignments.read") ||
    hasPermission(context.permissions, "assignments.manage");
  const canExams =
    hasPermission(context.permissions, "exams.read") ||
    hasPermission(context.permissions, "exams.manage");
  const canFinance = hasPermission(context.permissions, "finance.read");
  const canAudit = hasPermission(context.permissions, "audit.read");
  const { db } = getAdminServices();
  const schoolRef = db.collection("schools").doc(context.schoolId);
  const today = dayKey(new Date());
  // Keep reads minimal — free-tier Firestore quota is easy to exhaust with wide scans.
  const soft = <T,>(promise: Promise<T>): Promise<T | null> =>
    promise.catch((error) => {
      console.error("[dashboard] query failed:", error instanceof Error ? error.message : error);
      return null;
    });
  const [
    studentCount,
    teacherCount,
    staffCount,
    classCount,
    attendance,
    assignments,
    exams,
    publishedExams,
    school,
    activity,
  ] = await Promise.all([
    canStudents ? countCollection(context.schoolId, "students") : Promise.resolve(null),
    canTeachers ? countCollection(context.schoolId, "teachers") : Promise.resolve(null),
    canStaff ? countCollection(context.schoolId, "employees") : Promise.resolve(null),
    canAcademics ? countCollection(context.schoolId, "classes") : Promise.resolve(null),
    canAttendance
      ? soft(schoolRef.collection("attendanceSessions").where("date", "==", today).limit(20).get())
      : Promise.resolve(null),
    canAssignments
      ? soft(schoolRef.collection("assignments").where("status", "==", "published").limit(20).get())
      : Promise.resolve(null),
    canExams
      ? soft(schoolRef.collection("exams").where("status", "==", "scheduled").limit(20).get())
      : Promise.resolve(null),
    canExams
      ? soft(schoolRef.collection("exams").where("status", "==", "published").limit(20).get())
      : Promise.resolve(null),
    soft(schoolRef.get()),
    canAudit ? listRecentActivity(context.schoolId) : Promise.resolve(null),
  ]);
  const attendanceRows: Array<Record<string, unknown>> =
    attendance?.docs.map((doc: { data: () => Record<string, unknown> }) => doc.data()) ?? [];
  const attendanceTotal = attendanceRows.reduce(
    (sum, row) => sum + Number(row.totalEnrolled ?? 0),
    0,
  );
  const attendancePresent = attendanceRows.reduce(
    (sum, row) => sum + Number(row.present ?? 0) + Number(row.late ?? 0),
    0,
  );
  const attendanceRate = attendanceTotal
    ? Math.round((attendancePresent / attendanceTotal) * 100)
    : null;
  const upcomingExamCount =
    exams?.docs.filter((doc: { data: () => Record<string, unknown> }) => {
      const row = doc.data();
      const date = dateValue(row.examinationDate ?? row.examDate ?? row.date ?? row.scheduledAt);
      return !date || date >= new Date(new Date().setHours(0, 0, 0, 0));
    }).length ?? null;
  const schoolName = school?.data()?.name ?? "My school";
  const roleLabel = context.role.replaceAll("_", " ");
  const isLeadership = ["school_owner", "school_admin", "principal", "vice_principal"].includes(
    context.role,
  );
  const attendanceTrend = trendPoints(
    attendanceRows,
    "date",
    (row) => dateValue(row.date),
    (rows) => {
      const total = rows.reduce((sum, row) => sum + Number(row.totalEnrolled ?? 0), 0);
      const present = rows.reduce(
        (sum, row) => sum + Number(row.present ?? 0) + Number(row.late ?? 0),
        0,
      );
      return total ? Math.round((present / total) * 100) : 0;
    },
  );
  // Enrollment scans are intentionally disabled above to keep dashboard reads bounded.
  const enrollmentRows: Array<Record<string, unknown>> = [];
  const enrollmentTrend = trendPoints(
    enrollmentRows,
    "createdAt",
    (row) => dateValue(row.createdAt),
    (rows) => rows.length,
  );
  const publishedExamRows: Array<Record<string, unknown>> =
    publishedExams?.docs.map((doc: { data: () => Record<string, unknown> }) => doc.data()) ?? [];
  const performanceTrend = publishedExamRows
    .slice(0, 6)
    .reverse()
    .map((row, index) => ({
      label: String(row.name ?? row.subject ?? `Exam ${index + 1}`).slice(0, 8),
      value: typeof row.averagePercentage === "number" ? row.averagePercentage : null,
    }));
  const actions = [
    { label: "Add student", href: "/students", permission: "students.create", icon: Users },
    {
      label: "Add teacher",
      href: "/workforce",
      permission: "teachers.manage",
      icon: BookOpenCheck,
    },
    {
      label: "Create class",
      href: "/administration",
      permission: "academics.manage",
      icon: GraduationCap,
    },
    {
      label: "Schedule examination",
      href: "/exams",
      permission: "exams.manage",
      icon: CalendarDays,
    },
    {
      label: "Publish announcement",
      href: "/communication",
      permission: "announcements.manage",
      icon: Megaphone,
    },
    { label: "Generate report", href: "/reports", permission: "reports.read", icon: Receipt },
  ].filter((action) => hasPermission(context.permissions, action.permission));
  const stats = [
    { label: "Total students", value: studentCount, icon: Users, color: "#edf2ff" },
    { label: "Teachers", value: teacherCount, icon: BookOpenCheck, color: "#e9f8f0" },
    { label: "Staff", value: staffCount, icon: Users, color: "#fff4df" },
    { label: "Classes", value: classCount, icon: GraduationCap, color: "#f1edff" },
    {
      label: "Today's attendance",
      value: attendanceRate === null ? null : `${attendanceRate}%`,
      icon: ClipboardCheck,
      color: "#e9f8f0",
    },
    {
      label: "Pending assignments",
      value: assignments?.size ?? null,
      icon: Receipt,
      color: "#fff2d8",
    },
    {
      label: "Upcoming examinations",
      value: upcomingExamCount,
      icon: CalendarDays,
      color: "#edf2ff",
    },
    {
      label: "Outstanding fees",
      value: null,
      icon: CreditCard,
      color: "#fde7e9",
    },
  ];

  return (
    <AppShell
      schoolName={schoolName}
      userName={context.displayName}
      role={context.role}
      permissions={context.permissions}
    >
      <main className="page-content">
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              {isLeadership ? "Leadership workspace" : "School workspace"}
            </div>
            <h1>
              {context.role === "principal" || context.role === "vice_principal"
                ? "Academic overview"
                : `Good day, ${context.displayName.split(" ")[0]}`}
            </h1>
            <p>
              {isLeadership
                ? "Live operational information from the current school tenant."
                : `Your ${roleLabel} access is limited to authorized school records.`}
            </p>
          </div>
          <div className="status-pill">{roleLabel}</div>
        </div>
        <section className="stat-grid dashboard-stat-grid" aria-label="Live school statistics">
          {stats.map(({ label, value, icon: Icon, color }) => (
            <article className="stat-card" key={label}>
              <div className="stat-top">
                <span>{label}</span>
                <span className="stat-icon" style={{ background: color }}>
                  <Icon size={15} />
                </span>
              </div>
              <div className="stat-value">
                {value === null ? "—" : typeof value === "number" ? value.toLocaleString() : value}
              </div>
              <div className="stat-note">
                {value === null
                  ? "Not available to this role or not recorded"
                  : "Live from this school’s records"}
              </div>
            </article>
          ))}
        </section>
        <div className="dashboard-actions">
          {actions.map(({ label, href, icon: Icon }) => (
            <Link href={href} className="quick-action" key={href}>
              <span className="stat-icon">
                <Icon size={14} />
              </span>
              <span>{label}</span>
              <ArrowRight size={13} />
            </Link>
          ))}
          {!actions.length && (
            <span className="panel-subtitle">No quick actions are available for this role.</span>
          )}
        </div>
        <section className="dashboard-chart-grid">
          <TrendCard
            title="Monthly attendance"
            subtitle="Recorded attendance percentage"
            points={attendanceTrend}
            suffix="%"
          />
          <TrendCard
            title="Student enrollment"
            subtitle="New enrollment records"
            points={enrollmentTrend}
          />
          {performanceTrend.length ? (
            <TrendCard
              title="Examination performance"
              subtitle="Published exam averages"
              points={performanceTrend}
              suffix="%"
            />
          ) : (
            <section className="panel trend-card">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Academic progress</div>
                  <div className="panel-subtitle">Published examination data</div>
                </div>
                <BookOpenCheck size={15} />
              </div>
              <div className="empty-state" style={{ minHeight: 130 }}>
                <p>No published examination averages are recorded yet.</p>
              </div>
            </section>
          )}
        </section>
        <section className="content-grid">
          <article className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Recent activity</div>
                <div className="panel-subtitle">Audit events visible to your role.</div>
              </div>
              <Activity size={15} />
            </div>
            {activity === null ? (
              <div className="empty-state" style={{ minHeight: 120 }}>
                <p>Audit activity is not available to this role.</p>
              </div>
            ) : activity.length ? (
              <div className="activity-list">
                {activity.map((event) => (
                  <div className="activity-item" key={event.id}>
                    <div className="activity-dot" />
                    <div>
                      <div className="activity-copy">
                        {event.action} · {event.recordType}
                      </div>
                      <div className="activity-time">{event.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ minHeight: 120 }}>
                <p>No audited activity has been recorded yet.</p>
              </div>
            )}
          </article>
          <aside className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Leadership focus</div>
                <div className="panel-subtitle">Role-aware next steps</div>
              </div>
            </div>
            <div className="activity-list">
              <div className="activity-item">
                <div className="activity-dot" />
                <div>
                  <div className="activity-copy">
                    {attendanceRate === null
                      ? "Attendance awaiting records"
                      : `${attendanceRate}% attendance today`}
                  </div>
                  <div className="activity-time">
                    {canAttendance
                      ? "Based on today’s recorded sessions"
                      : "Attendance is not available to this role"}
                  </div>
                </div>
              </div>
              <div className="activity-item">
                <div className="activity-dot" style={{ background: "#49a887" }} />
                <div>
                  <div className="activity-copy">
                    {upcomingExamCount === null
                      ? "Examination schedule unavailable"
                      : `${upcomingExamCount} upcoming examination${upcomingExamCount === 1 ? "" : "s"}`}
                  </div>
                  <div className="activity-time">
                    {canExams ? "Live from scheduled exams" : "Examination access is restricted"}
                  </div>
                </div>
              </div>
              <div className="activity-item">
                <div className="activity-dot" style={{ background: "#9772e9" }} />
                <div>
                  <div className="activity-copy">
                    Finance summary unavailable
                  </div>
                  <div className="activity-time">
                    {canFinance
                      ? "Calculated from invoice balances"
                      : "Finance access is restricted"}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </section>
      </main>
    </AppShell>
  );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      typeof error.digest === "string" &&
      error.digest.startsWith("NEXT_REDIRECT")
    )
      throw error;
    console.error("[dashboard] render failed:", error instanceof Error ? error.message : error);
    return (
      <main className="page-content" style={{ padding: 32, maxWidth: 640, margin: "40px auto" }}>
        <div className="notice">
          <div>
            <h3>Dashboard temporarily unavailable</h3>
            <p>
              Something went wrong while loading your workspace. Your session is active — try
              refreshing the page. If this continues, open{" "}
              <a href="/setup">school setup</a> or sign out and back in.
            </p>
            <p style={{ marginTop: 12, fontSize: 13, opacity: 0.7 }}>
              {error instanceof Error ? error.message : "Unknown server error"}
            </p>
            {(error instanceof Error && /RESOURCE_EXHAUSTED|Quota exceeded/i.test(error.message)) ? (
              <p style={{ marginTop: 12, color: "#b45309" }}>
                Firebase Firestore quota is exceeded for this project. Wait for the quota to reset
                (often daily on the free plan), or upgrade the Firebase billing plan / raise limits
                in Google Cloud.
              </p>
            ) : null}
            <p style={{ marginTop: 16, display: "flex", gap: 16 }}>
              <Link href="/dashboard">Retry</Link>
              <Link href="/setup">Create a school</Link>
              <Link href="/">Home</Link>
            </p>
          </div>
        </div>
      </main>
    );
  }
}
