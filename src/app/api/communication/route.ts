import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { communicationActionSchema } from "@/server/schemas/communication";

export const dynamic = "force-dynamic";

function serialize(data: FirebaseFirestore.DocumentData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (
      value &&
      typeof value === "object" &&
      "toDate" in value &&
      typeof value.toDate === "function"
    )
      result[key] = value.toDate().toISOString();
    else if (value instanceof Date) result[key] = value.toISOString();
    else if (["string", "number", "boolean"].includes(typeof value) || value === null)
      result[key] = value;
    else if (Array.isArray(value)) result[key] = value;
  }
  return result;
}

function rootFor(schoolId: string) {
  return getAdminServices().db.collection("schools").doc(schoolId);
}

function canManage(permissions: readonly string[]) {
  return (
    hasPermission(permissions, "announcements.manage") ||
    hasPermission(permissions, "announcements.create")
  );
}

function audienceRoles(audience: unknown): string[] | null {
  return audience === "teachers"
    ? ["teacher", "class_teacher", "subject_teacher"]
    : audience === "parents"
      ? ["parent"]
      : audience === "students"
        ? ["student"]
        : null;
}
function roleMatchesAnnouncement(row: Record<string, unknown>, uid: string, role: string) {
  const targetRoles = Array.isArray(row.targetRoles) ? row.targetRoles : [];
  const targetUids = Array.isArray(row.targetUids) ? row.targetUids : [];
  if (targetUids.includes(uid)) return true;
  const byAudience =
    row.audience === "school"
      ? targetRoles.length === 0 || targetRoles.includes(role)
      : row.audience === "selected"
        ? targetRoles.includes(role)
        : Boolean(audienceRoles(row.audience)?.includes(role)) &&
          (targetRoles.length === 0 || targetRoles.includes(role));
  return byAudience;
}
function matchesScopes(
  row: Record<string, unknown>,
  scopes: Array<{ grade?: unknown; className?: unknown }>,
) {
  const grades = Array.isArray(row.targetGrades) ? row.targetGrades : [];
  const classes = Array.isArray(row.targetClasses) ? row.targetClasses : [];
  if (!grades.length && !classes.length) return true;
  return scopes.some(
    (scope) =>
      (!grades.length || grades.includes(scope.grade)) &&
      (!classes.length || classes.includes(scope.className)),
  );
}
function visibleToUser(
  row: Record<string, unknown>,
  uid: string,
  role: string,
  scopes: Array<{ grade?: unknown; className?: unknown }> = [],
) {
  return roleMatchesAnnouncement(row, uid, role) && matchesScopes(row, scopes);
}
async function scopesFor(root: FirebaseFirestore.DocumentReference, uid: string, role: string) {
  const scopes: Array<{ grade?: unknown; className?: unknown }> = [];
  if (role === "student") {
    const [a, b] = await Promise.all([
      root.collection("students").where("accountUid", "==", uid).limit(20).get(),
      root.collection("students").where("userUid", "==", uid).limit(20).get(),
    ]);
    scopes.push(
      ...[...new Map([...a.docs, ...b.docs].map((d) => [d.id, d])).values()].map((d) => ({
        grade: d.get("grade"),
        className: d.get("className"),
      })),
    );
  } else if (role === "parent") {
    const links = await root
      .collection("studentGuardianLinks")
      .where("guardianUid", "==", uid)
      .where("status", "==", "active")
      .limit(100)
      .get();
    const children = await Promise.all(
      links.docs.map((link) =>
        root
          .collection("students")
          .doc(String(link.get("studentId")))
          .get(),
      ),
    );
    scopes.push(
      ...children
        .filter((d) => d.exists)
        .map((d) => ({ grade: d.get("grade"), className: d.get("className") })),
    );
  } else if (["teacher", "class_teacher", "subject_teacher"].includes(role)) {
    const assignments = await root
      .collection("teacherAssignments")
      .where("teacherUid", "==", uid)
      .limit(200)
      .get();
    scopes.push(
      ...assignments.docs.map((d) => ({ grade: d.get("grade"), className: d.get("className") })),
    );
  }
  return scopes;
}
async function announcementRecipients(
  root: FirebaseFirestore.DocumentReference,
  row: Record<string, unknown>,
) {
  const members: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  const pageSize = 500;
  const maximum = 10000;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (members.length <= maximum) {
    let query = root.collection("memberships").where("status", "==", "active").limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    members.push(...page.docs);
    if (members.length > maximum) throw new Error("ANNOUNCEMENT_AUDIENCE_TOO_LARGE");
    if (page.docs.length < pageSize) break;
    cursor = page.docs[page.docs.length - 1];
  }
  const gradeOrClassTargeted =
    (Array.isArray(row.targetGrades) && row.targetGrades.length > 0) ||
    (Array.isArray(row.targetClasses) && row.targetClasses.length > 0);
  const recipients: string[] = [];
  for (const member of members) {
    const uid = member.id;
    const role = String(member.get("role") ?? "staff");
    if (!roleMatchesAnnouncement(row, uid, role)) continue;
    const scopes = gradeOrClassTargeted
      ? [
          ...(await scopesFor(root, uid, role)),
          { grade: member.get("grade"), className: member.get("className") },
        ]
      : [];
    if (matchesScopes(row, scopes)) recipients.push(uid);
  }
  return [...new Set(recipients)];
}
async function deliverAnnouncement(
  root: FirebaseFirestore.DocumentReference,
  announcementId: string,
  row: Record<string, unknown>,
  recipients: string[],
) {
  const db = getAdminServices().db;
  let created = 0;
  for (let i = 0; i < recipients.length; i += 400) {
    const uids = recipients.slice(i, i + 400);
    const refs = uids.map((uid) =>
      root.collection("notifications").doc(`announcement_${announcementId}_${uid}`),
    );
    // Only create missing rows. Retrying a publish never resets recipients' read/archive state.
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshots = await db.getAll(...refs);
      const missing = refs.filter((ref, index) => !snapshots[index].exists);
      if (!missing.length) break;
      const batch = db.batch();
      for (const ref of missing) {
        const uid = ref.id.slice(`announcement_${announcementId}_`.length);
        batch.create(ref, {
          type: "announcement",
          category: "Announcements",
          title: String(row.title ?? "School announcement"),
          message: String(row.message ?? ""),
          recipientUid: uid,
          schoolId: root.id,
          announcementId,
          deepLink: "/communication",
          createdAt: FieldValue.serverTimestamp(),
          read: false,
          archived: false,
        });
      }
      try {
        await batch.commit();
        created += missing.length;
        break;
      } catch (cause) {
        const code = String((cause as { code?: string | number }).code ?? "");
        if (!(code === "6" || code === "already-exists") || attempt === 2) throw cause;
      }
    }
  }
  return created;
}

