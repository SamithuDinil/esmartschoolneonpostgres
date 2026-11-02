import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { createRtdbFirestoreCompat } from "@/lib/firebase/rtdb-firestore-compat";
import { getPostgresPool } from "@/lib/postgres";

function parseServiceAccount(raw: string) {
  let text = raw.trim();
  if (!text.startsWith("{") && !text.startsWith('"'))
    text = Buffer.from(text, "base64").toString("utf8").trim();
  let value: unknown = JSON.parse(text);
  if (typeof value === "string") value = JSON.parse(value);
  const account = value as { private_key?: string };
  if (account.private_key) account.private_key = account.private_key.replace(/\\n/g, "\n");
  return account as { project_id?: string; client_email?: string; private_key?: string };
}

function getAdminApp() {
  const existing = getApps()[0];
  if (existing) return existing;

  const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson)
    throw new Error(
      "Firebase server credentials are not configured: FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON is empty or missing.",
    );

  let serviceAccount: { project_id?: string; client_email?: string; private_key?: string };
  try {
    serviceAccount = parseServiceAccount(serviceAccountJson);
  } catch {
    throw new Error(
      "FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the full key file contents.",
    );
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON is missing client_email or private_key.");
  }
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || serviceAccount.project_id;
  if (!projectId) throw new Error("Firebase project ID is not configured.");
  if (serviceAccount.project_id !== projectId) {
    throw new Error(
      `Service account project "${serviceAccount.project_id}" does not match NEXT_PUBLIC_FIREBASE_PROJECT_ID "${projectId}".`,
    );
  }
  const credential = cert(serviceAccount as Parameters<typeof cert>[0]);

  return initializeApp({
    credential,
    projectId,
    storageBucket:
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`,
  });
}

export function getAdminServices() {
  const app = getAdminApp();
  const postgres = getPostgresPool();
  return {
    app,
    auth: getAuth(app),
    db: createRtdbFirestoreCompat(postgres) as unknown as Firestore,
    postgres,
    bucket: getStorage(app).bucket(),
  };
}
