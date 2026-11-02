import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { SESSION_COOKIE } from "@/server/context";
import { hasValidCsrf } from "@/server/csrf";
import { permissionsForRole } from "@/server/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const RECENT_AUTH_MS = 10 * 60 * 1000;
const RECOVERY_DAYS = 30;
const paramsSchema = z.object({
  schoolId: z
    .string()
    .min(1)
    .max(150)
    .regex(/^[^/]+$/),
});

async function authorize(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { auth, db } = getAdminServices();
    const decoded = await auth.verifySessionCookie(token, true);
    if (decoded.email_verified !== true) return null;
    const owner = await db.collection("platformOwners").doc(decoded.uid).get();
    if (!owner.exists || owner.get("status") !== "active") return null;
    return { auth, db, uid: decoded.uid, authTime: decoded.auth_time };
  } catch {
    return null;
  }
}
function error(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
function safeMember(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const row = doc.data();
  return {
    uid: String(row.uid ?? doc.id),
    displayName: String(row.displayName ?? row.name ?? ""),
    email: String(row.email ?? ""),
    role: String(row.role ?? ""),
    status: String(row.status ?? ""),
    createdAt: row.createdAt ?? null,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ schoolId: string }> },
) {
  const platform = await authorize(request);
  if (!platform) return error("Forbidden", 403);
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return error("Invalid school", 400);
  try {
    const ref = platform.db.collection("schools").doc(parsed.data.schoolId);
    const snap = await ref.get();
    if (!snap.exists) return error("School not found", 404);
    const [members, principal] = await Promise.all([
      ref.collection("memberships").orderBy("displayName").limit(500).get(),
      ref
        .collection("memberships")
        .where("role", "in", ["principal", "school_owner", "school_admin"])
        .where("status", "==", "active")
        .limit(10)
        .get(),
    ]);
    const school = snap.data()!;
    const leader = principal.docs[0];
    return NextResponse.json(
      {
        school: {
          id: snap.id,
          name: school.name ?? "",
          slug: school.slug ?? "",
          status: school.status ?? "active",
          schoolCode: school.schoolCode ?? "",
          email: school.email ?? "",
          phone: school.phone ?? "",
          address: school.address ?? "",
          district: school.district ?? "",
          province: school.province ?? "",
          country: school.country ?? "",
          schoolType: school.schoolType ?? "",
          logoUrl: school.logoUrl ?? "",
          description: school.description ?? "",
          ownerUid: school.ownerUid ?? null,
          createdAt: school.createdAt ?? null,
          updatedAt: school.updatedAt ?? null,
          deletion: school.deletion ?? null,
          emergencyLock: school.emergencyLock ?? null,
        },
        principal: leader ? safeMember(leader) : null,
        members: members.docs.map(safeMember),
        membersTruncated: members.size === 500,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return error("Unable to load school details", 500);
  }
}

const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    status: z.enum(["active", "suspended", "archived"]).optional(),
    email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
    phone: z.string().trim().max(40).optional(),
    address: z.string().trim().max(300).optional(),
    district: z.string().trim().max(100).optional(),
    province: z.string().trim().max(100).optional(),
    country: z.string().trim().max(80).optional(),
    schoolType: z.string().trim().max(80).optional(),
    logoUrl: z.union([z.string().url().max(2048), z.literal("")]).optional(),
    description: z.string().trim().max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign-principal"), uid: z.string().trim().min(1).max(128) }),
  z.object({ action: z.literal("suspend-principal"), uid: z.string().trim().min(1).max(128) }),
  z.object({
    action: z.literal("request-deletion"),
    confirmation: z.string().trim().min(2).max(120),
  }),
  z.object({ action: z.literal("cancel-deletion") }),
  z.object({
    action: z.literal("emergency-lock"),
    confirmation: z.string().trim().min(2).max(120),
    reason: z.string().trim().min(10).max(500),
  }),
  z.object({ action: z.literal("release-emergency-lock") }),
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ schoolId: string }> },
) {
  if (!hasValidCsrf(request)) return error("Invalid request token", 403);
  const platform = await authorize(request);
  if (!platform) return error("Forbidden", 403);
  const parsed = paramsSchema.safeParse(await params);
  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !body.success) return error("Invalid school update", 400);
  if (body.data.status === "archived") {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      !Number.isInteger(platform.authTime) ||
      nowSeconds - platform.authTime! < 0 ||
      nowSeconds - platform.authTime! > RECENT_AUTH_MS / 1000
    )
      return error("Reauthenticate recently to archive a school", 403);
  }
  const ref = platform.db.collection("schools").doc(parsed.data.schoolId);
  try {
    await platform.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("NOT_FOUND");
      if (snap.get("deletion")?.status === "pending") throw new Error("DELETION_PENDING");
      if (snap.get("emergencyLock")?.status === "active" && body.data.status !== undefined)
        throw new Error("EMERGENCY_LOCK_ACTIVE");
      if (snap.get("status") === "setup_pending" && body.data.status !== undefined)
        throw new Error("PRINCIPAL_ACCEPTANCE_REQUIRED");
      tx.update(ref, { ...body.data, updatedAt: FieldValue.serverTimestamp() });
      const audit = platform.db.collection("platformAuditLogs").doc();
      tx.create(audit, {
        actorUid: platform.uid,
        action: body.data.status ? `school.${body.data.status}` : "school.updated",
        schoolId: ref.id,
        fields: Object.keys(body.data),
        occurredAt: FieldValue.serverTimestamp(),
      });
    });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return error(
      e instanceof Error && e.message === "NOT_FOUND"
        ? "School not found"
        : e instanceof Error && e.message === "DELETION_PENDING"
          ? "School deletion is pending"
          : e instanceof Error && e.message === "EMERGENCY_LOCK_ACTIVE"
            ? "Release the emergency lock before changing the school status"
            : e instanceof Error && e.message === "PRINCIPAL_ACCEPTANCE_REQUIRED"
              ? "A principal must accept the invitation before this school is activated"
              : "Update failed",
      e instanceof Error && e.message === "NOT_FOUND"
        ? 404
        : e instanceof Error &&
            ["DELETION_PENDING", "EMERGENCY_LOCK_ACTIVE", "PRINCIPAL_ACCEPTANCE_REQUIRED"].includes(
              e.message,
            )
          ? 409
          : 500,
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ schoolId: string }> },
) {
  if (!hasValidCsrf(request)) return error("Invalid request token", 403);
  const platform = await authorize(request);
  if (!platform) return error("Forbidden", 403);
  const parsed = paramsSchema.safeParse(await params);
  const body = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !body.success) return error("Invalid action", 400);
  const ref = platform.db.collection("schools").doc(parsed.data.schoolId);
  try {
    if (body.data.action === "request-deletion") {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (
        !Number.isInteger(platform.authTime) ||
        nowSeconds - platform.authTime! < 0 ||
        nowSeconds - platform.authTime! > RECENT_AUTH_MS / 1000
      )
        return error("Reauthenticate recently to request deletion", 403);
      await platform.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("NOT_FOUND");
        const name = String(snap.get("name") ?? "");
        if (body.data.action !== "request-deletion" || body.data.confirmation !== name)
          throw new Error("NAME_MISMATCH");
        if (snap.get("deletion")?.status === "pending" || snap.get("status") === "archived")
          throw new Error("ALREADY_PENDING");
        const requestedAt = new Date();
        const recoverUntil = new Date(requestedAt.getTime() + RECOVERY_DAYS * 86400000);
        tx.update(ref, {
          status: "deletion_pending",
          deletion: {
            status: "pending",
            previousStatus: String(snap.get("status") ?? "active"),
            requestedAt,
            recoverUntil,
            requestedBy: platform.uid,
          },
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.create(platform.db.collection("platformAuditLogs").doc(), {
          actorUid: platform.uid,
          action: "school.deletion_requested",
          schoolId: ref.id,
          requestedAt,
          recoverUntil,
          occurredAt: FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json(
        { ok: true, recoveryDays: RECOVERY_DAYS },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (body.data.action === "emergency-lock") {
      const lockAction = body.data;
      if (lockAction.action !== "emergency-lock")
        return error("Invalid emergency-lock action", 400);
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (
        !Number.isInteger(platform.authTime) ||
        nowSeconds - platform.authTime! < 0 ||
        nowSeconds - platform.authTime! > RECENT_AUTH_MS / 1000
      )
        return error("Reauthenticate recently to lock a school", 403);
      await platform.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("NOT_FOUND");
        if (snap.get("deletion")?.status === "pending" || snap.get("status") === "archived")
          throw new Error("SCHOOL_LOCKED");
        if (String(snap.get("name") ?? "") !== lockAction.confirmation)
          throw new Error("NAME_MISMATCH");
        if (snap.get("emergencyLock")?.status === "active") throw new Error("ALREADY_LOCKED");
        const previousStatus = String(snap.get("status") ?? "active");
        tx.update(ref, {
          status: "suspended",
          emergencyLock: {
            status: "active",
            previousStatus,
            reason: lockAction.reason,
            actorUid: platform.uid,
            lockedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.create(platform.db.collection("platformAuditLogs").doc(), {
          actorUid: platform.uid,
          action: "school.emergency_locked",
          schoolId: ref.id,
          previousStatus,
          reason: lockAction.reason,
          occurredAt: FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (body.data.action === "release-emergency-lock") {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (
        !Number.isInteger(platform.authTime) ||
        nowSeconds - platform.authTime! < 0 ||
        nowSeconds - platform.authTime! > RECENT_AUTH_MS / 1000
      )
        return error("Reauthenticate recently to restore a school", 403);
      await platform.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("NOT_FOUND");
        if (snap.get("deletion")?.status === "pending") throw new Error("DELETION_PENDING");
        const lock = snap.get("emergencyLock");
        if (lock?.status !== "active") throw new Error("NOT_LOCKED");
        const previousStatus = ["active", "suspended", "setup_pending"].includes(
          String(lock.previousStatus),
        )
          ? String(lock.previousStatus)
          : "active";
        tx.update(ref, {
          status: previousStatus,
          emergencyLock: {
            ...lock,
            status: "released",
            releasedBy: platform.uid,
            releasedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.create(platform.db.collection("platformAuditLogs").doc(), {
          actorUid: platform.uid,
          action: "school.emergency_lock_released",
          schoolId: ref.id,
          restoredStatus: previousStatus,
          occurredAt: FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (body.data.action === "cancel-deletion") {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (
        !Number.isInteger(platform.authTime) ||
        nowSeconds - platform.authTime! < 0 ||
        nowSeconds - platform.authTime! > RECENT_AUTH_MS / 1000
      )
        return error("Reauthenticate recently to restore a school", 403);
      await platform.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("NOT_FOUND");
        const deletion = snap.get("deletion");
        const recoverUntil = deletion?.recoverUntil?.toDate?.();
        if (
          deletion?.status !== "pending" ||
          !(recoverUntil instanceof Date) ||
          recoverUntil.getTime() <= Date.now()
        )
          throw new Error("RECOVERY_EXPIRED");
        const previousStatus = ["active", "suspended", "archived"].includes(
          String(deletion.previousStatus),
        )
          ? String(deletion.previousStatus)
          : "active";
        tx.update(ref, {
          status: previousStatus,
          deletion: {
            ...deletion,
            status: "cancelled",
            cancelledAt: FieldValue.serverTimestamp(),
            cancelledBy: platform.uid,
          },
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.create(platform.db.collection("platformAuditLogs").doc(), {
          actorUid: platform.uid,
          action: "school.deletion_cancelled",
          schoolId: ref.id,
          restoredStatus: previousStatus,
          occurredAt: FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (body.data.action === "assign-principal") {
      const identifier = body.data.uid.trim();
      const [school, user] = await Promise.all([
        ref.get(),
        (identifier.includes("@")
          ? platform.auth.getUserByEmail(identifier.toLowerCase())
          : platform.auth.getUser(identifier)
        ).catch(() => null),
      ]);
      if (!school.exists) return error("School not found", 404);
      if (!user || user.disabled || !user.emailVerified)
        return error("Principal must be an existing enabled, verified user", 400);
      await platform.db.runTransaction(async (tx) => {
        const currentSchool = await tx.get(ref);
        if (!currentSchool.exists) throw new Error("NOT_FOUND");
        if (currentSchool.get("deletion")?.status === "pending")
          throw new Error("DELETION_PENDING");
        const members = await tx.get(
          ref
            .collection("memberships")
            .where("role", "in", ["principal", "school_owner", "school_admin"])
            .where("status", "==", "active"),
        );
        const memberRef = ref.collection("memberships").doc(user.uid);
        const existing = await tx.get(memberRef);
        for (const member of members.docs)
          tx.update(member.ref, {
            role: "vice_principal",
            permissions: [...permissionsForRole("vice_principal")],
            isOwner: false,
            updatedAt: FieldValue.serverTimestamp(),
          });
        tx.set(
          memberRef,
          {
            uid: user.uid,
            email: user.email ?? "",
            displayName: user.displayName ?? "",
            role: "principal",
            status: "active",
            permissions: [...permissionsForRole("principal")],
            isOwner: false,
            updatedAt: FieldValue.serverTimestamp(),
            ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
          },
          { merge: true },
        );
        tx.update(ref, {
          ...(currentSchool.get("status") === "setup_pending" ? { status: "active" } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.create(platform.db.collection("platformAuditLogs").doc(), {
          actorUid: platform.uid,
          action: "school.principal_assigned",
          schoolId: ref.id,
          principalUid: user.uid,
          occurredAt: FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
    } else if (body.data.action === "suspend-principal") {
      const principalUid = body.data.uid;
      await platform.db.runTransaction(async (tx) => {
        const school = await tx.get(ref);
        if (!school.exists) throw new Error("NOT_FOUND");
        const memberRef = ref.collection("memberships").doc(principalUid);
        const member = await tx.get(memberRef);
        if (
          !member.exists ||
          !["principal", "school_owner", "school_admin"].includes(String(member.get("role")))
        )
          throw new Error("NOT_PRINCIPAL");
        tx.update(memberRef, { status: "suspended", updatedAt: FieldValue.serverTimestamp() });
        if (school.get("ownerUid") === principalUid)
          tx.update(ref, { ownerUid: null, updatedAt: FieldValue.serverTimestamp() });
        tx.create(platform.db.collection("platformAuditLogs").doc(), {
          actorUid: platform.uid,
          action: "school.principal_suspended",
          schoolId: ref.id,
          principalUid,
          occurredAt: FieldValue.serverTimestamp(),
        });
      });
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (m === "NOT_FOUND") return error("School not found", 404);
    if (m === "NAME_MISMATCH") return error("School name confirmation does not match", 400);
    if (m === "ALREADY_PENDING") return error("School cannot be deleted in its current state", 409);
    if (m === "DELETION_PENDING") return error("School deletion is pending", 409);
    if (m === "RECOVERY_EXPIRED") return error("The school recovery period has expired", 409);
    if (m === "NOT_PRINCIPAL") return error("Principal membership not found", 404);
    if (m === "SCHOOL_LOCKED") return error("School is archived or deletion-pending", 409);
    if (m === "ALREADY_LOCKED") return error("An emergency lock is already active", 409);
    if (m === "NOT_LOCKED") return error("No emergency lock is active", 409);
    return error("Unable to complete school action", 500);
  }
}
