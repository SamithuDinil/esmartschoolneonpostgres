import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const periodSchema = z.object({
  day: z.number().int().min(1).max(5),
  period: z.number().int().min(1).max(16),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  isBreak: z.boolean().default(false),
});
const entrySchema = z.object({
  grade: z.string().min(1).max(30),
  className: z.string().min(1).max(50),
  subject: z.string().min(1).max(100),
  teacherUid: z.string().min(1),
  classroomId: z.string().min(1),
  day: z.number().int().min(1).max(5),
  period: z.number().int().min(1).max(16),
  academicYearId: z.string().min(1),
});
const configSchema = z.object({
  action: z.literal("configure"),
  academicYearId: z.string().min(1),
  periods: z.array(periodSchema).min(1).max(112),
});
const saveSchema = z.object({
  action: z.literal("save"),
  academicYearId: z.string().min(1),
  entry: entrySchema,
});
const publishSchema = z.object({ action: z.literal("publish"), academicYearId: z.string().min(1) });
const generateSchema = z.object({
  action: z.literal("generate"),
  academicYearId: z.string().min(1),
  requirements: z
    .array(
      z.object({
        grade: z.string().min(1),
        className: z.string().min(1),
        subject: z.string().min(1),
        teacherUid: z.string().min(1),
        classroomId: z.string().min(1),
        weeklyPeriods: z.number().int().min(1).max(8),
        unavailable: z.array(z.string()).default([]),
        classroomUnavailable: z.array(z.string()).default([]),
        allowedDays: z.array(z.number().int().min(1).max(5)).max(5).optional(),
        weeklyWorkloadCap: z.number().int().min(1).max(50).default(30),
        maxPerDay: z.number().int().min(1).max(12).default(6),
      }),
    )
    .min(1)
    .max(60),
});
const actionSchema = z.discriminatedUnion("action", [
  configSchema,
  saveSchema,
  publishSchema,
  generateSchema,
]);
const key = (day: number, period: number) => `${day}:${period}`;

