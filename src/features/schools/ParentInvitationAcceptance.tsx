"use client";

import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Users } from "lucide-react";
import Link from "next/link";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type Invitation = { schoolName: string; guardianName: string; email: string; studentName: string; expiresAt: string };

export function ParentInvitationAcceptance({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [message, setMessage] = useState(token ? "" : "This invitation link is incomplete.");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token) return;
    void fetch(`/api/parent-invitations?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Invitation could not be loaded."); setInvitation(data.invitation); })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Invitation could not be loaded."));
  }, [token]);
  async function accept() {
    setBusy(true); setMessage("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/parent-invitations", { method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ token }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Invitation could not be accepted.");
      setMessage("Parent access activated. Opening your parent portal…");
      window.location.assign("/parent-portal");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Invitation could not be accepted."); } finally { setBusy(false); }
  }
  const signInUrl = `/?returnTo=${encodeURIComponent(`/parent-invite?token=${encodeURIComponent(token)}`)}`;
  const parentPortalUrl = `/?returnTo=${encodeURIComponent("/parent-portal")}`;
  return <main className="login-wrap"><section className="login-visual"><div className="brand"><div className="brand-mark"><img src="/e-school-mark.png" alt="" /></div><div><div className="brand-name">E-SmartSchool.lk</div><div className="brand-caption">Connected families</div></div></div><div><div className="eyebrow" style={{ color: "#d5deff" }}>Parent invitation</div><h1>Stay close to your child’s school day.</h1><p>Use your verified email to securely connect to the school parent portal.</p></div><div className="login-metrics"><div className="login-metric"><strong>Secure</strong><span>Verified email access</span></div><div className="login-metric"><strong>Connected</strong><span>Student-linked updates</span></div></div></section><section className="login-main"><div className="login-card"><div className="brand"><div className="brand-mark"><Users size={19} /></div><div><div className="brand-name">Parent portal access</div><div className="brand-caption">One invitation · one family link</div></div></div><h2>Join your child’s school</h2>{invitation ? <div className="notice" style={{ margin: "18px 0" }}><CheckCircle2 size={20} color="#25795d" /><div><h3>{invitation.schoolName}</h3><p>This invite is for <strong>{invitation.guardianName}</strong> ({invitation.email}) to connect with <strong>{invitation.studentName}</strong>.</p></div></div> : null}{message && <div className={message.startsWith("Parent access") ? "login-success" : "login-error"} role="status">{message}</div>}<button className="btn-primary" disabled={busy || !token || !invitation} onClick={() => void accept()} style={{ width: "100%", padding: 12 }}>{busy ? "Activating access…" : "Accept parent invitation"}<ArrowRight size={15} /></button><p className="footer-note">If you need to sign in or create the invited account, <Link href={signInUrl}>continue here</Link>. Return here after verifying your email. If this link has expired, <Link href={parentPortalUrl}>sign in and configure your child manually</Link>.</p></div></section></main>;
}
