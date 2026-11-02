import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type RouteContext = { params: Promise<{ studentId: string }> };
const linkSchema = z.object({}).strict();

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "students.account.link"))
    return NextResponse.json(
      { error: "Student account-link permission required" },
      { status: 403 },
    );
  const parsed = linkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Enter a valid student account UID" }, { status: 400 });
  const { studentId } = await params;
  const { db, auth } = getAdminServices();
  const schoolRef = db.collection("schools").doc(context.schoolId);
  const studentRef = schoolRef.collection("students").doc(studentId);
  try {
    const student = await studentRef.get();
    if (!student.exists)
      return NextResponse.json({ error: "Student record not found" }, { status: 404 });
    const expectedEmail = String(student.get("studentEmail") ?? "")
      .trim()
      .toLowerCase();
    if (!expectedEmail)
      return NextResponse.json(
        { error: "Add the student email to the profile before linking an account" },
        { status: 400 },
      );
    let authUser;
    try {
      authUser = await auth.getUserByEmail(expectedEmail);
    } catch {
      return NextResponse.json(
        { error: "No student login exists for the registered email" },
        { status: 404 },
      );
    }
    const linkedUid = authUser.uid;
    const userRef = db.collection("users").doc(linkedUid);
    const user = await userRef.get();
    if (!user.exists)
      return NextResponse.json({ error: "Student user profile was not found" }, { status: 404 });
    if (!authUser.emailVerified)
      return NextResponse.json(
        { error: "Student account must have a verified email address" },
        { status: 400 },
      );
    if (user.get("activeSchoolId") !== context.schoolId)
      return NextResponse.json(
        { error: "Student account is not active in this school" },
        { status: 403 },
      );
    const membership = await schoolRef.collection("memberships").doc(linkedUid).get();
    if (
      !membership.exists ||
      membership.get("status") !== "active" ||
      membership.get("role") !== "student"
    )
      return NextResponse.json(
        { error: "Only an active student-role account can be linked" },
        { status: 403 },
      );
    const duplicate = await schoolRef
      .collection("students")
      .where("accountUid", "==", linkedUid)
      .limit(2)
      .get();
    if (duplicate.docs.some((doc) => doc.id !== studentId))
      return NextResponse.json(
        { error: "This account is already linked to a different student record" },
        { status: 409 },
      );
    await db.runTransaction(async (transaction) => {
      const [latestStudent, latestUser] = await Promise.all([
        transaction.get(studentRef),
        transaction.get(userRef),
      ]);
      if (!latestStudent.exists || !latestUser.exists)
        throw new Error("ACCOUNT_LINK_RECORD_MISSING");
      const currentUid = latestStudent.get("accountUid");
      if (typeof currentUid === "string" && currentUid !== linkedUid)
        throw new Error("STUDENT_ALREADY_LINKED");
      const currentStudentId = latestUser.get("studentRecordId");
      if (typeof currentStudentId === "string" && currentStudentId !== studentId)
        throw new Error("ACCOUNT_ALREADY_LINKED");
      transaction.update(studentRef, {
        accountUid: linkedUid,
        accountEmail: authUser.email!.toLowerCase(),
        accountLinkedAt: new Date(),
        accountLinkedBy: context.uid,
        updatedAt: new Date(),
      });
      transaction.update(userRef, { studentRecordId: studentId, updatedAt: new Date() });
      const auditRef = schoolRef.collection("auditLogs").doc();
      transaction.set(auditRef, {
        schoolId: context.schoolId,
        actorUid: context.uid,
        action: "student.account.linked",
        recordType: "student",
        recordId: studentId,
        linkedUserUid: linkedUid,
        occurredAt: new Date(),
      });
    });
    return NextResponse.json({ ok: true, accountUid: linkedUid, email: authUser.email });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "STUDENT_ALREADY_LINKED")
      return NextResponse.json(
        { error: "This student already has a different linked account" },
        { status: 409 },
      );
    if (message === "ACCOUNT_ALREADY_LINKED")
      return NextResponse.json(
        { error: "This user account is already linked to a different student" },
        { status: 409 },
      );
    return NextResponse.json({ error: "Student account could not be linked" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "students.account.link"))
    return NextResponse.json(
      { error: "Student account-link permission required" },
      { status: 403 },
    );
  const { studentId } = await params;
  const { db } = getAdminServices();
  const schoolRef = db.collection("schools").doc(context.schoolId);
  const studentRef = schoolRef.collection("students").doc(studentId);
  try {
    const student = await studentRef.get();
    if (!student.exists) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    const uid = student.get("accountUid");
    if (typeof uid !== "string") return NextResponse.json({ ok: true, unlinked: false });
    const userRef = db.collection("users").doc(uid);
    await db.runTransaction(async (transaction) => {
      const [latestStudent, latestUser] = await Promise.all([
        transaction.get(studentRef),
        transaction.get(userRef),
      ]);
      if (!latestStudent.exists) throw new Error("STUDENT_NOT_FOUND");
      transaction.update(studentRef, {
        accountUid: FieldValue.delete(),
        accountEmail: FieldValue.delete(),
        accountLinkedAt: FieldValue.delete(),
        accountLinkedBy: FieldValue.delete(),
        updatedAt: new Date(),
      });
      if (latestUser.exists && latestUser.get("studentRecordId") === studentId)
        transaction.update(userRef, {
          studentRecordId: FieldValue.delete(),
          updatedAt: new Date(),
        });
      const auditRef = schoolRef.collection("auditLogs").doc();
      transaction.set(auditRef, {
        schoolId: context.schoolId,
        actorUid: context.uid,
        action: "student.account.unlinked",
        recordType: "student",
        recordId: studentId,
        linkedUserUid: uid,
        occurredAt: new Date(),
      });
    });
    return NextResponse.json({ ok: true, unlinked: true });
  } catch {
    return NextResponse.json({ error: "Student account could not be unlinked" }, { status: 500 });
  }
}
