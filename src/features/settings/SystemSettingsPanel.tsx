"use client";
import { useEffect, useState } from "react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";
import { CheckCircle2, Info, Save, ShieldCheck } from "lucide-react";

type Settings = {
  general: {
    name: string;
    logoUrl: string;
    phone: string;
    email: string;
    timezone: string;
    preferredLanguage: "en" | "si" | "ta";
    currency: string;
    dateFormat: string;
    academicYearId: string;
  };
  academic: {
    examinationTypes: string[];
    gradingSystem: string;
    attendanceRule: string;
    attendanceLowThreshold: number;
    activeTermId: string;
  };
  security: {
    passwordMinLength: number;
    sessionDurationDays: number;
    accountActivation: string;
    loginRestriction: string;
    auditLogAccess: string;
  };
  notifications: {
    emailEnabled: boolean;
    emailProvider: "none" | "resend";
    emailFrom: string;
    smsEnabled: boolean;
    smsProvider: "none" | "twilio";
    smsFrom: string;
    whatsappEnabled: boolean;
    templates: Record<string, string>;
    defaultPreference: string;
  };
  ai: { enabled: boolean; allowModelExplanation: boolean };
};
const tabs = [
  { id: "general", label: "General" },
  { id: "academic", label: "Academic" },
  { id: "security", label: "Security" },
  { id: "notifications", label: "Notifications" },
  { id: "ai", label: "Optional AI" },
];
const empty: Settings = {
  general: {
    name: "",
    logoUrl: "",
    phone: "",
    email: "",
    timezone: "Asia/Colombo",
    preferredLanguage: "en",
    currency: "LKR",
    dateFormat: "DD/MM/YYYY",
    academicYearId: "",
  },
  academic: {
    examinationTypes: ["Term test", "Mid-year", "Final examination"],
    gradingSystem: "School default",
    attendanceRule: "Present and late count toward attendance; excused is excluded.",
    attendanceLowThreshold: 80,
    activeTermId: "",
  },
  security: {
    passwordMinLength: 8,
    sessionDurationDays: 5,
    accountActivation: "email_verification",
    loginRestriction: "none",
    auditLogAccess: "leadership",
  },
  notifications: {
    emailEnabled: false,
    emailProvider: "none",
    emailFrom: "",
    smsEnabled: false,
    smsProvider: "none",
    smsFrom: "",
    whatsappEnabled: false,
    templates: {},
    defaultPreference: "in_app",
  },
  ai: { enabled: false, allowModelExplanation: false },
};

