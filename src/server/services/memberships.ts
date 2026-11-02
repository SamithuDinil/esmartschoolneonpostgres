import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { dateFromValue } from "@/lib/date-value";
import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { getAdminServices } from "@/lib/firebase/admin";
import { permissionsForRole, type Role } from "@/server/permissions";
import type { SchoolContext } from "@/server/context";
import type { MemberRole } from "@/server/schemas/membership";

const iso = (value: unknown) =>
  value && typeof (value as { toDate?: unknown }).toDate === "function"
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : typeof value === "string"
      ? value
      : null;
const invitationHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function listMemberships(
  context: SchoolContext,
  filters: { query?: string; role?: string; status?: string } = {},
) {
  const { db } = getAdminServices();
  const school = db.collection("schools").doc(context.schoolId);
  const [snapshot, classSnapshot] = await Promise.all([
    school.collection("memberships").orderBy("createdAt", "desc").limit(500).get(),
    school.collection("classes").limit(1000).get(),
  ]);
  const classTeacherLabels = new Map<string, string[]>();
  for (const cls of classSnapshot.docs) {
    const teacherUid = String(cls.get("teacherId") ?? "").trim();
    if (!teacherUid) continue;
    const rawGrade = String(cls.get("grade") ?? "").trim().replace(/^grade\s*/i, "").replace(/^0+(?=\d)/, "");
    const grade = /^\d+$/.test(rawGrade) ? `Grade ${rawGrade}` : rawGrade;
    const className = String(cls.get("section") ?? cls.get("name") ?? "");
    classTeacherLabels.set(teacherUid, [...(classTeacherLabels.get(teacherUid) ?? []), `${grade}-${className}`]);
  }
  const members = await Promise.all(
    snapshot.docs.map(async (membership) => {
      const data = membership.data();
      const user = await db.collection("users").doc(membership.id).get();
      const userData = user.data() ?? {};
      return {
        uid: membership.id,
        email:
          typeof data.email === "string"
            ? data.email
            : typeof userData.email === "string"
              ? userData.email
              : null,
        displayName: userData.displayName ?? data.displayName ?? "School user",
        role: typeof data.role === "string" ? data.role : "staff",
        classTeacherClasses: classTeacherLabels.get(membership.id) ?? [],
        status: typeof data.status === "string" ? data.status : "active",
        permissions: Array.isArray(data.permissions) ? data.permissions : [],
        createdAt: iso(data.createdAt),
        lastActivityAt: iso(userData.lastActivityAt),
        isOnline: (() => { const seen = dateFromValue(userData.onlineAt); return userData.isOnline === true && !!seen && Date.now() - seen.getTime() < 75_000; })(),
        isOwner: data.isOwner === true,
      };
    }),
  );
  const query = filters.query?.trim().toLowerCase();
  return members.filter(
    (member) =>
      (!query ||
        `${member.displayName} ${member.email ?? ""} ${member.uid}`
          .toLowerCase()
          .includes(query)) &&
      (!filters.role || (filters.role === "teacher"
        ? ["teacher", "class_teacher", "subject_teacher"].includes(member.role)
        : member.role === filters.role)) &&
      (!filters.status || member.status === filters.status),
  );
}

export async function listInvitations(context: SchoolContext) {
  const { db } = getAdminServices();
  const snapshot = await db
    .collection("schools")
    .doc(context.schoolId)
    .collection("invitations")
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      email: data.email ?? "",
      displayName: data.displayName ?? "",
      role: data.role ?? "staff",
      status: data.status ?? "pending",
      createdAt: iso(data.createdAt),
      expiresAt: iso(data.expiresAt),
      acceptedAt: iso(data.acceptedAt),
    };
  });
}

