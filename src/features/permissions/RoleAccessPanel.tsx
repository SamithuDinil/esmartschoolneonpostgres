"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, LockKeyhole, Search, ShieldCheck, Undo2 } from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";
import styles from "./RoleAccessPanel.module.css";

type AccessData = {
  roles: string[];
  catalog: string[];
  defaults: Record<string, string[]>;
  overrides: Record<string, string[]>;
};

const roleTitles: Record<string, string> = {
  school_admin: "School admin",
  principal: "Principal",
  vice_principal: "Vice principal",
  section_head: "Section head",
  teacher: "Teacher",
  class_teacher: "Class teacher",
  subject_teacher: "Subject teacher",
  student: "Student",
  parent: "Parent / guardian",
  accountant: "Accountant",
  librarian: "Librarian",
  transport_manager: "Transport manager",
  administrative_staff: "Administrative staff",
  staff: "Staff",
};

const roleDescriptions: Record<string, string> = {
  school_admin: "School-wide settings and daily operations",
  principal: "School-wide leadership and oversight",
  vice_principal: "Academic and staff support",
  section_head: "Teaching and learning for a section",
  teacher: "Teaching, classes and student support",
  class_teacher: "Class-level teaching responsibilities",
  subject_teacher: "Subject teaching responsibilities",
  student: "Personal learning and school information",
  parent: "Updates for linked students",
  accountant: "Fees and financial operations",
  librarian: "Books, loans and library reports",
  transport_manager: "Routes, vehicles and transport",
  administrative_staff: "Office and student administration",
  staff: "Basic staff access",
};

const categoryTitles: Record<string, string> = {
  ai: "AI assistant",
  announcements: "Announcements",
  analytics: "Analytics & insights",
  assignments: "Assignments",
  attendance: "Attendance",
  audit: "Audit history",
  backups: "Backups & recovery",
  bulk: "Bulk operations",
  certificate: "Certificates",
  documents: "Documents",
  events: "Events & calendar",
  exams: "Examinations",
  fees: "Fees",
  finance: "Finance",
  integration: "Integrations",
  leave: "Leave requests",
  library: "Library",
  marks: "Marks & results",
  memberships: "Users & access",
  messages: "Messages",
  notifications: "Notifications",
  promotion: "Student promotion",
  reports: "Reports",
  school: "School settings",
  search: "Search",
  staff: "Staff records",
  students: "Students",
  teachers: "Teachers",
  timetable: "Timetable",
  transport: "Transport",
  welfare: "Student welfare",
};

const actionWords: Record<string, string> = {
  read: "View",
  manage: "Manage",
  create: "Create",
  update: "Edit",
  write: "Edit",
  delete: "Remove",
  approve: "Approve",
  enter: "Enter",
  mark: "Mark",
  request: "Request",
  issue: "Issue",
};

const resourceWords: Record<string, string> = {
  ai: "AI assistant",
  announcements: "announcements",
  assignments: "assignments",
  attendance: "attendance",
  audit: "audit history",
  backups: "backups",
  bulk: "bulk updates",
  certificate: "certificates",
  documents: "documents",
  events: "events",
  exams: "examinations",
  fees: "fees",
  finance: "finance",
  integration: "integrations",
  leave: "leave",
  library: "library",
  marks: "marks",
  memberships: "user accounts",
  messages: "messages",
  notifications: "notifications",
  promotion: "student promotion",
  reports: "reports",
  school: "school settings",
  search: "school-wide search",
  staff: "staff records",
  students: "student records",
  teachers: "teacher records",
  timetable: "timetable",
  transport: "transport",
  welfare: "student welfare",
  analytics: "analytics",
};

const qualifierWords: Record<string, string> = {
  assigned: "assigned",
  linked: "linked",
  published: "published",
  targeted: "targeted",
  global: "school-wide",
  self: "your own",
};

function featureTitle(permission: string) {
  const parts = permission.split(".");
  const subject = parts[0];
  const actionIndex = parts.findIndex((part) => part in actionWords);
  if (actionIndex < 0) return permission.replaceAll(".", " ").replaceAll("_", " ");
  const action = actionWords[parts[actionIndex]];
  const qualifiers = parts
    .slice(1)
    .filter((part, index) => index + 1 !== actionIndex)
    .map((part) => qualifierWords[part] ?? part.replaceAll("_", " "));
  const resource = subject === "finance" && parts.includes("expenses")
    ? "expenses"
    : resourceWords[subject] ?? subject.replaceAll("_", " ");
  const scope = qualifiers.join(" ");
  if (action === "Mark" && subject === "attendance") return scope ? `Mark attendance for ${scope} classes` : "Mark attendance";
  if (subject === "school" && parts.includes("manage")) return "Manage school settings";
  return `${action} ${[scope, resource].filter(Boolean).join(" ")}`;
}

