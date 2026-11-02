import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";

export const dynamic = "force-dynamic";
const requestSchema = z.object({
  studentId: z.string().min(1),
  fromDate: z.string().date(),
  toDate: z.string().date(),
  reason: z.string().trim().min(5).max(1000),
}).refine((value) => value.toDate >= value.fromDate, { message: "End date must be on or after the start date" });
const decisionSchema = z.object({ requestId: z.string().min(1), decision: z.enum(["approved", "rejected"]), reviewNote: z.string().trim().max(500).optional().default("") });
function canReview(permissions: readonly string[]) {
  return hasPermission(permissions, "leave.manage");
}
async function ownsStudent(root: FirebaseFirestore.DocumentReference, studentId: string, context: NonNullable<Awaited<ReturnType<typeof getSchoolContext>>>) {
  if (context.role === "parent") {
    const link = await root.collection("studentGuardianLinks").where("studentId", "==", studentId).where("guardianUid", "==", context.uid).where("status", "==", "active").limit(1).get();
    return !link.empty;
  }
  if (context.role === "student") {
    const student = await root.collection("students").doc(studentId).get();
    return student.exists && (student.get("accountUid") === context.uid || student.get("userUid") === context.uid);
  }
  return hasPermission(context.permissions, "students.read");
}
function serialize(doc: FirebaseFirestore.DocumentSnapshot) {
  const value = doc.data() ?? {};
  return { id: doc.id, ...value, createdAt: value.createdAt?.toDate?.()?.toISOString?.() ?? value.createdAt ?? null, reviewedAt: value.reviewedAt?.toDate?.()?.toISOString?.() ?? value.reviewedAt ?? null };
}
export async function GET(req: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const root = getAdminServices().db.collection("schools").doc(context.schoolId);
  const studentId = req.nextUrl.searchParams.get("studentId");
  const query = root.collection("studentLeaveRequests");
  let snapshot;
  if (studentId) {
    if (!(await ownsStudent(root, studentId, context))) return NextResponse.json({ error: "Student access denied" }, { status: 403 });
    snapshot = await query.where("studentId", "==", studentId).limit(100).get();
  } else {
    if (!canReview(context.permissions)) return NextResponse.json({ error: "Leave review access denied" }, { status: 403 });
    snapshot = await query.where("status", "==", "pending").limit(200).get();
  }
  return NextResponse.json({ requests: snapshot.docs.map(serialize) }, { headers: { "Cache-Control": "private,no-store" } });
}
export async function POST(req: NextRequest) {
  if (!hasValidCsrf(req)) return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context || !(context.role === "parent" || context.role === "student")) return NextResponse.json({ error: "Only a parent or student can submit leave" }, { status: 403 });
  const body = requestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid leave request" }, { status: 400 });
  const root = getAdminServices().db.collection("schools").doc(context.schoolId);
  if (!(await ownsStudent(root, body.data.studentId, context))) return NextResponse.json({ error: "Student access denied" }, { status: 403 });
  const now = new Date();
  const ref = root.collection("studentLeaveRequests").doc();
  await ref.create({ ...body.data, status: "pending", requestedBy: context.uid, createdAt: now, updatedAt: now, schoolId: context.schoolId });
  return NextResponse.json({ id: ref.id }, { status: 201 });
}
export async function PATCH(req: NextRequest) {
  if (!hasValidCsrf(req)) return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context || !canReview(context.permissions)) return NextResponse.json({ error: "Leave review permission required" }, { status: 403 });
  const body = decisionSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid leave decision" }, { status: 400 });
  const root = getAdminServices().db.collection("schools").doc(context.schoolId);
  const ref = root.collection("studentLeaveRequests").doc(body.data.requestId);
  const request = await ref.get();
  if (!request.exists) return NextResponse.json({ error: "Leave request not found" }, { status: 404 });
  const now = new Date();
  await ref.update({ status: body.data.decision, reviewNote: body.data.reviewNote, reviewedBy: context.uid, reviewedAt: now, updatedAt: now });
  if (body.data.decision === "approved") {
    const studentId = String(request.get("studentId"));
    const student = await root.collection("students").doc(studentId).get();
    const classes = await root.collection("classes").where("grade", "==", student.get("grade")).where("name", "==", student.get("className")).limit(1).get();
    const classId = classes.docs[0]?.id;
    if (classId) {
      const from = String(request.get("fromDate")), to = String(request.get("toDate"));
      const sessions = await root.collection("attendanceSessions").where("classId", "==", classId).where("date", ">=", from).where("date", "<=", to).limit(100).get();
      await Promise.all(sessions.docs.map((session) => session.ref.collection("records").doc(studentId).set({ studentId, status: "excused", notes: `Approved leave request ${ref.id}`, updatedAt: now }, { merge: true })));
    }
  }
  await root.collection("auditLogs").add({ schoolId: context.schoolId, actorUid: context.uid, action: `studentLeave.${body.data.decision}`, recordType: "studentLeaveRequest", recordId: ref.id, occurredAt: now });
  return NextResponse.json({ ok: true });
}