export async function createInvitation(
  context: SchoolContext,
  input: { email: string; displayName: string; role: MemberRole },
) {
  const { db } = getAdminServices();
  const token = randomBytes(32).toString("base64url");
  const hash = invitationHash(token);
  const ref = db.collection("schools").doc(context.schoolId).collection("invitations").doc(hash);
  const indexRef = db.collection("invitationTokens").doc(hash);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  await db.runTransaction(async (transaction) => {
    transaction.create(ref, {
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      role: input.role,
      status: "pending",
      invitedBy: context.uid,
      createdAt: now,
      expiresAt,
      singleUse: true,
    });
    transaction.create(indexRef, {
      schoolId: context.schoolId,
      email: input.email.toLowerCase(),
      status: "pending",
      expiresAt,
      createdAt: now,
    });
  });
  await db
    .collection("schools")
    .doc(context.schoolId)
    .collection("notificationOutbox")
    .add({
      channel: "email",
      template: "school_membership_invitation",
      to: input.email.toLowerCase(),
      payload: { displayName: input.displayName, role: input.role, invitationToken: token },
      status: "pending_provider",
      createdAt: now,
      createdBy: context.uid,
    });
  await db.collection("schools").doc(context.schoolId).collection("auditLogs").add({
    schoolId: context.schoolId,
    actorUid: context.uid,
    action: "membership.invitation.created",
    recordType: "invitation",
    recordId: ref.id,
    recipient: input.email.toLowerCase(),
    role: input.role,
    expiresAt,
    occurredAt: now,
  });
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function acceptInvitation(uid: string, token: string) {
  const { auth, db } = getAdminServices();
  const account = await auth.getUser(uid);
  if (!account.emailVerified) throw new Error("INVITATION_EMAIL_UNVERIFIED");
  const refHash = invitationHash(token);
  const tokenIndex = await db.collection("invitationTokens").doc(refHash).get();
  if (!tokenIndex.exists) throw new Error("INVITATION_NOT_FOUND");
  const schoolId = String(tokenIndex.get("schoolId") ?? "");
  if (!schoolId) throw new Error("INVITATION_NOT_FOUND");
  const schoolDoc = await db.collection("schools").doc(schoolId).get();
  if (!schoolDoc.exists) throw new Error("INVITATION_NOT_FOUND");
  {
    const invitationRef = schoolDoc.ref.collection("invitations").doc(refHash);
    const membershipRef = schoolDoc.ref.collection("memberships").doc(uid);
    const userRef = db.collection("users").doc(uid);
    const result = await db.runTransaction(async (transaction) => {
      const invitation = await transaction.get(invitationRef);
      if (!invitation.exists) return null;
      const data = invitation.data() ?? {};
      const currentSchool = await transaction.get(schoolDoc.ref);
      if (
        !currentSchool.exists ||
        ["suspended", "archived", "deletion_pending"].includes(
          String(currentSchool.get("status") ?? ""),
        )
      )
        throw new Error("SCHOOL_UNAVAILABLE");
      const expiresAt = dateFromValue(data.expiresAt);
      if (data.status !== "pending" || !expiresAt || expiresAt.getTime() <= Date.now())
        throw new Error("INVITATION_EXPIRED");
      if (String(data.email).toLowerCase() !== String(account.email ?? "").toLowerCase())
        throw new Error("INVITATION_RECIPIENT_MISMATCH");
      const existing = await transaction.get(membershipRef);
      if (existing.exists && existing.get("status") === "active") throw new Error("ALREADY_MEMBER");
      const now = new Date();
      transaction.set(
        membershipRef,
        {
          uid,
          email: account.email ?? data.email,
          displayName: account.displayName ?? data.displayName,
          role: data.role,
          status: "active",
          permissions: [...permissionsForRole(data.role as Role)],
          invitedBy: data.invitedBy,
          acceptedAt: now,
          updatedAt: now,
          createdAt: existing.exists ? existing.get("createdAt") : now,
        },
        { merge: true },
      );
      transaction.set(
        userRef,
        {
          displayName: account.displayName ?? data.displayName,
          email: account.email ?? data.email,
          ...(existing.exists ? {} : { activeSchoolId: schoolDoc.id }),
          updatedAt: now,
        },
        { merge: true },
      );
      transaction.update(invitationRef, { status: "accepted", acceptedBy: uid, acceptedAt: now });
      transaction.update(db.collection("invitationTokens").doc(refHash), {
        status: "accepted",
        acceptedBy: uid,
        acceptedAt: now,
      });
      if (data.role === "principal" && currentSchool.get("status") === "setup_pending")
        transaction.update(schoolDoc.ref, { status: "active", updatedAt: now });
      return { schoolId: schoolDoc.id };
    });
    if (result) {
      await schoolDoc.ref.collection("auditLogs").add({
        schoolId: schoolDoc.id,
        actorUid: uid,
        action: "membership.invitation.accepted",
        recordType: "invitation",
        recordId: refHash,
        occurredAt: new Date(),
      });
      return result;
    }
  }
  throw new Error("INVITATION_NOT_FOUND");
}

export async function upsertMembership(
  context: SchoolContext,
  input: { uid: string; email: string; displayName: string; role: MemberRole },
) {
  const { db } = getAdminServices();
  const now = FieldValue.serverTimestamp();
  const membershipRef = db
    .collection("schools")
    .doc(context.schoolId)
    .collection("memberships")
    .doc(input.uid);
  const userRef = db.collection("users").doc(input.uid);
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(membershipRef);
    transaction.set(
      userRef,
      { displayName: input.displayName, email: input.email, updatedAt: now },
      { merge: true },
    );
    transaction.set(
      membershipRef,
      {
        uid: input.uid,
        email: input.email,
        displayName: input.displayName,
        role: input.role,
        status: "active",
        permissions: [...permissionsForRole(input.role as Role)],
        updatedAt: now,
        ...(existing.exists ? {} : { createdAt: now, invitedBy: context.uid }),
      },
      { merge: true },
    );
  });
  await db
    .collection("schools")
    .doc(context.schoolId)
    .collection("auditLogs")
    .add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: "membership.upserted",
      recordType: "membership",
      recordId: input.uid,
      changeSummary: `Membership granted as ${input.role}`,
      occurredAt: new Date(),
    });
}

