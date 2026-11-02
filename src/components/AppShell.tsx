"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpenCheck,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Users,
  X,
  Settings2,
  ContactRound,
  BriefcaseBusiness,
  ClipboardCheck,
  ClipboardList,
  ChartNoAxesCombined,
  FileText,
  CalendarDays,
  NotebookPen,
  CircleDollarSign,
  LibraryBig,
  BusFront,
  Boxes,
  Megaphone,
  HeartHandshake,
  UserRound,
  ShieldAlert,
  CalendarRange,
  LineChart,
  Layers3,
  FolderLock,
  BellRing,
  ArrowUpRight,
  Sparkles,
  Network,
  ChevronDown,
} from "lucide-react";
import { endServerSession, fetchCsrfToken } from "@/lib/firebase/session-client";
import { GlobalSearch } from "@/features/search/GlobalSearch";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SchoolSwitcher } from "@/components/SchoolSwitcher";
import { useI18n } from "@/lib/i18n/useI18n";
import type { messages } from "@/lib/i18n/messages";
import { hasPermission } from "@/server/permissions";

const nav = [
  { href: "/dashboard", labelKey: "nav.overview", icon: LayoutDashboard },
  { href: "/students", labelKey: "nav.students", icon: Users, permissions: ["students.read"] },
  {
    href: "/memberships",
    labelKey: "nav.memberships",
    icon: Users,
    permissions: ["memberships.read"],
  },
  {
    href: "/administration",
    labelKey: "nav.administration",
    icon: Settings2,
    permissions: ["school.manage"],
  },
  {
    href: "/role-access",
    labelKey: "nav.roleAccess",
    icon: ShieldCheck,
    roles: ["school_owner", "school_admin", "principal"],
  },
  {
    href: "/guardians",
    labelKey: "nav.guardians",
    icon: ContactRound,
    permissions: ["guardians.read", "students.linked.read"],
  },
  {
    href: "/workforce",
    labelKey: "nav.staff",
    icon: BriefcaseBusiness,
    permissions: ["teachers.manage", "staff.manage"],
  },
  {
    href: "/teacher",
    labelKey: "nav.teacher",
    icon: BookOpenCheck,
    permissions: ["teachers.self.read", "teachers.read"],
  },
  {
    href: "/attendance",
    labelKey: "nav.attendance",
    icon: ClipboardCheck,
    permissions: [
      "attendance.read",
      "attendance.mark",
      "attendance.read.assigned",
      "attendance.mark.assigned",
      "attendance.correct",
    ],
  },
  {
    href: "/exams",
    labelKey: "nav.exams",
    icon: ClipboardList,
    permissions: [
      "exams.read",
      "exams.read.assigned",
      "exams.manage",
      "marks.enter",
      "marks.enter.assigned",
      "exams.approve",
    ],
  },
  {
    href: "/results",
    labelKey: "nav.results",
    icon: ChartNoAxesCombined,
    permissions: [
      "exams.read",
      "exams.read.assigned",
      "marks.enter.assigned",
      "exams.manage",
      "reports.read",
      "results.published.self.read",
      "results.published.linked.read",
    ],
  },
  {
    href: "/reports",
    labelKey: "nav.reports",
    icon: FileText,
    permissions: [
      "reports.read",
      "exams.read",
      "exams.read.assigned",
      "marks.enter.assigned",
      "exams.manage",
      "results.published.self.read",
      "results.published.linked.read",
    ],
  },
  {
    href: "/timetable",
    labelKey: "nav.timetable",
    icon: CalendarDays,
    permissions: ["academics.read", "academics.manage", "teachers.self.read"],
  },
  {
    href: "/assignments",
    labelKey: "nav.assignments",
    icon: NotebookPen,
    permissions: [
      "assignments.manage",
      "assignments.manage.assigned",
      "assignments.read",
      "assignments.self.read",
      "assignments.linked.read",
    ],
  },
  {
    href: "/finance",
    labelKey: "nav.finance",
    icon: CircleDollarSign,
    permissions: ["finance.read"],
  },
  {
    href: "/library",
    labelKey: "nav.library",
    icon: LibraryBig,
    permissions: ["library.manage", "library.reports.read"],
  },
  {
    href: "/transport",
    labelKey: "nav.transport",
    icon: BusFront,
    permissions: ["transport.manage", "transport.read"],
  },
  {
    href: "/inventory",
    labelKey: "nav.inventory",
    icon: Boxes,
    permissions: ["inventory.read", "inventory.manage", "inventory.reports.read"],
  },
  {
    href: "/communication",
    labelKey: "nav.communication",
    icon: Megaphone,
    permissions: ["announcements.manage", "announcements.create", "announcements.targeted.read"],
  },
  {
    href: "/parent-portal",
    labelKey: "nav.parent",
    icon: HeartHandshake,
    permissions: ["students.linked.read"],
  },
  {
    href: "/student-portal",
    labelKey: "nav.student",
    icon: UserRound,
    permissions: ["profile.self.read"],
  },
  {
    href: "/welfare",
    labelKey: "nav.welfare",
    icon: ShieldAlert,
    permissions: ["welfare.read", "welfare.manage"],
  },
  {
    href: "/events",
    labelKey: "nav.events",
    icon: CalendarRange,
    permissions: ["events.read", "events.manage"],
  },
  {
    href: "/reports/analytics",
    labelKey: "nav.analytics",
    icon: LineChart,
    permissions: ["analytics.read", "reports.read"],
  },
  { href: "/bulk-operations", labelKey: "nav.bulk", icon: Layers3, permissions: ["bulk.manage"] },
  {
    href: "/documents",
    labelKey: "nav.documents",
    icon: FolderLock,
    permissions: ["documents.read"],
  },
  {
    href: "/notifications",
    labelKey: "nav.notifications",
    icon: BellRing,
    permissions: ["notifications.read"],
  },
  {
    href: "/promotion",
    labelKey: "nav.promotion",
    icon: ArrowUpRight,
    permissions: ["promotion.manage"],
  },
  {
    href: "/certificates",
    labelKey: "nav.certificates",
    icon: FileText,
    permissions: ["certificate.read", "certificate.manage", "certificate.approve"],
  },
  { href: "/audit", labelKey: "nav.audit", icon: ShieldCheck, permissions: ["audit.read"] },
  {
    href: "/backups",
    labelKey: "nav.backups",
    icon: FolderLock,
    permissions: ["backups.read", "backups.manage"],
  },
  { href: "/ai-assistant", labelKey: "nav.ai", icon: Sparkles, permissions: ["ai.assistant"] },
  {
    href: "/integration",
    labelKey: "nav.integration",
    icon: Network,
    permissions: ["integration.read"],
  },
  {
    href: "/settings",
    labelKey: "nav.settings",
    icon: Settings2,
    permissions: ["settings.manage"],
  },
];

