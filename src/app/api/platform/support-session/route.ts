import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { SESSION_COOKIE } from "@/server/context";
import { hasValidCsrf } from "@/server/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const COOKIE = "edusphere_owner_support";
const MAX_AGE_SECONDS = 60 * 60;
const RECENT_AUTH_SECONDS = 10 * 60;
const startSchema = z.object({
  schoolId: z
    .string()
    .min(1)
    .max(150)
    .regex(/^[^/]+$/),
  reason: z.string().trim().min(10).max(500),
  reauthenticatedIdToken: z.string().min(20).max(20_000),
});
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const cookieOptions = (secure: boolean) => ({
  httpOnly: true,
  secure,
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE_SECONDS,
});

async function ownerFromRequest(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { auth, db } = getAdminServices();
    const decoded = await auth.verifySessionCookie(token, true);
    if (decoded.email_verified !== true) return null;
    const owner = await db.collection("platformOwners").doc(decoded.uid).get();
    if (!owner.exists || owner.get("status") !== "active") return null;
    return { uid: decoded.uid, auth, db };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const owner = await ownerFromRequest(request);
  if (!owner)
    return NextResponse.json(
      { session: null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  const token = request.cookies.get(COOKIE)?.value;
  if (!token)
    return NextResponse.json(
      { session: null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  const ref = owner.db.collection("platformSupportSessions").doc(hash(token));
  const snap = await ref.get();
  const expiresAt = snap.get("expiresAt")?.toDate?.();
  if (
    !snap.exists ||
    snap.get("ownerUid") !== owner.uid ||
    snap.get("status") !== "active" ||
    !(expiresAt instanceof Date) ||
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now()
  ) {
    const response = NextResponse.json(
      { session: null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
    response.cookies.set(COOKIE, "", {
      ...cookieOptions(request.nextUrl.protocol === "https:"),
      maxAge: 0,
    });
    return response;
  }
  const schoolId = String(snap.get("schoolId") ?? "");
  const school = await owner.db.collection("schools").doc(schoolId).get();
  if (
    !school.exists ||
    school.get("status") !== "active" ||
    school.get("emergencyLock")?.status === "active" ||
    school.get("deletion")?.status === "pending"
  ) {
    await ref.update({
      status: "revoked",
      revokedAt: new Date(),
      revokedReason: "school_unavailable",
    });
    const response = NextResponse.json(
      { session: null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
    response.cookies.set(COOKIE, "", {
      ...cookieOptions(request.nextUrl.protocol === "https:"),
      maxAge: 0,
    });
    return response;
  }
  return NextResponse.json(
    {
      session: {
        schoolId,
        schoolName: String(school.get("name") ?? "School"),
        reason: String(snap.get("reason") ?? ""),
        expiresAt: expiresAt.toISOString(),
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const owner = await ownerFromRequest(request);
  if (!owner) return NextResponse.json({ error: "System Owner access required." }, { status: 403 });
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "Provide a valid school, a reason (10–500 characters), and recent reauthentication.",
      },
      { status: 400 },
    );
  try {
    const fresh = await owner.auth.verifyIdToken(parsed.data.reauthenticatedIdToken, true);
    if (
      fresh.uid !== owner.uid ||
      !Number.isInteger(fresh.auth_time) ||
      Math.floor(Date.now() / 1000) - fresh.auth_time < 0 ||
      Math.floor(Date.now() / 1000) - fresh.auth_time > RECENT_AUTH_SECONDS
    )
      return NextResponse.json(
        { error: "Reauthenticate as this System Owner within the last 10 minutes." },
        { status: 403 },
      );
    const schoolRef = owner.db.collection("schools").doc(parsed.data.schoolId);
    const school = await schoolRef.get();
    if (!school.exists) return NextResponse.json({ error: "School not found." }, { status: 404 });
    if (
      school.get("status") !== "active" ||
      school.get("emergencyLock")?.status === "active" ||
      school.get("deletion")?.status === "pending"
    )
      return NextResponse.json(
        { error: "Support access is only available for active, unlocked schools." },
        { status: 409 },
      );
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + MAX_AGE_SECONDS * 1000);
    const sessionRef = owner.db.collection("platformSupportSessions").doc(hash(token));
    await owner.db.runTransaction(async (tx) => {
      const current = await tx.get(schoolRef);
      if (
        !current.exists ||
        current.get("status") !== "active" ||
        current.get("emergencyLock")?.status === "active" ||
        current.get("deletion")?.status === "pending"
      )
        throw new Error("SCHOOL_UNAVAILABLE");
      tx.create(sessionRef, {
        ownerUid: owner.uid,
        schoolId: schoolRef.id,
        reason: parsed.data.reason.trim(),
        status: "active",
        createdAt: now,
        expiresAt,
        reauthenticatedAt: new Date(fresh.auth_time * 1000),
      });
      tx.create(owner.db.collection("platformAuditLogs").doc(), {
        actorUid: owner.uid,
        action: "owner.support_session_started",
        schoolId: schoolRef.id,
        reason: parsed.data.reason.trim(),
        expiresAt,
        occurredAt: now,
      });
      tx.create(schoolRef.collection("auditLogs").doc(), {
        schoolId: schoolRef.id,
        actorUid: owner.uid,
        actorType: "system_owner_support",
        action: "owner.support_session_started",
        reason: parsed.data.reason.trim(),
        occurredAt: now,
      });
    });
    const response = NextResponse.json(
      {
        ok: true,
        schoolId: schoolRef.id,
        redirectTo: "/dashboard",
        expiresAt: expiresAt.toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(COOKIE, token, cookieOptions(request.nextUrl.protocol === "https:"));
    return response;
  } catch (cause) {
    if (cause instanceof Error && cause.message === "SCHOOL_UNAVAILABLE")
      return NextResponse.json(
        { error: "Support access is only available for active, unlocked schools." },
        { status: 409 },
      );
    console.error("[owner-support] could not start session", cause);
    return NextResponse.json({ error: "Support session could not be started." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const owner = await ownerFromRequest(request);
  const token = request.cookies.get(COOKIE)?.value;
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(COOKIE, "", {
    ...cookieOptions(request.nextUrl.protocol === "https:"),
    maxAge: 0,
  });
  if (owner && token) {
    const ref = owner.db.collection("platformSupportSessions").doc(hash(token));
    await owner.db.runTransaction(async (tx) => {
      const session = await tx.get(ref);
      if (
        !session.exists ||
        session.get("ownerUid") !== owner.uid ||
        session.get("status") !== "active"
      )
        return;
      const schoolId = String(session.get("schoolId") ?? "");
      tx.update(ref, { status: "ended", endedAt: new Date() });
      tx.create(owner.db.collection("platformAuditLogs").doc(), {
        actorUid: owner.uid,
        action: "owner.support_session_ended",
        schoolId,
        occurredAt: new Date(),
      });
      tx.create(owner.db.collection("schools").doc(schoolId).collection("auditLogs").doc(), {
        schoolId,
        actorUid: owner.uid,
        actorType: "system_owner_support",
        action: "owner.support_session_ended",
        occurredAt: new Date(),
      });
    });
  }
  return response;
}
