import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { welfareRecordSchema } from "@/server/schemas/welfare";

export const dynamic = "force-dynamic";

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
function rootFor(schoolId: string) {
  return getAdminServices().db.collection("schools").doc(schoolId);
}
function canRead(permissions: readonly string[]) {
  return hasPermission(permissions, "welfare.read") || hasPermission(permissions, "welfare.manage");
}
function canManage(permissions: readonly string[]) {
  return hasPermission(permissions, "welfare.manage");
}

export async function GET(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canRead(context.permissions))
    return NextResponse.json(
      { error: "Welfare records are restricted to authorized personnel." },
      { status: 403 },
    );
  const root = rootFor(context.schoolId);
  const studentId = request.nextUrl.searchParams.get("studentId");
  const status = request.nextUrl.searchParams.get("status");
  const category = request.nextUrl.searchParams.get("category");
  await root.collection("welfareAccessLogs").add({
    schoolId: context.schoolId,
    actorUid: context.uid,
    action: "read",
    filters: { studentId, status, category },
    occurredAt: FieldValue.serverTimestamp(),
  });
  const snapshot = await root
    .collection("welfareIncidents")
    .orderBy("incidentDate", "desc")
    .limit(500)
    .get()
    .catch(() => root.collection("welfareIncidents").limit(500).get());
  const incidents: Array<Record<string, unknown> & { id: string }> = snapshot.docs
    .map((doc) => ({ id: doc.id, ...serialize(doc.data()) }))
    .filter(
      (item: Record<string, unknown> & { id: string }) =>
        (!studentId || item.studentId === studentId) &&
        (!status || item.investigationStatus === status) &&
        (!category || item.category === category),
    );
  const report = {
    total: incidents.length,
    open: incidents.filter((item) =>
      ["open", "investigating"].includes(String(item.investigationStatus)),
    ).length,
    resolved: incidents.filter((item) =>
      ["resolved", "closed"].includes(String(item.investigationStatus)),
    ).length,
    categories: [...new Set(incidents.map((item) => String(item.category ?? "other")))].length,
  };
  return NextResponse.json(
    { incidents, report },
    { headers: { "Cache-Control": "private,no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canManage(context.permissions))
    return NextResponse.json(
      { error: "Welfare changes require a specifically authorized welfare manager." },
      { status: 403 },
    );
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid security token." }, { status: 403 });
  const parsed = welfareRecordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "The welfare request is invalid.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  const root = rootFor(context.schoolId);
  try {
    if (parsed.data.action === "create") {
      const student = await root.collection("students").doc(parsed.data.studentId).get();
      if (!student.exists || student.get("status") === "archived")
        return NextResponse.json({ error: "Student record not found." }, { status: 404 });
      const ref = root.collection("welfareIncidents").doc();
      const now = FieldValue.serverTimestamp();
      await ref.create({
        ...parsed.data,
        id: ref.id,
        schoolId: context.schoolId,
        createdBy: context.uid,
        updatedBy: context.uid,
        createdAt: now,
        updatedAt: now,
      });
      await root.collection("welfareHistory").add({
        schoolId: context.schoolId,
        incidentId: ref.id,
        actorUid: context.uid,
        action: "created",
        snapshot: parsed.data,
        occurredAt: now,
      });
      await root.collection("auditLogs").add({
        schoolId: context.schoolId,
        actorUid: context.uid,
        action: "welfare.incident.created",
        recordType: "welfareIncident",
        recordId: ref.id,
        occurredAt: now,
      });
      return NextResponse.json({ id: ref.id }, { status: 201 });
    }
    const ref = root.collection("welfareIncidents").doc(parsed.data.incidentId);
    const existing = await ref.get();
    if (!existing.exists)
      return NextResponse.json({ error: "Welfare incident not found." }, { status: 404 });
    const { action: _action, incidentId: _incidentId, ...changes } = parsed.data;
    void _action;
    void _incidentId;
    await ref.update({
      ...changes,
      updatedBy: context.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await root.collection("welfareHistory").add({
      schoolId: context.schoolId,
      incidentId: ref.id,
      actorUid: context.uid,
      action: "updated",
      changedFields: Object.keys(changes),
      previous: serialize(existing.data() ?? {}),
      changes,
      occurredAt: FieldValue.serverTimestamp(),
    });
    await root.collection("auditLogs").add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: "welfare.incident.updated",
      recordType: "welfareIncident",
      recordId: ref.id,
      changedFields: Object.keys(changes),
      occurredAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "The restricted welfare record could not be saved." },
      { status: 500 },
    );
  }
}
