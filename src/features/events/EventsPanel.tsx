"use client";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  MapPin,
  Megaphone,
  Plus,
  RotateCcw,
  Send,
  XCircle,
} from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type EventRow = {
  id: string;
  title?: string;
  description?: string;
  category?: string;
  participants?: string;
  startAt?: string;
  endAt?: string;
  location?: string;
  status?: string;
  reminderMinutes?: number[];
};
const categories = [
  "examination",
  "school_holiday",
  "parent_meeting",
  "sports_meet",
  "educational_trip",
  "cultural_event",
  "club_activity",
  "school_ceremony",
];
const categoryLabel = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const startOfWeek = (date: Date) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() - copy.getDay());
  copy.setHours(0, 0, 0, 0);
  return copy;
};
const formatDate = (value?: string, timezone = "Asia/Colombo") =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: timezone,
      })
    : "—";
function exportEvents(events: EventRow[]) {
  if (!events.length) return;
  const headers = ["title", "category", "startAt", "endAt", "participants", "location", "status"];
  const csv = [
    headers.join(","),
    ...events.map((event) =>
      headers
        .map((key) => `"${String(event[key as keyof EventRow] ?? "").replaceAll('"', '""')}"`)
        .join(","),
    ),
  ].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = "school-events.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}
export function EventsPanel({ canManage }: { canManage: boolean }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [timezone, setTimezone] = useState("Asia/Colombo");
  const [view, setView] = useState<"month" | "week" | "day">("month");
  const [current, setCurrent] = useState(() => new Date());
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    setError("");
    try {
      const response = await fetch("/api/events", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Events could not be loaded.");
      setEvents(body.events as EventRow[]);
      setTimezone(String(body.timezone ?? "Asia/Colombo"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Events could not be loaded.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function write(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Event change could not be saved.");
      setNotice(
        payload.action === "publish"
          ? "Event published to its selected participants."
          : payload.action === "cancel"
            ? "Event cancelled."
            : "Event saved.",
      );
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Event change could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const targetRoles = String(form.get("targetRoles") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const reminderMinutes = String(form.get("reminderMinutes") ?? "")
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item >= 0);
    const ok = await write({
      action: "create",
      title: form.get("title"),
      description: form.get("description"),
      category: form.get("category"),
      participants: form.get("participants"),
      targetRoles,
      targetUids: [],
      startAt: form.get("startAt"),
      endAt: form.get("endAt"),
      location: form.get("location"),
      reminderMinutes,
    });
    if (ok) {
      setShowForm(false);
      event.currentTarget.reset();
    }
  }
  const days = useMemo(() => {
    if (view === "day") return [new Date(current)];
    if (view === "week")
      return Array.from({ length: 7 }, (_, index) => {
        const date = startOfWeek(current);
        date.setDate(date.getDate() + index);
        return date;
      });
    const first = new Date(current.getFullYear(), current.getMonth(), 1);
    const last = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    }).filter((date) => date <= last || date >= first);
  }, [current, view]);
  const eventsByDay = (date: Date) =>
    events.filter((event) => event.startAt && dateKey(new Date(event.startAt)) === dateKey(date));
  function shift(delta: number) {
    const next = new Date(current);
    if (view === "month") next.setMonth(next.getMonth() + delta);
    else if (view === "week") next.setDate(next.getDate() + delta * 7);
    else next.setDate(next.getDate() + delta);
    setCurrent(next);
  }
  const heading =
    view === "month"
      ? current.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : view === "week"
        ? `Week of ${startOfWeek(current).toLocaleDateString(undefined, { dateStyle: "medium" })}`
        : current.toLocaleDateString(undefined, { dateStyle: "full" });
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Module 26 · School calendar</div>
          <h1>Events & calendar</h1>
          <p>Publish the right date, time and reminder to the right school audience.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canManage && (
            <button className="btn-primary" onClick={() => setShowForm(true)}>
              <Plus size={14} />
              Create event
            </button>
          )}
          <button className="btn-secondary" onClick={() => exportEvents(events)}>
            <FileText size={13} />
            Event report
          </button>
        </div>
      </div>
      {(error || notice) && (
        <div className={error ? "login-error" : "login-success"} style={{ marginBottom: 14 }}>
          {error || notice}
        </div>
      )}
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">School calendar</div>
            <div className="panel-subtitle">
              Month, week and day views use the same published event records.
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="icon-button" onClick={() => shift(-1)} aria-label="Previous period">
              <ChevronLeft size={15} />
            </button>
            <button className="btn-secondary" onClick={() => setCurrent(new Date())}>
              Today
            </button>
            <button className="icon-button" onClick={() => shift(1)} aria-label="Next period">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
        <div className="module-tabs">
          {(["month", "week", "day"] as const).map((item) => (
            <button
              key={item}
              className={view === item ? "btn-primary" : "btn-secondary"}
              onClick={() => setView(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
          <strong style={{ margin: "auto 0 auto 8px", fontSize: 13 }}>{heading}</strong>
        </div>
        {view === "month" && (
          <div className="calendar-grid">
            <div className="calendar-weekdays">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="calendar-cells">
              {days.map((day) => (
                <div
                  className={`calendar-cell ${day.getMonth() !== current.getMonth() ? "muted-day" : ""}`}
                  key={dateKey(day)}
                >
                  <div className="calendar-date">{day.getDate()}</div>
                  {eventsByDay(day)
                    .slice(0, 3)
                    .map((event) => (
                      <button
                        className="calendar-event"
                        key={event.id}
                        onClick={() =>
                          canManage && void write({ action: "publish", eventId: event.id })
                        }
                      >
                        <span>{event.title}</span>
                        <small>{event.status === "published" ? "Published" : event.status}</small>
                      </button>
                    ))}
                  {eventsByDay(day).length > 3 && (
                    <small className="calendar-more">+{eventsByDay(day).length - 3} more</small>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {view !== "month" && (
          <div className={`calendar-list ${view === "day" ? "day-view" : ""}`}>
            {days.map((day) => (
              <article className="calendar-day" key={dateKey(day)}>
                <div className="calendar-day-label">
                  <strong>{day.toLocaleDateString(undefined, { weekday: "short" })}</strong>
                  <span>
                    {day.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </span>
                </div>
                <div className="calendar-day-events">
                  {eventsByDay(day).map((event) => (
                    <div className="announcement-card" key={event.id}>
                      <div className="announcement-top">
                        <div>
                          <span className="pill">{categoryLabel(event.category ?? "event")}</span>
                          <h3>{event.title}</h3>
                        </div>
                        <span
                          className={`pill ${event.status === "published" ? "active" : event.status === "cancelled" ? "pending" : ""}`}
                        >
                          {event.status}
                        </span>
                      </div>
                      <div className="announcement-meta">
                        <span>
                          <Clock3 size={12} />
                          {formatDate(event.startAt, timezone)}
                        </span>
                        <span>
                          <MapPin size={12} />
                          {event.location || "No location"}
                        </span>
                      </div>
                      {canManage && (
                        <div className="form-actions">
                          <button
                            className="btn-secondary"
                            onClick={() => void write({ action: "publish", eventId: event.id })}
                          >
                            <Send size={13} />
                            Publish
                          </button>
                          <button
                            className="btn-secondary"
                            onClick={() => void write({ action: "cancel", eventId: event.id })}
                          >
                            <XCircle size={13} />
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {!eventsByDay(day).length && (
                    <div className="empty-state" style={{ minHeight: 80 }}>
                      <p>No event records on this date.</p>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="content-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Reminder readiness</div>
              <div className="panel-subtitle">
                Reminder jobs remain pending until a configured delivery provider runs them.
              </div>
            </div>
            <RotateCcw size={16} color="#315ee8" />
          </div>
          <div className="mini-status-row">
            <span>
              <Megaphone size={13} />
              Published events
            </span>
            <strong>{events.filter((event) => event.status === "published").length}</strong>
          </div>
          <div className="mini-status-row">
            <span>
              <Clock3 size={13} />
              Reminder metadata
            </span>
            <strong>
              {events.filter((event) => event.reminderMinutes?.length).length} configured
            </strong>
          </div>
          <div className="mini-status-row">
            <span>
              <CalendarDays size={13} />
              All records
            </span>
            <strong>{events.length}</strong>
          </div>
        </article>
        <article className="notice">
          <CalendarDays size={18} color="#315ee8" />
          <div>
            <h3>Participant scope is explicit</h3>
            <p>
              Whole-school, teacher, parent, student and selected-role audiences are saved with each
              event. Unpublished drafts stay visible only to event managers.
            </p>
          </div>
        </article>
      </section>
      {showForm && (
        <div className="modal-backdrop">
          <section className="modal-card">
            <div className="panel-header">
              <div>
                <div className="panel-title">Create school event</div>
                <div className="panel-subtitle">
                  Save first, then publish when the audience and reminder plan are ready.
                </div>
              </div>
              <button className="icon-button" onClick={() => setShowForm(false)} aria-label="Close">
                ×
              </button>
            </div>
            <form className="form-grid" onSubmit={submit}>
              <label className="field full">
                <span>Event title</span>
                <input name="title" required placeholder="Inter-house sports meet" />
              </label>
              <label className="field">
                <span>Event category</span>
                <select name="category" defaultValue="school_ceremony">
                  {categories.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Participants</span>
                <select name="participants" defaultValue="school">
                  <option value="school">Whole school</option>
                  <option value="teachers">Teachers</option>
                  <option value="parents">Parents / guardians</option>
                  <option value="students">Students</option>
                  <option value="selected">Selected roles</option>
                </select>
              </label>
              <label className="field">
                <span>Start</span>
                <input name="startAt" type="datetime-local" required />
              </label>
              <label className="field">
                <span>End</span>
                <input name="endAt" type="datetime-local" required />
              </label>
              <label className="field">
                <span>Location</span>
                <input name="location" placeholder="Main hall / grounds" />
              </label>
              <label className="field">
                <span>Reminder minutes</span>
                <input name="reminderMinutes" placeholder="10080, 1440, 60" />
              </label>
              <label className="field full">
                <span>Target roles</span>
                <input name="targetRoles" placeholder="parent, student, class_teacher" />
              </label>
              <label className="field full">
                <span>Description</span>
                <textarea name="description" rows={3} placeholder="What participants should know" />
              </label>
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button className="btn-primary" disabled={busy}>
                  {busy ? "Saving…" : "Save draft"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
