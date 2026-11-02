import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasValidCsrf } from "@/server/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const normalize = (value: string) => value.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const compact = (value: string) => normalize(value).replace(/\s+/g, "");
const tokens = (value: string) => new Set(normalize(value).split(/\s+/).filter((token) => token.length > 1));
function similarity(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b || a.includes(b) || b.includes(a)) return 1;
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? overlap / union : 0;
}

export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request)) return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const context = await getSchoolContext();
  if (!context || context.role !== "parent") return NextResponse.json({ error: "Parent account setup is only available to parent accounts." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const admissionNumber = typeof body?.admissionNumber === "string" ? body.admissionNumber.trim().slice(0, 80) : "";
  const childName = typeof body?.childName === "string" ? body.childName.trim().slice(0, 120) : "";
  const address = typeof body?.address === "string" ? body.address.trim().slice(0, 500) : "";
  if (!admissionNumber || childName.length < 2 || address.length < 5) return NextResponse.json({ error: "Enter the child admission number, full name, and home address." }, { status: 400 });
  const { auth, db } = getAdminServices();
  const account = await auth.getUser(context.uid);
  const accountEmail = String(account.email ?? "").trim().toLowerCase();
  if (!account.emailVerified || !accountEmail) return NextResponse.json({ error: "Verify your parent account email before linking a child." }, { status: 403 });
  const root = db.collection("schools").doc(context.schoolId);
  try {
    const [admissionMatches, guardianRecords] = await Promise.all([
      root.collection("students").where("admissionNumber", "==", admissionNumber).limit(10).get(),
      root.collection("guardians").limit(1000).get(),
    ]);
    const accountGuardian = guardianRecords.docs.find((guardian) => String(guardian.get("email") ?? "").trim().toLowerCase() === accountEmail);
    const candidates = admissionMatches.docs.length
      ? admissionMatches.docs
      : (await root.collection("students").limit(1000).get()).docs.filter((student) => compact(String(student.get("admissionNumber") ?? "")) === compact(admissionNumber));
    const candidate = candidates.find((student) => {
      const storedNames = [student.get("fullName"), student.get("nameWithInitials"), student.get("preferredName")].filter((value): value is string => typeof value === "string" && value.trim().length > 1);
      const storedEmail = String(student.get("guardianEmail") ?? "").trim().toLowerCase();
      const emailMatches = storedEmail === accountEmail || Boolean(accountGuardian);
      const nameMatches = storedNames.some((storedName) => similarity(childName, storedName) >= 0.4);
      const addressCandidates = [student.get("address"), student.get("guardianAddress"), accountGuardian?.get("address")].filter((value): value is string => typeof value === "string" && value.trim().length > 2);
      const addressMatches = addressCandidates.some((storedAddress) => similarity(address, storedAddress) >= 0.2);
      return emailMatches && nameMatches && addressMatches;
    });
    if (!candidate) return NextResponse.json({ error: "We could not verify those details. Check the admission number, child name, and address with the school office." }, { status: 404 });
    const guardianRef = accountGuardian?.ref ?? root.collection("guardians").doc();
    const linkRef = root.collection("studentGuardianLinks").doc(`${candidate.id}_${guardianRef.id}`);
    const now = new Date();
    await db.runTransaction(async (tx) => {
      const existingLink = await tx.get(linkRef);
      tx.set(guardianRef, { schoolId: context.schoolId, fullName: accountGuardian?.get("fullName") ?? account.displayName ?? "Parent / guardian", email: accountEmail, phone: accountGuardian?.get("phone") ?? "", relationship: accountGuardian?.get("relationship") ?? "Parent", updatedAt: now, ...(!accountGuardian ? { createdAt: now, createdBy: context.uid } : {}) }, { merge: true });
      tx.set(linkRef, { schoolId: context.schoolId, studentId: candidate.id, guardianId: guardianRef.id, guardianUid: context.uid, relationship: accountGuardian?.get("relationship") ?? "Parent", accessPermissions: ["attendance", "published_results", "fees", "report_cards", "announcements", "assignments"], status: "active", createdAt: existingLink.exists ? existingLink.get("createdAt") : now, updatedAt: now, createdBy: existingLink.exists ? existingLink.get("createdBy") : context.uid }, { merge: true });
      tx.update(candidate.ref, { guardianIds: Array.from(new Set([...(candidate.get("guardianIds") ?? []), guardianRef.id])) });
    });
    await root.collection("auditLogs").add({ schoolId: context.schoolId, actorUid: context.uid, action: "parent.self_linked", recordType: "student", recordId: candidate.id, guardianId: guardianRef.id, occurredAt: now });
    return NextResponse.json({ ok: true, studentId: candidate.id });
  } catch {
    return NextResponse.json({ error: "Parent setup could not be completed. Please contact the school office." }, { status: 500 });
  }
}
