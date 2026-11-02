import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GradeBand = { min: number; max: number; label: string };
const defaultBands: GradeBand[] = [
  { min: 75, max: 100, label: "A" },
  { min: 65, max: 74.99, label: "B" },
  { min: 50, max: 64.99, label: "C" },
  { min: 35, max: 49.99, label: "S" },
  { min: 0, max: 34.99, label: "W" },
];
function markGrade(mark: number, maximum: number, bands: GradeBand[]) {
  const pct = maximum > 0 ? (mark / maximum) * 100 : 0;
  return bands.find((b) => pct >= b.min && pct <= b.max)?.label ?? (pct >= 50 ? "S" : "W");
}

export async function GET(req: NextRequest) {
  const c = await getSchoolContext();
  if (!c) return NextResponse.json({ error: "School access required" }, { status: 403 });
  const examId = req.nextUrl.searchParams.get("examId");
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(c.schoolId);
  try {
    if (req.nextUrl.searchParams.get("schemes") === "1") {
      if (!hasPermission(c.permissions, "academics.manage"))
        return NextResponse.json(
          { error: "Academic configuration permission required" },
          { status: 403 },
        );
      const schemes = await root.collection("gradingSchemes").orderBy("name").limit(100).get();
      return NextResponse.json(
        { items: schemes.docs.map((d) => ({ id: d.id, ...d.data() })) },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    let staffAccess =
      hasPermission(c.permissions, "exams.read") ||
      hasPermission(c.permissions, "reports.read") ||
      hasPermission(c.permissions, "exams.manage");
    const canReadAssigned =
      hasPermission(c.permissions, "exams.read.assigned") ||
      hasPermission(c.permissions, "marks.enter.assigned");
    if (!examId) {
      const reportCardsOnly = req.nextUrl.searchParams.get("reportCards") === "1";
      if (!staffAccess && !canReadAssigned && !["student", "parent"].includes(c.role))
        return NextResponse.json({ error: "Published result access required" }, { status: 403 });
      const exams = await root
        .collection("exams")
        .where("status", "==", "published")
        .limit(500)
        .get();
      const assignments = canReadAssigned
        ? await root
            .collection("teacherAssignments")
            .where("teacherUid", "==", c.uid)
            .limit(300)
            .get()
        : null;
      let childRecords: Array<{ id: string; grade: string; className: string }> = [];
      if (
        c.role === "student" &&
        !staffAccess &&
        hasPermission(c.permissions, "results.published.self.read")
      ) {
        const [a, b] = await Promise.all([
          root.collection("students").where("accountUid", "==", c.uid).limit(5).get(),
          root.collection("students").where("userUid", "==", c.uid).limit(5).get(),
        ]);
        childRecords = [...a.docs, ...b.docs].map((d) => ({
          id: d.id,
          grade: d.get("grade"),
          className: d.get("className"),
        }));
      }
      if (
        c.role === "parent" &&
        !staffAccess &&
        hasPermission(c.permissions, "results.published.linked.read")
      ) {
        const links = await root
          .collection("studentGuardianLinks")
          .where("guardianUid", "==", c.uid)
          .where("status", "==", "active")
          .get();
        const requiredPermission = reportCardsOnly ? "report_cards" : "published_results";
        const linked = links.docs.filter((d) =>
          (d.get("accessPermissions") ?? []).includes(requiredPermission),
        );
        const students = await Promise.all(
          linked.map((d) => root.collection("students").doc(d.get("studentId")).get()),
        );
        childRecords = students
          .filter((d) => d.exists)
          .map((d) => ({ id: d.id, grade: d.get("grade"), className: d.get("className") }));
      }
      const items = exams.docs
        .filter(
          (d) =>
            staffAccess ||
            assignments?.docs.some(
              (a) =>
                a.get("status") === "active" &&
                a.get("grade") === d.get("grade") &&
                a.get("className") === d.get("className") &&
                a.get("subject") === d.get("subject"),
            ) ||
            childRecords.some(
              (s) => s.grade === d.get("grade") && s.className === d.get("className"),
            ),
        )
        .map((d) => ({
          id: d.id,
          name: d.get("name"),
          grade: d.get("grade"),
          className: d.get("className"),
          subject: d.get("subject"),
          examinationDate: d.get("examinationDate"),
          academicYearId: d.get("academicYearId"),
        }));
      return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const examRef = root.collection("exams").doc(examId);
    const examSnap = await examRef.get();
    if (!examSnap.exists)
      return NextResponse.json({ error: "Examination not found" }, { status: 404 });
    const exam = examSnap.data()!;
    if (!staffAccess && canReadAssigned) {
      const assignments = await root
        .collection("teacherAssignments")
        .where("teacherUid", "==", c.uid)
        .limit(300)
        .get();
      staffAccess =
        exam.assignedTeacherUid === c.uid ||
        assignments.docs.some(
          (a) =>
            a.get("status") === "active" &&
            a.get("grade") === exam.grade &&
            a.get("className") === exam.className &&
            a.get("subject") === exam.subject,
        );
    }
    if (!staffAccess && canReadAssigned && c.role !== "parent" && c.role !== "student")
      return NextResponse.json({ error: "Examination assignment access denied" }, { status: 403 });
    const isPublished = exam.status === "published";
    let allowedStudentIds: Set<string> | null = null;
    if (
      !staffAccess &&
      c.role === "student" &&
      isPublished &&
      hasPermission(c.permissions, "results.published.self.read")
    ) {
      const matches = await root
        .collection("students")
        .where("accountUid", "==", c.uid)
        .limit(5)
        .get();
      const more = await root.collection("students").where("userUid", "==", c.uid).limit(5).get();
      allowedStudentIds = new Set(
        [...matches.docs, ...more.docs]
          .filter((d) => d.get("status") !== "archived")
          .map((d) => d.id),
      );
    } else if (
      !staffAccess &&
      c.role === "parent" &&
      isPublished &&
      hasPermission(c.permissions, "results.published.linked.read")
    ) {
      const links = await root
        .collection("studentGuardianLinks")
        .where("guardianUid", "==", c.uid)
        .where("status", "==", "active")
        .get();
      const requiredPermission =
        req.nextUrl.searchParams.get("reportCards") === "1" ? "report_cards" : "published_results";
      allowedStudentIds = new Set(
        links.docs
          .filter((d) => (d.get("accessPermissions") ?? []).includes(requiredPermission))
          .map((d) => d.get("studentId")),
      );
    }
    if (!staffAccess && !allowedStudentIds)
      return NextResponse.json({ error: "Published result access required" }, { status: 403 });
    if (!isPublished && !staffAccess)
      return NextResponse.json({ error: "Results are not published" }, { status: 403 });

    let roster: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    if (exam.academicYearId) {
      const enrollments = await root
        .collection("enrollments")
        .where("academicYearId", "==", exam.academicYearId)
        .limit(1500)
        .get();
      const eligible = enrollments.docs.filter(
        (d) =>
          d.get("grade") === exam.grade &&
          d.get("className") === exam.className &&
          d.get("status") === "active",
      );
      const records = await Promise.all(
        eligible.map((d) => root.collection("students").doc(d.get("studentId")).get()),
      );
      roster = records.filter(
        (d): d is FirebaseFirestore.QueryDocumentSnapshot => d.exists,
      ) as FirebaseFirestore.QueryDocumentSnapshot[];
    } else {
      const s = await root
        .collection("students")
        .where("grade", "==", exam.grade)
        .where("className", "==", exam.className)
        .limit(500)
        .get();
      roster = s.docs;
    }
    const relatedQuery = exam.academicYearId
      ? await root
          .collection("exams")
          .where("academicYearId", "==", exam.academicYearId)
          .limit(500)
          .get()
      : await root.collection("exams").limit(500).get();
    const related: FirebaseFirestore.DocumentSnapshot[] = relatedQuery.docs.filter((d) => {
      const e = d.data();
      return (
        (d.id === examId ||
          (e.name === exam.name &&
            e.grade === exam.grade &&
            e.className === exam.className &&
            e.academicYearId === exam.academicYearId)) &&
        (staffAccess || e.status === "published")
      );
    });
    if (!related.some((d) => d.id === examId)) related.push(examSnap);
    const examGroup = relatedQuery.docs.filter(
      (d) =>
        d.get("name") === exam.name &&
        d.get("grade") === exam.grade &&
        d.get("className") === exam.className &&
        d.get("academicYearId") === exam.academicYearId,
    );
    const publicationComplete =
      examGroup.length > 0 && examGroup.every((d) => d.get("status") === "published");
    const settings = await root.collection("settings").doc("results").get();
    const rankingsEnabled = settings.get("rankingsEnabled") === true;
    const policy = String(settings.get("rankingPolicy") ?? "competition");
    const schoolSnap = await root.get();
    const academicYearDoc = exam.academicYearId
      ? await root.collection("academicYears").doc(String(exam.academicYearId)).get()
      : null;
    const components = await Promise.all(
      related.map(async (doc) => {
        const e = doc.data()!;
        const marksSnap = await doc.ref.collection("marks").get();
        const schemeDoc = await root
          .collection("gradingSchemes")
          .doc(String(e.gradingSchemeId ?? "default"))
          .get();
        const bands: GradeBand[] = Array.isArray(e.gradingScheme)
          ? e.gradingScheme
          : (schemeDoc.get("bands") ?? defaultBands);
        return {
          exam: {
            id: doc.id,
            subject: String(e.subject ?? "Subject"),
            maxMarks: Number(e.maxMarks ?? 100),
            minimumPassingMarks: Number(e.minimumPassingMarks ?? 0),
          },
          marks: new Map(marksSnap.docs.map((m) => [m.id, m.data()])),
          bands,
        };
      }),
    );
    const commentSnap = staffAccess ? await examRef.collection("reportComments").get() : null;
    const comments = new Map((commentSnap?.docs ?? []).map((d) => [d.id, d.data()]));
    const attendanceById = new Map<
      string,
      { percentage: number | null; present: number; absent: number; late: number; excused: number }
    >();
    if (req.nextUrl.searchParams.get("includeAttendance") === "1") {
      const academicYear = exam.academicYearId
        ? await root.collection("academicYears").doc(String(exam.academicYearId)).get()
        : null;
      const year = String(exam.examinationDate ?? new Date().getFullYear()).slice(0, 4);
      const startDate = String(academicYear?.get("startDate") ?? `${year}-01-01`);
      const endDate = String(academicYear?.get("endDate") ?? `${year}-12-31`);
      for (let i = 0; i < roster.length; i += 20) {
        const batchRoster = roster.slice(i, i + 20);
        const attendanceRecords = await Promise.all(
          batchRoster.map(async (student) => {
            const snap = await db
              .collectionGroup("records")
              .where("schoolId", "==", c.schoolId)
              .where("studentId", "==", student.id)
              .limit(1000)
              .get();
            const counts = { present: 0, absent: 0, late: 0, excused: 0 };
            for (const record of snap.docs) {
              const date = String(record.get("date") ?? "");
              const status = record.get("status");
              if (date < startDate || date > endDate || !(status in counts)) continue;
              counts[status as keyof typeof counts]++;
            }
            const denominator = counts.present + counts.absent + counts.late;
            return [
              student.id,
              {
                ...counts,
                percentage: denominator
                  ? Math.round(((counts.present + counts.late) / denominator) * 10000) / 100
                  : null,
              },
            ] as const;
          }),
        );
        for (const [id, stats] of attendanceRecords) attendanceById.set(id, stats);
      }
    }
    const full = roster.map((student) => {
      const subjectResults = components.map((component) => {
        const score = component.marks.get(student.id);
        const mark = typeof score?.marks === "number" ? score.marks : null;
        return {
          examId: component.exam.id,
          subject: component.exam.subject,
          marks: mark,
          maxMarks: component.exam.maxMarks,
          grade: mark === null ? null : markGrade(mark, component.exam.maxMarks, component.bands),
          pass: mark === null ? null : mark >= component.exam.minimumPassingMarks,
        };
      });
      const completed = subjectResults.filter((x) => x.marks !== null);
      const totalMarks = completed.reduce((sum, x) => sum + Number(x.marks), 0);
      const maximumTotal = completed.reduce((sum, x) => sum + x.maxMarks, 0);
      const calculatedAverage = maximumTotal ? (totalMarks / maximumTotal) * 100 : null;
      const average = staffAccess || publicationComplete ? calculatedAverage : null;
      const selected = subjectResults.find((x) => x.examId === examId);
      const comment = comments.get(student.id);
      return {
        id: student.id,
        fullName: student.get("fullName"),
        admissionNumber: student.get("admissionNumber"),
        photoUrl: student.get("photoUrl") ?? null,
        marks: selected?.marks ?? null,
        grade: selected?.grade ?? null,
        pass:
          completed.length > 0 && (staffAccess || publicationComplete)
            ? completed.every((x) => x.pass)
            : null,
        rank: null as number | null,
        subjectResults,
        totalMarks: staffAccess || publicationComplete ? totalMarks : null,
        average,
        remarks: components.find((x) => x.exam.id === examId)?.marks.get(student.id)?.remarks ?? "",
        teacherComment: comment?.teacherComment ?? "",
        principalComment: comment?.principalComment ?? "",
        attendanceSummary:
          attendanceById.get(student.id) ?? student.get("attendanceSummary") ?? null,
      };
    });
    const scored = full
      .filter((r) => r.average !== null)
      .sort((a, b) => Number(b.average) - Number(a.average));
    const scores = scored.map((r) => Number(r.average));
    const ranked = full.map((r) => {
      if (!rankingsEnabled || r.average === null) return { ...r, rank: null };
      const pos = scored.findIndex((x) => x.id === r.id);
      const higher = scores.filter((v) => v > Number(r.average)).length;
      const rank =
        policy === "ordinal"
          ? pos + 1
          : policy === "dense"
            ? [...new Set(scores.filter((v) => v > Number(r.average)))].length + 1
            : higher + 1;
      return { ...r, rank };
    });
    const visible = staffAccess ? ranked : ranked.filter((r) => allowedStudentIds!.has(r.id));
    const subjectScores = full
      .map((student) => {
        const component = student.subjectResults.find((x) => x.examId === examId);
        return component && typeof component.marks === "number"
          ? (component.marks / component.maxMarks) * 100
          : null;
      })
      .filter((x): x is number => typeof x === "number");
    const historyDocs = relatedQuery.docs
      .filter(
        (d) =>
          d.get("grade") === exam.grade &&
          d.get("className") === exam.className &&
          d.get("subject") === exam.subject &&
          d.get("status") === "published",
      )
      .sort((a, b) =>
        String(a.get("examinationDate") ?? "").localeCompare(
          String(b.get("examinationDate") ?? ""),
        ),
      );
    const trends = await Promise.all(
      historyDocs.map(async (d) => {
        const snap = await d.ref.collection("marks").get();
        const vals = snap.docs.map((m) => Number(m.get("marks"))).filter(Number.isFinite);
        return {
          name: String(d.get("name") ?? "Exam"),
          date: String(d.get("examinationDate") ?? ""),
          average: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
        };
      }),
    );
    const summary = staffAccess
      ? {
          students: full.length,
          entered: subjectScores.length,
          totalMarks: scores.reduce((a, b) => a + b, 0),
          average: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
          classAverage: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
          subjectAverage: subjectScores.length
            ? subjectScores.reduce((a, b) => a + b, 0) / subjectScores.length
            : 0,
          highest: subjectScores.length ? Math.max(...subjectScores) : null,
          lowest: subjectScores.length ? Math.min(...subjectScores) : null,
          passCount: full.filter((r) => r.pass === true).length,
          failCount: full.filter((r) => r.pass === false).length,
          trends,
        }
      : null;
    const payload = {
      exam: {
        id: examSnap.id,
        name: exam.name,
        grade: exam.grade,
        className: exam.className,
        subject: exam.subject,
        academicYearId: exam.academicYearId,
        academicYearName: academicYearDoc?.get("name") ?? exam.academicYearId,
        examinationDate: exam.examinationDate,
        maxMarks: exam.maxMarks,
        minimumPassingMarks: exam.minimumPassingMarks,
        status: exam.status,
      },
      school: {
        name: schoolSnap.get("name") ?? "School",
        logoUrl: schoolSnap.get("logoUrl") ?? null,
      },
      scheme: components.find((x) => x.exam.id === examId)?.bands ?? defaultBands,
      settings: { rankingsEnabled, rankingPolicy: policy },
      summary,
      results: visible,
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Result calculations are unavailable" }, { status: 500 });
  }
}

const policySchema = z.object({
  action: z.literal("policy"),
  rankingsEnabled: z.boolean(),
  rankingPolicy: z.enum(["competition", "dense", "ordinal"]),
  bands: z
    .array(
      z.object({
        min: z.number().min(0).max(100),
        max: z.number().min(0).max(100),
        label: z.string().trim().min(1).max(8),
      }),
    )
    .min(2)
    .max(12),
});
const schemeSchema = z.object({
  action: z.literal("scheme"),
  schemeId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{2,50}$/),
  name: z.string().trim().min(2).max(80),
  bands: z
    .array(
      z.object({
        min: z.number().min(0).max(100),
        max: z.number().min(0).max(100),
        label: z.string().trim().min(1).max(8),
      }),
    )
    .min(2)
    .max(12),
});
const commentSchema = z.object({
  action: z.literal("comments"),
  examId: z.string().min(1),
  studentId: z.string().min(1),
  teacherComment: z.string().max(1000),
  principalComment: z.string().max(1000),
});

export async function POST(req: NextRequest) {
  if (!hasValidCsrf(req))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const c = await getSchoolContext();
  if (!c) return NextResponse.json({ error: "School access required" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const policy = policySchema.safeParse(body);
  const scheme = schemeSchema.safeParse(body);
  const comment = commentSchema.safeParse(body);
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(c.schoolId);
  if (scheme.success) {
    if (!hasPermission(c.permissions, "academics.manage"))
      return NextResponse.json(
        { error: "Academic configuration permission required" },
        { status: 403 },
      );
    const bands = [...scheme.data.bands].sort((a, b) => a.min - b.min);
    if (
      bands[0].min !== 0 ||
      bands[bands.length - 1].max !== 100 ||
      bands.some((b, i) => b.min > b.max || (i > 0 && Math.abs(b.min - bands[i - 1].max) > 0.001))
    )
      return NextResponse.json(
        { error: "Grade bands must cover 0–100 without gaps or overlaps" },
        { status: 400 },
      );
    await root
      .collection("gradingSchemes")
      .doc(scheme.data.schemeId)
      .set(
        { name: scheme.data.name, bands, updatedBy: c.uid, updatedAt: new Date() },
        { merge: true },
      );
    await root.collection("auditLogs").add({
      actorUid: c.uid,
      action: "grading_scheme.saved",
      recordId: scheme.data.schemeId,
      occurredAt: new Date(),
    });
    return NextResponse.json({ ok: true, id: scheme.data.schemeId });
  }
  if (policy.success) {
    if (!hasPermission(c.permissions, "academics.manage"))
      return NextResponse.json(
        { error: "Academic configuration permission required" },
        { status: 403 },
      );
    const bands = [...policy.data.bands].sort((a, b) => a.min - b.min);
    if (
      bands[0].min !== 0 ||
      bands[bands.length - 1].max !== 100 ||
      bands.some((b, i) => b.min > b.max || (i > 0 && Math.abs(b.min - bands[i - 1].max) > 0.001))
    )
      return NextResponse.json(
        { error: "Grade bands must cover 0–100 without gaps or overlaps" },
        { status: 400 },
      );
    await root.collection("settings").doc("results").set(
      {
        rankingsEnabled: policy.data.rankingsEnabled,
        rankingPolicy: policy.data.rankingPolicy,
        updatedBy: c.uid,
        updatedAt: new Date(),
      },
      { merge: true },
    );
    await root
      .collection("gradingSchemes")
      .doc("default")
      .set(
        { name: "School default", bands, updatedBy: c.uid, updatedAt: new Date() },
        { merge: true },
      );
    await root
      .collection("auditLogs")
      .add({ actorUid: c.uid, action: "results.policy.updated", occurredAt: new Date() });
    return NextResponse.json({ ok: true });
  }
  if (comment.success) {
    const examRef = root.collection("exams").doc(comment.data.examId);
    const examSnap = await examRef.get();
    if (!examSnap.exists)
      return NextResponse.json({ error: "Examination not found" }, { status: 404 });
    const examData = examSnap.data()!;
    const manager =
      hasPermission(c.permissions, "exams.manage") || hasPermission(c.permissions, "exams.approve");
    const assigned =
      hasPermission(c.permissions, "marks.enter.assigned") &&
      (await (async () => {
        const rows = await root
          .collection("teacherAssignments")
          .where("teacherUid", "==", c.uid)
          .limit(300)
          .get();
        return (
          examData.assignedTeacherUid === c.uid ||
          rows.docs.some(
            (a) =>
              a.get("status") === "active" &&
              a.get("grade") === examData.grade &&
              a.get("className") === examData.className &&
              a.get("subject") === examData.subject,
          )
        );
      })());
    if (!manager && !assigned)
      return NextResponse.json(
        { error: "Report-card comment permission required" },
        { status: 403 },
      );
    const student = await root.collection("students").doc(comment.data.studentId).get();
    if (
      !student.exists ||
      student.get("grade") !== examData.grade ||
      student.get("className") !== examData.className
    )
      return NextResponse.json(
        { error: "Student is outside this examination class" },
        { status: 404 },
      );
    await examRef.collection("reportComments").doc(comment.data.studentId).set(
      {
        teacherComment: comment.data.teacherComment,
        principalComment: comment.data.principalComment,
        updatedAt: new Date(),
        updatedBy: c.uid,
      },
      { merge: true },
    );
    await root.collection("auditLogs").add({
      actorUid: c.uid,
      action: "report_card.comments.updated",
      examId: comment.data.examId,
      studentId: comment.data.studentId,
      occurredAt: new Date(),
    });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(
    { error: "Invalid result settings or report-card comment" },
    { status: 400 },
  );
}
