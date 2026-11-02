import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";

export const dynamic = "force-dynamic";

const defaultPreferences: Record<string, boolean> = {
  announcements: true,
  academic: true,
  attendance: true,
  finance: true,
  administrative: true,
  assignments: true,
  events: true,
  system: true,
  chime: true,
  browserAlerts: false,
};

function rootFor(schoolId: string) {
  return getAdminServices().db.collection("schools").doc(schoolId);
}

function serialize(data: FirebaseFirestore.DocumentData) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function"
        ? value.toDate().toISOString()
        : value instanceof Date
          ? value.toISOString()
          : value,
    ]),
  );
}

function safeDeepLink(value: unknown) {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !/[\u0000-\u001f]/.test(value)
    ? value
    : null;
}

function displayCategory(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "System";
  const labels: Record<string, string> = {
    announcements: "Announcements",
    academic: "Academic",
    attendance: "Attendance",
    finance: "Finance",
    administrative: "Administrative",
    assignments: "Assignments",
    events: "Events",
    system: "System",
  };
  return labels[value.toLowerCase()] ?? value;
}

function preferenceKey(category: unknown) {
  return typeof category === "string" && category ? category.toLowerCase() : "system";
}

export async function GET() {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(context.permissions, "notifications.read"))
    return NextResponse.json({ error: "Notification access is restricted." }, { status: 403 });

  const root = rootFor(context.schoolId);
  const [snapshot, preferenceSnapshot] = await Promise.all([
    root
      .collection("notifications")
      .where("recipientUid", "==", context.uid)
      .orderBy("createdAt", "desc")
      .limit(200)
      .get()
      .catch(() =>
        root.collection("notifications").where("recipientUid", "==", context.uid).limit(200).get(),
      ),
    root.collection("notificationPreferences").doc(context.uid).get(),
  ]);
  const preferences = { ...defaultPreferences, ...(preferenceSnapshot.data() ?? {}) } as Record<
    string,
    boolean
  >;
  const items = snapshot.docs
    .map((doc): Record<string, unknown> & { id: string; deepLink: string | null } => ({
      id: doc.id,
      ...serialize(doc.data()),
      category: displayCategory(doc.get("category")),
      deepLink: safeDeepLink(doc.get("deepLink")),
    }))
    .filter(
      (item) => item.archived !== true && preferences[preferenceKey(item.category)] !== false,
    );
  items.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  return NextResponse.json(
    {
      notifications: items,
      unreadCount: items.filter((item) => item.read !== true).length,
      preferences,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(context.permissions, "notifications.read"))
    return NextResponse.json({ error: "Notification access is restricted." }, { status: 403 });
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as {
    action?: string;
    notificationId?: string;
    notificationIds?: string[];
    preferences?: Record<string, boolean>;
  } | null;
  const root = rootFor(context.schoolId);
  try {
    if (body?.action === "preferences" && body.preferences) {
      const preferences = Object.fromEntries(
        Object.entries(defaultPreferences).map(([key, fallback]) => [
          key,
          typeof body.preferences?.[key] === "boolean" ? body.preferences[key] : fallback,
        ]),
      );
      await root
        .collection("notificationPreferences")
        .doc(context.uid)
        .set(
          { ...preferences, updatedBy: context.uid, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
      return NextResponse.json({ ok: true, preferences });
    }
    if (body?.action === "mark_viewed") {
      const ids = body.notificationIds;
      if (!Array.isArray(ids) || ids.length > 200 || ids.some((id) => typeof id !== "string" || !id || id.length > 512 || id.includes("/")))
        return NextResponse.json({ error: "A valid list of viewed notifications is required." }, { status: 400 });
      const refs = [...new Set(ids)].map((id) => root.collection("notifications").doc(id));
      const docs = await Promise.all(refs.map((ref) => ref.get()));
      if (docs.some((doc) => !doc.exists || doc.get("recipientUid") !== context.uid))
        return NextResponse.json({ error: "One or more notifications were not found." }, { status: 404 });
      const batch = getAdminServices().db.batch();
      docs.filter((doc) => doc.get("read") !== true).forEach((doc) => batch.update(doc.ref, { read: true, readAt: FieldValue.serverTimestamp() }));
      if (docs.some((doc) => doc.get("read") !== true)) await batch.commit();
      return NextResponse.json({ ok: true, updated: docs.filter((doc) => doc.get("read") !== true).length });
    }
    if (body?.action === "mark_all_read") {
      const snapshot = await root
        .collection("notifications")
        .where("recipientUid", "==", context.uid)
        .limit(300)
        .get();
      const batch = getAdminServices().db.batch();
      snapshot.docs
        .filter((doc) => doc.get("read") !== true && doc.get("archived") !== true)
        .forEach((doc) =>
          batch.update(doc.ref, { read: true, readAt: FieldValue.serverTimestamp() }),
        );
      await batch.commit();
      return NextResponse.json({ ok: true, updated: snapshot.size });
    }
    if (
      !["mark_read", "archive", "delete"].includes(body?.action ?? "") ||
      !body?.notificationId ||
      body.notificationId.length > 512 ||
      body.notificationId.includes("/")
    ) {
      return NextResponse.json(
        { error: "A valid notification action is required." },
        { status: 400 },
      );
    }
    const ref = root.collection("notifications").doc(body.notificationId);
    const doc = await ref.get();
    if (!doc.exists || doc.get("recipientUid") !== context.uid)
      return NextResponse.json({ error: "Notification not found." }, { status: 404 });
    if (body.action === "delete") await ref.delete();
    else if (body.action === "archive")
      await ref.update({ archived: true, archivedAt: FieldValue.serverTimestamp() });
    else await ref.update({ read: true, readAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Notification update failed." }, { status: 500 });
  }
}
