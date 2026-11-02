"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type SupportSession = { schoolId: string; schoolName: string; reason: string; expiresAt: string };
export function OwnerSupportBanner() {
  const [session, setSession] = useState<SupportSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  useEffect(() => {
    let active = true;
    void fetch("/api/platform/support-session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (active) setSession(data.session ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  async function exit() {
    setBusy(true);
    setError("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/platform/support-session", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrf },
      });
      if (!response.ok) throw new Error("Support session could not be closed.");
      setSession(null);
      router.replace("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not exit support mode.");
    } finally {
      setBusy(false);
    }
  }
  if (!session) return null;
  return (
    <div role="alert" className="support-banner">
      <div className="support-banner-main">
        <span className="support-banner-icon">
          <ShieldAlert size={18} />
        </span>
        <div className="support-banner-copy">
          <strong>System Owner support mode · {session.schoolName}</strong>
          <span>
            Full school administrator access. Reason: {session.reason} · Expires{" "}
            {new Date(session.expiresAt).toLocaleTimeString()} · Actions are attributed to your
            System Owner account.
          </span>
          {error && <span className="support-banner-error">{error}</span>}
        </div>
      </div>
      <button
        type="button"
        className="support-banner-exit"
        disabled={busy}
        onClick={() => void exit()}
      >
        {busy ? "Exiting…" : "Exit support mode"}
      </button>
    </div>
  );
}
