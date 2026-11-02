import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

/**
 * Web client config for project esmartschool-e326c.
 * Vercel NEXT_PUBLIC_* env vars override these when set (preferred in production).
 */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyBeD7wT1xHbJNp58H0RVXFQdEkbp1-Oxho",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "esmartschool-e326c.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "esmartschool-e326c",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:529824343285:web:94fd2a60977091df5251bc",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "esmartschool-e326c.firebasestorage.app",
};

export function getFirebaseClient() {
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(
      `Firebase web configuration is incomplete (missing: ${missing.join(", ")}). ` +
        "Set NEXT_PUBLIC_FIREBASE_* in Vercel → Settings → Environment Variables, then redeploy.",
    );
  }
  const app = getApps().length ? getApp() : initializeApp(config);
  return { app, auth: getAuth(app), storage: getStorage(app) };
}
