"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type Values = {
  name: string;
  schoolCode: string;
  shortName: string;
  schoolType: string;
  email: string;
  phone: string;
  address: string;
  district: string;
  province: string;
  country: string;
  logoUrl: string;
  description: string;
  academicYear: string;
  timeZone: string;
  currency: string;
  principalName: string;
  principalEmail: string;
};
const initial: Values = {
  name: "",
  schoolCode: "",
  shortName: "",
  schoolType: "private",
  email: "",
  phone: "",
  address: "",
  district: "",
  province: "",
  country: "LK",
  logoUrl: "",
  description: "",
  academicYear: String(new Date().getFullYear()),
  timeZone: "Asia/Colombo",
  currency: "LKR",
  principalName: "",
  principalEmail: "",
};

export function SchoolSetupForm({ systemOwner = false }: { systemOwner?: boolean }) {
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invitationUrl, setInvitationUrl] = useState("");
  const set = (key: keyof Values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const token = await fetchCsrfToken();
      const endpoint = systemOwner ? "/api/platform/schools/register" : "/api/schools";
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "School setup could not be completed.");
      if (systemOwner) setInvitationUrl(result.invitationUrl);
      else window.location.assign("/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "School setup could not be completed.");
    } finally {
      setBusy(false);
    }
  }
  const setField =
    (key: keyof Values) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      set(key, event.target.value);
  return (
    <main className="login-wrap">
      <section className="login-visual">
        <div className="brand">
          <div className="brand-mark">
            <img src="/e-school-mark.png" alt="" />
          </div>
          <div>
            <div className="brand-name">E-SmartSchool.lk</div>
          </div>
        </div>
        <div>
          <div className="eyebrow" style={{ color: "#d5deff" }}>
            {systemOwner ? "Platform school registration" : "Start with your school"}
          </div>
          <h1>
            {systemOwner
              ? "Create a complete school workspace."
              : "Build a trusted home for every school day."}
          </h1>
          <p>
            {systemOwner
              ? "Register the institution and securely invite its principal. The new school remains setup-pending until the principal accepts."
              : "Register your institution once. E-SmartSchool.lk provisions its settings, academic year, role defaults and school-owner access."}
          </p>
        </div>
        <div className="login-metrics">
          <div className="login-metric">
            <strong>Private by school</strong>
            <span>Records stay isolated by tenant</span>
          </div>
          <div className="login-metric">
            <strong>{systemOwner ? "Principal-led" : "Ready to lead"}</strong>
            <span>
              {systemOwner
                ? "School leadership stays school-scoped"
                : "You become the main administrator"}
            </span>
          </div>
        </div>
      </section>
      <section className="login-main">
        <div className="login-card setup-card">
          <div className="brand">
            <div className="brand-mark">
              <img src="/e-school-mark.png" alt="" />
            </div>
            <div>
              <div className="brand-name">School onboarding</div>
              <div className="brand-caption">
                {systemOwner ? "System Owner registration" : "Create your secure workspace"}
              </div>
            </div>
          </div>
          <h2>Register your school</h2>
          <p className="lead">
            Complete the institution profile. Required fields are marked with an asterisk.
          </p>
          <form className="login-form" onSubmit={submit}>
            <div className="setup-section">
              <div className="setup-section-title">Identity</div>
              <div className="form-grid">
                <label className="field">
                  School name *
                  <input
                    required
                    value={values.name}
                    onChange={setField("name")}
                    placeholder="Lakeside College"
                  />
                </label>
                <label className="field">
                  School code *
                  <input
                    required
                    value={values.schoolCode}
                    onChange={(event) => set("schoolCode", event.target.value.toUpperCase())}
                    placeholder="LAKESIDE"
                    pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
                  />
                  <small className="field-help">Unique platform identifier</small>
                </label>
                <label className="field">
                  Short name
                  <input
                    value={values.shortName}
                    onChange={setField("shortName")}
                    placeholder="Optional"
                  />
                </label>
                <label className="field">
                  School type
                  <select value={values.schoolType} onChange={setField("schoolType")}>
                    <option value="private">Private</option>
                    <option value="national">National</option>
                    <option value="provincial">Provincial</option>
                    <option value="international">International</option>
                    <option value="other">Other</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="setup-section">
              <div className="setup-section-title">Contact and location</div>
              <div className="form-grid">
                <label className="field">
                  School email *
                  <input
                    required
                    type="email"
                    value={values.email}
                    onChange={setField("email")}
                    placeholder="office@school.edu"
                  />
                </label>
                <label className="field">
                  Contact number *
                  <input
                    required
                    type="tel"
                    value={values.phone}
                    onChange={setField("phone")}
                    placeholder="+94 11 234 5678"
                  />
                </label>
                <label className="field full-span">
                  Address *
                  <input
                    required
                    value={values.address}
                    onChange={setField("address")}
                    placeholder="Street, town or city"
                  />
                </label>
                <label className="field">
                  District *
                  <input
                    required
                    value={values.district}
                    onChange={setField("district")}
                    placeholder="Colombo"
                  />
                </label>
                <label className="field">
                  Province *
                  <input
                    required
                    value={values.province}
                    onChange={setField("province")}
                    placeholder="Western"
                  />
                </label>
                <label className="field">
                  Country code *
                  <input
                    required
                    minLength={2}
                    maxLength={2}
                    value={values.country}
                    onChange={(event) => set("country", event.target.value.toUpperCase())}
                  />
                </label>
                <label className="field">
                  Time zone *
                  <input required value={values.timeZone} onChange={setField("timeZone")} />
                </label>
              </div>
            </div>
            <div className="setup-section">
              <div className="setup-section-title">Academic profile</div>
              <div className="form-grid">
                <label className="field">
                  Academic year *
                  <input
                    required
                    value={values.academicYear}
                    onChange={setField("academicYear")}
                    placeholder="2026"
                  />
                </label>
                <label className="field">
                  Currency *
                  <input
                    required
                    minLength={3}
                    maxLength={3}
                    value={values.currency}
                    onChange={(event) => set("currency", event.target.value.toUpperCase())}
                  />
                </label>
                <label className="field full-span">
                  School logo URL
                  <input
                    type="url"
                    value={values.logoUrl}
                    onChange={setField("logoUrl")}
                    placeholder="https://… (optional)"
                  />
                  <small className="field-help">
                    Use a durable HTTPS image URL. Private upload storage remains protected by the
                    existing document workflow.
                  </small>
                </label>
                <label className="field full-span">
                  School description
                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={values.description}
                    onChange={setField("description")}
                    placeholder="A short description for your institution"
                  />
                </label>
              </div>
            </div>
            {systemOwner && (
              <div className="setup-section">
                <div className="setup-section-title">Principal invitation</div>
                <p className="field-help">
                  The principal receives school-level access only after accepting a single-use,
                  email-bound invitation. No new account is created automatically.
                </p>
                <div className="form-grid">
                  <label className="field">
                    Principal full name *
                    <input
                      required
                      minLength={2}
                      maxLength={120}
                      value={values.principalName}
                      onChange={setField("principalName")}
                    />
                  </label>
                  <label className="field">
                    Principal email *
                    <input
                      required
                      type="email"
                      value={values.principalEmail}
                      onChange={setField("principalEmail")}
                    />
                  </label>
                </div>
              </div>
            )}
            {error && (
              <div className="login-error" role="alert">
                {error}
              </div>
            )}
            <button
              className="btn-primary"
              disabled={busy || Boolean(invitationUrl)}
              style={{ width: "100%", padding: 12 }}
            >
              {busy
                ? "Provisioning school…"
                : systemOwner
                  ? "Create school and principal invitation"
                  : "Create school workspace"}
              <ArrowRight size={15} />
            </button>
          </form>
          {invitationUrl && (
            <section className="setup-section" style={{ marginTop: 20 }}>
              <div className="setup-section-title">School created · setup pending</div>
              <p>
                Send this single-use link to {values.principalName} at {values.principalEmail}. It
                expires after seven days. The invitation is not emailed automatically, so copy/share
                it securely.
              </p>
              <QRCodeSVG value={invitationUrl} size={180} title="Principal invitation QR code" />
              <label className="field">
                Principal invitation URL
                <input
                  readOnly
                  value={invitationUrl}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(invitationUrl)}
              >
                Copy principal invitation
              </button>
              <p>
                <Link href="/system-owner/dashboard">Return to Control Center</Link>
              </p>
            </section>
          )}
          <div className="footer-note">
            <ShieldCheck size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
            {systemOwner
              ? "School principals receive no platform-level privileges. Setup remains pending until the invitation is accepted."
              : "Your account becomes the School Owner / Main Administrator after successful registration."}
          </div>
        </div>
      </section>
    </main>
  );
}