const navigationGroups = [
  {
    id: "people",
    labelKey: "shell.group.people",
    icon: Users,
    hrefs: ["/students", "/memberships", "/role-access", "/guardians", "/workforce", "/teacher"],
  },
  {
    id: "academics",
    labelKey: "shell.group.academics",
    icon: BookOpenCheck,
    hrefs: [
      "/attendance",
      "/exams",
      "/results",
      "/reports",
      "/timetable",
      "/assignments",
      "/certificates",
      "/promotion",
    ],
  },
  {
    id: "operations",
    labelKey: "shell.group.operations",
    icon: Boxes,
    hrefs: ["/finance", "/library", "/transport", "/inventory", "/bulk-operations", "/documents"],
  },
  {
    id: "community",
    labelKey: "shell.group.community",
    icon: HeartHandshake,
    hrefs: [
      "/communication",
      "/parent-portal",
      "/student-portal",
      "/welfare",
      "/events",
      "/notifications",
    ],
  },
  {
    id: "admin",
    labelKey: "shell.group.admin",
    icon: Settings2,
    hrefs: [
      "/administration",
      "/reports/analytics",
      "/audit",
      "/backups",
      "/ai-assistant",
      "/integration",
      "/settings",
    ],
  },
] as const;

const DEFAULT_SIDEBAR_WIDTH = 272;
const MIN_SIDEBAR_WIDTH = 232;
const MAX_SIDEBAR_WIDTH = 380;
const SIDEBAR_WIDTH_STORAGE_KEY = "e-school-sidebar-width";

