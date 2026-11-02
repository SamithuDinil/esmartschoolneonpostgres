"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

export function InvitationAcceptance({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(token ? "" : "This invitation link is incomplete.");
  async function accept() {
    setBusy(true);
    setMessage("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/memberships/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ token }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Invitation could not be accepted.");
      setMessage("Invitation accepted. Opening your school workspace…");
      window.location.assign("/dashboard");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Invitation could not be accepted.");
    } finally {
      setBusy(false);
    }
  }
  const signInUrl = `/?returnTo=${encodeURIComponent(`/invite?token=${encodeURIComponent(token)}`)}`;
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
            Secure invitation
          </div>
          <h1>Join your school workspace.</h1>
          <p>
            This single-use invitation is linked to the email address selected by the System Owner.
          </p>
        </div>
      </section>
      <section className="login-main">
        <div className="login-card">
          <div className="brand">
            <div className="brand-mark">
              <img src="/e-school-mark.png" alt="" />
            </div>
            <div>
              <div className="brand-name">Membership invitation</div>
              <div className="brand-caption">Verified access required</div>
            </div>
          </div>
          <h2>Accept invitation</h2>
          <p className="lead">
            Sign in with the verified recipient account before activating this school membership.
          </p>
          {message && (
            <div
              className={
                message.startsWith("Invitation accepted") ? "login-success" : "login-error"
              }
              role="status"
            >
              {message}
            </div>
          )}
          <button
            className="btn-primary"
            disabled={busy || !token}
            onClick={() => void accept()}
            style={{ width: "100%", padding: 12 }}
          >
            {busy ? "Checking invitation…" : "Accept school invitation"}
            <ArrowRight size={15} />
          </button>
          <p className="footer-note">
            If you need to sign in or create the invited account,{" "}
            <Link href={signInUrl}>continue here</Link>. You will return to this invitation
            afterward.
          </p>
        </div>
      </section>
    </main>
  );
}
