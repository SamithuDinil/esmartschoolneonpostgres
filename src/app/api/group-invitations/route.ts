import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission, permissionsForRole, type Role } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { consumeRateLimit, rateLimitResponse, requestIp } from "@/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const reviewAllowed = (c: Awaited<ReturnType<typeof getSchoolContext>>) =>
  !!c && (c.role === "principal" || hasPermission(c.permissions, "memberships.manage"));

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!token) {
    const c = await getSchoolContext();
    if (!reviewAllowed(c))
      return NextResponse.json(
        { error: "Principal or membership-management access required." },
        { status: 403 },
      );
    try {
      const school = getAdminServices().db.collection("schools").doc(c!.schoolId);
      const [snap, pending] = await Promise.all([
        school.collection("groupInvitations").orderBy("createdAt", "desc").limit(100).get(),
        school
          .collection("registrationRequests")
          .where("status", "==", "pending")
          .limit(5000)
          .get(),
      ]);
      const pendingByInvitation = new Map<string, number>();
      for (const request of pending.docs) {
        const hash = String(request.get("invitationHash") ?? "");
        if (hash) pendingByInvitation.set(hash, (pendingByInvitation.get(hash) ?? 0) + 1);
      }
      return NextResponse.json(
        {
          invitations: snap.docs.map((doc) => ({
            id: doc.id,
            role: doc.get("role"),
            status: doc.get("status"),
            requiresApproval: doc.get("requiresApproval") !== false,
            gradeRestriction: doc.get("gradeRestriction") ?? "",
            createdBy: doc.get("createdBy") ?? "",
            pendingApprovals: pendingByInvitation.get(doc.id) ?? 0,
            maxUses: doc.get("maxUses"),
            usedCount: doc.get("usedCount"),
            expiresAt: doc.get("expiresAt")?.toDate?.()?.toISOString() ?? null,
            createdAt: doc.get("createdAt")?.toDate?.()?.toISOString() ?? null,
          })),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return NextResponse.json({ error: "Invitation list could not be loaded." }, { status: 500 });
    }
  }
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token))
    return NextResponse.json({ error: "Invitation is invalid or expired." }, { status: 404 });
  try {
    const { db } = getAdminServices();
    const index = await db.collection("groupInvitationTokens").doc(tokenHash(token)).get();
    if (!index.exists || index.get("status") !== "active")
      return NextResponse.json({ error: "Invitation is invalid or expired." }, { status: 404 });
    const data = index.data()!;
    const expiry = data.expiresAt?.toDate?.();
    if (
      !(expiry instanceof Date) ||
      expiry.getTime() <= Date.now() ||
      Number(data.usedCount) >= Number(data.maxUses)
    )
      return NextResponse.json({ error: "Invitation is expired or fully used." }, { status: 410 });
    const school = await db.collection("schools").doc(String(data.schoolId)).get();
    if (
      !school.exists ||
      ["setup_pending", "suspended", "archived", "deletion_pending"].includes(
        String(school.get("status") ?? ""),
      )
    )
      return NextResponse.json({ error: "Invitation is unavailable." }, { status: 404 });
    return NextResponse.json(
      {
        invitation: {
          schoolName: school.get("name") ?? "School",
          role: data.role,
          requiresApproval: data.requiresApproval !== false,
          gradeRestriction: data.gradeRestriction ?? "",
          expiresAt: expiry.toISOString(),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Invitation could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const rate = await consumeRateLimit(
    `group-invite-create:${requestIp(request)}`,
    20,
    60 * 60 * 1000,
  );
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const c = await getSchoolContext();
  if (!reviewAllowed(c))
    return NextResponse.json(
      { error: "Principal or membership-management access required." },
      { status: 403 },
    );
  const body = await request.json().catch(() => null);
  if (body?.action === "extend") {
    const id = typeof body.id === "string" ? body.id : "";
    const days = Number(body.days);
    if (!/^[a-f0-9]{64}$/.test(id) || !Number.isInteger(days) || days < 1 || days > 90)
      return NextResponse.json(
        { error: "Provide a valid link and extension from 1 to 90 days." },
        { status: 400 },
      );
    const { db } = getAdminServices();
    const school = db.collection("schools").doc(c!.schoolId);
    const invitation = school.collection("groupInvitations").doc(id);
    try {
      const expiresAt = await db.runTransaction(async (tx) => {
        const current = await tx.get(invitation);
        if (!current.exists) throw new Error("NOT_FOUND");
        if (current.get("status") !== "active") throw new Error("NOT_ACTIVE");
        const oldExpiry = current.get("expiresAt")?.toDate?.();
        const base =
          oldExpiry instanceof Date && oldExpiry.getTime() > Date.now() ? oldExpiry : new Date();
        const extended = new Date(base.getTime() + days * 86400000);
        tx.update(invitation, { expiresAt: extended, updatedAt: new Date() });
        tx.update(db.collection("groupInvitationTokens").doc(id), {
          expiresAt: extended,
          updatedAt: new Date(),
        });
        tx.create(school.collection("auditLogs").doc(), {
          schoolId: c!.schoolId,
          actorUid: c!.uid,
          action: "group_invitation.extended",
          recordType: "groupInvitation",
          recordId: id,
          extensionDays: days,
          expiresAt: extended,
          occurredAt: new Date(),
        });
        return extended;
      });
      return NextResponse.json({ ok: true, expiresAt: expiresAt.toISOString() });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      return NextResponse.json(
        {
          error:
            message === "NOT_FOUND"
              ? "Invitation not found."
              : message === "NOT_ACTIVE"
                ? "Only active invitations can be extended."
                : "Invitation could not be extended.",
        },
        { status: message === "NOT_FOUND" ? 404 : message === "NOT_ACTIVE" ? 409 : 500 },
      );
    }
  }
  const role = body?.role;
  const maxUses = Number(body?.maxUses);
  const expiresInDays = Number(body?.expiresInDays);
  const requiresApproval =
    typeof body?.requiresApproval === "boolean" ? body.requiresApproval : true;
  const gradeRestriction =
    role === "student" && typeof body?.gradeRestriction === "string"
      ? body.gradeRestriction.trim().slice(0, 40)
      : "";
  if (
    !["student", "class_teacher", "subject_teacher"].includes(role) ||
    !Number.isInteger(maxUses) ||
    maxUses < 1 ||
    maxUses > 500 ||
    !Number.isInteger(expiresInDays) ||
    expiresInDays < 1 ||
    expiresInDays > 90
  )
    return NextResponse.json(
      { error: "Choose a supported student/teacher role, 1–500 uses, and 1–90 days." },
      { status: 400 },
    );
  const token = randomBytes(32).toString("base64url");
  const hash = tokenHash(token);
  const now = new Date();
  const expiry = new Date(now.getTime() + expiresInDays * 86400000);
  const { db } = getAdminServices();
  const school = db.collection("schools").doc(c!.schoolId);
  await db.runTransaction(async (tx) => {
    tx.create(school.collection("groupInvitations").doc(hash), {
      schoolId: c!.schoolId,
      role,
      status: "active",
      requiresApproval,
      ...(gradeRestriction ? { gradeRestriction } : {}),
      maxUses,
      usedCount: 0,
      createdBy: c!.uid,
      createdAt: now,
      expiresAt: expiry,
    });
    tx.create(db.collection("groupInvitationTokens").doc(hash), {
      schoolId: c!.schoolId,
      status: "active",
      role,
      requiresApproval,
      ...(gradeRestriction ? { gradeRestriction } : {}),
      maxUses,
      usedCount: 0,
      expiresAt: expiry,
    });
  });
  await school.collection("auditLogs").add({
    schoolId: c!.schoolId,
    actorUid: c!.uid,
    action: "group_invitation.created",
    recordType: "groupInvitation",
    recordId: hash,
    role,
    maxUses,
    expiresAt: expiry,
    occurredAt: now,
  });
  return NextResponse.json(
    {
      ok: true,
      url: `${new URL(request.url).origin}/group-registration?token=${encodeURIComponent(token)}`,
      expiresAt: expiry.toISOString(),
    },
    { status: 201 },
  );
}

export async function DELETE(request: NextRequest) {
  const rate = await consumeRateLimit(
    `group-invite-revoke:${requestIp(request)}`,
    30,
    60 * 60 * 1000,
  );
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const c = await getSchoolContext();
  if (!reviewAllowed(c))
    return NextResponse.json(
      { error: "Principal or membership-management access required." },
      { status: 403 },
    );
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!/^[a-f0-9]{64}$/.test(id))
    return NextResponse.json({ error: "Invitation ID is invalid." }, { status: 400 });
  const { db } = getAdminServices();
  const school = db.collection("schools").doc(c!.schoolId);
  const invitation = school.collection("groupInvitations").doc(id);
  try {
    await db.runTransaction(async (tx) => {
      const current = await tx.get(invitation);
      if (!current.exists) throw new Error("NOT_FOUND");
      if (current.get("status") !== "active") throw new Error("NOT_ACTIVE");
      tx.update(invitation, { status: "revoked", revokedAt: new Date(), revokedBy: c!.uid });
      tx.update(db.collection("groupInvitationTokens").doc(id), {
        status: "revoked",
        revokedAt: new Date(),
      });
    });
    await school.collection("auditLogs").add({
      schoolId: c!.schoolId,
      actorUid: c!.uid,
      action: "group_invitation.revoked",
      recordType: "groupInvitation",
      recordId: id,
      occurredAt: new Date(),
    });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    return NextResponse.json(
      {
        error:
          message === "NOT_FOUND"
            ? "Invitation not found."
            : message === "NOT_ACTIVE"
              ? "Invitation is no longer active."
              : "Invitation could not be revoked.",
      },
      { status: message === "NOT_FOUND" ? 404 : message === "NOT_ACTIVE" ? 409 : 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const rate = await consumeRateLimit(
    `group-registration:${requestIp(request)}`,
    8,
    60 * 60 * 1000,
  );
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const uid = await getSessionUid();
  if (!uid)
    return NextResponse.json(
      { error: "Sign in with a verified email address first." },
      { status: 401 },
    );
  const { auth, db } = getAdminServices();
  const account = await auth.getUser(uid);
  if (!account.emailVerified || !account.email)
    return NextResponse.json(
      { error: "Verify your email address before registering." },
      { status: 403 },
    );
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim().slice(0, 120) : "";
  const admissionNumber =
    typeof body?.admissionNumber === "string" ? body.admissionNumber.trim().slice(0, 80) : "";
  const contactNumber =
    typeof body?.contactNumber === "string" ? body.contactNumber.trim().slice(0, 40) : "";
  const teacherId = typeof body?.teacherId === "string" ? body.teacherId.trim().slice(0, 80) : "";
  const grade = typeof body?.grade === "string" ? body.grade.trim().slice(0, 40) : "";
  const className = typeof body?.className === "string" ? body.className.trim().slice(0, 80) : "";
  const qualifications =
    typeof body?.qualifications === "string" ? body.qualifications.trim().slice(0, 500) : "";
  const subjects = Array.isArray(body?.subjects)
    ? body.subjects
        .filter((value: unknown): value is string => typeof value === "string")
        .map((value: string) => value.trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, 20)
    : typeof body?.subjects === "string"
      ? body.subjects
          .split(",")
          .map((value: string) => value.trim().slice(0, 80))
          .filter(Boolean)
          .slice(0, 20)
      : [];
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token) || fullName.length < 2)
    return NextResponse.json(
      { error: "Provide a valid invitation and full name." },
      { status: 400 },
    );
  const hash = tokenHash(token);
  const indexRef = db.collection("groupInvitationTokens").doc(hash);
  const index = await indexRef.get();
  if (!index.exists || index.get("status") !== "active")
    return NextResponse.json({ error: "Invitation is invalid." }, { status: 404 });
  const schoolId = String(index.get("schoolId"));
  const role = String(index.get("role"));
  if (!(role === "student" || role === "class_teacher" || role === "subject_teacher"))
    return NextResponse.json({ error: "Invitation role is invalid." }, { status: 409 });
  const school = db.collection("schools").doc(schoolId);
  const membership = school.collection("memberships").doc(uid);
  const requestRef = school.collection("registrationRequests").doc(uid);
  const studentRef = school.collection("students").doc(uid);
  const now = new Date();
  try {
    const created = await db.runTransaction(async (tx) => {
      const [invite, activeMembership, pendingRequest, student, schoolSnapshot, activeMemberships] =
        await Promise.all([
          tx.get(school.collection("groupInvitations").doc(hash)),
          tx.get(membership),
          tx.get(requestRef),
          role === "student" ? tx.get(studentRef) : Promise.resolve(null),
          tx.get(school),
          tx.get(school.collection("memberships").where("status", "==", "active")),
        ]);
      if (
        !schoolSnapshot.exists ||
        ["setup_pending", "suspended", "archived", "deletion_pending"].includes(
          String(schoolSnapshot.get("status") ?? ""),
        )
      )
        throw new Error("SCHOOL_UNAVAILABLE");
      if (!invite.exists || invite.get("status") !== "active")
        throw new Error("INVITATION_INVALID");
      const expiry = invite.get("expiresAt")?.toDate?.();
      const count = Number(invite.get("usedCount") ?? 0);
      if (!(expiry instanceof Date) || expiry.getTime() <= Date.now())
        throw new Error("INVITATION_EXPIRED");
      if (count >= Number(invite.get("maxUses"))) throw new Error("INVITATION_FULL");
      if (activeMembership.exists && activeMembership.get("status") === "active")
        throw new Error("ALREADY_MEMBER");
      if (pendingRequest.exists && pendingRequest.get("status") === "pending")
        throw new Error("DUPLICATE_REQUEST");
      if (role === "student" && student?.exists) throw new Error("DUPLICATE_ADMISSION");
      if (role === "student" && admissionNumber) {
        const duplicates = await tx.get(
          school.collection("students").where("admissionNumber", "==", admissionNumber).limit(1),
        );
        if (!duplicates.empty) throw new Error("DUPLICATE_ADMISSION");
      }
      const approved = invite.get("requiresApproval") === false;
      const gradeRestriction = String(invite.get("gradeRestriction") ?? "")
        .trim()
        .toLowerCase();
      if (role === "student" && gradeRestriction && grade.toLowerCase() !== gradeRestriction)
        throw new Error("GRADE_RESTRICTION");
      tx.update(school.collection("groupInvitations").doc(hash), { usedCount: count + 1 });
      tx.update(indexRef, { usedCount: count + 1 });
      const requestData = {
        uid,
        schoolId,
        invitationHash: hash,
        email: account.email!.toLowerCase(),
        fullName,
        role,
        ...(admissionNumber ? { admissionNumber } : {}),
        ...(contactNumber ? { contactNumber } : {}),
        ...(teacherId ? { teacherId } : {}),
        ...(grade ? { grade } : {}),
        ...(className ? { className } : {}),
        ...(qualifications ? { qualifications } : {}),
        ...(subjects.length ? { subjects } : {}),
        status: approved ? "approved" : "pending",
        requestedAt: now,
        ...(approved ? { decidedAt: now, decision: "approved", decisionBy: "system" } : {}),
      };
      tx.set(requestRef, requestData);
      if (approved) {
        tx.set(
          membership,
          {
            uid,
            email: account.email!.toLowerCase(),
            displayName: fullName,
            role,
            permissions: [...permissionsForRole(role as Role)],
            status: "active",
            createdAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
        tx.set(
          db.collection("users").doc(uid),
          {
            email: account.email!.toLowerCase(),
            displayName: fullName,
            activeSchoolId: schoolId,
            updatedAt: now,
          },
          { merge: true },
        );
        if (role === "student")
          tx.set(
            studentRef,
            {
              uid,
              fullName,
              admissionNumber,
              grade,
              className,
              phone: contactNumber,
              email: account.email!.toLowerCase(),
              status: "active",
              verified: true,
              createdAt: now,
            },
            { merge: true },
          );
        else
          tx.set(
            school.collection("teachers").doc(uid),
            {
              uid,
              fullName,
              email: account.email!.toLowerCase(),
              phone: contactNumber,
              teacherId,
              subjects,
              qualifications,
              role,
              status: "active",
              createdAt: now,
            },
            { merge: true },
          );
      }
      if (!approved) {
        const reviewers = activeMemberships.docs.filter((member) =>
          ["principal", "school_owner", "school_admin"].includes(String(member.get("role"))),
        );
        for (const reviewer of reviewers)
          tx.create(school.collection("notifications").doc(), {
            recipientUid: reviewer.id,
            category: "Administrative",
            title: "New registration request",
            message: `${fullName} requested ${role.replaceAll("_", " ")} membership.`,
            createdAt: now,
            read: false,
            deepLink: "/memberships",
          });
      }
      tx.create(school.collection("notifications").doc(), {
        recipientUid: uid,
        category: "Administrative",
        title: approved ? "Registration approved" : "Registration submitted",
        message: approved
          ? `Your ${role.replaceAll("_", " ")} registration at ${schoolSnapshot.get("name") ?? "the school"} is active.`
          : `Your ${role.replaceAll("_", " ")} registration at ${schoolSnapshot.get("name") ?? "the school"} is awaiting administrator review.`,
        createdAt: now,
        read: false,
        deepLink: approved ? "/dashboard" : "/registration/pending",
      });
      return { status: approved ? "approved" : "pending" };
    });
    await school.collection("auditLogs").add({
      schoolId,
      actorUid: uid,
      action: "registration.requested",
      recordType: "registrationRequest",
      recordId: uid,
      role,
      status: created.status,
      occurredAt: now,
    });
    return NextResponse.json({ ok: true, status: created.status }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const messages: Record<string, [string, number]> = {
      INVITATION_INVALID: ["Invitation is invalid.", 404],
      INVITATION_EXPIRED: ["Invitation has expired.", 410],
      INVITATION_FULL: ["Invitation has reached its usage limit.", 410],
      SCHOOL_UNAVAILABLE: ["This school is not accepting registrations.", 410],
      GRADE_RESTRICTION: ["This invitation is restricted to another grade.", 403],
      ALREADY_MEMBER: ["This account already has an active membership.", 409],
      DUPLICATE_REQUEST: ["A registration request is already pending.", 409],
      DUPLICATE_ADMISSION: ["Admission number is already in use.", 409],
    };
    const [message, status] = messages[code] ?? ["Registration could not be saved.", 500];
    return NextResponse.json({ error: message }, { status });
  }
}
