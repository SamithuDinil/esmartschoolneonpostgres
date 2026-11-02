import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function assigned(
  root: FirebaseFirestore.DocumentReference,
  uid: string,
  exam: FirebaseFirestore.DocumentData,
) {
  const snap = await root
    .collection("teacherAssignments")
    .where("teacherUid", "==", uid)
    .limit(200)
    .get();
  return (
    snap.docs.some(
      (d) =>
        d.get("grade") === exam.grade &&
        d.get("className") === exam.className &&
        d.get("subject") === exam.subject,
    ) || exam.assignedTeacherUid === uid
  );
}
async function students(
  root: FirebaseFirestore.DocumentReference,
  exam: FirebaseFirestore.DocumentData,
) {
  if (exam.academicYearId) {
    const es = await root
      .collection("enrollments")
      .where("academicYearId", "==", exam.academicYearId)
      .limit(1500)
      .get();
    const active = es.docs.filter(
      (e) =>
        e.get("grade") === exam.grade &&
        e.get("className") === exam.className &&
        e.get("status") === "active",
    );
    return await Promise.all(
      active.map(async (e) => root.collection("students").doc(e.get("studentId")).get()),
    );
  }
  const s = await root
    .collection("students")
    .where("grade", "==", exam.grade)
    .where("className", "==", exam.className)
    .limit(500)
    .get();
  return s.docs;
}
async function notifyPublished(
  root: FirebaseFirestore.DocumentReference,
  examId: string,
  exam: FirebaseFirestore.DocumentData,
) {
  const roster = await students(root, exam);
  for (const student of roster.filter((item) => item.exists)) {
    const targets = new Set<string>();
    const accountUid = student.get("accountUid");
    const userUid = student.get("userUid");
    if (typeof accountUid === "string") targets.add(accountUid);
    if (typeof userUid === "string") targets.add(userUid);
    const links = await root
      .collection("studentGuardianLinks")
      .where("studentId", "==", student.id)
      .where("status", "==", "active")
      .limit(20)
      .get();
    for (const link of links.docs) {
      const guardianUid = link.get("guardianUid");
      if (typeof guardianUid === "string") targets.add(guardianUid);
    }
    for (const targetUid of targets) {
      await root
        .collection("notifications")
        .doc(`exam-published-${examId}-${targetUid}`)
        .set(
          {
            schoolId: root.id,
            recipientUid: targetUid,
            category: "Academic",
            type: "examination_results_published",
            title: "Examination results published",
            message: `${String(exam.name ?? "Examination")} results are now available.`,
            deepLink: `/results?examId=${examId}`,
            read: false,
            archived: false,
            createdAt: new Date(),
            sourceRecordId: examId,
          },
          { merge: true },
        );
    }
  }
}
export async function GET(req: NextRequest) {
  const c = await getSchoolContext();
  if (!c) return NextResponse.json({ error: "School access required" }, { status: 403 });
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(c.schoolId);
  const examId = req.nextUrl.searchParams.get("examId");
  try {
    if (
      !hasPermission(c.permissions, "exams.read") &&
      !hasPermission(c.permissions, "exams.read.assigned") &&
      !hasPermission(c.permissions, "exams.manage")
    )
      return NextResponse.json({ error: "Examination access denied" }, { status: 403 });
    if (examId) {
      const ref = root.collection("exams").doc(examId);
      const snap = await ref.get();
      if (!snap.exists)
        return NextResponse.json({ error: "Examination not found" }, { status: 404 });
      const exam = snap.data()!;
      if (
        !hasPermission(c.permissions, "exams.read") &&
        !hasPermission(c.permissions, "exams.manage") &&
        !(await assigned(root, c.uid, exam))
      )
        return NextResponse.json(
          { error: "You are not assigned to this examination" },
          { status: 403 },
        );
      const [roster, marks] = await Promise.all([
        students(root, exam),
        ref.collection("marks").get(),
      ]);
      const map = new Map(marks.docs.map((m) => [m.id, m.data()]));
      return NextResponse.json(
        {
          exam: { id: snap.id, ...exam },
          students: roster
            .filter((s) => s.exists)
            .map((s) => ({
              id: s.id,
              fullName: s.get("fullName"),
              admissionNumber: s.get("admissionNumber"),
              marks: map.get(s.id)?.marks ?? null,
              markStatus: map.get(s.id)?.status ?? null,
            })),
        },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    const all = await root.collection("exams").orderBy("examinationDate", "desc").limit(500).get();
    const items = [];
    for (const doc of all.docs) {
      const data = doc.data();
      if (
        hasPermission(c.permissions, "exams.read") ||
        hasPermission(c.permissions, "exams.manage") ||
        (await assigned(root, c.uid, data))
      )
        items.push({ id: doc.id, ...data });
    }
    return NextResponse.json({ items }, { headers: { "Cache-Control": "private,no-store" } });
  } catch {
    return NextResponse.json({ error: "Examination records unavailable" }, { status: 500 });
  }
}
const examSchema = z.object({
  action: z.literal("create"),
  name: z.string().trim().min(3).max(120),
  kind: z.enum([
    "first_term",
    "second_term",
    "third_term",
    "monthly_test",
    "unit_test",
    "mock_exam",
    "assignment_assessment",
    "custom",
  ]),
  academicYearId: z.string().min(1),
  termId: z.string().optional(),
  grade: z.string().min(1).max(30),
  className: z.string().min(1).max(50),
  subject: z.string().min(1).max(100),
  examinationDate: z.string().date(),
  maxMarks: z.number().positive().max(10000),
  minimumPassingMarks: z.number().min(0).max(10000),
  gradingSchemeId: z.string().optional(),
  resultPublicationDate: z.string().date().optional(),
  assignedTeacherUid: z.string().optional(),
});
const marksSchema = z.object({
  action: z.literal("save_marks"),
  examId: z.string().min(1),
  records: z
    .array(
      z.object({
        studentId: z.string().min(1),
        marks: z.number().min(0),
        remarks: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(300),
  status: z.enum(["draft", "submitted"]).default("draft"),
});
const transitionSchema = z.object({
  action: z.enum(["submit", "approve", "publish"]),
  examId: z.string().min(1),
});
const postSchema = z.discriminatedUnion("action", [examSchema, marksSchema, transitionSchema]);
export async function POST(req: NextRequest) {
  if (!hasValidCsrf(req))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const c = await getSchoolContext();
  if (!c) return NextResponse.json({ error: "School access required" }, { status: 403 });
  const p = postSchema.safeParse(await req.json().catch(() => null));
  if (!p.success)
    return NextResponse.json(
      { error: "Invalid examination request", fields: p.error.flatten().fieldErrors },
      { status: 400 },
    );
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(c.schoolId);
  try {
    const d = p.data;
    if (d.action === "create") {
      if (!hasPermission(c.permissions, "exams.manage"))
        return NextResponse.json(
          { error: "Examination management permission required" },
          { status: 403 },
        );
      if (d.minimumPassingMarks > d.maxMarks)
        return NextResponse.json(
          { error: "Passing marks cannot exceed maximum marks" },
          { status: 400 },
        );
      if (
        d.gradingSchemeId &&
        !(await root.collection("gradingSchemes").doc(d.gradingSchemeId).get()).exists
      )
        return NextResponse.json(
          { error: "Selected grading scheme was not found in this school" },
          { status: 404 },
        );
      const duplicate = await root
        .collection("exams")
        .where("academicYearId", "==", d.academicYearId)
        .where("grade", "==", d.grade)
        .where("className", "==", d.className)
        .where("subject", "==", d.subject)
        .where("examinationDate", "==", d.examinationDate)
        .limit(1)
        .get();
      if (!duplicate.empty)
        return NextResponse.json(
          {
            error:
              "An examination for this subject, class, academic year, and date already exists.",
          },
          { status: 409 },
        );
      const year = await root.collection("academicYears").doc(d.academicYearId).get();
      if (!year.exists)
        return NextResponse.json({ error: "Academic year not found" }, { status: 404 });
      if (year.get("status") === "closed")
        return NextResponse.json(
          { error: "Cannot create exams in a closed academic year" },
          { status: 409 },
        );
      const ref = root.collection("exams").doc();
      await ref.set({
        ...d,
        status: "scheduled",
        schoolId: c.schoolId,
        createdBy: c.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await root
        .collection("auditLogs")
        .add({ actorUid: c.uid, action: "exam.created", recordId: ref.id, occurredAt: new Date() });
      return NextResponse.json({ id: ref.id }, { status: 201 });
    }
    if (d.action === "save_marks") {
      const examRef = root.collection("exams").doc(d.examId);
      const examSnap = await examRef.get();
      if (!examSnap.exists)
        return NextResponse.json({ error: "Examination not found" }, { status: 404 });
      const exam = examSnap.data()!;
      const manager =
        hasPermission(c.permissions, "marks.enter") || hasPermission(c.permissions, "exams.manage");
      const allowed =
        manager ||
        (hasPermission(c.permissions, "marks.enter.assigned") &&
          (await assigned(root, c.uid, exam)));
      if (!allowed)
        return NextResponse.json(
          { error: "You are not authorized to enter marks for this subject and class" },
          { status: 403 },
        );
      if (d.records.some((r) => r.marks > Number(exam.maxMarks)))
        return NextResponse.json(
          { error: `Marks cannot exceed ${exam.maxMarks}` },
          { status: 400 },
        );
      if (
        ["approved", "published"].includes(exam.status) &&
        !hasPermission(c.permissions, "marks.approved.update")
      )
        return NextResponse.json(
          { error: "Approved marks require specific correction permission" },
          { status: 403 },
        );
      const roster = await students(root, exam);
      const allowedIds = new Set(roster.filter((s) => s.exists).map((s) => s.id));
      if (
        d.records.some((r) => !allowedIds.has(r.studentId)) ||
        new Set(d.records.map((r) => r.studentId)).size !== d.records.length
      )
        return NextResponse.json(
          { error: "Marks include duplicate or out-of-class student records" },
          { status: 400 },
        );
      const batch = db.batch(),
        now = new Date(),
        changes: Array<{ studentId: string; previousMarks: number; newMarks: number }> = [];
      for (const r of d.records) {
        const ref = examRef.collection("marks").doc(r.studentId);
        const old = await ref.get();
        if (
          old.exists &&
          old.get("marks") !== r.marks &&
          ["approved", "published"].includes(exam.status) &&
          !hasPermission(c.permissions, "marks.approved.update")
        )
          return NextResponse.json(
            { error: "Approved mark changes require authorization" },
            { status: 403 },
          );
        if (old.exists && old.get("marks") !== r.marks)
          changes.push({
            studentId: r.studentId,
            previousMarks: old.get("marks"),
            newMarks: r.marks,
          });
        const recordStatus = ["approved", "published"].includes(exam.status)
          ? "approved"
          : d.status;
        batch.set(
          ref,
          {
            studentId: r.studentId,
            marks: r.marks,
            remarks: r.remarks ?? "",
            status: recordStatus,
            updatedAt: now,
            updatedBy: c.uid,
            schoolId: c.schoolId,
          },
          { merge: true },
        );
      }
      batch.set(
        examRef,
        {
          status: ["approved", "published"].includes(exam.status)
            ? exam.status
            : d.status === "submitted"
              ? "marks_submitted"
              : "marks_entry",
          marksUpdatedAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
      await batch.commit();
      if (changes.length)
        await root.collection("examAudit").add({
          examId: d.examId,
          changes,
          actorUid: c.uid,
          action: "approved_marks.corrected",
          occurredAt: now,
        });
      await root.collection("auditLogs").add({
        actorUid: c.uid,
        action: `exam.marks.${d.status}`,
        recordId: d.examId,
        occurredAt: now,
      });
      await root.collection("integrationEvents").doc(`exam-marks-${d.examId}`).set(
        {
          schoolId: c.schoolId,
          eventType: "examination_marks_updated",
          recordId: d.examId,
          records: d.records.length,
          status: d.status,
          occurredAt: now,
          actorUid: c.uid,
        },
        { merge: true },
      );
      return NextResponse.json({ ok: true, records: d.records.length });
    }
    if (d.action === "submit") {
      const ref = root.collection("exams").doc(d.examId),
        snap = await ref.get();
      if (!snap.exists)
        return NextResponse.json({ error: "Examination not found" }, { status: 404 });
      const exam = snap.data()!;
      if (
        !hasPermission(c.permissions, "marks.enter") &&
        !hasPermission(c.permissions, "exams.manage") &&
        !(
          hasPermission(c.permissions, "marks.enter.assigned") &&
          (await assigned(root, c.uid, exam))
        )
      )
        return NextResponse.json(
          { error: "Marks submission permission required" },
          { status: 403 },
        );
      const [roster, markRows] = await Promise.all([
        students(root, exam),
        ref.collection("marks").get(),
      ]);
      if (markRows.size < roster.filter((s) => s.exists).length)
        return NextResponse.json(
          { error: "Enter a mark for every enrolled student before submitting" },
          { status: 409 },
        );
      await ref.update({ status: "marks_submitted", submittedAt: new Date(), submittedBy: c.uid });
    } else {
      if (d.action === "approve" && !hasPermission(c.permissions, "exams.approve"))
        return NextResponse.json(
          { error: "Examination approval permission required" },
          { status: 403 },
        );
      if (
        d.action === "publish" &&
        !hasPermission(c.permissions, "exams.publish") &&
        !hasPermission(c.permissions, "exams.manage")
      )
        return NextResponse.json(
          { error: "Result publication permission required" },
          { status: 403 },
        );
      const ref = root.collection("exams").doc(d.examId),
        snap = await ref.get();
      if (!snap.exists)
        return NextResponse.json({ error: "Examination not found" }, { status: 404 });
      if (d.action === "approve" && snap.get("status") !== "marks_submitted")
        return NextResponse.json(
          { error: "Only submitted marks may be approved" },
          { status: 409 },
        );
      if (d.action === "publish" && snap.get("status") !== "approved")
        return NextResponse.json(
          { error: "Approve marks before publishing results" },
          { status: 409 },
        );
      if (d.action === "approve") {
        const marks = await ref.collection("marks").get();
        const batch = db.batch();
        for (const mark of marks.docs)
          batch.update(mark.ref, { status: "approved", approvedAt: new Date(), approvedBy: c.uid });
        await batch.commit();
      }
      await ref.update({
        status: d.action === "approve" ? "approved" : "published",
        [d.action === "approve" ? "approvedAt" : "publishedAt"]: new Date(),
        [d.action === "approve" ? "approvedBy" : "publishedBy"]: c.uid,
      });
    }
    await root.collection("auditLogs").add({
      actorUid: c.uid,
      action: `exam.${d.action}`,
      recordId: d.examId,
      occurredAt: new Date(),
    });
    if (d.action === "publish") {
      await root.collection("integrationEvents").doc(`exam-publish-${d.examId}`).set(
        {
          schoolId: c.schoolId,
          eventType: "examination_results_published",
          recordId: d.examId,
          notificationState: "queued_in_app",
          occurredAt: new Date(),
          actorUid: c.uid,
        },
        { merge: true },
      );
      await notifyPublished(
        root,
        d.examId,
        (await root.collection("exams").doc(d.examId).get()).data() ?? {},
      );
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Examination action failed" }, { status: 500 });
  }
}

const updateSchema = z.object({
  examId: z.string().min(1),
  name: z.string().min(3).max(120).optional(),
  termId: z.string().optional(),
  examinationDate: z.string().date().optional(),
  resultPublicationDate: z.string().date().optional(),
  maxMarks: z.number().positive().max(10000).optional(),
  minimumPassingMarks: z.number().min(0).max(10000).optional(),
  assignedTeacherUid: z.string().optional(),
  className: z.string().optional(),
  subject: z.string().optional(),
});
export async function PATCH(req: NextRequest) {
  if (!hasValidCsrf(req))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const c = await getSchoolContext();
  if (!c || !hasPermission(c.permissions, "exams.manage"))
    return NextResponse.json(
      { error: "Examination management permission required" },
      { status: 403 },
    );
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid examination update" }, { status: 400 });
  const { db } = getAdminServices(),
    root = db.collection("schools").doc(c.schoolId);
  const { examId, ...changes } = parsed.data;
  try {
    const ref = root.collection("exams").doc(examId),
      snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Examination not found" }, { status: 404 });
    if (["approved", "published"].includes(snap.get("status")))
      return NextResponse.json(
        {
          error:
            "Approved/published examination schedules are locked; authorized marks correction does not alter schedules",
        },
        { status: 409 },
      );
    const max = changes.maxMarks ?? snap.get("maxMarks"),
      pass = changes.minimumPassingMarks ?? snap.get("minimumPassingMarks");
    if (pass > max)
      return NextResponse.json(
        { error: "Passing marks cannot exceed maximum marks" },
        { status: 400 },
      );
    await ref.update({ ...changes, updatedAt: new Date(), updatedBy: c.uid });
    await root.collection("auditLogs").add({
      actorUid: c.uid,
      action: "exam.schedule.updated",
      recordId: examId,
      changedFields: Object.keys(changes),
      occurredAt: new Date(),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Examination schedule update failed" }, { status: 500 });
  }
}
