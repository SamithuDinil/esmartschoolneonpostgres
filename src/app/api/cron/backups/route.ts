import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { safeEqual } from "@/server/secure-compare";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const PAGE_SIZE = 100;
const TIME_BUDGET_MS = 240_000;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(secret && supplied && safeEqual(secret, supplied));
}

/**
 * Daily scheduled-backup recorder (Vercel Cron, see vercel.json). For every active school whose
 * `settings/backup` document is enabled it records one `backupRuns` entry per UTC day. Runs are
 * idempotent: a second invocation on the same day is reported as already recorded.
 */
async function run(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { db } = getAdminServices();
  const providerReady = Boolean(process.env.BACKUP_EXPORT_BUCKET);
  const status = providerReady ? "queued_for_managed_export" : "pending_provider_configuration";
  const dayKey = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const deadline = Date.now() + TIME_BUDGET_MS;
  const summary = { recorded: 0, alreadyRecorded: 0, disabled: 0, failed: 0, complete: true };

  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = db.collection("schools").orderBy("__name__").limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;

    for (const school of page.docs) {
      if (school.get("status") !== "active") continue;
      if (Date.now() > deadline) {
        summary.complete = false;
        return NextResponse.json({ ok: true, ...summary });
      }
      try {
        const root = school.ref;
        const config = await root.collection("settings").doc("backup").get();
        if (config.get("enabled") !== true) {
          summary.disabled += 1;
          continue;
        }
        const runId = `scheduled-${dayKey}`;
        const runRef = root.collection("backupRuns").doc(runId);
        const now = new Date();
        try {
          await runRef.create({
            schoolId: school.id,
            type: "database_backup",
            trigger: "scheduled",
            status,
            encryption: providerReady ? "provider_managed_encryption" : "not_configured",
            storageAccess: "private_only",
            storageBucketConfigured: providerReady,
            createdAt: now,
            updatedAt: now,
            note: providerReady
              ? "Queued for configured private export provider."
              : "Configure the approved private backup provider before an encrypted artifact can be created.",
          });
        } catch (error) {
          if ((error as { code?: number }).code === 6) {
            summary.alreadyRecorded += 1; // ALREADY_EXISTS
            continue;
          }
          throw error;
        }
        await root
          .collection("settings")
          .doc("backup")
          .set(
            { lastAttemptAt: now, lastRunId: runId, lastStatus: status, updatedAt: now },
            { merge: true },
          );
        summary.recorded += 1;
      } catch {
        summary.failed += 1;
      }
    }
    if (page.size < PAGE_SIZE) break;
    cursor = page.docs[page.docs.length - 1];
  }
  return NextResponse.json({ ok: true, ...summary });
}

export const GET = run; // Vercel Cron issues GET requests
export const POST = run;
