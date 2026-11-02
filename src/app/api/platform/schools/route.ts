import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { SESSION_COOKIE } from "@/server/context";
import { hasValidCsrf } from "@/server/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function timestampDate(value: unknown): Date | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function")
    return (value as { toDate: () => Date }).toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}
async function authorize(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { auth, db } = getAdminServices();
  const decoded = await auth.verifySessionCookie(token, true);
  if (decoded.email_verified !== true) return null;
  const owner = await db.collection("platformOwners").doc(decoded.uid).get();
  return owner.exists && owner.get("status") === "active" ? { auth, db, uid: decoded.uid } : null;
}
export async function GET(request: NextRequest) {
  try {
    const platform = await authorize(request);
    if (!platform) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const status = request.nextUrl.searchParams.get("status");
    let query: FirebaseFirestore.Query = platform.db
      .collection("schools")
      .orderBy("name")
      .limit(200);
    if (status === "active" || status === "suspended") query = query.where("status", "==", status);
    const schoolCollection = platform.db.collection("schools");
    const membershipRoles = [
      "principal",
      "school_owner",
      "school_admin",
      "class_teacher",
      "subject_teacher",
      "student",
    ];
    const [
      schools,
      totalSchools,
      activeSchools,
      suspendedSchools,
      pendingSchools,
      users,
      owners,
      memberships,
      logs,
    ] = await Promise.all([
      query.get(),
      schoolCollection.count().get(),
      schoolCollection.where("status", "==", "active").count().get(),
      schoolCollection.where("status", "==", "suspended").count().get(),
      schoolCollection.where("status", "in", ["setup_pending", "SETUP_PENDING"]).count().get(),
      platform.db.collection("users").count().get(),
      platform.db.collection("platformOwners").where("status", "==", "active").count().get(),
      platform.db.collectionGroup("memberships").limit(10_000).get(),
      platform.db.collection("platformAuditLogs").orderBy("occurredAt", "desc").limit(12).get(),
    ]);
    const membershipBySchool = new Map<string, Array<Record<string, unknown>>>();
    for (const member of memberships.docs) {
      if (
        member.get("status") !== "active" ||
        !membershipRoles.includes(String(member.get("role")))
      )
        continue;
      const schoolRef = member.ref.parent.parent;
      if (!schoolRef) continue;
      const rows = membershipBySchool.get(schoolRef.id) ?? [];
      rows.push({ id: member.id, ...member.data() });
      membershipBySchool.set(schoolRef.id, rows);
    }
    const principalRoles = new Set(["principal", "school_owner", "school_admin"]);
    const membershipRows = memberships.docs
      .filter(
        (doc) =>
          doc.get("status") === "active" && membershipRoles.includes(String(doc.get("role"))),
      )
      .map((doc) => doc.data());
    const truncatedMemberships = memberships.size >= 10_000;
    const schoolRows = schools.docs.map((doc) => {
      const row = doc.data();
      const members = membershipBySchool.get(doc.id) ?? [];
      const principal = members.find((member) => principalRoles.has(String(member.role)));
      return {
        id: doc.id,
        ...row,
        principal: principal
          ? {
              uid: principal.uid ?? principal.id,
              name: principal.displayName ?? principal.name ?? "Principal",
              email: principal.email ?? "",
            }
          : null,
        teacherCount: truncatedMemberships
          ? null
          : members.filter(
              (member) => member.role === "class_teacher" || member.role === "subject_teacher",
            ).length,
        studentCount: truncatedMemberships
          ? null
          : members.filter((member) => member.role === "student").length,
      };
    });
    const leadershipRoles = new Set(["principal", "school_owner", "school_admin"]);
    const stats = {
      schools: totalSchools.data().count,
      activeSchools: activeSchools.data().count,
      suspendedSchools: suspendedSchools.data().count,
      pendingSchools: pendingSchools.data().count,
      principals: truncatedMemberships
        ? null
        : membershipRows.filter((member) => leadershipRoles.has(String(member.role))).length,
      teachers: truncatedMemberships
        ? null
        : membershipRows.filter(
            (member) => member.role === "class_teacher" || member.role === "subject_teacher",
          ).length,
      students: truncatedMemberships
        ? null
        : membershipRows.filter((member) => member.role === "student").length,
      users: users.data().count,
      systemOwners: owners.data().count,
      membershipMetricsUnavailable: truncatedMemberships,
    };
    const monthStarts = Array.from(
      { length: 6 },
      (_, index) => new Date(new Date().getFullYear(), new Date().getMonth() - (5 - index), 1),
    );
    const rangeStart = monthStarts[0];
    const [schoolGrowth, activityGrowth] = await Promise.all([
      schoolCollection
        .where("createdAt", ">=", rangeStart)
        .limit(5001)
        .get()
        .catch((cause) => {
          console.error("[platform-dashboard] school growth query failed", cause);
          return null;
        }),
      platform.db
        .collection("platformAuditLogs")
        .where("occurredAt", ">=", rangeStart)
        .limit(5001)
        .get()
        .catch((cause) => {
          console.error("[platform-dashboard] activity trend query failed", cause);
          return null;
        }),
    ]);
    const analytics = monthStarts.map((month) => {
      const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
      const label = month.toLocaleDateString("en", { month: "short" });
      const countMonth = (docs: FirebaseFirestore.QueryDocumentSnapshot[], field: string) =>
        docs.filter((doc) => {
          const date = timestampDate(doc.get(field));
          return (
            date && `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` === key
          );
        }).length;
      const membershipForRole = (roles: string[]) =>
        memberships.docs.filter(
          (doc) =>
            doc.get("status") === "active" &&
            roles.includes(String(doc.get("role"))) &&
            timestampDate(doc.get("createdAt")) &&
            `${timestampDate(doc.get("createdAt"))!.getFullYear()}-${String(timestampDate(doc.get("createdAt"))!.getMonth() + 1).padStart(2, "0")}` ===
              key,
        ).length;
      return {
        month: key,
        label,
        schools:
          !schoolGrowth || schoolGrowth.size >= 5001
            ? null
            : countMonth(schoolGrowth.docs, "createdAt"),
        teachers: truncatedMemberships
          ? null
          : membershipForRole(["class_teacher", "subject_teacher"]),
        students: truncatedMemberships ? null : membershipForRole(["student"]),
        activity:
          !activityGrowth || activityGrowth.size >= 5001
            ? null
            : countMonth(activityGrowth.docs, "occurredAt"),
      };
    });
    return NextResponse.json(
      {
        schools: schoolRows,
        stats,
        analytics,
        audit: logs.docs.map((d) => ({ id: d.id, ...d.data() })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (cause) {
    console.error("[platform-dashboard] failed to load platform data", cause);
    return NextResponse.json({ error: "Unable to load platform data" }, { status: 500 });
  }
}
export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  try {
    const platform = await authorize(request);
    if (!platform) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json(
      {
        error:
          "Use the complete school-registration workflow, which initializes required settings and creates a secure principal invitation.",
      },
      { status: 410 },
    );
  } catch {
    return NextResponse.json({ error: "School creation failed" }, { status: 500 });
  }
}
const updateSchema = z.object({
  schoolId: z.string().min(1),
  status: z.enum(["active", "suspended"]).optional(),
  planId: z.string().max(80).optional(),
  subscriptionExpiresAt: z.string().datetime().nullable().optional(),
  name: z.string().trim().min(2).max(120).optional(),
});
export async function PATCH(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const data = updateSchema.safeParse(await request.json().catch(() => null));
  if (!data.success) return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  try {
    const platform = await authorize(request);
    if (!platform) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { schoolId, ...changes } = data.data;
    const update: Record<string, unknown> = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    );
    if (typeof update.subscriptionExpiresAt === "string")
      update.subscriptionExpiresAt = new Date(update.subscriptionExpiresAt);
    const schoolRef = platform.db.collection("schools").doc(schoolId);
    await platform.db.runTransaction(async (transaction) => {
      const current = await transaction.get(schoolRef);
      if (!current.exists) throw new Error("SCHOOL_NOT_FOUND");
      if (
        current.get("deletion")?.status === "pending" ||
        ["archived", "deletion_pending"].includes(String(current.get("status")))
      )
        throw new Error("SCHOOL_LOCKED");
      if (current.get("emergencyLock")?.status === "active" && update.status !== undefined)
        throw new Error("EMERGENCY_LOCK_ACTIVE");
      if (current.get("status") === "setup_pending" && update.status !== undefined)
        throw new Error("PRINCIPAL_ACCEPTANCE_REQUIRED");
      transaction.update(schoolRef, { ...update, updatedAt: new Date() });
      transaction.create(platform.db.collection("platformAuditLogs").doc(), {
        actorUid: platform.uid,
        action: "school.updated",
        schoolId,
        fields: Object.keys(update),
        occurredAt: new Date(),
      });
    });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (message === "SCHOOL_NOT_FOUND")
      return NextResponse.json({ error: "School not found." }, { status: 404 });
    if (message === "SCHOOL_LOCKED")
      return NextResponse.json(
        { error: "This school is archived or deletion-pending." },
        { status: 409 },
      );
    if (message === "EMERGENCY_LOCK_ACTIVE")
      return NextResponse.json(
        { error: "Release the emergency lock before changing the school status." },
        { status: 409 },
      );
    if (message === "PRINCIPAL_ACCEPTANCE_REQUIRED")
      return NextResponse.json(
        { error: "A principal must accept the invitation before this school is activated." },
        { status: 409 },
      );
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
