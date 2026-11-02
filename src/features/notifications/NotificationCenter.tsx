"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  BellRing,
  Check,
  CheckCheck,
  ExternalLink,
  Settings2,
  Trash2,
  Volume2,
} from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";
import { playNotificationChime } from "@/lib/notifications/sound";

type NotificationRow = {
  id: string;
  category?: string;
  title?: string;
  message?: string;
  createdAt?: string;
  read?: boolean;
  deepLink?: string | null;
};
type Preferences = Record<string, boolean>;
const preferenceCategories = [
  "Announcements",
  "Academic",
  "Attendance",
  "Finance",
  "Administrative",
  "Assignments",
  "Events",
  "System",
];
const filters = ["All", ...preferenceCategories];

function when(value?: string) {
  if (!value) return "Recently";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function NotificationCenter() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [preferences, setPreferences] = useState<Preferences>({});
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [soundTested, setSoundTested] = useState(false);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Notifications could not be loaded.");
      const notifications = Array.isArray(body.notifications) ? body.notifications as NotificationRow[] : [];
      setItems(notifications);
      setPreferences(body.preferences ?? {});
      if (notifications.some((item) => item.read !== true)) {
        try {
          const csrf = await fetchCsrfToken();
          const marked = await fetch("/api/notifications", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ action: "mark_viewed", notificationIds: notifications.filter((item) => item.read !== true).map((item) => item.id) }) });
          if (marked.ok) setItems((current) => current.map((item) => ({ ...item, read: true })));
        } catch { /* Keep unread state when auto-marking cannot be completed. */ }
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Notifications could not be loaded.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(false), 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const action = useCallback(async (payload: Record<string, unknown>) => {
    setError("");
    const csrf = await fetchCsrfToken();
    const response = await fetch("/api/notifications", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Notification update failed.");
    return body;
  }, []);

  const apply = useCallback(
    async (payload: Record<string, unknown>, success: string) => {
      try {
        await action(payload);
        setMessage(success);
        await load(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Notification update failed.");
      }
    },
    [action, load],
  );

  async function savePreference(key: string, value: boolean) {
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    await apply({ action: "preferences", preferences: next }, "Notification preferences saved.");
  }

  async function enableBrowserAlerts(enabled: boolean) {
    if (enabled) {
      if (typeof Notification === "undefined") {
        setError("This browser does not support browser notifications.");
        return;
      }
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setError(
            "Browser alerts were not enabled. You can change this permission in your browser settings.",
          );
          await savePreference("browserAlerts", false);
          return;
        }
      } catch {
        setError("Browser permission could not be requested in this browser.");
        return;
      }
    }
    await savePreference("browserAlerts", enabled);
  }

  const visible = useMemo(
    () => (filter === "All" ? items : items.filter((item) => item.category === filter)),
    [items, filter],
  );
  const unread = items.filter((item) => item.read !== true).length;

  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">System · personal delivery</div>
          <h1>Notification center</h1>
          <p>
            Announcements appear here for your account, with controls for sound and browser alerts.
          </p>
        </div>
        <div className="portal-access-note">
          <BellRing size={13} />
          {unread} unread
        </div>
      </div>
      {(error || message) && (
        <div
          className={error ? "login-error" : "login-success"}
          role={error ? "alert" : "status"}
          style={{ marginBottom: 14 }}
        >
          {error || message}
        </div>
      )}
      <div className="module-tabs" role="tablist" aria-label="Notification categories">
        {filters.map((category) => (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={filter === category}
            className={filter === category ? "btn-primary" : "btn-secondary"}
            onClick={() => setFilter(category)}
          >
            {category}
          </button>
        ))}
      </div>
      <div className="content-grid" style={{ alignItems: "start" }}>
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Your notifications</div>
              <div className="panel-subtitle">
                Updates refresh automatically while this page is open.
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                void apply({ action: "mark_all_read" }, "All notifications marked as read.")
              }
            >
              <CheckCheck size={13} />
              Mark all read
            </button>
          </div>
          {loading ? (
            <div className="empty-state">
              <div>
                <div className="empty-icon">
                  <BellRing size={17} />
                </div>
                <h3>Loading notification history</h3>
                <p>Retrieving notifications addressed to this account.</p>
              </div>
            </div>
          ) : !visible.length ? (
            <div className="empty-state">
              <div>
                <div className="empty-icon">
                  <Check size={17} />
                </div>
                <h3>No notifications in this view</h3>
                <p>New school alerts addressed to you will appear here.</p>
              </div>
            </div>
          ) : (
            <div className="announcement-list">
              {visible.map((item) => (
                <article
                  className="announcement-card"
                  key={item.id}
                  style={{
                    borderColor: item.read === true ? "var(--line)" : "#a9bbff",
                    background: item.read === true ? "#fff" : "#fbfcff",
                  }}
                >
                  <div className="announcement-top">
                    <div>
                      <span className="pill active">{item.category ?? "System"}</span>
                      <h3>{item.title ?? "School notification"}</h3>
                    </div>
                    {item.read !== true && <span className="pill pending">Unread</span>}
                  </div>
                  <p>{item.message}</p>
                  <div className="announcement-meta">
                    <span>{when(item.createdAt)}</span>
                    {item.deepLink && (
                      <Link href={item.deepLink}>
                        <ExternalLink size={12} />
                        Open record
                      </Link>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() =>
                        void apply(
                          { action: "mark_read", notificationId: item.id },
                          "Notification marked as read.",
                        )
                      }
                    >
                      <Check size={12} />
                      Read
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() =>
                        void apply(
                          { action: "archive", notificationId: item.id },
                          "Notification archived.",
                        )
                      }
                    >
                      <Archive size={12} />
                      Archive
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      aria-label={`Delete ${item.title ?? "notification"}`}
                      onClick={() =>
                        void apply(
                          { action: "delete", notificationId: item.id },
                          "Notification deleted.",
                        )
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Notification preferences</div>
              <div className="panel-subtitle">
                Choose which categories stay visible in your inbox.
              </div>
            </div>
            <Settings2 size={20} color="#7656e8" />
          </div>
          <div className="activity-list">
            {preferenceCategories.map((category) => {
              const key = category.toLowerCase();
              return (
                <div className="mini-status-row" key={category}>
                  <span>{category}</span>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={preferences[key] !== false}
                      onChange={(event) => void savePreference(key, event.target.checked)}
                    />{" "}
                    In-app
                  </label>
                </div>
              );
            })}
          </div>
          <div className="activity-list" style={{ marginTop: 18 }}>
            <div className="mini-status-row">
              <span>Announcement chime</span>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={preferences.chime !== false}
                  onChange={(event) => void savePreference("chime", event.target.checked)}
                />{" "}
                Play sound
              </label>
            </div>
            <button
              type="button"
              className="btn-secondary notification-test-sound"
              onClick={() => {
                playNotificationChime();
                setSoundTested(true);
              }}
            >
              <Volume2 size={14} />
              {soundTested ? "Play test sound again" : "Test notification sound"}
            </button>
            <div className="mini-status-row">
              <span>Browser alerts</span>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={preferences.browserAlerts === true}
                  onChange={(event) => void enableBrowserAlerts(event.target.checked)}
                />{" "}
                Enable
              </label>
            </div>
            <p className="panel-subtitle">
              A clear, rising three-note chime plays when a new unread notification arrives while
              the site is open. Use the test button once if your browser needs an interaction before
              it allows sound. Browser alerts require permission.
            </p>
          </div>
          <div className="portal-footnote">
            <BellRing size={13} /> Only notifications addressed to this signed-in account are shown.
          </div>
        </section>
      </div>
    </main>
  );
}
