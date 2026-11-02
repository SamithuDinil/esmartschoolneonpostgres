import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { createRtdbFirestoreCompat } from "../src/lib/firebase/rtdb-firestore-compat";
import { getPostgresPool } from "../src/lib/postgres";

const OWNER_EMAILS = ["samithudinildewapriya@gmail.com", "sasindagimhana10@gmail.com"];

function loadServiceAccount() {
  const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON is required.");
  let text = raw.trim();
  if (!text.startsWith("{") && !text.startsWith('\"')) text = Buffer.from(text, "base64").toString("utf8").trim();
  let parsed: unknown = JSON.parse(text);
  if (typeof parsed === "string") parsed = JSON.parse(parsed);
  if (!parsed || typeof parsed !== "object") throw new Error("Firebase service account must be a JSON object.");
  const account = parsed as { project_id?: string; client_email?: string; private_key?: string };
  if (!account.project_id || !account.client_email || !account.private_key) {
    throw new Error("Firebase service account is missing project_id, client_email, or private_key.");
  }
  account.private_key = account.private_key.replace(/\\n/g, "\n");
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || account.project_id;
  if (projectId !== account.project_id) throw new Error("Service account project does not match NEXT_PUBLIC_FIREBASE_PROJECT_ID.");
  return { account, projectId };
}

async function main() {
  const { account, projectId } = loadServiceAccount();
  const app = getApps()[0] ?? initializeApp({
    credential: cert({ projectId: account.project_id, clientEmail: account.client_email, privateKey: account.private_key }),
    projectId,
  });
  const auth = getAuth(app);
  const db = createRtdbFirestoreCompat(getPostgresPool());

  for (const email of OWNER_EMAILS) {
    const user = await auth.getUserByEmail(email);
    if (!user.emailVerified) throw new Error(`Refusing to provision unverified account: ${email}`);
    await db.collection("platformOwners").doc(user.uid).set({
      uid: user.uid,
      email: user.email,
      role: "SYSTEM_OWNER",
      status: "active",
      provisionedAt: new Date(),
      provisionedBy: "server-side-migration",
    }, { merge: true });
    console.log(`Provisioned verified owner UID ${user.uid}`);
  }
}

main().catch((error) => {
  console.error("System Owner provisioning failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