export async function updateMembership(
  context: SchoolContext,
  input: {
    uid: string;
    role?: MemberRole;
    status?: "active" | "suspended" | "revoked";
    permissions?: string[];
  },
) {
  const { db } = getAdminServices();
  const ref = db
    .collection("schools")
    .doc(context.schoolId)
    .collection("memberships")
    .doc(input.uid);
  const current = await ref.get();
  if (!current.exists) throw new Error("MEMBERSHIP_NOT_FOUND");
  if (input.uid === context.uid && input.status && input.status !== "active")
    throw new Error("CANNOT_DISABLE_SELF");
  if (current.get("isOwner") === true && input.status && input.status !== "active")
    throw new Error("CANNOT_DISABLE_OWNER");
  const effectiveRole = input.role ?? String(current.get("role") ?? "staff");
  const changes: Record<string, unknown> = { updatedAt: new Date(), updatedBy: context.uid };
  if (input.role) {
    changes.role = input.role;
    changes.permissions = [...permissionsForRole(input.role as Role)];
  }
  if (input.permissions) {
    if (context.role !== "school_owner") throw new Error("OWNER_REQUIRED");
    const allowed = new Set(permissionsForRole(effectiveRole as Role));
    if (input.permissions.some((permission) => !allowed.has(permission)))
      throw new Error("PERMISSION_ESCALATION");
    changes.permissions = [...new Set(input.permissions)];
    changes.permissionsCustomized = true;
  }
  if (input.status) changes.status = input.status;
  await ref.update(changes);
  await db
    .collection("schools")
    .doc(context.schoolId)
    .collection("auditLogs")
    .add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: input.status === "revoked" ? "membership.revoked" : "membership.updated",
      recordType: "membership",
      recordId: input.uid,
      changedFields: Object.keys(changes),
      occurredAt: new Date(),
    });
}

export async function transferOwnership(context: SchoolContext, targetUid: string) {
  const { db } = getAdminServices();
  const school = db.collection("schools").doc(context.schoolId);
  const currentRef = school.collection("memberships").doc(context.uid);
  const targetRef = school.collection("memberships").doc(targetUid);
  await db.runTransaction(async (transaction) => {
    const [schoolSnap, currentSnap, targetSnap] = await Promise.all([
      transaction.get(school),
      transaction.get(currentRef),
      transaction.get(targetRef),
    ]);
    if (
      !schoolSnap.exists ||
      schoolSnap.get("ownerUid") !== context.uid ||
      !currentSnap.exists ||
      currentSnap.get("role") !== "school_owner"
    )
      throw new Error("OWNER_REQUIRED");
    if (!targetSnap.exists || targetSnap.get("status") !== "active")
      throw new Error("TARGET_NOT_ELIGIBLE");
    const targetRole = String(targetSnap.get("role") ?? "staff");
    if (
      !["principal", "vice_principal", "school_admin", "school_owner"].includes(targetRole) ||
      targetUid === context.uid
    )
      throw new Error("TARGET_NOT_ELIGIBLE");
    const now = new Date();
    transaction.update(school, { ownerUid: targetUid, updatedAt: now, updatedBy: context.uid });
    transaction.update(currentRef, {
      role: "school_admin",
      isOwner: false,
      permissions: [...permissionsForRole("school_admin")],
      updatedAt: now,
      updatedBy: context.uid,
    });
    transaction.update(targetRef, {
      role: "school_owner",
      isOwner: true,
      permissions: [...permissionsForRole("school_owner")],
      updatedAt: now,
      updatedBy: context.uid,
    });
  });
  await school.collection("auditLogs").add({
    schoolId: context.schoolId,
    actorUid: context.uid,
    action: "school.ownership.transferred",
    recordType: "school",
    recordId: context.schoolId,
    targetUid,
    occurredAt: new Date(),
  });
}
