import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const statusSchema = z.enum(["present", "absent", "late", "excused"]);
const ATTENDANCE_EDIT_WINDOW_MS = 5 * 60 * 1000;
function timestampMs(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  const parsed = new Date(String(value ?? "")).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}
function timestampIso(value: unknown) {
  const ms = timestampMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}
const isSchoolDay = (date: string) => {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return weekday >= 1 && weekday <= 5;
};
function gradeKey(value: unknown) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(?:grade\s*)?0*(\d{1,2})$/i);
  return match ? `grade:${Number(match[1])}` : text.toLowerCase().replace(/\s+/g, " ");
}
function classKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/^(?:GRADE\s*)?0*\d{1,2}\s*[-–—:/]\s*/, "")
    .replace(/\s+/g, " ");
}
function matchesClass(data: FirebaseFirestore.DocumentData, classData: FirebaseFirestore.DocumentData) {
  if (gradeKey(data.grade) !== gradeKey(classData.grade)) return false;
  const wanted = new Set([classKey(classData.section), classKey(classData.name)].filter(Boolean));
  return wanted.has(classKey(data.className));
}
type C = { schoolId: string; uid: string; permissions: readonly string[] };
async function access(
  c: C,
  classId: string,
  date?: string,
) {
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(c.schoolId);
  const cls = await root.collection("classes").doc(classId).get();
  if (!cls.exists) return { ok: false as const, status: 404 };
  const coverSnap = date
    ? await root.collection("attendanceCovers").doc(`${classId}_${date}`).get()
    : null;
  const coverData = coverSnap?.exists ? coverSnap.data() ?? null : null;
  const cover = coverData?.status === "active" && coverData.teacherUid
    ? coverData
    : null;
  const admin =
    hasPermission(c.permissions, "attendance.read") ||
    hasPermission(c.permissions, "attendance.mark") ||
    hasPermission(c.permissions, "attendance.correct");
  if (admin) return { ok: true as const, root, cls, admin: true, cover };
  if (cover && cover.teacherUid !== c.uid) return { ok: false as const, status: 403 };
  if (
    !hasPermission(c.permissions, "attendance.read.assigned") &&
    !hasPermission(c.permissions, "attendance.mark.assigned")
  )
    return { ok: false as const, status: 403 };
  const data = cls.data()!;
  if (cover?.teacherUid === c.uid)
    return { ok: true as const, root, cls, admin: false, cover };
  if (data.teacherId === c.uid) return { ok: true as const, root, cls, admin: false, cover: null };
  const links = await root
    .collection("teacherAssignments")
    .where("teacherUid", "==", c.uid)
    .limit(200)
    .get();
  if (!links.docs.some((d) => d.get("grade") === data.grade && d.get("className") === data.name))
    return { ok: false as const, status: 403 };
  return { ok: true as const, root, cls, admin: false, cover: null };
}
async function roster(
  root: FirebaseFirestore.DocumentReference,
  classData: FirebaseFirestore.DocumentData,
) {
  if (typeof classData.academicYearId === "string") {
    const enrollments = await root
      .collection("enrollments")
      .where("academicYearId", "==", classData.academicYearId)
      .limit(1500)
      .get();
    const active = enrollments.docs.filter(
      (enrollment) =>
        enrollment.get("status") === "active" &&
        matchesClass(enrollment.data(), classData),
    );
    const students = await Promise.all(
      active.map((e) => root.collection("students").doc(e.get("studentId")).get()),
    );
    return students.filter((s) => s.exists && s.get("status") !== "archived");
  }
  const gradeText = String(classData.grade ?? "").trim();
  const number = gradeText.match(/^(?:grade\s*)?0*(\d{1,2})$/i)?.[1];
  const variants: unknown[] = number
    ? [...new Set([gradeText, `Grade ${Number(number)}`, `Grade ${String(Number(number)).padStart(2, "0")}`, String(Number(number))])]
    : [gradeText];
  const snapshots = await Promise.all(variants.map((grade) =>
    root.collection("students").where("grade", "==", grade).limit(1200).get(),
  ));
  const byId = new Map(snapshots.flatMap((snapshot) => snapshot.docs).map((student) => [student.id, student]));
  return [...byId.values()].filter((student) =>
    student.get("status") !== "archived" && matchesClass(student.data(), classData),
  );
}
export async function GET(req: NextRequest) {
  const c = await getSchoolContext();
  if (!c) return NextResponse.json({ error: "School access required" }, { status: 403 });
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(c.schoolId);
  const classId = req.nextUrl.searchParams.get("classId"),
    date = req.nextUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10),
    month = req.nextUrl.searchParams.get("month");
  try {
    if (req.nextUrl.searchParams.get("type") === "insights") {
      if (!hasPermission(c.permissions, "attendance.read"))
        return NextResponse.json({ error: "Attendance insights access denied" }, { status: 403 });
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const from = since.toISOString().slice(0, 10);
      const [sessionSnapshot, studentSnapshot] = await Promise.all([
        root.collection("attendanceSessions").where("date", ">=", from).limit(300).get(),
        root.collection("students").where("status", "!=", "archived").limit(1000).get(),
      ]);
      const stats = new Map<string, { present: number; absent: number; late: number; excused: number }>();
      const classStats = new Map<string, { total: number; present: number; absent: number; late: number; excused: number }>();
      await Promise.all(sessionSnapshot.docs.map(async (session) => {
        const records = await session.ref.collection("records").get();
        const classKey = String(session.get("className") ?? session.get("classId") ?? "Class");
        const group = classStats.get(classKey) ?? { total: 0, present: 0, absent: 0, late: 0, excused: 0 };
        records.docs.forEach((record) => {
          const status = String(record.get("status") ?? "");
          if (!["present", "absent", "late", "excused"].includes(status)) return;
          const item = stats.get(record.id) ?? { present: 0, absent: 0, late: 0, excused: 0 };
          item[status as keyof typeof item] += 1;
          stats.set(record.id, item);
          group[status as keyof typeof group] += 1;
          group.total += 1;
        });
        classStats.set(classKey, group);
      }));
      const names = new Map(studentSnapshot.docs.map((student) => [student.id, { name: String(student.get("fullName") ?? "Student"), grade: String(student.get("grade") ?? ""), className: String(student.get("className") ?? "") }]));
      const atRisk = [...stats.entries()].map(([studentId, value]) => {
        const denominator = value.present + value.absent + value.late;
        return { studentId, ...names.get(studentId), ...value, attendancePercentage: denominator ? Math.round(((value.present + value.late) / denominator) * 100) : 0 };
      }).filter((item) => item.attendancePercentage < 80 && item.absent >= 2).sort((a, b) => a.attendancePercentage - b.attendancePercentage).slice(0, 20);
      const classes = [...classStats.entries()].map(([name, value]) => ({ name, ...value, attendancePercentage: value.total - value.excused ? Math.round(((value.present + value.late) / (value.total - value.excused)) * 100) : 0 })).sort((a, b) => a.attendancePercentage - b.attendancePercentage);
      return NextResponse.json({ range: { from, to: new Date().toISOString().slice(0, 10) }, sessions: sessionSnapshot.size, atRisk, classes });
    }
    if (req.nextUrl.searchParams.get("type") === "corrections") {
      if (!hasPermission(c.permissions, "attendance.correct"))
        return NextResponse.json(
          { error: "Correction review permission required" },
          { status: 403 },
        );
      const requests = await root
        .collection("attendanceCorrections")
        .where("status", "==", "pending")
        .limit(300)
        .get();
      return NextResponse.json(
        { requests: requests.docs.map((d) => ({ id: d.id, ...d.data() })) },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    if (req.nextUrl.searchParams.get("type") === "cover_teachers") {
      if (
        !hasPermission(c.permissions, "attendance.mark") &&
        !hasPermission(c.permissions, "teachers.manage")
      )
        return NextResponse.json({ error: "Class cover assignment permission required" }, { status: 403 });
      const memberships = await root.collection("memberships").get();
      const teachers = memberships.docs.flatMap((doc) => {
        const member = doc.data() ?? {};
        const role = String(member.role ?? "");
        if (
          String(member.status ?? "active") !== "active" ||
          !["teacher", "class_teacher", "subject_teacher"].includes(role)
        )
          return [];
        return [{
          uid: doc.id,
          name: typeof member.displayName === "string" && member.displayName.trim()
            ? member.displayName
            : "Teacher",
          role,
        }];
      }).sort((a, b) => a.name.localeCompare(b.name));
      return NextResponse.json({ teachers }, { headers: { "Cache-Control": "private,no-store" } });
    }
    if (req.nextUrl.searchParams.get("type") === "classes") {
      if (!z.string().date().safeParse(date).success)
        return NextResponse.json({ error: "Date must use YYYY-MM-DD format" }, { status: 400 });
      if (
        !hasPermission(c.permissions, "attendance.read") &&
        !hasPermission(c.permissions, "attendance.mark") &&
        !hasPermission(c.permissions, "attendance.read.assigned") &&
        !hasPermission(c.permissions, "attendance.mark.assigned")
      )
        return NextResponse.json({ error: "Attendance access denied" }, { status: 403 });
      const classes = await root.collection("classes").limit(500).get();
      const result = [];
      for (const cls of classes.docs) {
        const resultAccess = await access(c, cls.id, date);
        if (resultAccess.ok) result.push({ id: cls.id, ...cls.data(), isClassTeacher: cls.get("teacherId") === c.uid });
      }
      return NextResponse.json({ classes: result });
    }
    if (month) {
      if (!/^\d{4}-\d{2}$/.test(month))
        return NextResponse.json({ error: "Month must use YYYY-MM format" }, { status: 400 });
      const first = `${month}-01`,
        last = `${month}-31`;
      const all = await root
        .collection("attendanceSessions")
        .where("date", ">=", first)
        .where("date", "<=", last)
        .limit(1000)
        .get();
      const sessions = all.docs.filter((d) => !classId || d.get("classId") === classId);
      if (
        !hasPermission(c.permissions, "attendance.read") &&
        !hasPermission(c.permissions, "attendance.read.assigned")
      )
        return NextResponse.json({ error: "Attendance history access denied" }, { status: 403 });
      const visible = [];
      for (const d of sessions) {
        const a = await access(c, String(d.get("classId")), String(d.get("date")));
        if (a.ok) visible.push({ id: d.id, ...d.data() });
      }
      return NextResponse.json(
        { sessions: visible },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    if (!classId) return NextResponse.json({ error: "Select a class" }, { status: 400 });
    if (!z.string().date().safeParse(date).success)
      return NextResponse.json({ error: "Date must use YYYY-MM-DD format" }, { status: 400 });
    const a = await access(c, classId, date);
    if (!a.ok)
      return NextResponse.json({ error: "Class attendance access denied" }, { status: a.status });
    const students = await roster(a.root, a.cls.data()!);
    const sessionId = `${classId}_${date}_daily`;
    const session = await a.root.collection("attendanceSessions").doc(sessionId).get();
    const marked = session.exists ? await session.ref.collection("records").get() : null;
    const byId = new Map((marked?.docs ?? []).map((d) => [d.id, d.data()]));
    return NextResponse.json(
      {
        class: { id: a.cls.id, ...a.cls.data() },
        date,
        cover: a.cover ? {
          teacherUid: a.cover.teacherUid,
          teacherName: a.cover.teacherName ?? "Assigned teacher",
          assignedBy: a.cover.assignedBy,
          reason: a.cover.reason ?? "",
        } : null,
        students: students.map((s) => ({
          id: s.id,
          fullName: s.get("fullName"),
          admissionNumber: s.get("admissionNumber"),
          status: byId.get(s.id)?.status ?? null,
          updatedAt: timestampIso(byId.get(s.id)?.updatedAt),
          notes: byId.get(s.id)?.notes ?? "",
        })),
        summary: session.exists ? session.data() : null,
        sessionId,
      },
      { headers: { "Cache-Control": "private,no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Attendance data unavailable" }, { status: 500 });
  }
}
const bulkSchema = z.object({
  action: z.literal("mark"),
  classId: z.string().min(1),
  date: z.string().date(),
  records: z
    .array(
      z.object({
        studentId: z.string().min(1),
        status: statusSchema,
        notes: z.string().max(300).optional(),
      }),
    )
    .min(1)
    .max(300),
});
const correctionSchema = z.object({
  action: z.literal("request_correction"),
  classId: z.string().min(1),
  date: z.string().date(),
  studentId: z.string().min(1),
  requestedStatus: statusSchema,
  reason: z.string().min(5).max(500),
});
const coverAssignmentSchema = z.object({
  action: z.literal("assign_cover"),
  classId: z.string().trim().min(1).max(160).refine((value) => !value.includes("/")),
  date: z.string().date(),
  teacherUid: z.string().trim().min(1).max(128).refine((value) => !value.includes("/")),
  reason: z.string().trim().max(300).optional().default(""),
});
const decideSchema = z.object({
  action: z.literal("decide_correction"),
  requestId: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().max(500).optional(),
});
export async function POST(req: NextRequest) {
  if (!hasValidCsrf(req))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const c = await getSchoolContext();
  if (!c) return NextResponse.json({ error: "School access required" }, { status: 403 });
  const raw = await req.json().catch(() => null);
  const decision = decideSchema.safeParse(raw);
  const correction = correctionSchema.safeParse(raw);
  const coverAssignment = coverAssignmentSchema.safeParse(raw);
  const bulk = bulkSchema.safeParse(raw);
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(c.schoolId);
  try {
    if (coverAssignment.success) {
      if (!isSchoolDay(coverAssignment.data.date))
        return NextResponse.json({ error: "Saturday and Sunday are school holidays. Class cover is only available Monday to Friday." }, { status: 400 });
      if (
        !hasPermission(c.permissions, "attendance.mark") &&
        !hasPermission(c.permissions, "teachers.manage")
      )
        return NextResponse.json({ error: "Class cover assignment permission required" }, { status: 403 });
      const data = coverAssignment.data;
      const classRef = root.collection("classes").doc(data.classId);
      const classSnap = await classRef.get();
      if (!classSnap.exists)
        return NextResponse.json({ error: "Class not found" }, { status: 404 });
      if (classSnap.get("teacherId") === data.teacherUid)
        return NextResponse.json(
          { error: "Choose a different teacher from the class’s regular teacher." },
          { status: 400 },
        );
      const [user, membership] = await Promise.all([
        root.collection("users").doc(data.teacherUid).get(),
        root.collection("memberships").doc(data.teacherUid).get(),
      ]);
      const role = String(membership.get("role") ?? "");
      if (
        !user.exists || user.get("activeSchoolId") !== c.schoolId ||
        !membership.exists || String(membership.get("status") ?? "active") !== "active" ||
        !["teacher", "class_teacher", "subject_teacher"].includes(role)
      )
        return NextResponse.json(
          { error: "Choose an active class teacher or subject teacher from this school." },
          { status: 400 },
        );
      const classLabel = [classSnap.get("grade"), classSnap.get("section"), classSnap.get("name")]
        .filter((value) => typeof value === "string" && value.trim())
        .join(" · ");
      const teacherName = typeof membership.get("displayName") === "string"
        ? membership.get("displayName")
        : typeof user.get("displayName") === "string"
          ? user.get("displayName")
          : "Teacher";
      const reason = data.reason || "Class teacher unavailable";
      const now = new Date();
      const coverRef = root.collection("attendanceCovers").doc(`${data.classId}_${data.date}`);
      const teacherNotice = root.collection("notifications").doc();
      const auditRef = root.collection("auditLogs").doc();
      const attendanceAuditRef = root.collection("attendanceAudit").doc();
      const attendanceLink = `/attendance?classId=${encodeURIComponent(data.classId)}&date=${data.date}`;
      const outcome = await db.runTransaction(async (tx) => {
        const previous = await tx.get(coverRef);
        const previousTeacherUid = previous.exists ? String(previous.get("teacherUid") ?? "") : "";
        if (
          previous.exists &&
          previous.get("status") === "active" &&
          previousTeacherUid === data.teacherUid
        )
          return { kind: "unchanged" as const, previousTeacherUid };
        tx.set(coverRef, {
          classId: data.classId,
          className: classLabel,
          grade: classSnap.get("grade") ?? "",
          date: data.date,
          teacherUid: data.teacherUid,
          teacherName,
          reason,
          status: "active",
          createdAt: previous.exists ? previous.get("createdAt") ?? now : now,
          createdBy: previous.exists ? previous.get("createdBy") ?? c.uid : c.uid,
          updatedAt: now,
          updatedBy: c.uid,
          schoolId: c.schoolId,
        });
        tx.create(teacherNotice, {
          recipientUid: data.teacherUid,
          category: "attendance",
          type: "attendance_cover_assignment",
          title: "You’re assigned as class cover",
          message: `You have been assigned to take attendance for ${classLabel} on ${data.date}. ${reason}`,
          deepLink: attendanceLink,
          recordId: coverRef.id,
          read: false,
          archived: false,
          createdAt: now,
          schoolId: c.schoolId,
        });
        const reassigned = Boolean(previousTeacherUid && previousTeacherUid !== data.teacherUid);
        if (reassigned) {
          const oldTeacherNotice = root.collection("notifications").doc();
          tx.create(oldTeacherNotice, {
            recipientUid: previousTeacherUid,
            category: "attendance",
            type: "attendance_cover_reassigned",
            title: "Class cover assignment updated",
            message: `Your temporary attendance cover for ${classLabel} on ${data.date} was reassigned.`,
            deepLink: "/notifications",
            recordId: coverRef.id,
            read: false,
            archived: false,
            createdAt: now,
            schoolId: c.schoolId,
          });
        }
        tx.create(auditRef, {
          schoolId: c.schoolId,
          actorUid: c.uid,
          action: reassigned ? "attendance.cover_reassigned" : "attendance.cover_assigned",
          recordType: "attendanceCover",
          recordId: coverRef.id,
          classId: data.classId,
          date: data.date,
          teacherUid: data.teacherUid,
          previousTeacherUid: previousTeacherUid || null,
          occurredAt: now,
        });
        tx.create(attendanceAuditRef, {
          schoolId: c.schoolId,
          actorUid: c.uid,
          action: reassigned ? "attendance.cover_reassigned" : "attendance.cover_assigned",
          recordId: coverRef.id,
          classId: data.classId,
          date: data.date,
          teacherUid: data.teacherUid,
          previousTeacherUid: previousTeacherUid || null,
          occurredAt: now,
        });
        return { kind: "assigned" as const, previousTeacherUid, reassigned };
      });
      if (outcome.kind === "unchanged")
        return NextResponse.json({ ok: true, unchanged: true, teacherName, classLabel, date: data.date });
      return NextResponse.json(
        { ok: true, reassigned: outcome.reassigned, teacherName, classLabel, date: data.date },
        { status: outcome.reassigned ? 200 : 201 },
      );
    }
    if (decision.success) {
      if (!hasPermission(c.permissions, "attendance.correct"))
        return NextResponse.json(
          { error: "Attendance correction approval permission required" },
          { status: 403 },
        );
      const ref = root.collection("attendanceCorrections").doc(decision.data.requestId);
      const request = await ref.get();
      if (!request.exists)
        return NextResponse.json({ error: "Correction request not found" }, { status: 404 });
      if (request.get("status") !== "pending")
        return NextResponse.json(
          { error: "Correction request was already decided" },
          { status: 409 },
        );
      if (decision.data.decision === "approved") {
        const session = root.collection("attendanceSessions").doc(request.get("sessionId"));
        await session
          .collection("records")
          .doc(request.get("studentId"))
          .set(
            {
              studentId: request.get("studentId"),
              status: request.get("requestedStatus"),
              correctedAt: new Date(),
              correctedBy: c.uid,
              notes: decision.data.reason ?? "",
            },
            { merge: true },
          );
        const all = await session.collection("records").get();
        const counts = { present: 0, absent: 0, late: 0, excused: 0 };
        for (const item of all.docs) {
          const s = item.get("status") as keyof typeof counts;
          if (s in counts) counts[s]++;
        }
        const denom =
          Number((await session.get()).get("totalEnrolled") ?? all.size) - counts.excused;
        await session.set(
          {
            ...counts,
            markedCount: all.size,
            attendancePercentage: denom
              ? Math.round(((counts.present + counts.late) / denom) * 10000) / 100
              : 0,
            updatedAt: new Date(),
            correctedCount: ((await session.get()).get("correctedCount") ?? 0) + 1,
          },
          { merge: true },
        );
      }
      await ref.update({
        status: decision.data.decision,
        decisionReason: decision.data.reason ?? "",
        decidedAt: new Date(),
        decidedBy: c.uid,
      });
      await root.collection("attendanceAudit").add({
        action: `correction.${decision.data.decision}`,
        actorUid: c.uid,
        requestId: ref.id,
        occurredAt: new Date(),
      });
      return NextResponse.json({ ok: true });
    }
    if (correction.success) {
      if (
        !hasPermission(c.permissions, "attendance.correct") &&
        !hasPermission(c.permissions, "attendance.mark.assigned")
      )
        return NextResponse.json(
          { error: "Attendance correction request permission required" },
          { status: 403 },
        );
      const a = await access(c, correction.data.classId, correction.data.date);
      if (!a.ok) return NextResponse.json({ error: "Class access denied" }, { status: a.status });
      const id = `${correction.data.classId}_${correction.data.date}_daily`;
      const session = a.root.collection("attendanceSessions").doc(id);
      if (!(await session.get()).exists)
        return NextResponse.json({ error: "Attendance session not found" }, { status: 404 });
      if (!(await session.collection("records").doc(correction.data.studentId).get()).exists)
        return NextResponse.json(
          { error: "No attendance record exists for this student" },
          { status: 404 },
        );
      const r = a.root.collection("attendanceCorrections").doc();
      await r.set({
        ...correction.data,
        sessionId: id,
        status: "pending",
        requestedBy: c.uid,
        requestedAt: new Date(),
        schoolId: c.schoolId,
      });
      return NextResponse.json({ id: r.id }, { status: 201 });
    }
    if (!bulk.success)
      return NextResponse.json(
        { error: "Invalid attendance payload", fields: bulk.error.flatten().fieldErrors },
        { status: 400 },
      );
    const d = bulk.data;
    if (!isSchoolDay(d.date))
      return NextResponse.json({ error: "Saturday and Sunday are school holidays. Attendance can only be marked Monday to Friday." }, { status: 400 });
    const a = await access(c, d.classId, d.date);
    if (!a.ok) return NextResponse.json({ error: "Class access denied" }, { status: a.status });
    if (
      !hasPermission(c.permissions, "attendance.mark") &&
      !hasPermission(c.permissions, "attendance.mark.assigned") &&
      a.cover?.teacherUid !== c.uid
    )
      return NextResponse.json(
        { error: "Attendance marking permission required" },
        { status: 403 },
      );
    const rosterDocs = await roster(a.root, a.cls.data()!);
    const rosterIds = new Set(rosterDocs.map((s) => s.id));
    if (
      d.records.some((r) => !rosterIds.has(r.studentId)) ||
      new Set(d.records.map((r) => r.studentId)).size !== d.records.length
    )
      return NextResponse.json(
        { error: "Attendance contains duplicate or out-of-class student IDs" },
        { status: 400 },
      );
    const sessionId = `${d.classId}_${d.date}_daily`,
      session = a.root.collection("attendanceSessions").doc(sessionId);
    const recordRefs = d.records.map((r) => session.collection("records").doc(r.studentId));
    const now = new Date();
    let changed: string[] = [];
    await db.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(session);
      const old = await Promise.all(recordRefs.map((ref) => tx.get(ref)));
      changed = [];
      for (let i = 0; i < d.records.length; i++) {
        const r = d.records[i],
          prev = old[i];
        if (
          prev.exists &&
          !sessionSnap.exists &&
          !hasPermission(c.permissions, "attendance.correct")
        )
          throw new Error("ATTENDANCE_UPDATE_FORBIDDEN");
        if (prev.exists && prev.get("status") !== r.status && !hasPermission(c.permissions, "attendance.correct")) {
          const markedAt = timestampMs(prev.get("updatedAt"));
          if (markedAt == null || now.getTime() - markedAt >= ATTENDANCE_EDIT_WINDOW_MS)
            throw new Error("ATTENDANCE_UPDATE_LOCKED");
        }
        if (!prev.exists || prev.get("status") !== r.status) changed.push(r.studentId);
        tx.set(
          recordRefs[i],
          {
            studentId: r.studentId,
            status: r.status,
            notes: r.notes ?? "",
            classId: d.classId,
            date: d.date,
            markedBy: c.uid,
            updatedAt: now,
            schoolId: c.schoolId,
          },
          { merge: true },
        );
      }
      const counts = { present: 0, absent: 0, late: 0, excused: 0 };
      for (const r of d.records) counts[r.status]++;
      const denominator = rosterIds.size - counts.excused;
      tx.set(
        session,
        {
          classId: d.classId,
          className: a.cls.get("name"),
          grade: a.cls.get("grade"),
          academicYearId: a.cls.get("academicYearId") ?? null,
          date: d.date,
          session: "daily",
          totalEnrolled: rosterIds.size,
          markedCount: d.records.length,
          ...counts,
          attendancePercentage: denominator
            ? Math.round(((counts.present + counts.late) / denominator) * 10000) / 100
            : 0,
          markedBy: c.uid,
          updatedAt: now,
          schoolId: c.schoolId,
        },
        { merge: true },
      );
    });
    await a.root.collection("attendanceAudit").add({
      sessionId,
      classId: d.classId,
      date: d.date,
      action: "attendance.bulk_marked",
      actorUid: c.uid,
      changedStudentIds: changed,
      occurredAt: now,
    });
    await a.root.collection("auditLogs").add({
      schoolId: c.schoolId,
      actorUid: c.uid,
      action: "attendance.bulk_marked",
      recordType: "attendanceSession",
      recordId: sessionId,
      occurredAt: now,
    });
    await a.root
      .collection("integrationEvents")
      .doc(`attendance-${sessionId}`)
      .set(
        {
          schoolId: c.schoolId,
          eventType: "attendance_marked",
          recordId: sessionId,
          classId: d.classId,
          date: d.date,
          changedRecords: changed.length,
          absenceCount: d.records.filter((r) => r.status === "absent").length,
          notificationState: "queued_when_absent",
          occurredAt: now,
          actorUid: c.uid,
        },
        { merge: true },
      );
    const absent = d.records.filter((r) => r.status === "absent").map((r) => r.studentId);
    if (absent.length)
      await Promise.all(
        absent.map((studentId) =>
          a.root.collection("attendanceNotificationQueue").doc(`${sessionId}-${studentId}`).set(
            {
              classId: d.classId,
              date: d.date,
              studentId,
              status: "queued",
              createdAt: now,
              createdBy: c.uid,
              delivery: "not_configured",
            },
            { merge: true },
          ),
        ),
      );
    return NextResponse.json({
      ok: true,
      changed: changed.length,
      summary: {
        ...{ totalEnrolled: rosterIds.size },
        ...d.records.reduce(
          (o, r) => ({ ...o, [r.status]: (o[r.status] ?? 0) + 1 }),
          {} as Record<string, number>,
        ),
      },
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ATTENDANCE_UPDATE_FORBIDDEN")
      return NextResponse.json(
        {
          error: "This attendance already exists. Correction permission is required to change it.",
        },
        { status: 403 },
      );
    if (e instanceof Error && e.message === "ATTENDANCE_UPDATE_LOCKED")
      return NextResponse.json(
        { error: "This attendance was saved more than 5 minutes ago and can no longer be changed directly." },
        { status: 403 },
      );
    return NextResponse.json({ error: "Attendance could not be saved" }, { status: 500 });
  }
}
