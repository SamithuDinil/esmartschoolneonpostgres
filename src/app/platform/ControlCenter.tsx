"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowDownUp,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  GraduationCap,
  RefreshCw,
  Search,
  Shield,
  Users,
  UserRoundCog,
  X,
} from "lucide-react";
import {
  fetchCsrfToken,
  reauthenticateForSensitiveAction,
  reauthenticateWithGoogleForSensitiveAction,
} from "@/lib/firebase/session-client";

type Principal = { uid?: string; name?: string; email?: string } | null;
type School = {
  id: string;
  name: string;
  slug?: string;
  schoolCode?: string;
  status?: string;
  planId?: string;
  emergencyLock?: { status?: string };
  schoolType?: string;
  email?: string;
  phone?: string;
  address?: string;
  district?: string;
  province?: string;
  createdAt?: unknown;
  principal?: Principal;
  teacherCount?: number | null;
  studentCount?: number | null;
  subscriptionExpiresAt?: unknown;
};
type Audit = {
  id: string;
  action?: string;
  actorUid?: string;
  schoolId?: string;
  outcome?: string;
  occurredAt?: unknown;
};
type AnalyticsPoint = {
  month: string;
  label: string;
  schools: number | null;
  teachers: number | null;
  students: number | null;
  activity: number | null;
};
type Stats = {
  schools: number;
  activeSchools: number;
  suspendedSchools: number;
  pendingSchools: number;
  principals: number | null;
  teachers: number | null;
  students: number | null;
  users: number;
  systemOwners: number;
  membershipMetricsUnavailable?: boolean;
};
type ChartMetric = "schools" | "teachers" | "students" | "activity";
type Tab = "overview" | "schools" | "principals" | "audit";
const emptyStats: Stats = {
  schools: 0,
  activeSchools: 0,
  suspendedSchools: 0,
  pendingSchools: 0,
  principals: null,
  teachers: null,
  students: null,
  users: 0,
  systemOwners: 0,
};
const statusLabel = (status?: string) =>
  (status ?? "active").replaceAll("_", " ").replace(/^./, (s) => s.toUpperCase());
function dateLabel(value: unknown) {
  if (!value) return "Not recorded";
  const raw = value as { toDate?: () => Date; _seconds?: number; seconds?: number };
  const date =
    typeof raw.toDate === "function"
      ? raw.toDate()
      : typeof raw._seconds === "number"
        ? new Date(raw._seconds * 1000)
        : typeof raw.seconds === "number"
          ? new Date(raw.seconds * 1000)
          : typeof value === "string"
            ? new Date(value)
            : null;
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date)
    : "Not recorded";
}
const panel: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5eaf1",
  borderRadius: 14,
  padding: 20,
  boxShadow: "0 6px 24px rgba(21,37,67,.035)",
};
const button: React.CSSProperties = {
  border: "1px solid #dbe2ec",
  borderRadius: 9,
  background: "#fff",
  padding: "9px 12px",
  color: "#34425a",
  fontWeight: 600,
  cursor: "pointer",
};
const input: React.CSSProperties = {
  width: "100%",
  border: "1px solid #d7deea",
  borderRadius: 9,
  padding: "10px 12px",
  minHeight: 40,
  color: "#1c2940",
  background: "#fff",
};

