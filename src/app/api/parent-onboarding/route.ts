import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSessionUid } from "@/server/context";
import { permissionsForRole } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function verifiedAccount() {
  const uid = await getSessionUid();
  if (!uid) return null;
  const { auth } = getAdminServices();
  const account = await auth.getUser(uid);
  if (!account.emailVerified || !account.email) return null;
  return { uid, email: account.email.trim().toLowerCase(), displayName: account.displayName ?? "Parent / guardian" };
}

export async function GET() {
  const account = await verifiedAccount();
  if (!account) return NextResponse.json({ error: "Sign in and verify your email first." }, { status: 401 });
  try {
    const { db } = getAdminServices();
    // Avoid collection-group indexes here: parent onboarding must work on a newly
    // provisioned school before optional Firestore indexes have been deployed.
    const schoolSnapshots = await db.collection("schools").where("status", "==", "active").limit(100).get();
    const options = await Promise.all(schoolSnapshots.docs.map(async (school) => {
      const [guardians, students] = await Promise.all([
        school.ref.collection("guardians").where("email", "==", account.email).limit(1).get(),
        school.ref.collection("students").where("guardianEmail", "==", account.email).limit(1).get(),
      ]);
      const guardian = guardians.docs[0];
      const student = students.docs[0];
      if (!guardian && !student) return null;
      return { schoolId: school.id, schoolName: String(school.get("name") ?? "School"), guardianName: String(guardian?.get("fullName") ?? student?.get("guardianName") ?? account.displayName) };
    }));
    return NextResponse.json({ schools: [...new Map(options.filter(Boolean).map((item) => [item!.schoolId, item])).values()] }, { headers: { "Cache-Control": "private,no-store" } });
  } catch {
    return NextResponse.json({ error: "Parent school discovery is temporarily unavailable." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request)) return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const account = await verifiedAccount();
  if (!account) return NextResponse.json({ error: "Sign in and verify your email first." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const schoolId = typeof body?.schoolId === "string" ? body.schoolId.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(schoolId)) return NextResponse.json({ error: "Choose a valid school workspace." }, { status: 400 });
  const { db } = getAdminServices();
  const school = db.collection("schools").doc(schoolId);
  try {
    const [guardians, students] = await Promise.all([
      school.collection("guardians").where("email", "==", account.email).limit(1).get(),
      school.collection("students").where("guardianEmail", "==", account.email).limit(1).get(),
    ]);
    const schoolSnapshot = await school.get();
    if (!schoolSnapshot.exists || schoolSnapshot.get("status") !== "active" || (guardians.empty && students.empty)) return NextResponse.json({ error: "No verified parent record was found for this school." }, { status: 404 });
    const membership = school.collection("memberships").doc(account.uid);
    const user = db.collection("users").doc(account.uid);
    const now = new Date();
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(membership);
      if (existing.exists && existing.get("status") === "active" && existing.get("role") !== "parent") throw new Error("ROLE_CONFLICT");
      tx.set(membership, { uid: account.uid, email: account.email, displayName: account.displayName, role: "parent", status: "active", permissions: [...permissionsForRole("parent")], acceptedAt: now, updatedAt: now, createdAt: existing.exists ? existing.get("createdAt") : now }, { merge: true });
      tx.set(user, { displayName: account.displayName, email: account.email, activeSchoolId: schoolId, updatedAt: now }, { merge: true });
    });
    return NextResponse.json({ ok: true, schoolId });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "ROLE_CONFLICT") return NextResponse.json({ error: "This account already has another active role in that school." }, { status: 409 });
    return NextResponse.json({ error: "Parent workspace activation failed." }, { status: 500 });
  }
}
