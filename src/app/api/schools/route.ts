import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { hasValidCsrf } from "@/server/csrf";
import { SESSION_COOKIE } from "@/server/context";
import { schoolCreateSchema } from "@/server/schemas/school";
import { schoolSwitchSchema } from "@/server/schemas/membership";
import { createSchoolForUser } from "@/server/services/schools";
import { getSchoolContext } from "@/server/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token)
    return NextResponse.json({ error: "Sign in before viewing school access." }, { status: 401 });
  try {
    const { auth, db } = getAdminServices();
    const decoded = await auth.verifySessionCookie(token, true);
    const user = await db.collection("users").doc(decoded.uid).get();
    const activeSchoolId = user.data()?.activeSchoolId ?? null;
    let schools: unknown[] = [];
    try {
      const memberships = await db
        .collectionGroup("memberships")
        .where("uid", "==", decoded.uid)
        .where("status", "==", "active")
        .limit(100)
        .get();
      schools = await Promise.all(
        memberships.docs.map(async (membership) => {
          const schoolRef = membership.ref.parent.parent;
          if (!schoolRef) return null;
          const school = await schoolRef.get();
          if (
            !school.exists ||
            ["setup_pending", "suspended", "archived", "deletion_pending"].includes(
              String(school.data()?.status ?? ""),
            )
          )
            return null;
          return {
            id: school.id,
            name: school.data()?.name ?? "School",
            logoUrl: school.data()?.logoUrl ?? "",
            role: membership.data().role ?? "staff",
            isActive: school.id === activeSchoolId,
          };
        }),
      );
    } catch {
      schools = [];
    }
    let activeSchool: unknown = null;
    try {
      const context = await getSchoolContext();
      const targetId = context?.schoolId ?? activeSchoolId;
      if (targetId) {
        const snap = await db.collection("schools").doc(String(targetId)).get();
        if (snap.exists)
          activeSchool = {
            id: snap.id,
            name: snap.data()?.name ?? "School",
            logoUrl: snap.data()?.logoUrl ?? "",
            role: context?.role ?? "staff",
            isActive: true,
          };
      }
    } catch {
      activeSchool = null;
    }
    return NextResponse.json(
      { schools: schools.filter(Boolean), activeSchool },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "School access could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json(
      { error: "This secure request expired. Please reload and retry." },
      { status: 403 },
    );
  const currentContext = await getSchoolContext();
  if (currentContext?.supportMode)
    return NextResponse.json(
      {
        error:
          "School switching and self-service creation are unavailable during System Owner support mode. Exit support mode first.",
      },
      { status: 409 },
    );
  const body = await request.json().catch(() => null);
  const switchInput = schoolSwitchSchema.safeParse(body);
  if (switchInput.success) {
    try {
      const token = request.cookies.get(SESSION_COOKIE)?.value;
      if (!token)
        return NextResponse.json({ error: "Sign in before switching school." }, { status: 401 });
      const { auth, db } = getAdminServices();
      const decoded = await auth.verifySessionCookie(token, true);
      const membership = await db
        .collection("schools")
        .doc(switchInput.data.schoolId)
        .collection("memberships")
        .doc(decoded.uid)
        .get();
      const school = await db.collection("schools").doc(switchInput.data.schoolId).get();
      if (
        !membership.exists ||
        membership.data()?.status !== "active" ||
        !school.exists ||
        ["setup_pending", "suspended", "archived", "deletion_pending"].includes(
          String(school.data()?.status ?? ""),
        )
      )
        return NextResponse.json(
          { error: "You do not have active access to that school." },
          { status: 403 },
        );
      await db
        .collection("users")
        .doc(decoded.uid)
        .update({ activeSchoolId: switchInput.data.schoolId, updatedAt: new Date() });
      await school.ref.collection("auditLogs").add({
        schoolId: school.id,
        actorUid: decoded.uid,
        action: "school.switched",
        recordType: "school",
        recordId: school.id,
        occurredAt: new Date(),
      });
      return NextResponse.json(
        { ok: true, schoolId: school.id },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return NextResponse.json({ error: "School switch could not be completed." }, { status: 500 });
    }
  }
  const input = schoolCreateSchema.safeParse(body);
  if (!input.success)
    return NextResponse.json(
      {
        error: "Please check the school details and try again.",
        fields: input.error.flatten().fieldErrors,
      },
      { status: 400 },
    );

  try {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (!token)
      return NextResponse.json({ error: "Sign in before creating a school." }, { status: 401 });
    const { auth } = getAdminServices();
    const decoded = await auth.verifySessionCookie(token, true);
    if (!decoded.email_verified)
      return NextResponse.json(
        { error: "Verify your account email before creating a school." },
        { status: 403 },
      );
    const owner = await getAdminServices().db.collection("platformOwners").doc(decoded.uid).get();
    if (!owner.exists || owner.get("status") !== "active")
      return NextResponse.json(
        { error: "Only an authorized System Owner can create schools." },
        { status: 403 },
      );
    const result = await createSchoolForUser(
      decoded.uid,
      decoded.name ?? "System Owner",
      input.data,
      decoded.email ?? "",
    );
    return NextResponse.json(result, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "USER_ALREADY_HAS_SCHOOL")
      return NextResponse.json(
        {
          error:
            "This account already has a school. Ask an administrator to add you to another school.",
        },
        { status: 409 },
      );
    if (cause instanceof Error && cause.message === "SCHOOL_CODE_TAKEN")
      return NextResponse.json(
        { error: "That school code is already in use. Choose a different code." },
        { status: 409 },
      );
    return NextResponse.json({ error: "School setup could not be completed." }, { status: 500 });
  }
}