export function SystemSettingsPanel() {
  const [tab, setTab] = useState("general");
  const [providerState, setProviderState] = useState<{ email?: string; sms?: string }>({});
  const [settings, setSettings] = useState<Settings>(empty);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw Error(data.error);
        setSettings({ ...empty, ...data });
        setProviderState(data.providerState ?? {});
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "Settings could not be loaded."),
      )
      .finally(() => setBusy(false));
  }, []);
  function update(group: keyof Settings, key: string, value: unknown) {
    setSettings((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));
    setNotice("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(settings),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setNotice(
        `Saved at ${new Date(data.savedAt).toLocaleTimeString()}. Changes are recorded in audit history.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }
  if (busy)
    return (
      <main className="page-content">
        <div className="loading-state">Loading persistent system settings…</div>
      </main>
    );
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Configuration desk · School-wide</div>
          <h1>System settings</h1>
          <p>Review what E-SmartSchool.lk stores and how each setting affects downstream records.</p>
        </div>
        <div className="status-pill">
          <ShieldCheck size={14} /> Admin-managed
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
      <form onSubmit={save}>
        <div className="settings-tabs">
          {tabs.map((item) => (
            <button
              type="button"
              key={item.id}
              className={tab === item.id ? "btn-primary" : "btn-secondary"}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <section className="panel settings-panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">settings/system</div>
              <h2>{tabs.find((item) => item.id === tab)?.label} configuration</h2>
            </div>
            <Info size={19} />
          </div>
          {tab === "general" && (
            <div className="form-grid">
              {(
                [
                  ["name", "School name"],
                  ["logoUrl", "School logo URL"],
                  ["phone", "Contact phone"],
                  ["email", "Contact email"],
                  ["timezone", "School time zone"],
                  ["currency", "Currency"],
                  ["academicYearId", "Active academic year ID"],
                ] as const
              ).map(([key, label]) => (
                <label className="field" key={key}>
                  {label}
                  <input
                    value={settings.general[key]}
                    onChange={(event) => update("general", key, event.target.value)}
                  />
                </label>
              ))}
              <label className="field">
                Preferred language
                <select
                  value={settings.general.preferredLanguage}
                  onChange={(event) => update("general", "preferredLanguage", event.target.value)}
                >
                  <option value="en">English</option>
                  <option value="si">සිංහල</option>
                  <option value="ta">தமிழ்</option>
                </select>
              </label>
              <label className="field">
                Date format
                <select
                  value={settings.general.dateFormat}
                  onChange={(event) => update("general", "dateFormat", event.target.value)}
                >
                  <option>DD/MM/YYYY</option>
                  <option>MM/DD/YYYY</option>
                  <option>YYYY-MM-DD</option>
                </select>
              </label>
            </div>
          )}
          {tab === "academic" && (
            <div className="form-grid">
              <label className="field full-span">
                Examination types
                <span className="field-help">
                  Comma-separated labels used by examination workflows.
                </span>
                <input
                  value={settings.academic.examinationTypes.join(", ")}
                  onChange={(event) =>
                    update(
                      "academic",
                      "examinationTypes",
                      event.target.value
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </label>
              <label className="field">
                Grading system
                <input
                  value={settings.academic.gradingSystem}
                  onChange={(event) => update("academic", "gradingSystem", event.target.value)}
                />
              </label>
              <label className="field">
                Low attendance threshold (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.academic.attendanceLowThreshold}
                  onChange={(event) =>
                    update("academic", "attendanceLowThreshold", Number(event.target.value))
                  }
                />
              </label>
              <label className="field full-span">
                Attendance rules
                <textarea
                  rows={4}
                  value={settings.academic.attendanceRule}
                  onChange={(event) => update("academic", "attendanceRule", event.target.value)}
                />
              </label>
              <label className="field">
                Active term ID
                <input
                  value={settings.academic.activeTermId}
                  onChange={(event) => update("academic", "activeTermId", event.target.value)}
                />
              </label>
              <div className="settings-callout">
                <CheckCircle2 size={15} />
                <span>
                  Grades, classes, subjects and academic terms remain managed in School
                  administration.
                </span>
              </div>
            </div>
          )}
          {tab === "security" && (
            <div className="form-grid">
              <label className="field">
                Minimum password length
                <input
                  type="number"
                  min={8}
                  max={64}
                  value={settings.security.passwordMinLength}
                  onChange={(event) =>
                    update("security", "passwordMinLength", Number(event.target.value))
                  }
                />
              </label>
              <label className="field">
                Session duration (days)
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={settings.security.sessionDurationDays}
                  onChange={(event) =>
                    update("security", "sessionDurationDays", Number(event.target.value))
                  }
                />
              </label>
              <label className="field">
                Account activation
                <select
                  value={settings.security.accountActivation}
                  onChange={(event) => update("security", "accountActivation", event.target.value)}
                >
                  <option value="email_verification">Email verification</option>
                  <option value="admin_only">Administrator approval</option>
                  <option value="manual_review">Manual review</option>
                </select>
              </label>
              <label className="field">
                Login restrictions
                <select
                  value={settings.security.loginRestriction}
                  onChange={(event) => update("security", "loginRestriction", event.target.value)}
                >
                  <option value="none">None</option>
                  <option value="school_domain">Approved school domain</option>
                  <option value="approved_devices">Approved devices</option>
                </select>
              </label>
              <label className="field">
                Audit log access
                <select
                  value={settings.security.auditLogAccess}
                  onChange={(event) => update("security", "auditLogAccess", event.target.value)}
                >
                  <option value="leadership">School leadership</option>
                  <option value="school_admin_only">School administrators only</option>
                </select>
              </label>
              <div className="settings-callout">
                <ShieldCheck size={15} />
                <span>Permission grants remain role-scoped and are enforced by the server.</span>
              </div>
            </div>
          )}
          {tab === "notifications" && (
            <div className="form-grid">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={settings.notifications.emailEnabled}
                  onChange={(event) =>
                    update("notifications", "emailEnabled", event.target.checked)
                  }
                />
                <span>
                  <strong>Email notifications</strong>
                  <small>
                    Enabled channels send supported alerts when provider credentials are installed
                    server-side.
                  </small>
                </span>
              </label>
              <label className="field">
                Email gateway
                <select
                  value={settings.notifications.emailProvider}
                  onChange={(event) => update("notifications", "emailProvider", event.target.value)}
                >
                  <option value="none">Not configured</option>
                  <option value="resend">Resend</option>
                </select>
              </label>
              <label className="field">
                Verified sender email
                <input
                  type="email"
                  value={settings.notifications.emailFrom}
                  onChange={(event) => update("notifications", "emailFrom", event.target.value)}
                  placeholder="school@example.org"
                />
              </label>
              <div className="settings-callout full-span">
                <Info size={15} />
                <span>
                  Email status:{" "}
                  <strong>{(providerState.email ?? "not_configured").replaceAll("_", " ")}</strong>.
                  Delivery requires EMAIL_PROVIDER_API_KEY and a verified sender domain in Resend.
                  Never paste API secrets here.
                </span>
              </div>
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={settings.notifications.smsEnabled}
                  onChange={(event) => update("notifications", "smsEnabled", event.target.checked)}
                />
                <span>
                  <strong>SMS notifications</strong>
                  <small>
                    Can be enabled after your school subscribes to a supported SMS gateway.
                  </small>
                </span>
              </label>
              <label className="field">
                SMS gateway
                <select
                  value={settings.notifications.smsProvider}
                  onChange={(event) => update("notifications", "smsProvider", event.target.value)}
                >
                  <option value="none">Not configured</option>
                  <option value="twilio">Twilio</option>
                </select>
              </label>
              <label className="field">
                SMS sender number
                <input
                  value={settings.notifications.smsFrom}
                  onChange={(event) => update("notifications", "smsFrom", event.target.value)}
                  placeholder="+15551234567"
                />
              </label>
              <div className="settings-callout full-span">
                <Info size={15} />
                <span>
                  SMS status:{" "}
                  <strong>{(providerState.sms ?? "not_configured").replaceAll("_", " ")}</strong>.
                  Twilio requires server secrets SMS_TWILIO_ACCOUNT_SID and SMS_PROVIDER_API_KEY
                  (auth token). Gateway charges may apply. Credentials are never stored in school
                  settings.
                </span>
              </div>
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={settings.notifications.whatsappEnabled}
                  onChange={(event) =>
                    update("notifications", "whatsappEnabled", event.target.checked)
                  }
                />
                <span>
                  <strong>WhatsApp integration</strong>
                  <small>Only approved recipients may receive messages.</small>
                </span>
              </label>
              <label className="field">
                Default preference
                <select
                  value={settings.notifications.defaultPreference}
                  onChange={(event) =>
                    update("notifications", "defaultPreference", event.target.value)
                  }
                >
                  <option value="in_app">In-app only</option>
                  <option value="all_configured">All configured channels</option>
                  <option value="email">Email when available</option>
                </select>
              </label>
              <label className="field full-span">
                Important announcement template
                <textarea
                  rows={4}
                  value={settings.notifications.templates.important ?? ""}
                  onChange={(event) =>
                    update("notifications", "templates", {
                      ...settings.notifications.templates,
                      important: event.target.value,
                    })
                  }
                  placeholder="Template text; recipient checks remain server-side."
                />
              </label>
            </div>
          )}
          {tab === "ai" && (
            <div className="ai-settings-card">
              <div className="toggle-card">
                <input
                  type="checkbox"
                  checked={settings.ai.enabled}
                  onChange={(event) => update("ai", "enabled", event.target.checked)}
                />
                <span>
                  <strong>Enable optional AI assistant</strong>
                  <small>
                    Disabled by default. The platform continues to work normally when off.
                  </small>
                </span>
              </div>
              <div className="toggle-card">
                <input
                  type="checkbox"
                  checked={settings.ai.allowModelExplanation}
                  onChange={(event) => update("ai", "allowModelExplanation", event.target.checked)}
                  disabled={!settings.ai.enabled}
                />
                <span>
                  <strong>Allow built-in model explanations</strong>
                  <small>
                    Only aggregate, redacted school context is sent; no student-level identifiers or
                    welfare records.
                  </small>
                </span>
              </div>
              <div className="settings-callout">
                <Info size={15} />
                <span>
                  Deterministic summaries remain available as the safe fallback whenever the
                  optional model is unavailable.
                </span>
              </div>
            </div>
          )}
          <div className="settings-footer">
            <span>Changes are stored under the school tenant and recorded in audit history.</span>
            <button className="btn-primary" disabled={saving}>
              <Save size={15} />
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </section>
      </form>
    </main>
  );
}
