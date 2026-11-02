"use client";

import { useEffect, useState } from "react";
import { ArrowRight, HeartHandshake } from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type SchoolOption = { schoolId: string; schoolName: string; guardianName: string };

export function ParentWorkspaceActivation() {
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void fetch("/api/parent-onboarding", { cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to find your parent record.");
      setSchools(body.schools ?? []);
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to find your parent record.")).finally(() => setLoading(false));
  }, []);
  async function activate(schoolId: string) {
    setBusy(schoolId); setError("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/parent-onboarding", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ schoolId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Parent workspace activation failed.");
      window.location.assign("/parent-portal");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Parent workspace activation failed."); } finally { setBusy(""); }
  }
  if (loading) return <p className="panel-subtitle" style={{ marginTop: 12 }}>Checking for a parent record linked to your verified email…</p>;
  if (!schools.length && !error) return <p className="panel-subtitle" style={{ marginTop: 12 }}>No parent record was found for this email yet. Ask the school office to add this email to the student guardian record.</p>;
  return <section className="panel parent-workspace-activation" style={{ marginTop: 16 }}><div className="panel-header"><div><div className="panel-title">Parent account found</div><div className="panel-subtitle">Choose your school workspace to continue setting up your child link.</div></div><span className="portal-icon"><HeartHandshake size={16} /></span></div>{error && <p className="login-error" role="alert">{error}</p>}{schools.map((school) => <button className="school-option" type="button" key={school.schoolId} onClick={() => void activate(school.schoolId)} disabled={Boolean(busy)}><span className="school-avatar-fallback">{school.schoolName.slice(0, 2).toUpperCase()}</span><span><strong>{school.schoolName}</strong><small>Guardian record: {school.guardianName}</small></span><ArrowRight size={16} /></button>)}</section>;
}
