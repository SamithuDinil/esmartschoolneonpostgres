import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Ctx = { params: Promise<{ studentId: string }> };
function reportDate(value: unknown): string {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function")
    return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
  return typeof value === "string" ? value.slice(0, 10) : "";
}
export async function GET(_req: NextRequest, { params }: Ctx) {
  const context = await getSchoolContext();
  if (
    !context ||
    (!hasPermission(context.permissions, "students.read") && context.role !== "parent")
  )
    return NextResponse.json({ error: "Student access denied" }, { status: 403 });
  const { studentId } = await params;
  try {
    const { db } = getAdminServices();
    const base = db.collection("schools").doc(context.schoolId);
    const student = await base.collection("students").doc(studentId).get();
    if (!student.exists) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    const data = student.data()!;
    if (context.role === "parent") {
      const linked = await base
        .collection("studentGuardianLinks")
        .where("studentId", "==", studentId)
        .where("guardianUid", "==", context.uid)
        .where("status", "==", "active")
        .limit(1)
        .get();
      if (linked.empty)
        return NextResponse.json(
          { error: "This student is not linked to your guardian account" },
          { status: 403 },
        );
      const permissions = linked.docs[0].get("accessPermissions") ?? [];
      return NextResponse.json(
        {
          student: {
            id: student.id,
            fullName: data.fullName,
            admissionNumber: data.admissionNumber,
            grade: data.grade,
            className: data.className,
            status: data.status,
          },
          guardians: [],
          enrollments: [],
          history: [],
          documents: [],
          allowedSections: permissions,
        },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    const [guardianLinks, enrollments, history, changeHistory, documents, attendanceSessions, managedRecords] = await Promise.all([
      base.collection("studentGuardianLinks").where("studentId", "==", studentId).get(),
      base.collection("enrollments").where("studentId", "==", studentId).get(),
      base
        .collection("admissionHistory")
        .where("studentId", "==", studentId)
        .orderBy("occurredAt", "desc")
        .limit(100)
        .get(),
      base
        .collection("studentHistory")
        .where("studentId", "==", studentId)
        .orderBy("occurredAt", "desc")
        .limit(100)
        .get(),
      base
        .collection("students")
        .doc(studentId)
        .collection("documents")
        .orderBy("createdAt", "desc")
        .limit(100)
        .get(),
      base.collection("attendanceSessions").orderBy("date", "desc").limit(500).get(),
      base.collection("studentProfileRecords").where("studentId", "==", studentId).limit(300).get(),
    ]);
    const attendanceRows = (
      await Promise.all(
        attendanceSessions.docs.map(async (session) => {
          const record = await session.ref.collection("records").doc(studentId).get();
          if (!record.exists) return null;
          return {
            id: `${session.id}-${studentId}`,
            date: reportDate(session.get("date") ?? record.get("date")),
            className: String(session.get("className") ?? "Class"),
            grade: String(session.get("grade") ?? data.grade ?? ""),
            status: String(record.get("status") ?? "excused"),
            notes: String(record.get("notes") ?? ""),
          };
        }),
      )
    ).filter(Boolean);
    const leaveHistory = attendanceRows.filter((item) => ["excused", "leave"].includes(String(item?.status ?? "")));
    const attendanceSummary = attendanceRows.reduce((summary, item) => {
      const status = String(item?.status ?? "");
      if (status in summary) summary[status as keyof typeof summary] += 1;
      return summary;
    }, { present: 0, absent: 0, late: 0, excused: 0 });
    const attendanceDenominator = attendanceSummary.present + attendanceSummary.absent + attendanceSummary.late;
    const guardians = await Promise.all(
      guardianLinks.docs.map(async (link) => {
        const g = await base.collection("guardians").doc(link.get("guardianId")).get();
        return g.exists
          ? {
              id: g.id,
              ...g.data(),
              relationship: link.get("relationship"),
              linkId: link.id,
              accessPermissions: link.get("accessPermissions") ?? [],
            }
          : null;
      }),
    );
    return NextResponse.json(
      {
        student: { id: student.id, ...data },
        guardians: guardians.filter(Boolean),
        enrollments: enrollments.docs.map((d) => ({ id: d.id, ...d.data() })),
        history: [...history.docs, ...changeHistory.docs].map((d) => ({ id: d.id, ...d.data() })),
        documents: documents.docs.map((d) => ({ id: d.id, ...d.data(), storagePath: undefined })),
        leaveHistory,
        attendanceSummary: {
          ...attendanceSummary,
          percentage: attendanceDenominator ? Math.round(((attendanceSummary.present + attendanceSummary.late) / attendanceDenominator) * 100) : 0,
          riskFlags: [
            ...(attendanceDenominator > 0 && ((attendanceSummary.present + attendanceSummary.late) / attendanceDenominator) < 0.8 ? ["Attendance below 80%"] : []),
            ...(attendanceSummary.absent >= 3 ? ["Three or more absences"] : []),
          ],
        },
        managedRecords: managedRecords.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String((b as Record<string, unknown>).date ?? (b as Record<string, unknown>).createdAt ?? "").localeCompare(String((a as Record<string, unknown>).date ?? (a as Record<string, unknown>).createdAt ?? ""))),
      },
      { headers: { "Cache-Control": "private,no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Student profile could not be loaded" }, { status: 500 });
  }
}
const patchSchema = z.object({
  action: z.enum(["edit", "archive", "restore", "transfer", "promote"]),
  fullName: z.string().trim().min(2).max(120).optional(),
  nameWithInitials: z.string().max(120).optional(),
  preferredName: z.string().max(80).optional(),
  dateOfBirth: z.string().date().optional(),
  gender: z.enum(["female", "male", "other", "undisclosed"]).optional(),
  nationality: z.string().max(80).optional(),
  address: z.string().max(500).optional(),
  studentEmail: z.email().max(254).or(z.literal("")).optional(),
  grade: z.string().max(20).optional(),
  className: z.string().max(40).optional(),
  guardianName: z.string().max(120).optional(),
  guardianEmail: z.email().max(254).optional(),
  guardianPhone: z.string().max(24).optional(),
  academicYear: z.number().int().min(2000).max(2100).optional(),
});
export async function PATCH(req: NextRequest, { params }: Ctx) {
  if (!hasValidCsrf(req))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "School access denied" }, { status: 403 });
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid student update" }, { status: 400 });
  const { studentId } = await params;
  const { db } = getAdminServices();
  const school = db.collection("schools").doc(context.schoolId),
    ref = school.collection("students").doc(studentId);
  try {
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    const now = new Date(),
      d = body.data;
    let patch: Record<string, unknown> = { updatedAt: now, updatedBy: context.uid };
    if (d.action === "archive" || d.action === "restore") {
      if (!hasPermission(context.permissions, "students.archive"))
        return NextResponse.json({ error: "Archive permission required" }, { status: 403 });
      patch = {
        ...patch,
        status: d.action === "archive" ? "archived" : "active",
        archivedAt: d.action === "archive" ? now : null,
        restoredAt: d.action === "restore" ? now : null,
      };
    } else if (d.action === "edit") {
      if (!hasPermission(context.permissions, "students.update"))
        return NextResponse.json({ error: "Edit permission required" }, { status: 403 });
      for (const [k, v] of Object.entries(d)) if (k !== "action" && v !== undefined) patch[k] = v;
    } else {
      if (!hasPermission(context.permissions, "students.update"))
        return NextResponse.json(
          { error: "Enrollment update permission required" },
          { status: 403 },
        );
      if (!d.grade || !d.className)
        return NextResponse.json({ error: "Grade and class are required" }, { status: 400 });
      const year = d.academicYear ?? new Date().getFullYear();
      const academicYears = await school.collection("academicYears").limit(100).get();
      const academicYearDoc =
        academicYears.docs.find((doc) => doc.get("name") === String(year)) ??
        academicYears.docs.find((doc) => doc.get("status") === "active");
      if (academicYearDoc?.get("status") === "closed")
        return NextResponse.json(
          { error: "This academic year is closed and cannot be modified" },
          { status: 409 },
        );
      const academicYearId = academicYearDoc?.id ?? null;
      const enrollments = school.collection("enrollments");
      const prior = await enrollments
        .where("studentId", "==", studentId)
        .where("academicYear", "==", year)
        .where("status", "==", "active")
        .get();
      const previous = prior.docs.map((doc) => ({
        id: doc.id,
        grade: doc.get("grade"),
        className: doc.get("className"),
      }));
      for (const doc of prior.docs)
        await doc.ref.update({
          status: "transferred",
          endDate: now.toISOString().slice(0, 10),
          updatedAt: now,
        });
      const enrollment = enrollments.doc();
      await enrollment.create({
        studentId,
        schoolId: context.schoolId,
        academicYear: year,
        academicYearId,
        grade: d.grade,
        className: d.className,
        startDate: now.toISOString().slice(0, 10),
        status: "active",
        previousEnrollments: previous,
        createdAt: now,
        updatedAt: now,
        updatedBy: context.uid,
      });
      patch.grade = d.grade;
      patch.className = d.className;
    }
    await ref.update(patch);
    await school.collection("studentHistory").add({
      studentId,
      action: `student.${d.action}`,
      details: { grade: d.grade ?? null, className: d.className ?? null },
      actorUid: context.uid,
      occurredAt: now,
    });
    await school.collection("auditLogs").add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: `student.${d.action}`,
      recordType: "student",
      recordId: studentId,
      occurredAt: now,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Student record could not be updated" }, { status: 500 });
  }
}
const profileRecordSchema = z.object({
  type: z.enum(["discipline", "activity", "history"]),
  title: z.string().trim().min(2).max(120),
  details: z.string().trim().min(2).max(2000),
  date: z.string().date(),
  status: z.string().trim().max(60).optional().default("recorded"),
});
function canManageProfileRecords(context: Awaited<ReturnType<typeof getSchoolContext>>) {
  return Boolean(context && ["school_owner", "principal"].includes(context.role));
}
function recordDenied(context: Awaited<ReturnType<typeof getSchoolContext>>) {
  return !context || !canManageProfileRecords(context)
    ? NextResponse.json({ error: "Only the school owner or principal can manage these records" }, { status: 403 })
    : null;
}
export async function POST(req: NextRequest, { params }: Ctx) {
  if (!hasValidCsrf(req)) return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  const denied = recordDenied(context);
  if (denied) return denied;
  const body = profileRecordSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid student record", fields: body.error.flatten().fieldErrors }, { status: 400 });
  const { studentId } = await params;
  const school = getAdminServices().db.collection("schools").doc(context!.schoolId);
  const student = await school.collection("students").doc(studentId).get();
  if (!student.exists) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  const now = new Date();
  const ref = school.collection("studentProfileRecords").doc();
  await ref.create({ ...body.data, studentId, schoolId: context!.schoolId, createdBy: context!.uid, createdAt: now, updatedAt: now });
  await school.collection("auditLogs").add({ schoolId: context!.schoolId, actorUid: context!.uid, action: `student.${body.data.type}.created`, recordType: "studentProfileRecord", recordId: ref.id, studentId, occurredAt: now });
  return NextResponse.json({ id: ref.id }, { status: 201 });
}
export async function PUT(req: NextRequest, { params }: Ctx) {
  if (!hasValidCsrf(req)) return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  const denied = recordDenied(context);
  if (denied) return denied;
  const raw = await req.json().catch(() => null);
  const recordId = typeof raw?.recordId === "string" ? raw.recordId : "";
  const body = profileRecordSchema.safeParse(raw);
  if (!recordId || !body.success) return NextResponse.json({ error: "Invalid student record" }, { status: 400 });
  const { studentId } = await params;
  const school = getAdminServices().db.collection("schools").doc(context!.schoolId);
  const ref = school.collection("studentProfileRecords").doc(recordId);
  const record = await ref.get();
  if (!record.exists || record.get("studentId") !== studentId) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  await ref.update({ ...body.data, updatedBy: context!.uid, updatedAt: new Date() });
  await school.collection("auditLogs").add({ schoolId: context!.schoolId, actorUid: context!.uid, action: `student.${body.data.type}.updated`, recordType: "studentProfileRecord", recordId, studentId, occurredAt: new Date() });
  return NextResponse.json({ ok: true });
}
export async function DELETE(req: NextRequest, { params }: Ctx) {
  if (!hasValidCsrf(req)) return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  const denied = recordDenied(context);
  if (denied) return denied;
  const recordId = new URL(req.url).searchParams.get("recordId") ?? "";
  if (!recordId || recordId.includes("/")) return NextResponse.json({ error: "Record ID is required" }, { status: 400 });
  const { studentId } = await params;
  const school = getAdminServices().db.collection("schools").doc(context!.schoolId);
  const ref = school.collection("studentProfileRecords").doc(recordId);
  const record = await ref.get();
  if (!record.exists || record.get("studentId") !== studentId) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  await ref.delete();
  await school.collection("auditLogs").add({ schoolId: context!.schoolId, actorUid: context!.uid, action: `student.${record.get("type")}.deleted`, recordType: "studentProfileRecord", recordId, studentId, occurredAt: new Date() });
  return NextResponse.json({ ok: true });
}
