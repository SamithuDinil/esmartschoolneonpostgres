import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getPostgresPool } from "../src/lib/postgres";

type Node = Record<string, unknown>;
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");
function accountFromEnv() {
  const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON is required.");
  let text = raw.trim();
  if (!text.startsWith("{") && !text.startsWith('"')) text = Buffer.from(text, "base64").toString("utf8").trim();
  let account = JSON.parse(text);
  if (typeof account === "string") account = JSON.parse(account);
  account.private_key = account.private_key?.replace(/\\n/g, "\n");
  if (!account.project_id || !account.client_email || !account.private_key) throw new Error("Firebase service account is incomplete.");
  return account as { project_id: string; client_email: string; private_key: string };
}
function recordsAtCollection(collection: unknown, prefix: string, out: Array<{ path: string; data: Node }>) {
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) return;
  for (const [encodedId, raw] of Object.entries(collection as Node)) {
    if (encodedId === "__metadata" || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const child = raw as Node;
    let id: string;
    try { id = decode(encodedId); } catch { continue; }
    const path = `${prefix}/${id}`;
    if (child.__data && typeof child.__data === "object" && !Array.isArray(child.__data)) out.push({ path, data: child.__data as Node });
    const nested = child.__collections;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      for (const [encodedCollection, docs] of Object.entries(nested as Node)) {
        let name: string;
        try { name = decode(encodedCollection); } catch { continue; }
        recordsAtCollection(docs, `${path}/${name}`, out);
      }
    }
  }
}

async function main() {
  if (process.env.CONFIRM_RTDB_TO_NEON_MIGRATION !== "yes") throw new Error("Set CONFIRM_RTDB_TO_NEON_MIGRATION=yes after reviewing the target Firebase and Neon databases. This importer does not delete source records.");
  const account = accountFromEnv();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || account.project_id;
  if (projectId !== account.project_id) throw new Error("Firebase service account project does not match NEXT_PUBLIC_FIREBASE_PROJECT_ID.");
  const app = getApps()[0] ?? initializeApp({ credential: cert(account as Parameters<typeof cert>[0]), projectId, databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${projectId}-default-rtdb.firebaseio.com` });
  const snapshot = await getDatabase(app).ref("__edusphere_documents").get();
  const tree = snapshot.val();
  if (!tree || typeof tree !== "object") throw new Error("No Edusphere RTDB document root was found.");
  const records: Array<{ path: string; data: Node }> = [];
  for (const [encodedCollection, docs] of Object.entries(tree as Node)) {
    let name: string;
    try { name = decode(encodedCollection); } catch { continue; }
    recordsAtCollection(docs, name, records);
  }
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const record of records) {
      await client.query("INSERT INTO app_documents(path,data) VALUES($1,$2) ON CONFLICT(path) DO UPDATE SET data=EXCLUDED.data,updated_at=now()", [record.path, JSON.stringify(record.data)]);
    }
    await client.query("COMMIT");
    console.log(`Migrated ${records.length} document records into Neon. RTDB source was not modified.`);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); await pool.end(); }
}

main().catch((error) => { console.error("RTDB to Neon migration failed:", error instanceof Error ? error.message : error); process.exitCode = 1; });
