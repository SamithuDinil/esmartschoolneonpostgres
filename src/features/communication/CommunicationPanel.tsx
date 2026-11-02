"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Bell,
  Check,
  Clock3,
  FileText,
  Megaphone,
  Send,
  ShieldCheck,
  Smartphone,
  Users,
} from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type Row = Record<string, unknown> & { id: string };
type CommunicationResponse = {
  announcements: Row[];
  notifications: Row[];
  providerStatus: Record<string, string>;
};
const text = (value: unknown) => String(value ?? "—");

export function CommunicationPanel({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<"announcements" | "notifications" | "delivery">("announcements");
  const [data, setData] = useState<CommunicationResponse | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/communication", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Communication data could not be loaded.");
      setData(body as CommunicationResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Communication data could not be loaded.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const payload = {
      action: "create",
      title: String(form.get("title") ?? ""),
      message: String(form.get("message") ?? ""),
      audience: String(form.get("audience") ?? "school"),
      targetRoles: String(form.get("targetRoles") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      targetGrades: String(form.get("targetGrades") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      targetClasses: String(form.get("targetClasses") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      targetUids: [],
      channels: Array.from(form.getAll("channels")).map(String),
      scheduledAt: String(form.get("scheduledAt") ?? ""),
      attachmentName: String(form.get("attachmentName") ?? ""),
    };
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/communication", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Announcement could not be saved.");
      setNotice(
        payload.scheduledAt
          ? "Announcement scheduled for review."
          : "Announcement saved as a draft.",
      );
      setShowComposer(false);
      event.currentTarget.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Announcement could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  async function action(announcementId: string, actionName: "publish" | "archive" | "mark_read") {
    setBusy(true);
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/communication", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ action: actionName, announcementId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The announcement could not be updated.");
      setNotice(
        actionName === "publish"
          ? "Announcement published to its authorized recipients."
          : actionName === "archive"
            ? "Announcement archived."
            : "Marked as read.",
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The announcement could not be updated.");
    } finally {
      setBusy(false);
    }
  }
  async function editAnnouncement(item: Row) {
    const title = window.prompt("Edit announcement headline", text(item.title));
    if (!title) return;
    const message = window.prompt("Edit announcement message", text(item.message));
    if (!message) return;
    setBusy(true);
    setError("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/communication", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ action: "edit", announcementId: item.id, title, message }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Announcement could not be edited.");
      setNotice("Announcement updated for its authorized recipients.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Announcement could not be edited.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Module 22 · Trust & delivery</div>
          <h1>Communication center</h1>
          <p>
            Publish the right message to the right school audience, with a visible delivery trail.
          </p>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={() => setShowComposer(true)}>
            <Megaphone size={14} />
            Create announcement
          </button>
        )}
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
      <section className="content-grid">
        <article className="notice">
          <ShieldCheck size={18} color="#315ee8" />
          <div>
            <h3>Recipient access is enforced</h3>
            <p>
              Announcements are filtered by school, role or verified recipient identity before they
              are returned. External channels remain pending until an authorized provider is
              connected.
            </p>
          </div>
        </article>
        <article className="panel">
          <div className="panel-title">Delivery snapshot</div>
          <div className="mini-status-row">
            <span>
              <Bell size={14} />
              In-app
            </span>
            <strong>Ready</strong>
          </div>
          <div className="mini-status-row">
            <span>
              <Send size={14} />
              Email
            </span>
            <strong>
              {data?.providerStatus.email === "configured" ? "Configured" : "Pending"}
            </strong>
          </div>
          <div className="mini-status-row">
            <span>
              <Smartphone size={14} />
              SMS / WhatsApp
            </span>
            <strong>
              {data?.providerStatus.sms === "configured" &&
              data?.providerStatus.whatsapp === "configured"
                ? "Configured"
                : "Pending"}
            </strong>
          </div>
        </article>
      </section>
      <div className="module-tabs" role="tablist" aria-label="Communication views">
        {[
          ["announcements", "Announcements"],
          ["notifications", "My notifications"],
          ["delivery", "Channels & alerts"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "btn-primary" : "btn-secondary"}
            onClick={() => setTab(id as typeof tab)}
            role="tab"
            aria-selected={tab === id}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "announcements" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Announcement stream</div>
              <div className="panel-subtitle">
                Draft, scheduled, published and archived messages visible to your role.
              </div>
            </div>
            <FileText size={16} color="#315ee8" />
          </div>
          {data?.announcements.length ? (
            <div className="announcement-list">
              {data.announcements.map((item) => (
                <article className="announcement-card" key={item.id}>
                  <div className="announcement-top">
                    <div>
                      <span
                        className={`pill ${item.status === "published" ? "active" : item.status === "scheduled" ? "pending" : ""}`}
                      >
                        {text(item.status)}
                      </span>
                      <h3>{text(item.title)}</h3>
                    </div>
                    <span className="panel-subtitle">{text(item.createdAt)}</span>
                  </div>
                  <p>{text(item.message)}</p>
                  <div className="announcement-meta">
                    <span>
                      <Users size={13} />
                      {text(item.audience)}
                    </span>
                    <span>
                      <Bell size={13} />
                      {Array.isArray(item.channels) ? item.channels.join(", ") : "in_app"}
                    </span>
                    {item.attachmentName ? (
                      <span>
                        <FileText size={13} />
                        {text(item.attachmentName)}
                      </span>
                    ) : null}
                  </div>
                  {canManage && (
                    <div className="form-actions">
                      <button
                        className="btn-secondary"
                        disabled={busy}
                        onClick={() => void editAnnouncement(item)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn-secondary"
                        disabled={busy || item.status === "published"}
                        onClick={() => void action(item.id, "publish")}
                      >
                        <Send size={13} />
                        Publish
                      </button>
                      <button
                        className="btn-secondary"
                        disabled={busy || item.status === "archived"}
                        onClick={() => void action(item.id, "archive")}
                      >
                        Archive
                      </button>
                    </div>
                  )}
                  {!canManage && item.status === "published" && (
                    <button
                      className="btn-secondary"
                      onClick={() => void action(item.id, "mark_read")}
                    >
                      <Check size={13} />
                      Mark as read
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div>
                <div className="empty-icon">
                  <Megaphone size={17} />
                </div>
                <h3>No announcements available</h3>
                <p>
                  Only published messages addressed to your authorized role or linked account appear
                  here.
                </p>
              </div>
            </div>
          )}
        </section>
      )}
      {tab === "notifications" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">In-app notifications</div>
              <div className="panel-subtitle">
                Absences, exams, results, fees, events, deadlines and important announcements.
              </div>
            </div>
            <Bell size={16} color="#315ee8" />
          </div>
          {data?.notifications.length ? (
            <div className="activity-list">
              {data.notifications.map((item) => (
                <div className="activity-item" key={item.id}>
                  <div
                    className="activity-dot"
                    style={{ background: item.readAt ? "#b6c0d1" : "#315ee8" }}
                  />
                  <div>
                    <div className="activity-copy">
                      <strong>{text(item.title)}</strong> · {text(item.message)}
                    </div>
                    <div className="activity-time">
                      {text(item.createdAt)} · {item.readAt ? "Read" : "Unread"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div>
                <div className="empty-icon">
                  <Bell size={17} />
                </div>
                <h3>No unread notifications</h3>
                <p>
                  Authorized automated alerts will appear here when the school records an event for
                  you.
                </p>
              </div>
            </div>
          )}
        </section>
      )}
      {tab === "delivery" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Channels and automated alerts</div>
              <div className="panel-subtitle">
                The center is ready for in-app delivery; external providers require explicit
                configuration.
              </div>
            </div>
            <Clock3 size={16} color="#315ee8" />
          </div>
          <div className="channel-grid">
            {[
              [
                "In-app notifications",
                "Absences, examinations, results, fees, events, deadlines and announcements",
                "ready",
              ],
              [
                "Email notifications",
                "Configured only after an authorized email provider is connected.",
                data?.providerStatus.email ?? "pending",
              ],
              [
                "SMS notifications",
                "Configured only after an authorized SMS provider is connected.",
                data?.providerStatus.sms ?? "pending",
              ],
              [
                "WhatsApp notifications",
                "Configured only after an authorized WhatsApp integration is connected.",
                data?.providerStatus.whatsapp ?? "pending",
              ],
            ].map(([name, description, status]) => (
              <div className="channel-card" key={name}>
                <div className="channel-icon">
                  <Smartphone size={16} />
                </div>
                <div>
                  <strong>{name}</strong>
                  <p>{description}</p>
                  <span
                    className={`pill ${status === "ready" || status === "configured" ? "active" : "pending"}`}
                  >
                    {status === "ready"
                      ? "Ready"
                      : status === "configured"
                        ? "Configured"
                        : "Not configured"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {showComposer && (
        <div className="modal-backdrop">
          <section className="modal-card">
            <div className="panel-header">
              <div>
                <div className="panel-title">Create announcement</div>
                <div className="panel-subtitle">
                  Only authorized recipients will see this message.
                </div>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowComposer(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form className="form-grid" onSubmit={submit}>
              <label className="field full">
                <span>Headline</span>
                <input name="title" required placeholder="Parent meeting schedule updated" />
              </label>
              <label className="field full">
                <span>Message</span>
                <textarea
                  name="message"
                  required
                  rows={5}
                  placeholder="Write a clear, school-scoped message."
                />
              </label>
              <label className="field">
                <span>Recipients</span>
                <select name="audience" defaultValue="school">
                  <option value="school">Whole school</option>
                  <option value="teachers">Teachers</option>
                  <option value="parents">Parents / guardians</option>
                  <option value="students">Students</option>
                  <option value="selected">Selected roles</option>
                </select>
              </label>
              <label className="field">
                <span>Target roles</span>
                <input name="targetRoles" placeholder="parent, student" />
              </label>
              <label className="field">
                <span>Target grades</span>
                <input name="targetGrades" placeholder="Grade 6, Grade 7" />
              </label>
              <label className="field">
                <span>Target classes</span>
                <input name="targetClasses" placeholder="6A, 7B" />
              </label>
              <fieldset className="field full">
                <legend>Channels</legend>
                <div className="check-row">
                  {["in_app", "email", "sms", "whatsapp"].map((channel) => (
                    <label key={channel}>
                      <input
                        type="checkbox"
                        name="channels"
                        value={channel}
                        defaultChecked={channel === "in_app"}
                      />
                      {channel.replace("_", " ")}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="field">
                <span>Schedule publication</span>
                <input name="scheduledAt" type="datetime-local" />
              </label>
              <label className="field">
                <span>Attachment name</span>
                <input name="attachmentName" placeholder="Optional private file" />
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowComposer(false)}
                >
                  Cancel
                </button>
                <button className="btn-primary" disabled={busy}>
                  {busy ? "Saving…" : "Save announcement"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
