import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission, permissionsForRole } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { consumeRateLimit, rateLimitResponse, requestIp } from "@/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const validToken = (token: string) => /^[A-Za-z0-9_-]{40,60}$/.test(token);

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!validToken(token)) return NextResponse.json({ error: "Invitation is invalid or expired." }, { status: 404 });
  try {
    const { db } = getAdminServices();
    const index = await db.collection("parentInvitationTokens").doc(hashToken(token)).get();
    if (!index.exists || index.get("status") !== "active")
      return NextResponse.json({ error: "Invitation is invalid or expired." }, { status: 404 });
    const expiresAt = index.get("expiresAt")?.toDate?.();
    if (!(expiresAt instanceof Date) || expiresAt.getTime() <= Date.now())
      return NextResponse.json({ error: "This parent invitation has expired." }, { status: 410 });
    const school = await db.collection("schools").doc(String(index.get("schoolId"))).get();
    const student = await school.ref.collection("students").doc(String(index.get("studentId"))).get();
    if (!school.exists || !student.exists)
      return NextResponse.json({ error: "Invitation records are unavailable." }, { status: 404 });
    return NextResponse.json({
      invitation: {
        schoolName: school.get("name") ?? "School",
        guardianName: index.get("guardianName") ?? "Parent / guardian",
        email: index.get("email") ?? "",
        studentName: student.get("fullName") ?? "your child",
        expiresAt: expiresAt.toISOString(),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Invitation could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const rate = await consumeRateLimit(`parent-invite-create:${requestIp(request)}`, 20, 60 * 60 * 1000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  if (!hasValidCsrf(request)) return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "guardians.manage"))
    return NextResponse.json({ error: "Guardian management permission required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const guardianId = typeof body?.guardianId === "string" ? body.guardianId.trim() : "";
  const studentId = typeof body?.studentId === "string" ? body.studentId.trim() : "";
  const expiresInDays = Number(body?.expiresInDays ?? 14);
  if (!guardianId || !studentId || !Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30)
    return NextResponse.json({ error: "Select a guardian, student, and valid expiry period." }, { status: 400 });
  const { db } = getAdminServices();
  const school = db.collection("schools").doc(context.schoolId);
  try {
    const [guardian, student] = await Promise.all([
      school.collection("guardians").doc(guardianId).get(),
      school.collection("students").doc(studentId).get(),
    ]);
    const email = String(guardian.get("email") ?? "").trim().toLowerCase();
    if (!guardian.exists || !student.exists) return NextResponse.json({ error: "Guardian or student not found." }, { status: 404 });
    if (!email) return NextResponse.json({ error: "Add an email address to this guardian before sending an invite." }, { status: 400 });
    const token = randomBytes(32).toString("base64url");
    const hash = hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInDays * 86400000);
    const data = {
      schoolId: context.schoolId,
      guardianId,
      studentId,
      guardianName: String(guardian.get("fullName") ?? "Parent / guardian"),
      email,
      status: "active",
      relationship: String(guardian.get("relationship") ?? "Parent"),
      createdBy: context.uid,
      createdAt: now,
      expiresAt,
    };
    await db.runTransaction(async (tx) => {
      tx.set(school.collection("parentInvitations").doc(hash), data);
      tx.set(db.collection("parentInvitationTokens").doc(hash), data);
    });
    await school.collection("auditLogs").add({ schoolId: context.schoolId, actorUid: context.uid, action: "parent_invitation.created", recordType: "parentInvitation", recordId: hash, studentId, guardianId, occurredAt: now });
    return NextResponse.json({ ok: true, url: `${new URL(request.url).origin}/parent-invite?token=${encodeURIComponent(token)}`, expiresAt: expiresAt.toISOString() }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Parent invitation could not be created." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const rate = await consumeRateLimit(`parent-invite-accept:${requestIp(request)}`, 10, 60 * 60 * 1000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  if (!hasValidCsrf(request)) return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const uid = await getSessionUid();
  if (!uid) return NextResponse.json({ error: "Sign in and verify your email before accepting this invite." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  if (!validToken(token)) return NextResponse.json({ error: "This invitation link is invalid." }, { status: 400 });
  const { auth, db } = getAdminServices();
  try {
    const account = await auth.getUser(uid);
    if (!account.emailVerified || !account.email) return NextResponse.json({ error: "Verify your email before accepting this invite." }, { status: 403 });
    const hash = hashToken(token);
    const indexRef = db.collection("parentInvitationTokens").doc(hash);
    const index = await indexRef.get();
    if (!index.exists || index.get("status") !== "active") return NextResponse.json({ error: "This invitation is invalid or already used." }, { status: 404 });
    const school = db.collection("schools").doc(String(index.get("schoolId")));
    const invitationRef = school.collection("parentInvitations").doc(hash);
    const membershipRef = school.collection("memberships").doc(uid);
    const userRef = db.collection("users").doc(uid);
    const guardianRef = school.collection("guardians").doc(String(index.get("guardianId")));
    const studentRef = school.collection("students").doc(String(index.get("studentId")));
    const now = new Date();
    await db.runTransaction(async (tx) => {
      const [invitation, schoolSnapshot, guardian, student, membership] = await Promise.all([tx.get(invitationRef), tx.get(school), tx.get(guardianRef), tx.get(studentRef), tx.get(membershipRef)]);
      const expiresAt = invitation.get("expiresAt")?.toDate?.();
      if (!invitation.exists || invitation.get("status") !== "active") throw new Error("INVALID");
      if (!(expiresAt instanceof Date) || expiresAt.getTime() <= Date.now()) throw new Error("EXPIRED");
      if (!schoolSnapshot.exists || ["suspended", "archived", "deletion_pending"].includes(String(schoolSnapshot.get("status") ?? ""))) throw new Error("SCHOOL");
      if (!guardian.exists || !student.exists) throw new Error("RECORDS");
      if (String(invitation.get("email")).toLowerCase() !== account.email!.toLowerCase()) throw new Error("EMAIL");
      if (membership.exists && membership.get("status") === "active" && membership.get("role") !== "parent") throw new Error("MEMBER");
      tx.set(membershipRef, { uid, email: account.email, displayName: account.displayName ?? invitation.get("guardianName"), role: "parent", status: "active", permissions: [...permissionsForRole("parent")], acceptedAt: now, updatedAt: now, createdAt: membership.exists ? membership.get("createdAt") : now }, { merge: true });
      tx.set(userRef, { displayName: account.displayName ?? invitation.get("guardianName"), email: account.email, activeSchoolId: schoolSnapshot.id, updatedAt: now }, { merge: true });
      tx.set(school.collection("studentGuardianLinks").doc(`${student.id}_${guardian.id}`), { schoolId: schoolSnapshot.id, studentId: student.id, guardianId: guardian.id, guardianUid: uid, relationship: invitation.get("relationship") ?? "Parent", accessPermissions: ["attendance", "published_results", "fees", "report_cards", "announcements", "assignments"], status: "active", createdAt: now, createdBy: invitation.get("createdBy") }, { merge: true });
      tx.update(studentRef, { guardianIds: Array.from(new Set([...(student.get("guardianIds") ?? []), guardian.id])) });
      tx.update(invitationRef, { status: "accepted", acceptedBy: uid, acceptedAt: now });
      tx.update(indexRef, { status: "accepted", acceptedBy: uid, acceptedAt: now });
    });
    await school.collection("auditLogs").add({ schoolId: school.id, actorUid: uid, action: "parent_invitation.accepted", recordType: "parentInvitation", recordId: hash, occurredAt: now });
    return NextResponse.json({ ok: true, schoolId: school.id });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    const map: Record<string, [string, number]> = { INVALID: ["This invitation is invalid or already used.", 404], EXPIRED: ["This parent invitation has expired.", 410], EMAIL: ["Sign in with the invited guardian email address.", 403], MEMBER: ["This account already has another active role in this school.", 409], SCHOOL: ["This school is not accepting invitations.", 410], RECORDS: ["The linked student or guardian record is unavailable.", 404] };
    const [error, status] = map[message] ?? ["The parent invitation could not be accepted.", 500];
    return NextResponse.json({ error }, { status });
  }
}
