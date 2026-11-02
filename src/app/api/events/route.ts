import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { eventActionSchema } from "@/server/schemas/events";

export const dynamic = "force-dynamic";
function rootFor(schoolId: string) {
  return getAdminServices().db.collection("schools").doc(schoolId);
}
function serialize(data: FirebaseFirestore.DocumentData) {
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
    else if (
      ["string", "number", "boolean"].includes(typeof value) ||
      value === null ||
      Array.isArray(value)
    )
      result[key] = value;
  }
  return result;
}
function audienceRole(audience: unknown, role: string) {
  return audience === "teachers"
    ? ["teacher", "class_teacher", "subject_teacher", "principal", "vice_principal", "section_head"].includes(
        role,
      )
    : audience === "students"
      ? role === "student"
      : audience === "parents"
        ? role === "parent"
        : false;
}
function visibleToUser(item: Record<string, unknown>, uid: string, role: string) {
  const targetRoles = Array.isArray(item.targetRoles) ? item.targetRoles : [];
  const targetUids = Array.isArray(item.targetUids) ? item.targetUids : [];
  return (
    item.participants === "school" ||
    audienceRole(item.participants, role) ||
    targetRoles.includes(role) ||
    targetUids.includes(uid)
  );
}
function canRead(permissions: readonly string[]) {
  return hasPermission(permissions, "events.read") || hasPermission(permissions, "events.manage");
}
function canManage(permissions: readonly string[]) {
  return hasPermission(permissions, "events.manage");
}

export async function GET(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canRead(context.permissions))
    return NextResponse.json({ error: "Event access is restricted." }, { status: 403 });
  const root = rootFor(context.schoolId);
  const manage = canManage(context.permissions);
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const snapshot = await root
    .collection("events")
    .orderBy("startAt", "asc")
    .limit(500)
    .get()
    .catch(() => root.collection("events").limit(500).get());
  const events = snapshot.docs
    .map((doc) => ({ id: doc.id, ...serialize(doc.data()) }))
    .filter((item: Record<string, unknown> & { id: string }) => {
      if (
        !manage &&
        (item.status !== "published" || !visibleToUser(item, context.uid, context.role))
      )
        return false;
      if (from && String(item.endAt ?? "") < from) return false;
      if (to && String(item.startAt ?? "") > to) return false;
      return true;
    });
  const settings = await root.collection("settings").doc("system").get();
  const school = await root.get();
  return NextResponse.json(
    {
      events,
      timezone: settings.get("general")?.timezone ?? school.get("timezone") ?? "Asia/Colombo",
    },
    { headers: { "Cache-Control": "private,no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canManage(context.permissions))
    return NextResponse.json(
      { error: "Event changes require event management permission." },
      { status: 403 },
    );
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid security token." }, { status: 403 });
  const parsed = eventActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "The event request is invalid.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  if (parsed.data.action === "create" && parsed.data.endAt < parsed.data.startAt)
    return NextResponse.json(
      { error: "Event end time must be after the start time." },
      { status: 400 },
    );
  const root = rootFor(context.schoolId);
  try {
    if (parsed.data.action === "create") {
      const ref = root.collection("events").doc();
      await ref.create({
        ...parsed.data,
        id: ref.id,
        schoolId: context.schoolId,
        status: "draft",
        reminderStatus: parsed.data.reminderMinutes.length ? "pending" : "none",
        createdBy: context.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await root.collection("auditLogs").add({
        schoolId: context.schoolId,
        actorUid: context.uid,
        action: "event.created",
        recordType: "event",
        recordId: ref.id,
        occurredAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ id: ref.id }, { status: 201 });
    }
    const ref = root.collection("events").doc(parsed.data.eventId);
    const existing = await ref.get();
    if (!existing.exists) return NextResponse.json({ error: "Event not found." }, { status: 404 });
    if (parsed.data.action === "delete") await ref.delete();
    else {
      const { action, eventId, ...changes } = parsed.data;
      void eventId;
      await ref.update({
        ...changes,
        status:
          action === "publish"
            ? "published"
            : action === "cancel"
              ? "cancelled"
              : (existing.get("status") ?? "draft"),
        publishedAt:
          action === "publish"
            ? FieldValue.serverTimestamp()
            : (existing.get("publishedAt") ?? null),
        updatedBy: context.uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await root.collection("auditLogs").add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: `event.${parsed.data.action}`,
      recordType: "event",
      recordId: parsed.data.eventId,
      occurredAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "The event change could not be saved." }, { status: 500 });
  }
}
