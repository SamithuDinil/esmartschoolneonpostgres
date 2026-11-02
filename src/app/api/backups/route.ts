import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { backupActionSchema, backupConfigSchema } from "@/server/schemas/backups";
import { writeAudit } from "@/server/services/audit";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const defaultConfig = {
  enabled: false,
  scheduleCron: "0 0 2 * * *",
  retentionDays: 30,
  scheduleTaskUid: null,
  providerStatus: "not_configured",
};
function dateValue(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value && "toDate" in value && typeof value.toDate === "function")
    return value.toDate().toISOString();
  return String(value);
}
function serialise(
  data: FirebaseFirestore.DocumentData,
  id: string,
): Record<string, unknown> & {
  id: string;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  lastAttemptAt: string | null;
  failureResolvedAt: string | null;
} {
  return {
    id,
    ...data,
    createdAt: dateValue(data.createdAt),
    updatedAt: dateValue(data.updatedAt),
    completedAt: dateValue(data.completedAt),
    lastAttemptAt: dateValue(data.lastAttemptAt),
    failureResolvedAt: dateValue(data.failureResolvedAt),
  };
}
function allowed(permissions: readonly string[]) {
  return hasPermission(permissions, "backups.read") || hasPermission(permissions, "backups.manage");
}
export async function GET() {
  const context = await getSchoolContext();
  if (!context || !allowed(context.permissions))
    return NextResponse.json({ error: "Backup access is restricted." }, { status: 403 });
  try {
    const root = getAdminServices().db.collection("schools").doc(context.schoolId);
    const [configSnap, runsSnap] = await Promise.all([
      root.collection("settings").doc("backup").get(),
      root.collection("backupRuns").limit(100).get(),
    ]);
    const config = { ...defaultConfig, ...(configSnap.data() ?? {}) };
    const runs = runsSnap.docs
      .map((doc) => serialise(doc.data(), doc.id))
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
    const failures = runs.filter((run) => String(run.status).includes("failed")).length;
    return NextResponse.json(
      {
        config,
        runs,
        failures,
        recovery: [
          "Confirm the latest successful run and retention window before a restore.",
          "Suspend application writes or place the school in maintenance mode.",
          "Restore only into an access-controlled recovery project or approved private bucket.",
          "Validate student, attendance, examination and finance integrity before reopening access.",
          "Record the restoration test or incident outcome in the audit history.",
        ],
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Backup status could not be loaded." }, { status: 500 });
  }
}
export async function PATCH(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "backups.manage"))
    return NextResponse.json(
      { error: "Backup management permission is required." },
      { status: 403 },
    );
  const parsed = backupConfigSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid backup configuration.", fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  try {
    const { db } = getAdminServices();
    const root = db.collection("schools").doc(context.schoolId);
    const config = {
      ...parsed.data,
      providerStatus: process.env.BACKUP_EXPORT_BUCKET ? "provider_configured" : "not_configured",
      updatedAt: new Date(),
      updatedBy: context.uid,
    };
    await root.collection("settings").doc("backup").set(config, { merge: true });
    if (parsed.data.scheduleTaskUid)
      await db.collection("backupSchedules").doc(parsed.data.scheduleTaskUid).set(
        {
          taskUid: parsed.data.scheduleTaskUid,
          schoolId: context.schoolId,
          enabled: parsed.data.enabled,
          updatedAt: new Date(),
          updatedBy: context.uid,
        },
        { merge: true },
      );
    await writeAudit(context, "backup.configuration.updated", {
      recordType: "backupConfig",
      recordId: "backup",
      changeSummary: `Backup schedule ${parsed.data.enabled ? "enabled" : "disabled"}; retention ${parsed.data.retentionDays} days`,
    });
    return NextResponse.json({ ok: true, providerStatus: config.providerStatus });
  } catch {
    return NextResponse.json(
      { error: "Backup configuration could not be saved." },
      { status: 500 },
    );
  }
}
export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "backups.manage"))
    return NextResponse.json(
      { error: "Backup management permission is required." },
      { status: 403 },
    );
  const parsed = backupActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid backup action." }, { status: 400 });
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  try {
    if (parsed.data.action === "resolve_failure") {
      if (!parsed.data.runId)
        return NextResponse.json({ error: "Backup run is required." }, { status: 400 });
      await root
        .collection("backupRuns")
        .doc(parsed.data.runId)
        .update({
          failureResolvedAt: new Date(),
          failureResolvedBy: context.uid,
          resolutionNote: parsed.data.reason ?? "Resolved by administrator",
          updatedAt: new Date(),
        });
      await writeAudit(context, "backup.failure.resolved", {
        recordType: "backupRun",
        recordId: parsed.data.runId,
        changeSummary: parsed.data.reason ?? "Backup failure marked resolved",
      });
      return NextResponse.json({ ok: true });
    }
    const isRestoreTest = parsed.data.action === "restore_test";
    const ref = root
      .collection("backupRuns")
      .doc(`${isRestoreTest ? "restore-test" : "manual"}-${Date.now()}`);
    const providerReady = Boolean(process.env.BACKUP_EXPORT_BUCKET);
    await ref.create({
      schoolId: context.schoolId,
      type: isRestoreTest ? "restoration_test" : "database_backup",
      status: isRestoreTest
        ? "restoration_test_pending"
        : providerReady
          ? "queued_for_managed_export"
          : "pending_provider_configuration",
      encryption: providerReady ? "provider_managed_encryption" : "not_configured",
      storageAccess: "private_only",
      storageBucketConfigured: providerReady,
      requestedBy: context.uid,
      note: isRestoreTest
        ? "Operator validation required; no production records are changed."
        : providerReady
          ? "Queued for the configured private export provider."
          : "Configure the approved private backup provider before an encrypted artifact can be created.",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await writeAudit(
      context,
      isRestoreTest ? "backup.restoration_test.requested" : "backup.requested",
      {
        recordType: "backupRun",
        recordId: ref.id,
        changeSummary: isRestoreTest ? "Restoration test requested" : "Manual backup requested",
      },
    );
    return NextResponse.json(
      {
        id: ref.id,
        status: isRestoreTest
          ? "restoration_test_pending"
          : providerReady
            ? "queued_for_managed_export"
            : "pending_provider_configuration",
      },
      { status: 201 },
    );
  } catch {
    return NextResponse.json({ error: "Backup action could not be recorded." }, { status: 500 });
  }
}
