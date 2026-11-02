import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { ROLE_PERMISSIONS } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";

export const dynamic = "force-dynamic";
const roles = ["school_admin", "principal", "vice_principal", "section_head", "teacher", "class_teacher", "subject_teacher", "student", "parent", "accountant", "librarian", "transport_manager", "administrative_staff", "staff"] as const;
const managers = ["school_owner", "school_admin", "principal"];
const catalog: string[] = [...new Set(Object.values(ROLE_PERMISSIONS).flat().filter((permission) => !permission.startsWith("platform.") && permission !== "school.ownership.transfer"))].sort();

export async function GET() {
  const context = await getSchoolContext();
  if (!context || !managers.includes(context.role)) return NextResponse.json({ error: "Role access administration is restricted." }, { status: 403 });
  const docs = await getAdminServices().db.collection("schools").doc(context.schoolId).collection("rolePermissions").get();
  const overrides = Object.fromEntries(docs.docs.map((doc) => [doc.id, doc.get("permissions")]));
  const defaults = Object.fromEntries(roles.map((role) => [role, ROLE_PERMISSIONS[role].filter((permission) => catalog.includes(permission))]));
  return NextResponse.json({ roles, catalog, defaults, overrides }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: NextRequest) {
  if (!hasValidCsrf(request)) return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const context = await getSchoolContext();
  if (!context || !managers.includes(context.role)) return NextResponse.json({ error: "Role access administration is restricted." }, { status: 403 });
  const schema = z.object({ role: z.enum(roles), permissions: z.array(z.string().min(1).max(100)).max(200) });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid role permission update.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  if (new Set(parsed.data.permissions).size !== parsed.data.permissions.length || parsed.data.permissions.some((permission) => !catalog.includes(permission))) return NextResponse.json({ error: "Choose only listed school features." }, { status: 400 });
  await getAdminServices().db.collection("schools").doc(context.schoolId).collection("rolePermissions").doc(parsed.data.role).set({ role: parsed.data.role, permissions: parsed.data.permissions, updatedAt: new Date(), updatedBy: context.uid }, { merge: true });
  await getAdminServices().db.collection("schools").doc(context.schoolId).collection("auditLogs").add({ schoolId: context.schoolId, actorUid: context.uid, action: "role.permissions.updated", role: parsed.data.role, permissions: parsed.data.permissions, occurredAt: new Date() });
  return NextResponse.json({ ok: true });
}