export default function ControlCenter() {
  const [schools, setSchools] = useState<School[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsPoint[]>([]);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("schools");
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<"name" | "created">("name");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<School | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [supportReason, setSupportReason] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportPassword, setSupportPassword] = useState("");
  const router = useRouter();
  const pageSize = 8;

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/platform/schools", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load platform data.");
      setSchools(data.schools ?? []);
      setStats({ ...emptyStats, ...(data.stats ?? {}) });
      setAnalytics(data.analytics ?? []);
      setAudit(data.audit ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load platform data.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function mutate(body: object, method: string) {
    setBusy(true);
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/platform/schools", {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Operation failed.");
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operation failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function setSchoolStatus(school: School) {
    if (school.emergencyLock?.status === "active") {
      setError(
        "Release the emergency lock from the school management page before changing its lifecycle status.",
      );
      return;
    }
    const next = school.status === "suspended" ? "active" : "suspended";
    if (
      next === "suspended" &&
      !window.confirm(
        `Suspend ${school.name}? Members will lose operational access until it is reactivated.`,
      )
    )
      return;
    await mutate({ schoolId: school.id, status: next }, "PATCH");
    setSelected(null);
  }

  async function enterSupportMode(school: School, method: "password" | "google" = "password") {
    setBusy(true);
    setError("");
    try {
      const reauthenticatedIdToken =
        method === "google"
          ? await reauthenticateWithGoogleForSensitiveAction()
          : await reauthenticateForSensitiveAction(supportEmail, supportPassword);
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/platform/support-session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          schoolId: school.id,
          reason: supportReason.trim(),
          reauthenticatedIdToken,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Support mode could not be started.");
      router.replace(data.redirectTo ?? "/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Support mode could not be started.");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(
    () =>
      schools
        .filter((school) => filter === "all" || (school.status ?? "active") === filter)
        .filter((school) =>
          `${school.name} ${school.schoolCode ?? ""} ${school.slug ?? ""} ${school.principal?.name ?? ""} ${school.principal?.email ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name)
            : String(
                (b.createdAt as { _seconds?: number } | undefined)?._seconds ?? "",
              ).localeCompare(
                String((a.createdAt as { _seconds?: number } | undefined)?._seconds ?? ""),
              ),
        ),
    [schools, filter, query, sort],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const cards = [
    { label: "Registered schools", value: stats.schools, icon: Building2, tint: "#eef3ff" },
    { label: "Active schools", value: stats.activeSchools, icon: CheckCircle2, tint: "#e9f8ef" },
    { label: "Suspended schools", value: stats.suspendedSchools, icon: Shield, tint: "#fff1ef" },
    { label: "Setup pending", value: stats.pendingSchools, icon: CircleAlert, tint: "#fff6e7" },
    { label: "Principals", value: stats.principals, icon: UserRoundCog, tint: "#f2edff" },
    { label: "Teachers", value: stats.teachers, icon: GraduationCap, tint: "#eaf7fb" },
    { label: "Students", value: stats.students, icon: Users, tint: "#fceefa" },
    { label: "Registered users", value: stats.users, icon: Users, tint: "#eff2f6" },
  ];
  const nav: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "schools", label: "Schools", icon: Building2 },
    { id: "principals", label: "Principals", icon: UserRoundCog },
    { id: "audit", label: "Audit logs", icon: ClipboardList },
  ];
  const chartTitles: Record<ChartMetric, string> = {
    schools: "School registrations",
    teachers: "Teacher membership additions",
    students: "Student membership additions",
    activity: "Platform audit activity",
  };
  const chartValues = analytics.map((point) => point[chartMetric]);
  const chartMax = Math.max(1, ...chartValues.filter((value): value is number => value !== null));
  const chartAvailable = chartValues.some((value) => value !== null);

  return (
    <main
      style={{
        maxWidth: 1440,
        margin: "0 auto",
        padding: "32px clamp(16px, 3vw, 40px) 56px",
        color: "#172033",
        minHeight: "100vh",
        background: "#f6f8fb",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <div style={{ color: "#65738a", fontSize: 12, fontWeight: 700, letterSpacing: ".08em" }}>
            E-SMARTSCHOOL.LK · PLATFORM
          </div>
          <h1 style={{ margin: "7px 0 4px", fontSize: 28 }}>E-SmartSchool.lk Control Center</h1>
          <p style={{ margin: 0, color: "#69778c" }}>
            Platform-wide oversight, school lifecycle management, and audited administration.
          </p>
        </div>
        <button style={button} onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} style={{ verticalAlign: "-3px", marginRight: 7 }} />
          {loading ? "Refreshing…" : "Refresh data"}
        </button>
      </header>
      <nav
        aria-label="Control Center sections"
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}
      >
        {nav.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              ...button,
              background: tab === id ? "#253e89" : "#fff",
              color: tab === id ? "#fff" : "#34425a",
              borderColor: tab === id ? "#253e89" : "#dbe2ec",
            }}
          >
            <Icon size={15} style={{ verticalAlign: "-3px", marginRight: 7 }} />
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <div
          role="alert"
          style={{ ...panel, borderColor: "#f0b8b3", color: "#9f2d25", marginBottom: 18 }}
        >
          {error}
        </div>
      )}

      {(tab === "overview" || tab === "schools") && (
        <>
          {tab === "overview" && (
            <section
              aria-label="Platform statistics"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
                gap: 14,
                marginBottom: 20,
              }}
            >
              {cards.map(({ label, value, icon: Icon, tint }) => (
                <article key={label} style={panel}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      color: "#65738a",
                      fontSize: 13,
                    }}
                  >
                    <span>{label}</span>
                    <span
                      style={{
                        background: tint,
                        width: 34,
                        height: 34,
                        display: "grid",
                        placeItems: "center",
                        borderRadius: 10,
                        color: "#3e4e6b",
                      }}
                    >
                      <Icon size={16} />
                    </span>
                  </div>
                  <strong style={{ display: "block", fontSize: 27, marginTop: 11 }}>
                    {value === null || value === undefined ? "—" : value.toLocaleString()}
                  </strong>
                  <small style={{ color: "#8691a2" }}>
                    {value == null
                      ? "Not available from current membership records"
                      : "Live database count"}
                  </small>
                </article>
              ))}
            </section>
          )}

          {tab === "overview" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1.5fr) minmax(280px,.8fr)",
                gap: 18,
                marginBottom: 20,
              }}
            >
              <section style={panel}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <h2 style={{ margin: 0, fontSize: 17 }}>School status distribution</h2>
                    <p style={{ margin: "5px 0 0", color: "#728097", fontSize: 13 }}>
                      Calculated from live school records
                    </p>
                  </div>
                  <Building2 size={18} color="#71809a" />
                </div>
                {[
                  { label: "Active", value: stats.activeSchools, color: "#39a678" },
                  { label: "Suspended", value: stats.suspendedSchools, color: "#d36a5d" },
                  { label: "Setup pending", value: stats.pendingSchools, color: "#d7a33c" },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "120px 1fr 40px",
                      alignItems: "center",
                      gap: 10,
                      margin: "16px 0",
                    }}
                  >
                    <span style={{ color: "#47546a", fontSize: 13 }}>{item.label}</span>
                    <div
                      style={{
                        background: "#eef1f5",
                        height: 9,
                        borderRadius: 20,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${stats.schools ? Math.max(2, (item.value / stats.schools) * 100) : 0}%`,
                          background: item.color,
                          borderRadius: 20,
                        }}
                      />
                    </div>
                    <strong style={{ fontSize: 13 }}>{item.value}</strong>
                  </div>
                ))}
              </section>
              <section style={panel}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <h2 style={{ margin: 0, fontSize: 17 }}>Recent platform activity</h2>
                    <p style={{ margin: "5px 0 0", color: "#728097", fontSize: 13 }}>
                      Latest audited administrative events
                    </p>
                  </div>
                  <Activity size={18} color="#71809a" />
                </div>
                {!audit.length ? (
                  <div style={{ padding: "22px 0", color: "#8390a3", fontSize: 13 }}>
                    No platform audit events have been recorded yet.
                  </div>
                ) : (
                  audit.slice(0, 6).map((event) => (
                    <div
                      key={event.id}
                      style={{ borderTop: "1px solid #eef1f5", padding: "11px 0" }}
                    >
                      <strong style={{ textTransform: "capitalize", fontSize: 13 }}>
                        {(event.action ?? "Platform event").replaceAll(".", " ")}
                      </strong>
                      <div style={{ color: "#8390a3", fontSize: 12, marginTop: 4 }}>
                        {dateLabel(event.occurredAt)}
                        {event.schoolId ? ` · School ${event.schoolId}` : ""}
                      </div>
                    </div>
                  ))
                )}
              </section>
            </div>
          )}

          {tab === "overview" && (
            <section style={{ ...panel, marginBottom: 20 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "start",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: 17 }}>Platform growth and activity</h2>
                  <p style={{ margin: "5px 0 0", color: "#728097", fontSize: 13 }}>
                    Monthly counts from timestamped school records, approved membership records, and
                    platform audit events. Historical records without timestamps are not inferred.
                  </p>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(["schools", "teachers", "students", "activity"] as ChartMetric[]).map(
                    (metric) => (
                      <button
                        key={metric}
                        type="button"
                        style={{
                          ...button,
                          background: chartMetric === metric ? "#253e89" : "#fff",
                          color: chartMetric === metric ? "#fff" : "#34425a",
                        }}
                        onClick={() => setChartMetric(metric)}
                      >
                        {chartTitles[metric]}
                      </button>
                    ),
                  )}
                </div>
              </div>
              {!analytics.length || !chartAvailable ? (
                <p style={{ padding: 24, color: "#728097" }}>
                  Trend unavailable: the API has no complete timestamp-backed records for this
                  metric, or the configured record cap was reached.
                </p>
              ) : (
                <div
                  role="img"
                  aria-label={`${chartTitles[chartMetric]} by month for the last six months`}
                  style={{
                    display: "flex",
                    alignItems: "stretch",
                    gap: 10,
                    height: 210,
                    marginTop: 24,
                    padding: "0 8px",
                  }}
                >
                  {analytics.map((point) => {
                    const value = point[chartMetric];
                    return (
                      <div
                        key={point.month}
                        style={{
                          flex: 1,
                          minWidth: 28,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "end",
                          gap: 7,
                        }}
                      >
                        <strong
                          style={{ fontSize: 12, color: value === null ? "#a0a8b5" : "#35445b" }}
                        >
                          {value === null ? "—" : value}
                        </strong>
                        <div
                          title={`${point.label}: ${value === null ? "Unavailable" : value}`}
                          style={{
                            width: "min(42px, 80%)",
                            height: `${value === null ? 2 : Math.max(4, (value / chartMax) * 150)}px`,
                            background:
                              value === null
                                ? "#e6e9ef"
                                : "linear-gradient(180deg,#667fe3,#344fae)",
                            borderRadius: "7px 7px 2px 2px",
                          }}
                        />
                        <span style={{ fontSize: 12, color: "#748197" }}>{point.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <section style={panel}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 16,
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>School directory</h2>
                <p style={{ color: "#728097", fontSize: 13, margin: "5px 0 0" }}>
                  Search, inspect, and manage registered schools.
                </p>
              </div>
              <Link
                className="btn-primary"
                href="/system-owner/schools/new"
                style={{
                  cursor: "pointer",
                  padding: "10px 14px",
                  border: 0,
                  borderRadius: 9,
                  textDecoration: "none",
                }}
              >
                + Register a school
              </Link>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
              <label style={{ position: "relative", flex: "1 1 260px" }}>
                <Search
                  size={15}
                  style={{ position: "absolute", left: 11, top: 12, color: "#8491a4" }}
                />
                <input
                  aria-label="Search schools"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                  placeholder="Search name, code, or principal"
                  style={{ ...input, paddingLeft: 34 }}
                />
              </label>
              <select
                aria-label="Filter schools by status"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(0);
                }}
                style={{ ...input, width: "auto", minWidth: 150 }}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="setup_pending">Setup pending</option>
                <option value="archived">Archived</option>
                <option value="deletion_pending">Deletion pending</option>
              </select>
              <button
                style={button}
                onClick={() => setSort((value) => (value === "name" ? "created" : "name"))}
              >
                <ArrowDownUp size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                Sort: {sort === "name" ? "Name" : "Recent"}
              </button>
            </div>
            {loading ? (
              <div style={{ padding: 28, color: "#718096" }}>Loading live school records…</div>
            ) : !pageRows.length ? (
              <div style={{ textAlign: "center", padding: 42, color: "#718096" }}>
                <Building2 size={28} />
                <p>No schools match this search or filter.</p>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: 920,
                    textAlign: "left",
                  }}
                >
                  <thead>
                    <tr
                      style={{ color: "#778499", fontSize: 12, borderBottom: "1px solid #e8edf3" }}
                    >
                      {[
                        "School",
                        "School code",
                        "Principal",
                        "Teachers",
                        "Students",
                        "Status",
                        "Actions",
                      ].map((label) => (
                        <th key={label} style={{ padding: "11px 9px", fontWeight: 600 }}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((school) => (
                      <tr key={school.id} style={{ borderBottom: "1px solid #eef1f5" }}>
                        <td style={{ padding: 12 }}>
                          <button
                            onClick={() => setSelected(school)}
                            style={{
                              border: 0,
                              background: "none",
                              cursor: "pointer",
                              padding: 0,
                              textAlign: "left",
                              color: "#23365f",
                              fontWeight: 700,
                            }}
                          >
                            {school.name}
                          </button>
                          <div style={{ fontSize: 11, color: "#8792a3", marginTop: 3 }}>
                            {school.district ||
                              school.province ||
                              school.schoolType ||
                              "School profile"}
                          </div>
                        </td>
                        <td>{school.schoolCode ?? school.slug ?? "—"}</td>
                        <td>
                          {school.principal ? (
                            <>
                              <div>{school.principal.name}</div>
                              <small style={{ color: "#7d899a" }}>{school.principal.email}</small>
                            </>
                          ) : (
                            <span style={{ color: "#8792a3" }}>Not assigned</span>
                          )}
                        </td>
                        <td>{school.teacherCount ?? "—"}</td>
                        <td>{school.studentCount ?? "—"}</td>
                        <td>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "5px 9px",
                              borderRadius: 20,
                              background:
                                school.status === "suspended"
                                  ? "#fff0ed"
                                  : school.status === "setup_pending"
                                    ? "#fff7e7"
                                    : "#eaf7ef",
                              color:
                                school.status === "suspended"
                                  ? "#a54236"
                                  : school.status === "setup_pending"
                                    ? "#8e6722"
                                    : "#28704a",
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {statusLabel(school.status)}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button style={button} onClick={() => setSelected(school)}>
                              View
                            </button>
                            <Link
                              href={`/system-owner/schools/${encodeURIComponent(school.id)}`}
                              style={button}
                            >
                              Manage
                            </Link>
                            <button
                              style={{
                                ...button,
                                color: school.status === "suspended" ? "#28704a" : "#a54236",
                              }}
                              disabled={
                                school.status === "archived" || school.status === "deletion_pending"
                              }
                              onClick={() => void setSchoolStatus(school)}
                            >
                              {school.status === "suspended" ? "Reactivate" : "Suspend"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <footer
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 14,
                color: "#7c899c",
                fontSize: 12,
              }}
            >
              <span>
                {filtered.length
                  ? `Showing ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, filtered.length)} of ${filtered.length} loaded school records`
                  : "No records"}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  aria-label="Previous page"
                  style={button}
                  disabled={!page}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft size={14} />
                </button>
                <span style={{ padding: 9 }}>
                  {page + 1} / {pageCount}
                </span>
                <button
                  aria-label="Next page"
                  style={button}
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </footer>
          </section>
        </>
      )}

      {tab === "principals" && (
        <section style={panel}>
          <h2 style={{ marginTop: 0 }}>Principal directory</h2>
          <p style={{ color: "#728097", marginTop: -6 }}>
            School-level administrators and their assigned schools.
          </p>
          {!schools.some((school) => school.principal) ? (
            <p style={{ padding: 24, color: "#7b8799" }}>
              No principal memberships are recorded for the loaded schools.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr>
                    <th style={{ padding: 10 }}>Principal</th>
                    <th>School</th>
                    <th>School status</th>
                    <th>Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {schools
                    .filter((school) => school.principal)
                    .map((school) => (
                      <tr key={school.id} style={{ borderTop: "1px solid #edf0f5" }}>
                        <td style={{ padding: 12 }}>{school.principal?.name}</td>
                        <td>{school.name}</td>
                        <td>{statusLabel(school.status)}</td>
                        <td>{school.principal?.email || "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "audit" && (
        <section style={panel}>
          <h2 style={{ marginTop: 0 }}>Platform audit log</h2>
          <p style={{ color: "#728097", marginTop: -6 }}>
            Latest sensitive platform administration events.
          </p>
          {!audit.length ? (
            <p style={{ padding: 24, color: "#7b8799" }}>
              No platform activity has been recorded yet.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr>
                    <th style={{ padding: 10 }}>Event</th>
                    <th>School ID</th>
                    <th>Actor UID</th>
                    <th>Outcome</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((event) => (
                    <tr key={event.id} style={{ borderTop: "1px solid #edf0f5" }}>
                      <td style={{ padding: 12 }}>
                        {(event.action ?? "Platform event").replaceAll(".", " ")}
                      </td>
                      <td>{event.schoolId ?? "—"}</td>
                      <td>{event.actorUid ?? "—"}</td>
                      <td>{event.outcome ?? "Recorded"}</td>
                      <td>{dateLabel(event.occurredAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {selected && (
        <div
          role="presentation"
          onClick={() => setSelected(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,27,48,.4)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 50,
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="school-detail-title"
            onClick={(event) => event.stopPropagation()}
            style={{
              ...panel,
              width: "min(640px, 100%)",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: 24,
            }}
          >
            <header
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "start",
                gap: 14,
              }}
            >
              <div>
                <div style={{ color: "#6c7b91", fontSize: 12, fontWeight: 700 }}>
                  SCHOOL PROFILE
                </div>
                <h2 id="school-detail-title" style={{ margin: "6px 0" }}>
                  {selected.name}
                </h2>
                <p style={{ margin: 0, color: "#718096" }}>
                  {selected.schoolCode ?? selected.slug ?? "No school code"} ·{" "}
                  {statusLabel(selected.status)}
                </p>
              </div>
              <button
                aria-label="Close school details"
                style={button}
                onClick={() => setSelected(null)}
              >
                <X size={16} />
              </button>
            </header>
            <section
              style={{
                background: "#fff7e5",
                border: "1px solid #ead6a4",
                borderRadius: 12,
                padding: 16,
                marginTop: 18,
              }}
            >
              <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>
                Enter school in System Owner support mode
              </h3>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "#6b5730" }}>
                Grants full school-administrator read/write access for up to one hour. Requires
                reauthentication within 10 minutes. Your actions remain attributed to your System
                Owner account and the session is audit logged. Not available for non-active, locked,
                or deletion-pending schools.
              </p>
              <div style={{ display: "grid", gap: 9 }}>
                <input
                  aria-label="System Owner email for reauthentication"
                  autoComplete="username"
                  type="email"
                  placeholder="System Owner email"
                  value={supportEmail}
                  onChange={(event) => setSupportEmail(event.target.value)}
                  style={input}
                />
                <input
                  aria-label="System Owner password for reauthentication"
                  autoComplete="current-password"
                  type="password"
                  placeholder="Re-enter System Owner password"
                  value={supportPassword}
                  onChange={(event) => setSupportPassword(event.target.value)}
                  style={input}
                />
                <textarea
                  aria-label="Support reason"
                  minLength={10}
                  maxLength={500}
                  placeholder="Reason for support access (10–500 characters)"
                  value={supportReason}
                  onChange={(event) => setSupportReason(event.target.value)}
                  style={{ ...input, minHeight: 82, resize: "vertical" }}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      selected.status !== "active" ||
                      !supportEmail.trim() ||
                      !supportPassword ||
                      supportReason.trim().length < 10
                    }
                    onClick={() => void enterSupportMode(selected, "password")}
                    style={{
                      ...button,
                      background: "#253e89",
                      color: "white",
                      borderColor: "#253e89",
                    }}
                  >
                    {busy ? "Verifying and entering…" : `Enter ${selected.name} with password`}
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy || selected.status !== "active" || supportReason.trim().length < 10
                    }
                    onClick={() => void enterSupportMode(selected, "google")}
                    style={{ ...button, color: "#253e89" }}
                  >
                    Continue with Google
                  </button>
                </div>
                <small style={{ color: "#6b7280" }}>
                  Use the Google account authorized as this System Owner. We never request a school
                  user&apos;s password.
                </small>
              </div>
            </section>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                gap: 12,
                margin: "22px 0",
              }}
            >
              {[
                ["Principal", selected.principal?.name ?? "Not assigned"],
                ["Principal email", selected.principal?.email ?? "—"],
                ["Teachers", selected.teacherCount ?? "Unavailable"],
                ["Students", selected.studentCount ?? "Unavailable"],
                ["Type", selected.schoolType ?? "Not recorded"],
                ["Created", dateLabel(selected.createdAt)],
                ["Email", selected.email ?? "—"],
                ["Phone", selected.phone ?? "—"],
                [
                  "District / province",
                  [selected.district, selected.province].filter(Boolean).join(" / ") || "—",
                ],
                ["Address", selected.address ?? "—"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  style={{ border: "1px solid #edf0f5", borderRadius: 10, padding: 12 }}
                >
                  <small style={{ display: "block", color: "#778499", marginBottom: 4 }}>
                    {label}
                  </small>
                  <strong style={{ fontSize: 13, fontWeight: 600 }}>{value}</strong>
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                borderTop: "1px solid #edf0f5",
                paddingTop: 16,
                gap: 10,
              }}
            >
              <label style={{ color: "#66758b", fontSize: 13 }}>
                Plan{" "}
                <select
                  aria-label="School plan"
                  value={selected.planId ?? "free"}
                  onChange={async (event) => {
                    const planId = event.target.value;
                    const ok = await mutate({ schoolId: selected.id, planId }, "PATCH");
                    if (ok) setSelected({ ...selected, planId });
                  }}
                  style={{ marginLeft: 7, ...input, width: "auto" }}
                >
                  <option value="free">Free</option>
                  <option value="standard">Standard</option>
                  <option value="premium">Premium</option>
                </select>
              </label>
              <button style={button} onClick={() => void setSchoolStatus(selected)}>
                {selected.status === "suspended" ? "Reactivate school" : "Suspend school"}
              </button>
            </div>
          </section>
        </div>
      )}
      <p style={{ color: "#8591a1", fontSize: 12, marginTop: 18 }}>
        Owner operations are authorized by the server and recorded in platform audit logs.
        Membership counts reflect active membership records.
      </p>
    </main>
  );
}