export async function GET() {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const root = rootFor(context.schoolId);
  const manage = canManage(context.permissions);
  const canReadTargeted = hasPermission(context.permissions, "announcements.targeted.read");
  if (!manage && !canReadTargeted)
    return NextResponse.json({ error: "Communication access is restricted." }, { status: 403 });
  const [announcements, notifications] = await Promise.all([
    root
      .collection("announcements")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get()
      .catch(() => root.collection("announcements").limit(200).get()),
    root
      .collection("notifications")
      .where("recipientUid", "==", context.uid)
      .limit(100)
      .get()
      .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
  ]);
  const scopes = await scopesFor(root, context.uid, context.role);
  const announcementRows = announcements.docs
    .map((doc): Record<string, unknown> & { id: string; status?: unknown } => ({
      id: doc.id,
      ...serialize(doc.data()),
    }))
    .filter(
      (row) =>
        manage ||
        (row.status === "published" && visibleToUser(row, context.uid, context.role, scopes)),
    );
  return NextResponse.json({
    announcements: announcementRows,
    notifications: notifications.docs.map((doc) => ({ id: doc.id, ...serialize(doc.data()) })),
    providerStatus: {
      in_app: "ready",
      email: process.env.EMAIL_PROVIDER_API_KEY ? "credentials_available" : "credentials_required",
      sms:
        process.env.SMS_PROVIDER_API_KEY && process.env.SMS_TWILIO_ACCOUNT_SID
          ? "credentials_available"
          : "credentials_required",
      whatsapp: process.env.WHATSAPP_PROVIDER_API_KEY ? "configured" : "not_configured",
    },
  });
}

