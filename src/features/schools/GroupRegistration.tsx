"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import {
  CheckCircle2,
  Clock3,
  Copy,
  Link2,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
  XCircle,
} from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type Invitation = {
  schoolName: string;
  role: string;
  requiresApproval: boolean;
  gradeRestriction?: string;
  expiresAt: string;
};
type GroupInviteRow = {
  id: string;
  role: string;
  status: string;
  requiresApproval: boolean;
  gradeRestriction?: string;
  createdBy?: string;
  pendingApprovals?: number;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string | null;
};
type RequestRow = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  admissionNumber: string;
  contactNumber?: string;
  teacherId?: string;
  grade?: string;
  className?: string;
  subjects?: string[];
  qualifications?: string;
  status: string;
  requestedAt: string | null;
};

export function GroupLinkManager() {
  const [role, setRole] = useState("student");
  const [maxUses, setMax] = useState("30");
  const [days, setDays] = useState("14");
  const [gradeRestriction, setGradeRestriction] = useState("");
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [url, setUrl] = useState("");
  const [invitations, setInvitations] = useState<GroupInviteRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/group-invitations", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load invitation links.");
      setInvitations(data.invitations ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load invitation links.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function generate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/group-invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          role,
          maxUses: Number(maxUses),
          expiresInDays: Number(days),
          requiresApproval,
          gradeRestriction,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate the link.");
      setUrl(data.url);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate link.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (
      !window.confirm(
        "Revoke this registration link? Anyone who has not submitted a request will no longer be able to use it.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/group-invitations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not revoke this link.");
      if (invitations.find((item) => item.id === id))
        setInvitations((rows) =>
          rows.map((item) => (item.id === id ? { ...item, status: "revoked" } : item)),
        );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke this link.");
    } finally {
      setBusy(false);
    }
  }

  async function extend(id: string) {
    setBusy(true);
    setError("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/group-invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ action: "extend", id, days: 7 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not extend invitation.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not extend invitation.");
    } finally {
      setBusy(false);
    }
  }

  function qrSvgMarkup() {
    const svg = document.querySelector("#invite-qr svg");
    return svg ? new XMLSerializer().serializeToString(svg) : "";
  }
  function downloadQr() {
    const svg = qrSvgMarkup();
    if (!svg) return;
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = `edusphere-${role}-registration-qr.svg`;
    anchor.click();
    URL.revokeObjectURL(blobUrl);
  }
  function printQr() {
    const svg = qrSvgMarkup();
    if (!svg) return;
    const popup = window.open("", "_blank", "width=640,height=720");
    if (!popup) {
      setError("Allow pop-ups to print the QR code.");
      return;
    }
    const imageUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const safeUrl = url
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
    popup.onload = () => popup.print();
    popup.document.write(
      `<html><head><title>E-SmartSchool.lk registration QR</title><style>body{font-family:Arial,sans-serif;text-align:center;padding:40px;color:#172033}img{width:320px;height:320px}.url{word-break:break-all;font-size:12px}</style></head><body><h1>E-SmartSchool.lk school registration</h1><p>Role: ${role.replaceAll("_", " ")}</p><img alt="Registration QR code" src="${imageUrl}"><p class="url">${safeUrl}</p></body></html>`,
    );
    popup.document.close();
  }

  return (
    <section className="panel membership-workflow">
      <div className="workflow-heading">
        <span className="workflow-icon">
          <Link2 size={18} />
        </span>
        <div>
          <h2>Group registration links</h2>
          <p>Create a shareable, school-specific link for new students or teachers.</p>
        </div>
      </div>
      <div className="workflow-callout">
        <ShieldCheck size={16} />
        <span>
          Choose whether registrations need approval. Manual review is recommended; auto-approval
          immediately activates eligible accounts.
        </span>
      </div>
      <form onSubmit={generate} className="invite-config-grid">
        <label className="field">
          <span>Registration role</span>
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="student">Student</option>
            <option value="class_teacher">Class teacher</option>
            <option value="subject_teacher">Subject teacher</option>
          </select>
        </label>
        <label className="field">
          <span>Maximum sign-ups</span>
          <input
            type="number"
            min="1"
            max="500"
            value={maxUses}
            onChange={(event) => setMax(event.target.value)}
            required
          />
          <small>From 1 to 500 accounts</small>
        </label>
        <label className="field">
          <span>Link validity</span>
          <div className="input-suffix">
            <input
              type="number"
              min="1"
              max="90"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              required
            />
            <span>days</span>
          </div>
          <small>From 1 to 90 days</small>
        </label>
        {role === "student" && (
          <label className="field">
            <span>
              Grade restriction <em>Optional</em>
            </span>
            <input
              maxLength={40}
              value={gradeRestriction}
              onChange={(event) => setGradeRestriction(event.target.value)}
              placeholder="For example, Grade 8"
            />
            <small>Only applicants entering this grade can use the link.</small>
          </label>
        )}
        <label className="approval-choice">
          <input
            type="checkbox"
            checked={requiresApproval}
            onChange={(event) => setRequiresApproval(event.target.checked)}
          />
          <span>
            <strong>Require administrator approval</strong>
            <small>
              {requiresApproval
                ? "Requests wait for review before school access is granted."
                : "Eligible applicants are activated automatically."}
            </small>
          </span>
        </label>
        <div className="invite-submit">
          <button className="btn-primary" disabled={busy}>
            {busy ? (
              "Creating link…"
            ) : (
              <>
                <Link2 size={15} /> Generate registration link
              </>
            )}
          </button>
        </div>
      </form>
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      {url && (
        <div className="generated-invite">
          <div className="generated-qr" id="invite-qr">
            <QRCodeSVG
              value={url}
              size={150}
              level="M"
              title="Scan to open the school registration link"
            />
          </div>
          <div className="generated-copy">
            <span className="pill active">
              <CheckCircle2 size={12} /> Link created
            </span>
            <h3>Your registration link is ready</h3>
            <p>
              Share this URL or QR code with applicants. The full link is shown only now; save it
              somewhere secure.
            </p>
            <label className="field">
              <span>Shareable URL</span>
              <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
            </label>
            <div className="workflow-actions">
              <button
                className="btn-secondary"
                type="button"
                onClick={() => void navigator.clipboard.writeText(url)}
              >
                <Copy size={14} /> Copy link
              </button>
              <button className="btn-secondary" type="button" onClick={downloadQr}>
                Download QR
              </button>
              <button className="btn-secondary" type="button" onClick={printQr}>
                Print QR
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="workflow-subsection">
        <div className="subsection-heading">
          <div>
            <h3>Previously created links</h3>
            <p>Track usage, expiry, and approval activity.</p>
          </div>
          <button
            className="btn-secondary"
            type="button"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} />
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {loading ? (
          <div className="workflow-empty">Loading invitation links…</div>
        ) : !invitations.length ? (
          <div className="workflow-empty">
            <Link2 size={20} />
            <strong>No links yet</strong>
            <span>Create a registration link above to get started.</span>
          </div>
        ) : (
          <div className="invite-list">
            {invitations.map((invite) => (
              <article className="invite-row" key={invite.id}>
                <div className="invite-row-main">
                  <div className="invite-row-title">
                    <h4>{invite.role.replaceAll("_", " ")}</h4>
                    <span className={`pill ${invite.status === "active" ? "active" : ""}`}>
                      {invite.status}
                    </span>
                  </div>
                  <div className="invite-metrics">
                    <span>
                      <UsersRound size={13} /> {invite.usedCount}/{invite.maxUses} sign-ups
                    </span>
                    <span>
                      <UserRoundCheck size={13} /> {invite.pendingApprovals ?? 0} awaiting review
                    </span>
                    <span>
                      <Clock3 size={13} /> Expires{" "}
                      {invite.expiresAt
                        ? new Date(invite.expiresAt).toLocaleDateString()
                        : "unknown"}
                    </span>
                  </div>
                  <div className="invite-tags">
                    <span>{invite.requiresApproval ? "Manual approval" : "Auto-approval"}</span>
                    {invite.gradeRestriction && <span>{invite.gradeRestriction} only</span>}
                    <span>
                      Created{" "}
                      {invite.createdAt
                        ? new Date(invite.createdAt).toLocaleDateString()
                        : "unknown"}
                    </span>
                  </div>
                </div>
                <div className="invite-row-actions">
                  <button
                    className="btn-secondary"
                    type="button"
                    disabled={busy || invite.status !== "active"}
                    onClick={() => void extend(invite.id)}
                  >
                    Extend 7 days
                  </button>
                  <button
                    className="btn-danger-soft"
                    type="button"
                    disabled={busy || invite.status !== "active"}
                    onClick={() => void revoke(invite.id)}
                  >
                    {invite.status === "active" ? "Revoke" : "Revoked"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function GroupRegistration({ token }: { token: string }) {
  const [invite, setInvite] = useState<Invitation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token) {
      setError("Invitation link is incomplete.");
      return;
    }
    fetch(`/api/group-invitations?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setInvite(data.invitation);
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "Invitation unavailable."),
      );
  }, [token]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/group-invitations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          token,
          fullName: form.get("fullName"),
          admissionNumber: form.get("admissionNumber"),
          contactNumber: form.get("contactNumber"),
          teacherId: form.get("teacherId"),
          grade: form.get("grade"),
          className: form.get("className"),
          subjects: form.get("subjects"),
          qualifications: form.get("qualifications"),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Registration failed.");
      if (data.status === "pending") window.location.assign("/registration/pending");
      else window.location.assign("/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  const returnTo = encodeURIComponent(`/group-registration?token=${encodeURIComponent(token)}`);
  return (
    <main className="page-content" style={{ maxWidth: 680, margin: "40px auto" }}>
      <section className="card" style={{ padding: 24 }}>
        <h1>Join a school</h1>
        {invite && (
          <>
            <p>
              Registration for <strong>{invite.schoolName}</strong> as{" "}
              <strong>{invite.role.replaceAll("_", " ")}</strong>.{" "}
              {invite.gradeRestriction && (
                <>
                  This link is restricted to <strong>{invite.gradeRestriction}</strong>.{" "}
                </>
              )}
              {invite.requiresApproval
                ? "A school administrator will review your request."
                : "Eligible registrations are activated automatically."}
            </p>
            <>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                <Link className="btn-secondary" href={`/?returnTo=${returnTo}`}>
                  Sign in
                </Link>
                <Link className="btn-secondary" href={`/?mode=register&returnTo=${returnTo}`}>
                  Create account
                </Link>
              </div>
              <form onSubmit={submit} className="form-grid">
                <label>
                  Full name
                  <input name="fullName" required minLength={2} maxLength={120} />
                </label>
                <label>
                  Contact number (optional)
                  <input name="contactNumber" type="tel" maxLength={40} />
                </label>
                {invite.role === "student" ? (
                  <>
                    <label>
                      Admission number (if assigned)
                      <input name="admissionNumber" maxLength={80} />
                    </label>
                    <label>
                      Grade
                      <input
                        name="grade"
                        maxLength={40}
                        required={!!invite.gradeRestriction}
                        defaultValue={invite.gradeRestriction ?? ""}
                      />
                    </label>
                    <label>
                      Class
                      <input name="className" maxLength={80} />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      Teacher ID (if available)
                      <input name="teacherId" maxLength={80} />
                    </label>
                    <label>
                      Subjects taught (comma separated)
                      <input name="subjects" maxLength={500} />
                    </label>
                    <label>
                      Qualifications (optional)
                      <textarea name="qualifications" maxLength={500} />
                    </label>
                  </>
                )}
                <button disabled={busy}>{busy ? "Submitting…" : "Request registration"}</button>
              </form>
            </>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <p>
          Use an email-verified E-SmartSchool.lk account. The invitation determines the school and role;
          the server verifies your account before submitting.
        </p>
      </section>
    </main>
  );
}

export function RegistrationRequestReview() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState<"pending" | "history">("pending");
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/registration-requests", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setRows(data.requests);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load requests.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function decide(uid: string, action: "approve" | "reject") {
    setBusy(uid);
    setError("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/registration-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ uid, action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Decision failed.");
    } finally {
      setBusy("");
    }
  }
  async function decideSelected(action: "approve" | "reject") {
    const targets = selectedUids.filter((uid) =>
      rows.some((row) => row.id === uid && row.status === "pending"),
    );
    if (
      !targets.length ||
      !window.confirm(
        `${action === "approve" ? "Approve" : "Reject"} ${targets.length} selected registration request(s)?`,
      )
    )
      return;
    setBusy("bulk");
    setError("");
    try {
      const csrf = await fetchCsrfToken();
      const failed: string[] = [];
      for (const uid of targets) {
        const response = await fetch("/api/registration-requests", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({ uid, action }),
        });
        const data = await response.json();
        if (!response.ok) failed.push(`${uid}: ${data.error ?? "Decision failed"}`);
      }
      await load();
      setSelectedUids([]);
      if (failed.length)
        setError(
          `${targets.length - failed.length} request(s) processed; ${failed.length} failed: ${failed.slice(0, 3).join("; ")}`,
        );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bulk decision failed.");
    } finally {
      setBusy("");
    }
  }
  const shown = rows.filter((row) =>
    filter === "pending" ? row.status === "pending" : row.status !== "pending",
  );
  const pendingCount = rows.filter((row) => row.status === "pending").length;
  return (
    <section className="panel membership-workflow request-review">
      <div className="workflow-heading">
        <span className="workflow-icon">
          <UserRoundCheck size={18} />
        </span>
        <div>
          <h2>Registration requests</h2>
          <p>Review new student and teacher access requests for this school.</p>
        </div>
        <span className="request-count">{pendingCount} pending</span>
      </div>
      <div className="review-toolbar">
        <div className="review-tabs">
          <button
            type="button"
            className={filter === "pending" ? "review-tab active" : "review-tab"}
            onClick={() => setFilter("pending")}
          >
            Pending <span>{pendingCount}</span>
          </button>
          <button
            type="button"
            className={filter === "history" ? "review-tab active" : "review-tab"}
            onClick={() => setFilter("history")}
          >
            Decision history <span>{rows.length - pendingCount}</span>
          </button>
        </div>
        <button
          className="btn-secondary"
          type="button"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw size={14} />
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {filter === "pending" && pendingCount > 0 && (
        <div className="bulk-toolbar">
          <span>
            {selectedUids.length
              ? `${selectedUids.length} selected`
              : "Select requests to review together"}
          </span>
          <div>
            <button
              className="btn-primary"
              type="button"
              disabled={!!busy || !selectedUids.length}
              onClick={() => void decideSelected("approve")}
            >
              <CheckCircle2 size={14} />
              Approve selected
            </button>
            <button
              className="btn-danger-soft"
              type="button"
              disabled={!!busy || !selectedUids.length}
              onClick={() => void decideSelected("reject")}
            >
              Reject selected
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <div className="workflow-empty">Loading registration requests…</div>
      ) : !shown.length ? (
        <div className="workflow-empty">
          <UserRoundCheck size={22} />
          <strong>{filter === "pending" ? "All caught up" : "No decisions yet"}</strong>
          <span>
            {filter === "pending"
              ? "New registration requests will appear here when applicants submit a link."
              : "Approved and rejected requests will be available here."}
          </span>
        </div>
      ) : (
        <div className="request-list">
          {shown.map((row) => (
            <article className="request-card" key={row.id}>
              <div className="request-card-top">
                {filter === "pending" && (
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.fullName}`}
                    checked={selectedUids.includes(row.id)}
                    onChange={(event) =>
                      setSelectedUids((current) =>
                        event.target.checked
                          ? [...current, row.id]
                          : current.filter((uid) => uid !== row.id),
                      )
                    }
                  />
                )}
                <div className="request-avatar">
                  {row.fullName.trim().charAt(0).toUpperCase() || "?"}
                </div>
                <div className="request-identity">
                  <strong>{row.fullName}</strong>
                  <span>{row.email}</span>
                </div>
                <span
                  className={`pill ${row.status === "pending" ? "pending" : row.status === "approved" ? "active" : ""}`}
                >
                  {row.status}
                </span>
              </div>
              <div className="request-details">
                <span className="request-role">{row.role.replaceAll("_", " ")}</span>
                {row.admissionNumber && <span>Admission no. {row.admissionNumber}</span>}
                {row.grade && (
                  <span>
                    {row.grade}
                    {row.className ? ` · ${row.className}` : ""}
                  </span>
                )}
                {row.teacherId && <span>Teacher ID {row.teacherId}</span>}
                {row.contactNumber && <span>{row.contactNumber}</span>}
                {row.subjects?.length ? <span>Subjects: {row.subjects.join(", ")}</span> : null}
                {row.qualifications && <span>Qualifications: {row.qualifications}</span>}
              </div>
              <div className="request-card-footer">
                <span>
                  <Clock3 size={13} /> Submitted{" "}
                  {row.requestedAt
                    ? new Date(row.requestedAt).toLocaleString()
                    : "time unavailable"}
                </span>
                {filter === "pending" && (
                  <div className="request-actions">
                    <button
                      className="btn-primary"
                      type="button"
                      disabled={!!busy}
                      onClick={() => void decide(row.id, "approve")}
                    >
                      <CheckCircle2 size={14} />
                      {busy === row.id ? "Saving…" : "Approve"}
                    </button>
                    <button
                      className="btn-danger-soft"
                      type="button"
                      disabled={!!busy}
                      onClick={() => void decide(row.id, "reject")}
                    >
                      <XCircle size={14} />
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