export async function GET(req: NextRequest) {
  const c = await getSchoolContext();
  if (!c) return NextResponse.json({ error: "School access required" }, { status: 403 });
  if (
    !hasPermission(c.permissions, "academics.read") &&
    !hasPermission(c.permissions, "academics.manage") &&
    !hasPermission(c.permissions, "teachers.self.read")
  )
    return NextResponse.json({ error: "Timetable access denied" }, { status: 403 });
  const year = req.nextUrl.searchParams.get("academicYearId");
  if (!year) return NextResponse.json({ error: "academicYearId is required" }, { status: 400 });
  const root = getAdminServices().db.collection("schools").doc(c.schoolId);
  try {
    const canManage =
      hasPermission(c.permissions, "academics.manage") ||
      hasPermission(c.permissions, "timetable.manage");
    const [entries, config, teachers, assignments, classes] = await Promise.all([
      root.collection("timetableEntries").where("academicYearId", "==", year).limit(2000).get(),
      root.collection("timetableConfig").doc(year).get(),
      canManage ? root.collection("teachers").orderBy("fullName").limit(500).get() : Promise.resolve(null),
      canManage ? root.collection("teacherAssignments").where("status", "==", "active").limit(3000).get() : Promise.resolve(null),
      canManage ? root.collection("classes").limit(500).get() : Promise.resolve(null),
    ]);
    const teacherNames = new Map(
      (teachers?.docs ?? []).map((teacher) => [
        String(teacher.get("uid") ?? teacher.id),
        String(teacher.get("fullName") ?? "Unnamed teacher"),
      ]),
    );
    const all = entries.docs.filter((doc) => Number(doc.get("day")) >= 1 && Number(doc.get("day")) <= 5).map((d) => ({
      id: d.id,
      ...d.data(),
      teacherUid: String(d.get("teacherUid")),
      teacherName: teacherNames.get(String(d.get("teacherUid"))) ?? "Unknown teacher",
    })) as Array<{ id: string; teacherUid: string; [key: string]: unknown }>;
    const teacherView = ["teacher", "class_teacher", "subject_teacher"].includes(c.role);
    const teacherFiltered = teacherView
      ? config.get("published") === true
        ? all.filter((e) => e.teacherUid === c.uid && e.status === "published")
        : []
      : all;
    return NextResponse.json(
      {
        entries: teacherFiltered,
        teachers:
          teachers?.docs.map((teacher) => ({
            uid: teacher.get("uid") ?? teacher.id,
            fullName: teacher.get("fullName") ?? "Unnamed teacher",
            status: teacher.get("status") ?? "active",
          })) ?? [],
        periods: ((config.get("periods") ?? []) as Array<{ day: number }>).filter((period) => period.day >= 1 && period.day <= 5),
        assignments: assignments?.docs.map((a) => ({ teacherUid: a.get("teacherUid"), grade: a.get("grade"), className: a.get("className"), subject: a.get("subject") })) ?? [],
        classes: classes?.docs
          .filter((classDoc) => {
            const status = String(classDoc.get("status") ?? "active");
            const classYear = String(classDoc.get("academicYearId") ?? "");
            return status !== "inactive" && status !== "archived" && (!classYear || classYear === year);
          })
          .map((classDoc) => ({
            id: classDoc.id,
            grade: String(classDoc.get("grade") ?? ""),
            className: String(classDoc.get("section") ?? classDoc.get("name") ?? ""),
          }))
          .filter((classItem) => classItem.grade && classItem.className) ?? [],
        published: config.get("published") === true,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Timetable unavailable" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!hasValidCsrf(req))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const c = await getSchoolContext();
  if (
    !c ||
    (!hasPermission(c.permissions, "academics.manage") &&
      !hasPermission(c.permissions, "timetable.manage"))
  )
    return NextResponse.json(
      { error: "Timetable administration permission required" },
      { status: 403 },
    );
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid timetable request", fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  const d = parsed.data;
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(c.schoolId);
  try {
    const configRef = root.collection("timetableConfig").doc(d.academicYearId);
    const academicYear = await root.collection("academicYears").doc(d.academicYearId).get();
    if (!academicYear.exists)
      return NextResponse.json({ error: "Academic year not found" }, { status: 404 });
    if (academicYear.get("status") === "closed")
      return NextResponse.json(
        { error: "Closed academic-year schedules are read-only" },
        { status: 409 },
      );
    if (d.action === "configure") {
      if ((await configRef.get()).get("published") === true)
        return NextResponse.json(
          {
            error:
              "Published timetables are locked; create a revision workflow before changing them",
          },
          { status: 409 },
        );
      const seen = new Set<string>();
      for (const p of d.periods) {
        const k = key(p.day, p.period);
        if (seen.has(k))
          return NextResponse.json(
            { error: "Duplicate day and period in period configuration" },
            { status: 400 },
          );
        if (p.start >= p.end)
          return NextResponse.json(
            { error: "Period end time must follow start time" },
            { status: 400 },
          );
        seen.add(k);
      }
      const days = [...new Set(d.periods.map((p) => p.day))];
      for (const day of days) {
        const daily = d.periods
          .filter((p) => p.day === day)
          .sort((a, b) => a.start.localeCompare(b.start));
        for (let i = 1; i < daily.length; i++)
          if (daily[i].start < daily[i - 1].end)
            return NextResponse.json(
              { error: `Configured periods overlap on day ${day}` },
              { status: 400 },
            );
      }
      await configRef.set(
        {
          academicYearId: d.academicYearId,
          periods: d.periods,
          updatedAt: new Date(),
          updatedBy: c.uid,
        },
        { merge: true },
      );
      return NextResponse.json({ ok: true });
    }
    if (d.action === "publish") {
      const entries = await root
        .collection("timetableEntries")
        .where("academicYearId", "==", d.academicYearId)
        .get();
      for (let i = 0; i < entries.docs.length; i += 400) {
        const batch = db.batch();
        for (const doc of entries.docs.slice(i, i + 400))
          batch.update(doc.ref, { status: "published", publishedAt: new Date() });
        await batch.commit();
      }
      await configRef.set(
        { published: true, publishedAt: new Date(), publishedBy: c.uid },
        { merge: true },
      );
      return NextResponse.json({ ok: true });
    }
    if (d.action === "save") {
      const conf = await configRef.get();
      if (conf.get("published") === true)
        return NextResponse.json(
          { error: "Published timetables are locked; use a schedule revision workflow" },
          { status: 409 },
        );
      if (d.entry.academicYearId !== d.academicYearId)
        return NextResponse.json(
          { error: "Entry academic year must match its timetable year" },
          { status: 400 },
        );
      const slots = (conf.get("periods") ?? []) as z.infer<typeof periodSchema>[];
      const wanted = d.entry;
      if (!slots.some((s) => s.day === wanted.day && s.period === wanted.period && !s.isBreak))
        return NextResponse.json(
          { error: "Choose a configured teaching period, not a break" },
          { status: 400 },
        );
      const assignments = await root
        .collection("teacherAssignments")
        .where("teacherUid", "==", wanted.teacherUid)
        .limit(200)
        .get();
      if (
        !assignments.docs.some(
          (a) =>
            a.get("status") === "active" &&
            a.get("grade") === wanted.grade &&
            a.get("className") === wanted.className &&
            a.get("subject") === wanted.subject,
        )
      )
        return NextResponse.json(
          { error: "Teacher must have an active matching subject, grade and class assignment" },
          { status: 403 },
        );
      const sameSlot = await root
        .collection("timetableEntries")
        .where("academicYearId", "==", d.academicYearId)
        .where("day", "==", wanted.day)
        .where("period", "==", wanted.period)
        .get();
      const collision = sameSlot.docs.find(
        (doc) =>
          (doc.get("className") === wanted.className && doc.get("grade") === wanted.grade) ||
          doc.get("teacherUid") === wanted.teacherUid ||
          doc.get("classroomId") === wanted.classroomId,
      );
      if (collision)
        return NextResponse.json(
          {
            error:
              "Schedule conflict: class, teacher, or classroom is already assigned in this period",
          },
          { status: 409 },
        );
      const ref = root.collection("timetableEntries").doc();
      await ref.set({
        ...wanted,
        schoolId: c.schoolId,
        status: "draft",
        createdBy: c.uid,
        createdAt: new Date(),
      });
      await root.collection("auditLogs").add({
        actorUid: c.uid,
        action: "timetable.entry.created",
        recordId: ref.id,
        occurredAt: new Date(),
      });
      return NextResponse.json({ id: ref.id }, { status: 201 });
    }
    const conf = await configRef.get();
    if (conf.get("published") === true)
      return NextResponse.json(
        { error: "Published timetables are locked; use a schedule revision workflow" },
        { status: 409 },
      );
    const slots = ((conf.get("periods") ?? []) as z.infer<typeof periodSchema>[])
      .filter((s) => !s.isBreak && s.day >= 1 && s.day <= 5)
      .sort((a, b) => a.day - b.day || a.period - b.period);
    if (!slots.length)
      return NextResponse.json(
        { error: "Configure school periods before automatic scheduling" },
        { status: 409 },
      );
    const existing = await root
      .collection("timetableEntries")
      .where("academicYearId", "==", d.academicYearId)
      .get();
    const assigned = new Set(
      existing.docs.map((x) => `${x.get("day")}:${x.get("period")}:${x.get("teacherUid")}`),
    );
    const classUsed = new Set(
      existing.docs.map(
        (x) => `${x.get("day")}:${x.get("period")}:${x.get("grade")}:${x.get("className")}`,
      ),
    );
    const roomUsed = new Set(
      existing.docs.map((x) => `${x.get("day")}:${x.get("period")}:${x.get("classroomId")}`),
    );
    const teacherIds = [...new Set(d.requirements.map((r) => r.teacherUid))];
    const assignmentRows = await Promise.all(
      teacherIds.map((uid) =>
        root.collection("teacherAssignments").where("teacherUid", "==", uid).limit(300).get(),
      ),
    );
    for (const req of d.requirements) {
      const assignments = assignmentRows[teacherIds.indexOf(req.teacherUid)].docs;
      if (
        !assignments.some(
          (a) =>
            a.get("status") === "active" &&
            a.get("grade") === req.grade &&
            a.get("className") === req.className &&
            a.get("subject") === req.subject,
        )
      )
        return NextResponse.json(
          {
            error: `Teacher ${req.teacherUid} has no active assignment for ${req.subject}, Grade ${req.grade} ${req.className}`,
          },
          { status: 403 },
        );
    }
    const tasks = d.requirements
      .flatMap((r) => Array.from({ length: r.weeklyPeriods }, (_, i) => ({ ...r, taskNo: i })))
      .sort(
        (a, b) =>
          a.unavailable.length +
            a.classroomUnavailable.length -
            (b.unavailable.length + b.classroomUnavailable.length) ||
          b.weeklyPeriods - a.weeklyPeriods,
      )
      .reverse();
    const placed: Array<z.infer<typeof entrySchema>> = [];
    const workload = new Map<string, number>();
    const dailyLoad = new Map<string, number>();
    for (const doc of existing.docs) {
      const uid = String(doc.get("teacherUid"));
      workload.set(uid, (workload.get(uid) ?? 0) + 1);
      const dk = `${uid}:${doc.get("day")}`;
      dailyLoad.set(dk, (dailyLoad.get(dk) ?? 0) + 1);
    }
    let attempts = 0;
    const place = (index: number): boolean => {
      if (index === tasks.length) return true;
      if (++attempts > 30000) return false;
      const t = tasks[index];
      if ((workload.get(t.teacherUid) ?? 0) >= t.weeklyWorkloadCap) return false;
      for (const slot of slots) {
        const time = key(slot.day, slot.period),
          dayKey = `${t.teacherUid}:${slot.day}`,
          classKey = `${time}:${t.grade}:${t.className}`,
          teacherKey = `${time}:${t.teacherUid}`,
          roomKey = `${time}:${t.classroomId}`;
        if (t.allowedDays?.length && !t.allowedDays.includes(slot.day)) continue;
        if (
          t.unavailable.includes(time) ||
          t.classroomUnavailable.includes(time) ||
          assigned.has(teacherKey) ||
          classUsed.has(classKey) ||
          roomUsed.has(roomKey) ||
          (dailyLoad.get(dayKey) ?? 0) >= t.maxPerDay
        )
          continue;
        const entry = {
          academicYearId: d.academicYearId,
          grade: t.grade,
          className: t.className,
          subject: t.subject,
          teacherUid: t.teacherUid,
          classroomId: t.classroomId,
          day: slot.day,
          period: slot.period,
        };
        placed.push(entry);
        assigned.add(teacherKey);
        classUsed.add(classKey);
        roomUsed.add(roomKey);
        workload.set(t.teacherUid, (workload.get(t.teacherUid) ?? 0) + 1);
        dailyLoad.set(dayKey, (dailyLoad.get(dayKey) ?? 0) + 1);
        if (place(index + 1)) return true;
        placed.pop();
        assigned.delete(teacherKey);
        classUsed.delete(classKey);
        roomUsed.delete(roomKey);
        workload.set(t.teacherUid, workload.get(t.teacherUid)! - 1);
        dailyLoad.set(dayKey, dailyLoad.get(dayKey)! - 1);
      }
      return false;
    };
    if (!place(0))
      return NextResponse.json(
        {
          error: `Unable to schedule all lessons within availability and workload limits after ${attempts} placement attempts; no entries were saved.`,
        },
        { status: 409 },
      );
    const batch = db.batch();
    for (const entry of placed)
      batch.set(root.collection("timetableEntries").doc(), {
        ...entry,
        schoolId: c.schoolId,
        status: "draft",
        generated: true,
        createdBy: c.uid,
        createdAt: new Date(),
      });
    await batch.commit();
    await root.collection("auditLogs").add({
      actorUid: c.uid,
      action: "timetable.auto_generated",
      recordCount: placed.length,
      occurredAt: new Date(),
    });
    return NextResponse.json({ ok: true, count: placed.length, entries: placed });
  } catch {
    return NextResponse.json({ error: "Timetable changes could not be saved" }, { status: 500 });
  }
}