export async function POST(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid security token." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const parsed = communicationActionSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "The communication request is invalid.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  const root = rootFor(context.schoolId);
  if (parsed.data.action === "mark_read") {
    if (!hasPermission(context.permissions, "announcements.targeted.read"))
      return NextResponse.json({ error: "Communication access is restricted." }, { status: 403 });
    const row = root.collection("announcements").doc(parsed.data.announcementId);
    const announcement = await row.get();
    if (
      !announcement.exists ||
      !visibleToUser(
        announcement.data() ?? {},
        context.uid,
        context.role,
        await scopesFor(root, context.uid, context.role),
      )
    )
      return NextResponse.json({ error: "Announcement not found." }, { status: 404 });
    await row
      .collection("reads")
      .doc(context.uid)
      .set({ uid: context.uid, readAt: FieldValue.serverTimestamp() }, { merge: true });
    return NextResponse.json({ ok: true });
  }
  if (!canManage(context.permissions))
    return NextResponse.json(
      { error: "Announcement changes require an authorized grant." },
      { status: 403 },
    );
  const payload = parsed.data;
  if (payload.action === "create") {
    const ref = root.collection("announcements").doc();
    const isScheduled = Boolean(payload.scheduledAt);
    await ref.create({
      ...payload,
      channels: [...new Set([...payload.channels, "in_app"])],
      id: ref.id,
      status: isScheduled ? "scheduled" : "draft",
      schoolId: context.schoolId,
      createdBy: context.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      readCount: 0,
    });
    await root.collection("auditLogs").add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: "announcement.created",
      recordType: "announcement",
      recordId: ref.id,
      occurredAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ id: ref.id });
  }
  const ref = root.collection("announcements").doc(payload.announcementId);
  const existing = await ref.get();
  if (!existing.exists)
    return NextResponse.json({ error: "Announcement not found." }, { status: 404 });
  if (payload.action === "edit") {
    await ref.update({
      title: payload.title,
      message: payload.message,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: context.uid,
    });
    return NextResponse.json({ ok: true });
  }
  if (payload.action === "publish") {
    const row = { ...(existing.data() ?? {}), status: "published" };
    let recipients: string[];
    try {
      recipients = await announcementRecipients(root, row);
    } catch (cause) {
      if (cause instanceof Error && cause.message === "ANNOUNCEMENT_AUDIENCE_TOO_LARGE")
        return NextResponse.json(
          {
            error:
              "This audience exceeds the 10,000-member in-app limit. Narrow the audience before publishing.",
          },
          { status: 413 },
        );
      return NextResponse.json(
        {
          error:
            "Announcement recipients could not be verified; the announcement was not published.",
        },
        { status: 500 },
      );
    }
    if (existing.get("status") !== "published")
      await ref.update({
        status: "published",
        publishedAt: FieldValue.serverTimestamp(),
        notificationDeliveryState: "pending",
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: context.uid,
      });
    if (existing.get("notificationDeliveryState") === "sent")
      return NextResponse.json({ ok: true, delivered: 0, alreadyPublished: true });
    try {
      const delivered = await deliverAnnouncement(root, ref.id, row, recipients);
      await ref.update({
        notificationDeliveryState: "sent",
        notificationRecipientCount: recipients.length,
        notificationsCreated: delivered,
        notificationsSentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({
        ok: true,
        delivered,
        alreadyPublished: existing.get("status") === "published",
      });
    } catch {
      await ref.update({
        notificationDeliveryState: "failed",
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json(
        {
          error:
            "The announcement was published, but some in-app notifications could not be delivered. Try Publish again to retry safely.",
        },
        { status: 503 },
      );
    }
  }
  await ref.update({
    status: "archived",
    publishedAt: null,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: context.uid,
  });
  return NextResponse.json({ ok: true });
}