export function RoleAccessPanel() {
  const [data, setData] = useState<AccessData | null>(null);
  const [role, setRole] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [roleSearch, setRoleSearch] = useState("");
  const [featureSearch, setFeatureSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<string[]>([]);

  const load = useCallback(async () => {
    const response = await fetch("/api/role-permissions", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Role access could not be loaded.");
    setData(body);
    setRole((current) => current || body.roles[0] || "");
  }, []);

  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Role access could not be loaded."));
  }, [load]);

  useEffect(() => {
    if (!data || !role) return;
    const grants = data.overrides[role] ?? data.defaults[role] ?? [];
    setChecked(grants);
    const categoryCounts = new Map<string, number>();
    grants.forEach((permission) => {
      const category = permission.split(".")[0];
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    });
    const firstCategory = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    setOpenGroups(firstCategory ? [firstCategory] : []);
    setFeatureSearch("");
  }, [data, role]);

  const groups = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const permission of data?.catalog ?? []) {
      const category = permission.split(".")[0];
      grouped.set(category, [...(grouped.get(category) ?? []), permission]);
    }
    return [...grouped.entries()].sort(([a], [b]) => (categoryTitles[a] ?? a).localeCompare(categoryTitles[b] ?? b));
  }, [data]);

  const filteredRoles = useMemo(() => (data?.roles ?? []).filter((item) => {
    const title = roleTitles[item] ?? item.replaceAll("_", " ");
    return `${title} ${roleDescriptions[item] ?? ""}`.toLowerCase().includes(roleSearch.toLowerCase());
  }), [data, roleSearch]);

  const dirty = useMemo(() => {
    if (!data || !role) return false;
    const baseline = data.overrides[role] ?? data.defaults[role] ?? [];
    return [...checked].sort().join("|") !== [...baseline].sort().join("|");
  }, [checked, data, role]);

  const enabledCount = checked.length;
  const totalCount = data?.catalog.length ?? 0;
  const progress = totalCount ? Math.round((enabledCount / totalCount) * 100) : 0;
  const visibleGroups = groups.map(([category, permissions]) => {
    const filtered = featureSearch.trim()
      ? permissions.filter((permission) => `${featureTitle(permission)} ${permission} ${categoryTitles[category] ?? category}`.toLowerCase().includes(featureSearch.toLowerCase()))
      : permissions;
    return [category, filtered] as const;
  }).filter(([, permissions]) => permissions.length > 0);

  function chooseRole(nextRole: string) {
    if (nextRole === role) return;
    if (dirty && !window.confirm("Discard your unsaved changes and switch roles?")) return;
    setRole(nextRole);
  }

  function toggleCategory(permissions: string[]) {
    const allEnabled = permissions.every((permission) => checked.includes(permission));
    setChecked((current) => allEnabled
      ? current.filter((permission) => !permissions.includes(permission))
      : [...new Set([...current, ...permissions])]);
  }

  async function save() {
    if (!role || !dirty) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/role-permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ role, permissions: checked }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Role access could not be saved.");
      setData((current) => current ? { ...current, overrides: { ...current.overrides, [role]: checked } } : current);
      setNotice(`Access saved for ${roleTitles[role] ?? role}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Role access could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <main className="page-content">{error ? <div className="login-error" role="alert">{error}</div> : <section className="panel"><p>Loading role access…</p></section>}</main>;
  }

  return (
    <main className={`page-content ${styles.page}`}>
      <header className={styles.hero}>
        <div className={styles.heroIcon}><ShieldCheck size={21} aria-hidden="true" /></div>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}>People & access</div>
          <h1>Role access</h1>
          <p>Decide which parts of EduSphere each school role can use.</p>
        </div>
        <div className={styles.protectedNote}><LockKeyhole size={15} aria-hidden="true" /><span>Ownership and platform controls stay protected</span></div>
      </header>

      {error && <div className="login-error" role="alert">{error}</div>}
      {notice && <div className="login-success" role="status">{notice}</div>}

      <div className={styles.layout}>
        <aside className={styles.rolePanel} aria-label="Choose a role">
          <div className={styles.rolePanelHeading}>
            <div><h2>School roles</h2><span>{data.roles.length} roles</span></div>
          </div>
          <label className={styles.search}>
            <Search size={15} aria-hidden="true" />
            <span className={styles.visuallyHidden}>Search roles</span>
            <input value={roleSearch} onChange={(event) => setRoleSearch(event.target.value)} placeholder="Find a role" />
          </label>
          <div className={styles.roleList}>
            {filteredRoles.map((item) => {
              const grants = data.overrides[item] ?? data.defaults[item] ?? [];
              const selected = item === role;
              return (
                <button key={item} type="button" className={`${styles.roleChoice} ${selected ? styles.roleChoiceSelected : ""}`} aria-pressed={selected} onClick={() => chooseRole(item)}>
                  <span className={styles.roleGlyph}><span>{(roleTitles[item] ?? item).slice(0, 1).toUpperCase()}</span></span>
                  <span className={styles.roleText}><strong>{roleTitles[item] ?? item.replaceAll("_", " ")}</strong><small>{roleDescriptions[item] ?? "School role access"}</small></span>
                  <span className={styles.roleCount}>{grants.length}</span>
                </button>
              );
            })}
            {!filteredRoles.length && <p className={styles.noRoles}>No matching roles.</p>}
          </div>
        </aside>

        <section className={styles.permissionPanel} aria-labelledby="selected-role-title">
          <div className={styles.permissionHeader}>
            <div>
              <div className={styles.roleKicker}>Permissions for</div>
              <h2 id="selected-role-title">{roleTitles[role] ?? role.replaceAll("_", " ")}</h2>
              <p>{roleDescriptions[role] ?? "Choose the features this role can access."}</p>
            </div>
            <button type="button" className={styles.defaultsButton} onClick={() => setChecked(data.defaults[role] ?? [])} disabled={!dirty || busy}>
              <Undo2 size={15} aria-hidden="true" /> Restore defaults
            </button>
          </div>

          <div className={styles.summary}>
            <div className={styles.summaryTop}><strong>{enabledCount} <span>of {totalCount} available features enabled</span></strong><span className={styles.summaryPercent}>{progress}%</span></div>
            <div className={styles.progressTrack} aria-label={`${progress}% of available features enabled`}><span style={{ width: `${progress}%` }} /></div>
            <p>{dirty ? "Unsaved changes" : "Current role access"} · Changes apply to everyone with this role.</p>
          </div>

          <label className={`${styles.search} ${styles.featureSearch}`}>
            <Search size={16} aria-hidden="true" />
            <span className={styles.visuallyHidden}>Search features</span>
            <input value={featureSearch} onChange={(event) => setFeatureSearch(event.target.value)} placeholder="Search features, e.g. attendance, reports…" />
            {featureSearch && <button type="button" className={styles.clearSearch} onClick={() => setFeatureSearch("")}>Clear</button>}
          </label>

          <div className={styles.categoryList}>
            {visibleGroups.map(([category, permissions]) => {
              const expanded = featureSearch ? true : openGroups.includes(category);
              const enabled = permissions.filter((permission) => checked.includes(permission)).length;
              const allEnabled = enabled === permissions.length;
              return (
                <section className={`${styles.category} ${expanded ? styles.categoryExpanded : ""}`} key={category}>
                  <button type="button" className={styles.categoryToggle} aria-expanded={expanded} aria-controls={`role-category-${category}`} onClick={() => setOpenGroups((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category])}>
                    <span className={styles.categoryName}><span className={`${styles.categoryCheck} ${allEnabled ? styles.categoryCheckOn : ""}`}>{allEnabled && <Check size={13} aria-hidden="true" />}</span><strong>{categoryTitles[category] ?? category.replaceAll("_", " ")}</strong></span>
                    <span className={styles.categoryMeta}>{enabled}/{permissions.length} on <ChevronDown size={16} aria-hidden="true" /></span>
                  </button>
                  {expanded && <div className={styles.featureList} id={`role-category-${category}`}>
                    <div className={styles.categoryActions}><span>Allow this role to:</span><button type="button" onClick={() => toggleCategory(permissions)}>{allEnabled ? "Turn all off" : "Turn all on"}</button></div>
                    {permissions.map((permission) => (
                      <label className={styles.featureRow} key={permission}>
                        <span className={`${styles.checkboxWrap} ${checked.includes(permission) ? styles.checkboxChecked : ""}`}><input type="checkbox" checked={checked.includes(permission)} onChange={(event) => setChecked((current) => event.target.checked ? [...new Set([...current, permission])] : current.filter((item) => item !== permission))} /><span aria-hidden="true">{checked.includes(permission) && <Check size={13} />}</span></span>
                        <span className={styles.featureText}><strong>{featureTitle(permission)}</strong></span>
                      </label>
                    ))}
                  </div>}
                </section>
              );
            })}
            {!visibleGroups.length && <div className={styles.emptySearch}><Search size={19} /><strong>No features found</strong><span>Try a different search term.</span></div>}
          </div>

          <footer className={styles.saveBar}>
            <div className={styles.saveStatus}>{dirty ? <><span className={styles.unsavedDot} />You have unsaved changes</> : <><span className={styles.savedIcon}><Check size={12} /></span>All changes saved</>}</div>
            <button type="button" className={styles.saveButton} disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Saving access…" : "Save changes"}</button>
          </footer>
        </section>
      </div>
    </main>
  );
}
