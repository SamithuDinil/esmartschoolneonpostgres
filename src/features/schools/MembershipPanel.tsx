"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Check, Copy, UserPlus, UsersRound } from "lucide-react";
import { fetchCsrfToken, reauthenticateForSensitiveAction } from "@/lib/firebase/session-client";

const roles = [
  "school_admin",
  "principal",
  "vice_principal",
  "section_head",
  "teacher",
  "accountant",
  "librarian",
  "transport_manager",
  "administrative_staff",
  "staff",
];
type Member = {
  uid: string;
  email: string | null;
  displayName: string;
  role: string;
  status: string;
  createdAt: string | null;
  lastActivityAt: string | null;
  permissions?: string[];
  isOwner?: boolean;
  isOnline?: boolean;
  classTeacherClasses?: string[];
};

export function MembershipPanel({ canManage, isOwner }: { canManage: boolean; isOwner: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("staff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [targetUid, setTargetUid] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [invitationUrl, setInvitationUrl] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, string[]>>({});
  const [permissionCatalog, setPermissionCatalog] = useState<string[]>([]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ q: query, role: roleFilter, status: statusFilter });
    const response = await fetch(`/api/memberships?${params.toString()}`, { cache: "no-store" });
    const data = (await response.json()) as {
      members?: Member[];
      error?: string;
      permissionCatalog?: { vice_principal?: string[] };
    };
    if (!response.ok) throw new Error(data.error ?? "Unable to load members.");
    setMembers(data.members ?? []);
    setPermissionDrafts(
      Object.fromEntries(
        (data.members ?? [])
          .filter((member) => member.role === "vice_principal")
          .map((member) => [member.uid, member.permissions ?? []]),
      ),
    );
    setPermissionCatalog(data.permissionCatalog?.vice_principal ?? []);
  }, [query, roleFilter, statusFilter]);
  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load members."));
    const timer = window.setInterval(() => void load().catch(() => undefined), 45_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    setCopyStatus("");
    setInvitationUrl("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/memberships", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ email, displayName, role }),
      });
      const data = (await response.json()) as { error?: string; invitationUrl?: string };
      if (!response.ok) throw new Error(data.error ?? "Invite failed.");
      setEmail("");
      setDisplayName("");
      setRole("staff");
      setInvitationUrl(data.invitationUrl ?? "");
      setNotice(
        "Secure invitation created. Copy the link or deliver it through the configured email provider.",
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Membership could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function update(uid: string, status: string) {
    const member = members.find((item) => item.uid === uid);
    if (
      ["suspended", "revoked"].includes(status) &&
      !window.confirm(
        `${status === "revoked" ? "Remove" : "Suspend"} access for ${member?.displayName ?? "this user"}?`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/memberships", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ uid, status }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Update failed.");
      setNotice(
        status === "revoked"
          ? "User access removed."
          : status === "suspended"
            ? "User access suspended."
            : "User access reactivated.",
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Membership update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvitation() {
    if (!invitationUrl) return;
    try {
      await navigator.clipboard.writeText(invitationUrl);
      setCopyStatus("Invitation link copied.");
    } catch {
      setCopyStatus("Could not copy automatically. Select the link and copy it manually.");
      const input = document.getElementById(
        "membership-invitation-link",
      ) as HTMLInputElement | null;
      input?.focus();
      input?.select();
    }
  }

  async function savePermissions(uid: string) {
    setBusy(true);
    setError("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/memberships", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ uid, permissions: permissionDrafts[uid] ?? [] }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Permissions could not be saved.");
      setNotice("Vice-principal permissions updated.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Permissions could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function transfer(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const token = await reauthenticateForSensitiveAction(ownerEmail, ownerPassword);
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/memberships/ownership", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          targetUid,
          confirmation: "TRANSFER_OWNERSHIP",
          reauthenticatedIdToken: token,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Ownership transfer failed.");
      setOwnerPassword("");
      setNotice("Ownership transferred. Your access remains as a school administrator.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ownership transfer failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">School workspace · Access</div>
          <h1>User management</h1>
          <p>
            Invite users, review membership activity, and manage access within this school only.
          </p>
        </div>
        <div className="status-pill">
          <UsersRound size={14} /> {members.length} members
        </div>
      </div>
      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="login-success" role="status">
          {notice}
        </div>
      )}
      <div className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Current users</div>
              <div className="panel-subtitle">
                Joined date, last activity, role, school status and tenant-scoped permissions.
              </div>
            </div>
          </div>
          <div className="membership-filters">
            <input
              aria-label="Search users"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email or UID"
            />
            <select
              aria-label="Filter by role"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            >
              <option value="">All roles</option>
              {roles.map((item) => (
                <option key={item} value={item}>
                  {item.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="revoked">Removed</option>
            </select>
          </div>
          <div className="table-wrap membership-table-wrap">
            <table className="data-table membership-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Presence</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Date joined</th>
                  <th>Last activity</th>
                  {canManage && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.uid}>
                    <td data-label="User">
                      <strong>{member.displayName}</strong>
                      <div className="panel-subtitle">{member.email ?? member.uid}</div>
                    </td>
                    <td data-label="Presence">
                      <span aria-label={member.isOnline ? "Online" : "Offline"} style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", borderRadius: 99, padding: "4px 9px", background: member.isOnline ? "#e7f6ed" : "#f0f2f4", color: member.isOnline ? "#176b3a" : "#68717b", fontSize: 12, fontWeight: 650 }}>
                        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: member.isOnline ? "#16834a" : "#929ba5" }} />
                        {member.isOnline ? "Online" : "Offline"}
                      </span>
                    </td>
                    <td data-label="Role">
                      {member.isOwner && (
                        <span className="pill active" style={{ marginRight: 5 }}>
                          Owner
                        </span>
                      )}
                      {member.role === "class_teacher" || member.role === "subject_teacher" ? "teacher" : member.role.replaceAll("_", " ")}
                      {member.classTeacherClasses?.length ? <div style={{ marginTop: 5 }}><span className="pill active" title={`Assigned class teacher for ${member.classTeacherClasses.join(", ")}`}>Class teacher</span><div className="panel-subtitle">{member.classTeacherClasses.join(", ")}</div></div> : null}
                    </td>
                    <td data-label="Status">
                      <span className={`pill ${member.status === "active" ? "active" : "pending"}`}>
                        {member.status}
                      </span>
                    </td>
                    <td data-label="Date joined">
                      {member.createdAt ? new Date(member.createdAt).toLocaleDateString() : "—"}
                    </td>
                    <td data-label="Last activity">
                      {member.lastActivityAt
                        ? new Date(member.lastActivityAt).toLocaleString()
                        : "Not available"}
                    </td>
                    {canManage && (
                      <td data-label="Actions">
                        <div className="membership-row-actions">
                          {member.status === "active" ? (
                            <>
                              <button
                                type="button"
                                className="btn-secondary membership-action"
                                disabled={busy || member.isOwner}
                                title={
                                  member.isOwner
                                    ? "The school owner cannot be suspended here."
                                    : "Temporarily block this user’s access."
                                }
                                onClick={() => void update(member.uid, "suspended")}
                              >
                                Suspend
                              </button>
                              <button
                                type="button"
                                className="btn-danger-soft membership-action"
                                disabled={busy || member.isOwner}
                                title={
                                  member.isOwner
                                    ? "The school owner cannot be removed here."
                                    : "Remove this user’s school access."
                                }
                                onClick={() => void update(member.uid, "revoked")}
                              >
                                Remove
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn-secondary membership-action"
                              disabled={busy}
                              onClick={() => void update(member.uid, "active")}
                            >
                              Reactivate
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {!members.length && (
                  <tr>
                    <td colSpan={canManage ? 7 : 6}>
                      <div className="empty-state">
                        <h3>No matching users</h3>
                        <p>Adjust the search or filters, or invite a new member.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        {canManage && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Invite a user</div>
                <div className="panel-subtitle">
                  Create a seven-day, single-use invitation for a verified email address.
                </div>
              </div>
              <UserPlus size={17} />
            </div>
            <form className="login-form" onSubmit={submit}>
              <label className="field">
                Full name
                <input
                  required
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label className="field">
                Email address
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="field">
                School role
                <select value={role} onChange={(event) => setRole(event.target.value)}>
                  {roles.map((item) => (
                    <option key={item} value={item}>
                      {item.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn-primary" disabled={busy}>
                {busy ? "Creating invitation…" : "Create secure invitation"}
              </button>
            </form>
            {invitationUrl && (
              <div className="invite-link">
                <strong>Invitation link</strong>
                <div className="invite-link-controls">
                  <input
                    id="membership-invitation-link"
                    aria-label="Secure invitation link"
                    readOnly
                    value={invitationUrl}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void copyInvitation()}
                  >
                    {copyStatus.startsWith("Invitation link copied") ? (
                      <Check size={15} />
                    ) : (
                      <Copy size={15} />
                    )}
                    {copyStatus.startsWith("Invitation link copied") ? "Copied" : "Copy link"}
                  </button>
                </div>
                <small>
                  Email delivery is queued for the configured provider; this link is shown for
                  controlled administrator handoff.
                </small>
                {copyStatus && (
                  <small className="invite-copy-status" role="status">
                    {copyStatus}
                  </small>
                )}
              </div>
            )}
          </section>
        )}
      </div>
      {isOwner && (
        <>
          <section className="panel ownership-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Configure vice-principal permissions</div>
                <div className="panel-subtitle">
                  Choose a subset of approved role grants. Platform permissions and ownership
                  transfer are never available here.
                </div>
              </div>
            </div>
            {members
              .filter((member) => member.role === "vice_principal" && member.status === "active")
              .map((member) => (
                <div key={member.uid} className="permission-editor">
                  <strong>{member.displayName}</strong>
                  <div className="permission-grid">
                    {permissionCatalog.map((permission) => (
                      <label key={permission}>
                        <input
                          type="checkbox"
                          checked={(permissionDrafts[member.uid] ?? []).includes(permission)}
                          onChange={(event) =>
                            setPermissionDrafts((current) => ({
                              ...current,
                              [member.uid]: event.target.checked
                                ? [...new Set([...(current[member.uid] ?? []), permission])]
                                : (current[member.uid] ?? []).filter((item) => item !== permission),
                            }))
                          }
                        />
                        {permission}
                      </label>
                    ))}
                  </div>
                  <button
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => void savePermissions(member.uid)}
                  >
                    Save grants
                  </button>
                </div>
              ))}
            {!members.some(
              (member) => member.role === "vice_principal" && member.status === "active",
            ) && (
              <p className="panel-subtitle">
                Add an active vice principal to configure assigned grants.
              </p>
            )}
          </section>
          <section className="panel ownership-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Transfer school ownership</div>
                <div className="panel-subtitle">
                  This irreversible governance action requires a fresh Firebase password
                  reauthentication. The current owner remains an administrator after transfer.
                </div>
              </div>
            </div>
            <form className="form-grid" onSubmit={transfer}>
              <label className="field">
                New owner
                <select
                  required
                  value={targetUid}
                  onChange={(event) => setTargetUid(event.target.value)}
                >
                  <option value="">Select an eligible member</option>
                  {members
                    .filter(
                      (member) =>
                        ["principal", "vice_principal", "school_admin"].includes(member.role) &&
                        member.status === "active",
                    )
                    .map((member) => (
                      <option key={member.uid} value={member.uid}>
                        {member.displayName} · {member.role.replaceAll("_", " ")}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Current owner email
                <input
                  required
                  type="email"
                  value={ownerEmail}
                  onChange={(event) => setOwnerEmail(event.target.value)}
                  autoComplete="username"
                />
              </label>
              <label className="field">
                Current owner password
                <input
                  required
                  type="password"
                  value={ownerPassword}
                  onChange={(event) => setOwnerPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </label>
              <div className="form-actions">
                <button className="btn-secondary" disabled={busy || !targetUid}>
                  {busy ? "Transferring…" : "Transfer ownership"}
                </button>
              </div>
            </form>
          </section>
        </>
      )}
    </main>
  );
}
