"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import {
  registerAccount,
  requestPasswordReset,
  signIn,
  signInWithGoogle,
} from "@/lib/firebase/session-client";

type Mode = "signin" | "register" | "reset";

export default function HomePage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "register") setMode("register");
  }, []);

  function postSignInPath() {
    const requested = new URLSearchParams(window.location.search).get("returnTo") ?? "";
    return requested.startsWith("/group-registration?token=") ||
      requested.startsWith("/invite?token=") ||
      requested.startsWith("/parent-invite?token=") ||
      requested === "/parent-portal"
      ? requested
      : "/dashboard";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (mode === "register") {
        await registerAccount(email, password);
        setSuccess(
          "Account created. Check your inbox to verify your email, then sign in and accept your school invitation.",
        );
        setMode("signin");
      } else if (mode === "reset") {
        await requestPasswordReset(email);
        setSuccess("If that account exists, Firebase will send password reset instructions.");
      } else {
        await signIn(email, password, remember);
        window.location.assign(postSignInPath());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function googleSignIn() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await signInWithGoogle();
      window.location.assign(postSignInPath());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Google sign-in could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === "signin"
      ? "Sign in to your workspace"
      : mode === "register"
        ? "Create your account"
        : "Reset your password";
  const description =
    mode === "signin"
      ? "Use your verified school account to access the right records and tools."
      : mode === "register"
        ? "Create and verify your account, then accept an invitation from your school principal or administrator."
        : "Enter your account email and Firebase will send reset instructions if the account exists.";

  return (
    <main className="login-wrap">
      <section className="login-visual" aria-label="E-SmartSchool.lk introduction">
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
            A calmer way to run school
          </div>
          <h1>Make every school day more connected.</h1>
          <p>
            One secure workspace for the people, learning and operations that keep a school moving.
          </p>
        </div>
        <div className="login-metrics">
          <div className="login-metric">
            <strong>One school view</strong>
            <span>Connected records and routines</span>
          </div>
          <div className="login-metric">
            <strong>Built around trust</strong>
            <span>Access shaped by role and school</span>
          </div>
        </div>
      </section>
      <section className="login-main">
        <div className="login-card">
          <div className="brand">
            <div className="brand-mark">
              <img src="/e-school-mark.png" alt="" />
            </div>
            <div>
              <div className="brand-name">E-SmartSchool.lk</div>
              <div className="brand-caption">Secure school workspace</div>
            </div>
          </div>
          <h2>{heading}</h2>
          <p className="lead">{description}</p>
          <form className="login-form" onSubmit={submit}>
            <div className="field">
              <label htmlFor="email">
                {mode === "signin" ? "Email or username" : "Email address"}
              </label>
              <div style={{ position: "relative" }}>
                <Mail
                  size={15}
                  style={{ position: "absolute", left: 12, top: 12, color: "#95a0b1" }}
                />
                <input
                  id="email"
                  autoComplete="username"
                  type={mode === "signin" ? "text" : "email"}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@school.edu"
                  style={{ paddingLeft: 36 }}
                />
              </div>
            </div>
            {mode !== "reset" && (
              <div className="field">
                <label htmlFor="password">Password</label>
                <div style={{ position: "relative" }}>
                  <LockKeyhole
                    size={15}
                    style={{ position: "absolute", left: 12, top: 12, color: "#95a0b1" }}
                  />
                  <input
                    id="password"
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                    type={showPassword ? "text" : "password"}
                    minLength={8}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      mode === "register" ? "At least 8 characters" : "Enter your password"
                    }
                    style={{ paddingLeft: 36, paddingRight: 42 }}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: "absolute",
                      right: 10,
                      top: 8,
                      border: 0,
                      background: "transparent",
                      cursor: "pointer",
                      color: "#778397",
                    }}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>
            )}
            {mode === "signin" && (
              <>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  Remember me on this device
                </label>
                <div className="forgot-row">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setMode("reset");
                      setError("");
                      setSuccess("");
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
              </>
            )}
            {error && (
              <div className="login-error" role="alert">
                {error}
              </div>
            )}
            {success && (
              <div className="login-success" role="status">
                {success}
              </div>
            )}
            <button
              className="btn-primary"
              type="submit"
              disabled={busy}
              style={{ width: "100%", padding: 12 }}
            >
              {busy
                ? "Please wait…"
                : mode === "signin"
                  ? "Sign in"
                  : mode === "register"
                    ? "Create account"
                    : "Send reset instructions"}
              <ArrowRight size={15} />
            </button>
          </form>
          {mode !== "reset" && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  margin: "16px 0",
                  color: "#95a0b1",
                  fontSize: 12,
                }}
              >
                <span style={{ flex: 1, height: 1, background: "#e3e8ef" }} />
                or
                <span style={{ flex: 1, height: 1, background: "#e3e8ef" }} />
              </div>
              <button
                type="button"
                onClick={googleSignIn}
                disabled={busy}
                aria-label="Continue with Google"
                style={{
                  width: "100%",
                  padding: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  border: "1px solid #d5dbe5",
                  borderRadius: 10,
                  background: "#fff",
                  color: "#1f2937",
                  fontWeight: 600,
                  cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.5 17.7 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.5 5.8c4.4-4.1 7-10.1 7-17.5z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C1 16.4 0 20.1 0 24s1 7.6 2.6 10.8l7.9-6.1z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.2 0 11.4-2 15.2-5.6l-7.5-5.8c-2.1 1.4-4.8 2.2-7.7 2.2-6.3 0-11.6-4-13.5-9.8l-7.9 6.1C6.500 42.6 14.6 48 24 48z"
                  />
                </svg>
                Continue with Google
              </button>
            </>
          )}
          <div className="login-switch">
            {mode === "signin" ? (
              <>
                New to E-SmartSchool.lk?{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setMode("register");
                    setError("");
                    setSuccess("");
                  }}
                >
                  Create an account
                </button>
              </>
            ) : (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setMode("signin");
                  setError("");
                  setSuccess("");
                }}
              >
                Return to sign in
              </button>
            )}
          </div>
          <div className="footer-note">
            <ShieldCheck size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
            Your school controls which information you can access.
          </div>
        </div>
      </section>
    </main>
  );
}
