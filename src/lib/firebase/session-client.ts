"use client";

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  signInWithPopup,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { getFirebaseClient } from "./client";

const AUTH_FETCH_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = AUTH_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      credentials: init.credentials ?? "same-origin",
      cache: init.cache ?? "no-store",
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw new Error(
        "Sign-in timed out. Check your connection and that the server is responding, then try again.",
      );
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCsrfToken() {
  const response = await fetchWithTimeout("/api/auth/csrf");
  if (!response.ok) throw new Error("Unable to start a secure sign-in session. Please try again.");
  const body = (await response.json()) as { csrfToken?: string };
  if (!body.csrfToken)
    throw new Error("Unable to start a secure sign-in session. Please try again.");
  return body.csrfToken;
}

async function startServerSession(idToken: string, remember = false) {
  const csrfToken = await fetchCsrfToken();
  const response = await fetchWithTimeout("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ idToken, remember }),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(result.error ?? "Sign-in could not be completed.");
  }
}

async function startServerUsernameSession(username: string, password: string, remember: boolean) {
  const csrfToken = await fetchCsrfToken();
  const response = await fetchWithTimeout("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ username, password, remember }),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(result.error ?? "Invalid sign-in details.");
  }
}

export async function signIn(identifier: string, password: string, remember = false) {
  const trimmed = identifier.trim();
  // Usernames are resolved and verified server-side so the account email is never exposed to the browser.
  if (!trimmed.includes("@")) return startServerUsernameSession(trimmed, password, remember);
  const { auth } = getFirebaseClient();
  const credential = await signInWithEmailAndPassword(auth, trimmed, password);
  if (!credential.user.emailVerified) {
    await signOut(auth);
    throw new Error("Please verify your email address before signing in.");
  }
  try {
    await startServerSession(await credential.user.getIdToken(), remember);
  } finally {
    await signOut(auth);
  }
}

export async function signInWithGoogle() {
  const { auth } = getFirebaseClient();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  let credential;
  try {
    credential = await signInWithPopup(auth, provider);
  } catch (cause) {
    const code = (cause as { code?: string }).code;
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request")
      throw new Error("Google sign-in was cancelled.");
    if (code === "auth/popup-blocked")
      throw new Error(
        "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.",
      );
    if (code === "auth/unauthorized-domain")
      throw new Error(
        "This domain is not authorized for Google sign-in. In Firebase project esmartschool-e326c → Authentication → Settings → Authorized domains, add edusphere-ten-nu.vercel.app.",
      );
    if (code === "auth/operation-not-allowed")
      throw new Error("Google sign-in is not enabled for this Firebase project.");
    if (code === "auth/network-request-failed")
      throw new Error("Network error during Google sign-in. Check your connection and try again.");
    throw new Error("Google sign-in could not be completed. Please try again.");
  }
  try {
    if (!credential.user.emailVerified) {
      throw new Error("Your Google account email is not verified.");
    }
    await startServerSession(await credential.user.getIdToken(), true);
  } finally {
    await signOut(auth);
  }
}

export async function reauthenticateWithGoogleForSensitiveAction() {
  const { auth } = getFirebaseClient();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const credential = await signInWithPopup(auth, provider);
    if (!credential.user.emailVerified)
      throw new Error("Your Google account email is not verified.");
    return await credential.user.getIdToken(true);
  } catch (cause) {
    const code = (cause as { code?: string }).code;
    if (cause instanceof Error && cause.message === "Your Google account email is not verified.")
      throw cause;
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request")
      throw new Error("Google verification was cancelled.");
    if (code === "auth/popup-blocked")
      throw new Error(
        "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.",
      );
    if (code === "auth/unauthorized-domain")
      throw new Error(
        "This domain is not authorized for Google sign-in in Firebase Authentication.",
      );
    if (code === "auth/operation-not-allowed")
      throw new Error("Google sign-in is not enabled for this Firebase project.");
    throw new Error("Google verification could not be completed.");
  } finally {
    await signOut(auth);
  }
}

export async function registerAccount(email: string, password: string) {
  const { auth } = getFirebaseClient();
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(credential.user);
  await signOut(auth);
}

export async function requestPasswordReset(email: string) {
  const { auth } = getFirebaseClient();
  await sendPasswordResetEmail(auth, email);
}

export async function reauthenticateForSensitiveAction(email: string, password: string) {
  const { auth } = getFirebaseClient();
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  try {
    return await credential.user.getIdToken(true);
  } finally {
    await signOut(auth);
  }
}

export async function endServerSession() {
  try {
    const csrfToken = await fetchCsrfToken();
    await fetchWithTimeout("/api/auth/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    });
  } finally {
    try {
      await signOut(getFirebaseClient().auth);
    } catch {
      // Firebase client may not be configured; the server session cookie is already handled above.
    }
  }
}
