"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type School = {
  id: string;
  name: string;
  slug: string;
  status: string;
  ownerUid: string | null;
  email?: string;
  phone?: string;
  address?: string;
  district?: string;
  province?: string;
  country?: string;
  schoolType?: string;
  logoUrl?: string;
  description?: string;
  deletion?: {
    status: string;
    requestedAt?: string;
    recoverUntil?: string;
    requestedBy?: string;
  } | null;
  emergencyLock?: { status: string; reason?: string; actorUid?: string; lockedAt?: string } | null;
};
type Member = { uid: string; displayName: string; email: string; role: string; status: string };
type Detail = {
  school: School;
  principal: Member | null;
  members: Member[];
  membersTruncated: boolean;
};
function csrf() {
  return (
    document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("edusphere_csrf="))
      ?.split("=")
      .slice(1)
      .join("=") ?? ""
  );
}

export default function SchoolManagement({ schoolId }: { schoolId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("active");
  const [profile, setProfile] = useState({
    email: "",
    phone: "",
    address: "",
    district: "",
    province: "",
    country: "",
    schoolType: "",
    logoUrl: "",
    description: "",
  });
  const [principalUid, setPrincipalUid] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [lockConfirmation, setLockConfirmation] = useState("");
  const [lockReason, setLockReason] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/platform/schools/${encodeURIComponent(schoolId)}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to load school");
      setDetail(data);
      setName(data.school.name);
      setStatus(data.school.status);
      setProfile({
        email: data.school.email ?? "",
        phone: data.school.phone ?? "",
        address: data.school.address ?? "",
        district: data.school.district ?? "",
        province: data.school.province ?? "",
        country: data.school.country ?? "",
        schoolType: data.school.schoolType ?? "",
        logoUrl: data.school.logoUrl ?? "",
        description: data.school.description ?? "",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load school");
    } finally {
      setLoading(false);
    }
  }, [schoolId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function mutate(method: "PATCH" | "POST", body: object) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/platform/schools/${encodeURIComponent(schoolId)}`, {
        method,
        headers: { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(csrf()) },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Action failed");
      setNotice(
        method === "POST" && "action" in body && body.action === "request-deletion"
          ? `Deletion requested. The school is marked pending and can be recovered for ${result.recoveryDays} days.`
          : "Changes saved.",
      );
      setConfirmation("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="page-content">
        <p>Loading school…</p>
      </main>
    );
  if (!detail)
    return (
      <main className="page-content">
        <p className="login-error">{error || "School unavailable"}</p>
        <Link className="btn-secondary" href="/platform">
          Back to schools
        </Link>
      </main>
    );
  const pending =
    detail.school.deletion?.status === "pending" || detail.school.status === "deletion_pending";
  const setupPending = detail.school.status === "setup_pending";
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <Link href="/platform">System owner</Link> / School management
          </div>
          <h1>{detail.school.name}</h1>
          <p>Dedicated school record · ID {detail.school.id}</p>
        </div>
        <Link className="btn-secondary" href="/platform">
          Back to platform
        </Link>
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
      {setupPending && (
        <section className="notice" style={{ marginBottom: 16 }}>
          <div>
            <h3>School setup is pending</h3>
            <p>
              Core profile, academic-year and security defaults are provisioned. This school remains
              pending until its invited principal accepts, or you assign an existing enabled,
              verified principal account below.
            </p>
          </div>
        </section>
      )}
      {pending && (
        <section className="notice" style={{ marginBottom: 16 }}>
          <div>
            <h3>Deletion pending</h3>
            <p>
              School data has not been destroyed. A System Owner can restore access until{" "}
              {detail.school.deletion?.recoverUntil
                ? new Date(detail.school.deletion.recoverUntil).toLocaleString()
                : "the recorded recovery deadline"}{" "}
              after recent reauthentication.
            </p>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Cancel deletion and restore ${detail.school.name}?`))
                  void mutate("POST", { action: "cancel-deletion" });
              }}
            >
              Cancel deletion and restore
            </button>
          </div>
        </section>
      )}
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header">
          <div>
            <div className="panel-title">School details and lifecycle</div>
            <div className="panel-subtitle">Edit the school record and control access state.</div>
          </div>
          <span className={`pill ${detail.school.status === "active" ? "active" : "pending"}`}>
            {detail.school.status}
          </span>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="school-name">School name</label>
            <input
              id="school-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="field">
            <label htmlFor="school-email">School email</label>
            <input
              id="school-email"
              type="email"
              value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              maxLength={254}
            />
          </div>
          <div className="field">
            <label htmlFor="school-phone">Contact number</label>
            <input
              id="school-phone"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              maxLength={40}
            />
          </div>
          <div className="field">
            <label htmlFor="school-address">Address</label>
            <input
              id="school-address"
              value={profile.address}
              onChange={(e) => setProfile({ ...profile, address: e.target.value })}
              maxLength={300}
            />
          </div>
          <div className="field">
            <label htmlFor="school-district">District</label>
            <input
              id="school-district"
              value={profile.district}
              onChange={(e) => setProfile({ ...profile, district: e.target.value })}
              maxLength={100}
            />
          </div>
          <div className="field">
            <label htmlFor="school-province">Province</label>
            <input
              id="school-province"
              value={profile.province}
              onChange={(e) => setProfile({ ...profile, province: e.target.value })}
              maxLength={100}
            />
          </div>
          <div className="field">
            <label htmlFor="school-country">Country</label>
            <input
              id="school-country"
              value={profile.country}
              onChange={(e) => setProfile({ ...profile, country: e.target.value })}
              maxLength={80}
            />
          </div>
          <div className="field">
            <label htmlFor="school-type">School type</label>
            <input
              id="school-type"
              value={profile.schoolType}
              onChange={(e) => setProfile({ ...profile, schoolType: e.target.value })}
              maxLength={80}
            />
          </div>
          <div className="field">
            <label htmlFor="school-logo">Logo URL</label>
            <input
              id="school-logo"
              type="url"
              value={profile.logoUrl}
              onChange={(e) => setProfile({ ...profile, logoUrl: e.target.value })}
              maxLength={2048}
            />
          </div>
          <div className="field">
            <label htmlFor="school-description">Description</label>
            <textarea
              id="school-description"
              value={profile.description}
              onChange={(e) => setProfile({ ...profile, description: e.target.value })}
              maxLength={2000}
            />
          </div>
          <div className="field">
            <label htmlFor="school-status">Status</label>
            <select
              id="school-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={pending || setupPending || detail.school.emergencyLock?.status === "active"}
            >
              <option value="setup_pending">Setup pending</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="form-actions">
            <button
              className="btn-primary"
              disabled={busy || pending || name.trim().length < 2}
              onClick={() => {
                if (
                  status === "archived" &&
                  !window.confirm(
                    `Archive ${detail.school.name}? Members will lose access, but their records remain.`,
                  )
                )
                  return;
                void mutate("PATCH", {
                  name: name.trim(),
                  ...profile,
                  ...(status === "setup_pending" || detail.school.emergencyLock?.status === "active"
                    ? {}
                    : { status }),
                });
              }}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </section>
      <section
        className="panel"
        style={{
          marginBottom: 16,
          borderColor: detail.school.emergencyLock?.status === "active" ? "#e8a19a" : undefined,
        }}
      >
        <div className="panel-header">
          <div>
            <div className="panel-title">Emergency school lock</div>
            <div className="panel-subtitle">
              Immediately suspend school-scoped access. The current status is{" "}
              {detail.school.emergencyLock?.status === "active" ? "locked" : "not locked"}.
            </div>
          </div>
        </div>
        {detail.school.emergencyLock?.status === "active" ? (
          <>
            <p className="login-error">
              Reason: {detail.school.emergencyLock.reason || "Not recorded"}
            </p>
            <p className="panel-subtitle">
              An owner reauthenticated within the last 10 minutes must release this lock. Release
              restores the recorded pre-lock state.
            </p>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Release the emergency lock for ${detail.school.name}?`))
                  void mutate("POST", { action: "release-emergency-lock" });
              }}
            >
              Release emergency lock
            </button>
          </>
        ) : (
          <>
            <p className="panel-subtitle" style={{ marginBottom: 12 }}>
              Requires recent owner reauthentication, an exact school-name confirmation, and a
              reason. All affected school-scoped requests are denied while the school is suspended.
            </p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="lock-confirm">Confirm school name: {detail.school.name}</label>
                <input
                  id="lock-confirm"
                  value={lockConfirmation}
                  onChange={(e) => setLockConfirmation(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="lock-reason">Incident reason</label>
                <textarea
                  id="lock-reason"
                  value={lockReason}
                  onChange={(e) => setLockReason(e.target.value)}
                  minLength={10}
                  maxLength={500}
                />
              </div>
              <div className="form-actions">
                <button
                  className="btn-secondary"
                  style={{ color: "#a83846", borderColor: "#efc9cf" }}
                  disabled={
                    busy ||
                    lockConfirmation !== detail.school.name ||
                    lockReason.trim().length < 10 ||
                    pending ||
                    detail.school.status === "archived"
                  }
                  onClick={() =>
                    void mutate("POST", {
                      action: "emergency-lock",
                      confirmation: lockConfirmation,
                      reason: lockReason.trim(),
                    })
                  }
                >
                  Lock school access
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header">
          <div>
            <div className="panel-title">Principal assignment</div>
            <div className="panel-subtitle">
              Assign or replace using the verified email address or UID of an existing Firebase
              user.
            </div>
          </div>
        </div>
        {detail.principal ? (
          <div className="notice" style={{ marginBottom: 14 }}>
            <div>
              <h3>{detail.principal.displayName || "Current principal"}</h3>
              <p>
                {detail.principal.email} · UID {detail.principal.uid} · {detail.principal.status}
              </p>
            </div>
            <button
              className="btn-secondary"
              disabled={busy || detail.principal.status !== "active"}
              onClick={() =>
                void mutate("POST", { action: "suspend-principal", uid: detail.principal!.uid })
              }
            >
              Suspend principal
            </button>
          </div>
        ) : (
          <p className="panel-subtitle">No active principal membership.</p>
        )}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="principal-uid">Verified principal email or user UID</label>
            <input
              id="principal-uid"
              value={principalUid}
              onChange={(e) => setPrincipalUid(e.target.value)}
              placeholder="principal@school.edu or Firebase UID"
            />
          </div>
          <div className="form-actions">
            <button
              className="btn-primary"
              disabled={busy || !principalUid.trim() || pending}
              onClick={() =>
                void mutate("POST", { action: "assign-principal", uid: principalUid.trim() })
              }
            >
              {detail.principal ? "Assign / replace principal" : "Assign principal"}
            </button>
          </div>
        </div>
      </section>
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header">
          <div>
            <div className="panel-title">School members</div>
            <div className="panel-subtitle">
              Memberships loaded for this school only (up to 500).
            </div>
          </div>
          <span className="pill">{detail.members.length} shown</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>UID</th>
              </tr>
            </thead>
            <tbody>
              {detail.members.map((member) => (
                <tr key={member.uid}>
                  <td>{member.displayName || "—"}</td>
                  <td>{member.email || "—"}</td>
                  <td>{member.role || "—"}</td>
                  <td>{member.status || "—"}</td>
                  <td>{member.uid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {detail.membersTruncated && (
          <p className="panel-subtitle">Member list is truncated at 500 entries.</p>
        )}
      </section>
      <section className="panel" style={{ borderColor: "#f0c9cf" }}>
        <div className="panel-header">
          <div>
            <div className="panel-title" style={{ color: "#a83846" }}>
              Request school deletion
            </div>
            <div className="panel-subtitle">
              This is not immediate destruction. It marks the school deletion-pending and starts a
              30-day recovery period.
            </div>
          </div>
        </div>
        {pending ? (
          <p className="login-success">A deletion request is already pending.</p>
        ) : (
          <>
            <p className="panel-subtitle" style={{ marginBottom: 12 }}>
              Requires a verified System Owner session reauthenticated within the last 10 minutes.
              Type the school name exactly to confirm.
            </p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="confirm-school">Confirm school name: {detail.school.name}</label>
                <input
                  id="confirm-school"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="form-actions">
                <button
                  className="btn-secondary"
                  style={{ color: "#a83846", borderColor: "#efc9cf" }}
                  disabled={busy || confirmation !== detail.school.name}
                  onClick={() => void mutate("POST", { action: "request-deletion", confirmation })}
                >
                  Request deletion
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