export function AppShell({
  children,
  schoolName,
  userName,
  role,
  permissions = [],
}: {
  children: React.ReactNode;
  schoolName: string;
  userName: string;
  role: string;
  permissions?: readonly string[];
}) {
  const pathname = usePathname();
  const canView = (required?: readonly string[]) =>
    !required || required.some((permission) => hasPermission(permissions, permission));
  const visibleNav = nav.filter((item) => canView(item.permissions) && (!("roles" in item) || (item.roles ?? []).includes(role)));
  const visibleGroups = navigationGroups
    .map((group) => ({
      ...group,
      hrefs: group.hrefs.filter((href) => visibleNav.some((item) => item.href === href)),
    }))
    .filter((group) => group.hrefs.length > 0);
  const activeNavHref = [...visibleNav]
    .filter(({ href }) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const router = useRouter();
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      visibleGroups.map((group) => [group.id, group.hrefs.some((href) => href === activeNavHref)]),
    ),
  );
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const sidebarRef = useRef<HTMLElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);

  const activeGroupId = visibleGroups.find((group) =>
    group.hrefs.some((href) => href === activeNavHref),
  )?.id;

  useEffect(() => {
    if (activeGroupId) setOpenGroups((current) => ({ ...current, [activeGroupId]: true }));
  }, [activeGroupId]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  useEffect(() => {
    let active = true;
    let lastBeat = 0;
    let csrfToken = "";
    const beat = async () => {
      if (document.visibilityState !== "visible" || Date.now() - lastBeat < 25_000) return;
      lastBeat = Date.now();
      try {
        csrfToken = csrfToken || await fetchCsrfToken();
        if (active) await fetch("/api/presence", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify({ action: "online" }) });
      } catch { /* Presence is best-effort; app access must not depend on it. */ }
    };
    const goOffline = () => {
      if (!csrfToken) return;
      void fetch("/api/presence", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify({ action: "offline" }) });
    };
    void beat();
    const timer = window.setInterval(() => void beat(), 10_000);
    window.addEventListener("pagehide", goOffline);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("pagehide", goOffline); };
  }, []);

  useEffect(() => {
    const storedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    if (Number.isFinite(storedWidth))
      setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, storedWidth)));
  }, []);

  function updateSidebarWidth(nextWidth: number) {
    const width = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, nextWidth));
    setSidebarWidth(width);
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  }

  function resizeSidebar(event: React.PointerEvent<HTMLButtonElement>) {
    if (window.matchMedia("(max-width: 760px)").matches) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (moveEvent: PointerEvent) => updateSidebarWidth(moveEvent.clientX);
    const finish = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  }

  function resizeSidebarWithKeyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      updateSidebarWidth(sidebarWidth - 8);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      updateSidebarWidth(sidebarWidth + 8);
    } else if (event.key === "Home") {
      event.preventDefault();
      updateSidebarWidth(MIN_SIDEBAR_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      updateSidebarWidth(MAX_SIDEBAR_WIDTH);
    }
  }

  useEffect(() => {
    const workspace = workspaceRef.current;
    const sidebar = sidebarRef.current;
    if (!workspace || !sidebar) return;
    const workspaceElement = workspace;
    const sidebarElement = sidebar;

    function transferWheelAtWorkspaceEdge(event: WheelEvent) {
      if (window.matchMedia("(max-width: 760px)").matches) return;

      const atBottom =
        workspaceElement.scrollTop + workspaceElement.clientHeight >=
        workspaceElement.scrollHeight - 1;
      const atTop = workspaceElement.scrollTop <= 0;
      const scrollingSidebarDown = event.deltaY > 0 && atBottom;
      const scrollingSidebarUp = event.deltaY < 0 && atTop;

      if (!scrollingSidebarDown && !scrollingSidebarUp) return;

      const previousScrollTop = sidebarElement.scrollTop;
      sidebarElement.scrollTop += event.deltaY;
      if (sidebarElement.scrollTop !== previousScrollTop) event.preventDefault();
    }

    workspace.addEventListener("wheel", transferWheelAtWorkspaceEdge, { passive: false });
    return () => workspace.removeEventListener("wheel", transferWheelAtWorkspaceEdge);
  }, []);
  async function logout() {
    await endServerSession();
    router.replace("/");
  }

  function renderNavigation(prefix: string, closeOnNavigate = false) {
    return (
      <div className="sidebar-nav">
        <Link
          onClick={closeOnNavigate ? () => setMenuOpen(false) : undefined}
          aria-current={activeNavHref === "/dashboard" ? "page" : undefined}
          className={`nav-link overview-link ${activeNavHref === "/dashboard" ? "active" : ""}`}
          href="/dashboard"
        >
          <LayoutDashboard size={16} />
          {t("nav.overview")}
        </Link>
        {visibleGroups.map((group) => {
          const GroupIcon = group.icon;
          const groupOpen = Boolean(openGroups[group.id]);
          const groupHasCurrent = group.hrefs.some((href) => href === activeNavHref);
          const groupMenuId = `${prefix}-nav-group-${group.id}`;
          return (
            <section
              className={`nav-group nav-group-${group.id} ${groupHasCurrent ? "has-current" : ""}`}
              key={group.id}
            >
              <button
                type="button"
                className={`nav-group-trigger ${groupOpen ? "expanded" : ""}`}
                aria-expanded={groupOpen}
                aria-controls={groupMenuId}
                onClick={() =>
                  setOpenGroups((current) => ({ ...current, [group.id]: !current[group.id] }))
                }
              >
                <GroupIcon size={16} aria-hidden="true" />
                <span className="nav-group-name">
                  {t(group.labelKey as keyof typeof messages.en)}
                </span>
                <span className="nav-group-count" aria-hidden="true">
                  {group.hrefs.length}
                </span>
                <ChevronDown size={15} className="nav-group-chevron" aria-hidden="true" />
              </button>
              <div className="nav-group-items" id={groupMenuId} hidden={!groupOpen}>
                {group.hrefs.map((href) => {
                  const item = visibleNav.find((entry) => entry.href === href);
                  if (!item) return null;
                  const Icon = item.icon;
                  const current = activeNavHref === href;
                  return (
                    <Link
                      key={href}
                      onClick={closeOnNavigate ? () => setMenuOpen(false) : undefined}
                      aria-current={current ? "page" : undefined}
                      className={`nav-link ${current ? "active" : ""}`}
                      href={href}
                    >
                      <Icon size={16} />
                      {t(item.labelKey as keyof typeof messages.en)}
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="app-frame"
      style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <aside ref={sidebarRef} className="sidebar">
        <div className="sidebar-identity">
          <SchoolSwitcher schoolName={schoolName} />
        </div>
        <div className="nav-label">{t("shell.workspace")}</div>
        <nav aria-label="Main navigation">{renderNavigation("desktop")}</nav>
        <div className="side-bottom">
          <div className="nav-list">
            <div className="nav-link" style={{ cursor: "default" }}>
              <ShieldCheck size={15} />
              {t("shell.roleScoped")}
            </div>
            <button
              className="nav-link"
              onClick={logout}
              style={{ width: "100%", border: 0, background: "transparent", textAlign: "left" }}
            >
              <LogOut size={15} />
              {t("shell.signOut")}
            </button>
          </div>
        </div>
        <button
          className="sidebar-resizer"
          type="button"
          role="separator"
          aria-label="Resize navigation sidebar"
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={sidebarWidth}
          title="Drag to resize sidebar"
          onPointerDown={resizeSidebar}
          onKeyDown={resizeSidebarWithKeyboard}
          onDoubleClick={() => updateSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
        />
      </aside>
      <section ref={workspaceRef} className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label={menuOpen ? t("shell.closeNavigation") : t("shell.openNavigation")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={17} /> : <Menu size={17} />}
          </button>
          {menuOpen && (
            <nav className="mobile-nav" aria-label="Mobile navigation">
              <SchoolSwitcher schoolName={schoolName} />
              {renderNavigation("mobile", true)}
              <button
                className="nav-link"
                onClick={logout}
                style={{ width: "100%", border: 0, background: "transparent", textAlign: "left" }}
              >
                <LogOut size={15} />
                {t("shell.signOut")}
              </button>
            </nav>
          )}
          <GlobalSearch role={role} />
          <div className="top-actions">
            <LanguageSwitcher />
            <NotificationBell />
            <div className="profile-chip">
              <div className="avatar">{userName.slice(0, 1).toUpperCase()}</div>
              <div>
                <div className="profile-name">{userName}</div>
                <div className="profile-role">{role.replaceAll("_", " ")}</div>
              </div>
            </div>
            <button
              className="icon-button"
              aria-label={t("shell.signOut")}
              title={t("shell.signOut")}
              onClick={logout}
            >
              <LogOut size={15} />
            </button>
          </div>
        </header>
        {children}
      </section>
    </div>
  );
}
