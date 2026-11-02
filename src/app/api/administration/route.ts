import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const groups = [
  "academicYears",
  "terms",
  "examinationPeriods",
  "grades",
  "classes",
  "subjects",
  "classrooms",
  "holidays",
  "events",
  "specialSchedules",
  "announcements",
  "attendancePolicies",
  "gradingSchemes",
  "workingDays",
] as const;
const profileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  registrationNumber: z.string().trim().max(60).optional(),
  logoUrl: z.string().trim().max(800).optional(),
  motto: z.string().trim().max(180).optional(),
  address: z.string().trim().max(500).optional(),
  province: z.string().trim().max(100).optional(),
  district: z.string().trim().max(100).optional(),
  educationalZone: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  alternatePhone: z.string().trim().max(40).optional(),
  email: z.email().max(254).optional(),
  website: z.url().max(300).or(z.literal("")).optional(),
  principalName: z.string().trim().max(120).optional(),
  principalContact: z.string().trim().max(60).optional(),
  schoolType: z.string().trim().max(60).optional(),
  medium: z.string().trim().max(40).optional(),
  establishedYear: z.number().int().min(1800).max(new Date().getFullYear()).optional(),
});
const recordSchema = z.object({
  id: z.string().trim().max(120).optional(),
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().max(40).optional(),
  status: z.string().max(40).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  grade: z.string().max(30).optional(),
  teacherId: z.string().max(128).optional(),
  room: z.string().max(50).optional(),
  description: z.string().max(1000).optional(),
  date: z.string().max(30).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  academicYearId: z.string().max(120).optional(),
  section: z.string().max(30).optional(),
  capacity: z.number().int().min(1).max(1000).optional(),
  classroomId: z.string().max(128).optional(),
  subjectCode: z.string().max(30).optional(),
  category: z.string().max(60).optional(),
  optional: z.boolean().optional(),
  streams: z.array(z.string().max(60)).max(20).optional(),
  combinations: z
    .array(z.array(z.string().max(60)))
    .max(50)
    .optional(),
  schoolType: z.string().max(60).optional(),
  teacherUids: z.array(z.string().max(128)).max(100).optional(),
  teacherAssignments: z.array(z.object({
    teacherUid: z.string().trim().min(1).max(128),
    subject: z.string().trim().min(1).max(80),
  })).max(40).default([]).refine(
    (assignments) => new Set(assignments.map((item) => `${item.teacherUid}\u0000${item.subject}`)).size === assignments.length,
    "A teacher can only be assigned to the same subject once in a class.",
  ),
});
function dropEmpty(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => !(typeof v === "string" && v.trim() === ""),
    ),
  );
}
function sortKey(data: Record<string, unknown>) {
  return String(data.name ?? data.title ?? data.room ?? "").toLowerCase();
}
function canonicalGrade(value: string): string {
  const match = value.trim().match(/^grade\s*0*(\d{1,2})$/i);
  if (!match) return value.trim();
  const number = Number(match[1]);
  return number >= 1 && number <= 13 ? `Grade ${String(number).padStart(2, "0")}` : value.trim();
}
export async function GET(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "School access required" }, { status: 403 });
  if (!hasPermission(context.permissions, "school.manage"))
    return NextResponse.json({ error: "Insufficient permission" }, { status: 403 });
  try {
    const { db } = getAdminServices();
    const ref = db.collection("schools").doc(context.schoolId);
    const group = request.nextUrl.searchParams.get("group");
    if (!group) {
      const snap = await ref.get();
      return NextResponse.json(
        { profile: { id: snap.id, ...snap.data() } },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    if (!(groups as readonly string[]).includes(group))
      return NextResponse.json({ error: "Unknown configuration group" }, { status: 400 });
    const docs = await ref.collection(group).limit(300).get();
    docs.docs.sort((a, b) => {
      if (group === "classes") {
        const byGrade = String(a.get("grade") ?? "").localeCompare(
          String(b.get("grade") ?? ""),
          undefined,
          { numeric: true, sensitivity: "base" },
        );
        if (byGrade) return byGrade;
        return String(a.get("section") ?? a.get("name") ?? "").localeCompare(
          String(b.get("section") ?? b.get("name") ?? ""),
          undefined,
          { numeric: true, sensitivity: "base" },
        );
      }
      return sortKey(a.data()).localeCompare(sortKey(b.data()));
    });
    let items: Record<string, unknown>[] = docs.docs.map((d) => ({
      id: d.id,
      name: String(d.get("name") ?? d.get("title") ?? d.get("room") ?? d.id),
      ...d.data(),
    }));
    if (group === "classes") {
      items = await Promise.all(
        docs.docs.map(async (d) => {
          const data = d.data();
          if (data.academicYearId) {
            const q = await ref
              .collection("enrollments")
              .where("academicYearId", "==", data.academicYearId)
              .limit(1500)
              .get();
            return {
              id: d.id,
              ...data,
              enrollmentCount: q.docs.filter(
                (x) =>
                  x.get("grade") === data.grade &&
                  x.get("className") === data.name &&
                  x.get("status") === "active",
              ).length,
              seatsAvailable: typeof data.capacity === "number"
                ? Math.max(0, data.capacity - q.docs.filter(
                    (x) =>
                      x.get("grade") === data.grade &&
                      x.get("className") === data.name &&
                      x.get("status") === "active",
                  ).length)
                : null,
            };
          }
          const q = await ref
            .collection("students")
            .where("grade", "==", data.grade)
            .where("className", "==", data.name)
            .limit(1000)
            .get();
          return {
            id: d.id,
            ...data,
            enrollmentCount: q.docs.filter((x) => x.get("status") !== "archived").length,
            seatsAvailable: typeof data.capacity === "number"
              ? Math.max(0, data.capacity - q.docs.filter((x) => x.get("status") !== "archived").length)
              : null,
          };
        }),
      );
    }
    if (group === "grades") {
      items = await Promise.all(
        docs.docs.map(async (d) => {
          const q = await ref
            .collection("students")
            .where("grade", "==", d.get("name"))
            .limit(1000)
            .get();
          return {
            id: d.id,
            ...d.data(),
            enrollmentCount: q.docs.filter((x) => x.get("status") !== "archived").length,
          };
        }),
      );
    }
    if (group === "classes") {
      const [memberships, subjectDocs] = await Promise.all([
        ref.collection("memberships").limit(500).get(),
        ref.collection("subjects").limit(300).get(),
      ]);
      const teacherOptions = memberships.docs.flatMap((doc) => {
        const member = doc.data() ?? {};
        const role = String(member.role ?? "");
        if (
          String(member.status ?? "active") !== "active" ||
          !["teacher", "class_teacher", "subject_teacher"].includes(role)
        ) return [];
        return [{
          uid: doc.id,
          displayName: typeof member.displayName === "string" ? member.displayName : "School user",
          role,
        }];
      }).sort((a, b) => a.displayName.localeCompare(b.displayName));
      const subjectOptions = subjectDocs.docs
        .filter((doc) => doc.get("status") !== "inactive")
        .map((doc) => ({ name: String(doc.get("name") ?? ""), grade: String(doc.get("grade") ?? "") }))
        .filter((subject) => subject.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      const classesWithTeacherNames = items.map((item) => ({
        ...item,
        teacherName: teacherOptions.find((teacher) => teacher.uid === item.teacherId)?.displayName ?? "",
      }));
      return NextResponse.json(
        { items: classesWithTeacherNames, teacherOptions, subjectOptions },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    return NextResponse.json({ items }, { headers: { "Cache-Control": "private,no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to load school settings" }, { status: 500 });
  }
}
export async function PATCH(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "School access required" }, { status: 403 });
  if (!hasPermission(context.permissions, "school.manage"))
    return NextResponse.json({ error: "Insufficient permission" }, { status: 403 });
  const original = await request.json().catch(() => null);
  if (original && typeof original === "object" && (original as Record<string, unknown>).action === "assign_class_teacher") {
    const assignment = z.object({ action: z.literal("assign_class_teacher"), classId: z.string().trim().min(1).max(128), teacherId: z.string().max(128) }).safeParse(original);
    if (!assignment.success) return NextResponse.json({ error: "Choose a valid class and teacher." }, { status: 400 });
    try {
      const school = getAdminServices().db.collection("schools").doc(context.schoolId);
      const classRef = school.collection("classes").doc(assignment.data.classId);
      const classSnap = await classRef.get();
      if (!classSnap.exists) return NextResponse.json({ error: "Class not found." }, { status: 404 });
      if (assignment.data.teacherId) {
        const teacher = await school.collection("memberships").doc(assignment.data.teacherId).get();
        if (!teacher.exists || teacher.get("status") !== "active" || !["teacher", "class_teacher", "subject_teacher"].includes(String(teacher.get("role") ?? ""))) return NextResponse.json({ error: "Choose an active teacher from this school." }, { status: 400 });
      }
      await classRef.update({ teacherId: assignment.data.teacherId, updatedAt: new Date(), updatedBy: context.uid });
      await school.collection("auditLogs").add({ schoolId: context.schoolId, actorUid: context.uid, action: "configuration.class_teacher.assigned", recordType: "classes", recordId: classRef.id, teacherId: assignment.data.teacherId || null, occurredAt: new Date() });
      return NextResponse.json({ ok: true });
    } catch { return NextResponse.json({ error: "Class teacher could not be assigned." }, { status: 500 }); }
  }
  const raw = dropEmpty(original);
  const config = z
    .object({
      scope: z.literal("configuration"),
      group: z.enum(groups),
      id: z.string().min(1),
      status: z.string().max(40).optional(),
      name: z.string().min(1).max(120).optional(),
      startDate: z.string().date().optional(),
      endDate: z.string().date().optional(),
      capacity: z.number().int().min(1).max(1000).optional(),
      room: z.string().max(50).optional(),
      teacherId: z.string().max(128).optional(),
      academicYearId: z.string().optional(),
      category: z.string().optional(),
      subjectCode: z.string().optional(),
      optional: z.boolean().optional(),
      section: z.string().optional(),
      classroomId: z.string().optional(),
      settings: z.record(z.string(), z.unknown()).optional(),
      streams: z.array(z.string()).optional(),
      combinations: z.array(z.array(z.string())).optional(),
    })
    .safeParse(raw);
  if (config.success) {
    try {
      const { db } = getAdminServices();
      const school = db.collection("schools").doc(context.schoolId);
      const ref = school.collection(config.data.group).doc(config.data.id);
      const current = await ref.get();
      if (!current.exists)
        return NextResponse.json({ error: "Configuration record not found" }, { status: 404 });
      if (current.get("status") === "closed")
        return NextResponse.json(
          {
            error:
              "Closed academic records are read-only. Create a new year or explicitly reopen this year.",
          },
          { status: 409 },
        );
      const group = config.data.group;
      const id = config.data.id;
      const changes = Object.fromEntries(
        Object.entries(config.data).filter(
          ([key]) => key !== "scope" && key !== "group" && key !== "id",
        ),
      );
      const linkedYearId = changes.academicYearId ?? current.get("academicYearId");
      const nextStart =
        typeof changes.startDate === "string" ? changes.startDate : current.get("startDate");
      const nextEnd =
        typeof changes.endDate === "string" ? changes.endDate : current.get("endDate");
      if (typeof nextStart === "string" && typeof nextEnd === "string" && nextStart > nextEnd)
        return NextResponse.json(
          { error: "Start date must be on or before end date" },
          { status: 400 },
        );
      if (group !== "academicYears" && typeof linkedYearId === "string") {
        const linkedYear = await school.collection("academicYears").doc(linkedYearId).get();
        if (linkedYear.exists && linkedYear.get("status") === "closed")
          return NextResponse.json(
            { error: "This record belongs to a closed academic year and is read-only" },
            { status: 409 },
          );
      }
      if (group === "academicYears" && changes.status === "active") {
        const active = await school
          .collection("academicYears")
          .where("status", "==", "active")
          .get();
        const batch = db.batch();
        for (const doc of active.docs)
          if (doc.id !== id)
            batch.update(doc.ref, {
              status: "closed",
              closedAt: new Date(),
              updatedAt: new Date(),
            });
        batch.update(ref, {
          ...changes,
          activatedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: context.uid,
        });
        await batch.commit();
      } else
        await ref.update({
          ...changes,
          updatedAt: new Date(),
          updatedBy: context.uid,
          ...(group === "academicYears" && changes.status === "closed"
            ? { closedAt: new Date() }
            : {}),
        });
      await school.collection("auditLogs").add({
        schoolId: context.schoolId,
        actorUid: context.uid,
        action: `configuration.${group}.updated`,
        recordType: group,
        recordId: id,
        occurredAt: new Date(),
      });
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: "Configuration update failed" }, { status: 500 });
    }
  }
  const profileInput =
    original && typeof original === "object"
      ? Object.fromEntries(
          Object.entries(original as Record<string, unknown>).filter(
            ([k, v]) => !(k === "email" && v === ""),
          ),
        )
      : original;
  const data = profileSchema.safeParse(profileInput);
  if (!data.success)
    return NextResponse.json(
      { error: "Invalid school profile", fields: data.error.flatten().fieldErrors },
      { status: 400 },
    );
  try {
    const { db } = getAdminServices();
    const ref = db.collection("schools").doc(context.schoolId);
    const before = await ref.get();
    await ref.set({ ...data.data, updatedAt: new Date(), updatedBy: context.uid }, { merge: true });
    await ref.collection("auditLogs").add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: "school.profile.updated",
      recordType: "school",
      recordId: context.schoolId,
      changedFields: Object.keys(data.data),
      before: { name: before.data()?.name },
      occurredAt: new Date(),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "School profile could not be saved" }, { status: 500 });
  }
}
export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "School access required" }, { status: 403 });
  if (!hasPermission(context.permissions, "school.manage"))
    return NextResponse.json({ error: "Insufficient permission" }, { status: 403 });
  const group = request.nextUrl.searchParams.get("group");
  if (group === "gradeStructure") {
    const parsed = z.object({ grade: z.string().trim().min(1).max(30), sections: z.array(z.string().trim().min(1).max(30)).min(1).max(40), academicYearId: z.string().trim().max(120).optional() }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose a grade and valid class names.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
    const grade = canonicalGrade(parsed.data.grade);
    if (!/^Grade (0[1-9]|1[0-3])$/.test(grade)) return NextResponse.json({ error: "Choose Grade 1 through Grade 13." }, { status: 400 });
    const sections = parsed.data.sections.map((section) => section.trim());
    if (new Set(sections.map((item) => item.toLowerCase())).size !== sections.length) return NextResponse.json({ error: "Class names must be unique." }, { status: 400 });
    try {
      const { db } = getAdminServices();
      const school = db.collection("schools").doc(context.schoolId);
      if (parsed.data.academicYearId) {
        const year = await school.collection("academicYears").doc(parsed.data.academicYearId).get();
        if (!year.exists || year.get("status") === "closed") return NextResponse.json({ error: "Choose an active academic year." }, { status: 400 });
      }
      const [gradeQuery, existingClasses] = await Promise.all([
        school.collection("grades").where("name", "==", grade).limit(1).get(),
        school.collection("classes").where("grade", "==", grade).limit(300).get(),
      ]);
      const existing = new Set(existingClasses.docs.map((doc) => String(doc.get("section") ?? doc.get("name") ?? "").toLowerCase()));
      const duplicates = sections.filter((section) => existing.has(section.toLowerCase()));
      if (duplicates.length) return NextResponse.json({ error: `These classes already exist for ${grade}: ${duplicates.join(", ")}.` }, { status: 409 });
      const batch = db.batch();
      if (gradeQuery.empty) batch.create(school.collection("grades").doc(), { name: grade, status: "active", schoolId: context.schoolId, createdAt: new Date(), createdBy: context.uid });
      const created = sections.map((section) => {
        const ref = school.collection("classes").doc();
        batch.create(ref, { name: section, section, grade, status: "active", ...(parsed.data.academicYearId ? { academicYearId: parsed.data.academicYearId } : {}), teacherId: "", schoolId: context.schoolId, createdAt: new Date(), createdBy: context.uid, updatedAt: new Date(), updatedBy: context.uid });
        return { id: ref.id, section };
      });
      batch.create(school.collection("auditLogs").doc(), { schoolId: context.schoolId, actorUid: context.uid, action: "configuration.grade_structure.generated", recordType: "classes", grade, sections, occurredAt: new Date() });
      await batch.commit();
      return NextResponse.json({ ok: true, grade, created: created.length }, { status: 201 });
    } catch {
      return NextResponse.json({ error: "Grade and classes could not be created." }, { status: 500 });
    }
  }
  if (!group || (groups as readonly string[]).indexOf(group) < 0)
    return NextResponse.json({ error: "Unknown configuration group" }, { status: 400 });
  const data = recordSchema.safeParse(dropEmpty(await request.json().catch(() => null)));
  if (!data.success)
    return NextResponse.json(
      { error: "Invalid configuration record", fields: data.error.flatten().fieldErrors },
      { status: 400 },
    );
  if (group === "classes") {
    const grade = canonicalGrade(data.data.grade ?? "");
    const gradeMatch = grade.match(/^Grade (\d{2})$/);
    const section = data.data.name.trim().toUpperCase();
    if (!gradeMatch || Number(gradeMatch[1]) < 1 || Number(gradeMatch[1]) > 13 || !/^[A-G]$/.test(section))
      return NextResponse.json(
        { error: "Choose a grade from Grade 01–13 and a class section from A–G." },
        { status: 400 },
      );
    data.data.grade = grade;
    data.data.name = section;
    data.data.section = section;
    if (data.data.teacherId) data.data.teacherId = data.data.teacherId.trim();
  }
  if (data.data.startDate && data.data.endDate && data.data.startDate > data.data.endDate)
    return NextResponse.json(
      { error: "Start date must be on or before end date" },
      { status: 400 },
    );
  if (group === "grades" && !/^Grade (0[1-9]|1[0-3]|[1-9])$/.test(data.data.name))
    return NextResponse.json(
      { error: "Sri Lankan grade names must be Grade 1 through Grade 13" },
      { status: 400 },
    );
  try {
    const { db } = getAdminServices();
    const school = db.collection("schools").doc(context.schoolId);
    const collection = school.collection(group);
    const ref = data.data.id ? collection.doc(data.data.id) : collection.doc();
    if (!data.data.id && (group === "classes" || group === "subjects")) {
      let duplicateQuery = collection.where("name", "==", data.data.name);
      if (group === "classes") {
        duplicateQuery = duplicateQuery.where("grade", "==", data.data.grade);
        if (data.data.academicYearId)
          duplicateQuery = duplicateQuery.where("academicYearId", "==", data.data.academicYearId);
      }
      duplicateQuery = duplicateQuery.limit(1);
      if (!(await duplicateQuery.get()).empty)
        return NextResponse.json(
          {
            error:
              group === "classes"
                ? "This class section already exists in the selected academic year."
                : "This subject already exists in this school.",
          },
          { status: 409 },
        );
    }
    if (group === "academicYears" && data.data.id) {
      const old = await ref.get();
      if (old.exists && old.get("status") === "closed")
        return NextResponse.json({ error: "Closed academic years are read-only" }, { status: 409 });
    }
    if (data.data.academicYearId) {
      const year = await db
        .collection("schools")
        .doc(context.schoolId)
        .collection("academicYears")
        .doc(data.data.academicYearId)
        .get();
      if (year.exists && year.get("status") === "closed")
        return NextResponse.json(
          { error: "Historical academic years are read-only" },
          { status: 409 },
        );
    }
    if (group === "classes" && !data.data.id && (data.data.teacherId || data.data.teacherAssignments.length)) {
      const assignments = data.data.teacherAssignments;
      const teacherUids = Array.from(new Set([
        ...(data.data.teacherId ? [data.data.teacherId] : []),
        ...assignments.map((assignment) => assignment.teacherUid),
      ]));
      const memberships = await Promise.all(
        teacherUids.map((uid) => school.collection("memberships").doc(uid).get()),
      );
      const allActiveTeachers = memberships.every((member) =>
        member.exists &&
        String(member.get("status") ?? "active") === "active" &&
        ["teacher", "class_teacher", "subject_teacher"].includes(String(member.get("role") ?? "")),
      );
      if (!allActiveTeachers)
        return NextResponse.json(
          { error: "Choose only active class or subject teachers from this school." },
          { status: 400 },
        );
      if (assignments.length) {
        const configuredSubjects = await school.collection("subjects").limit(300).get();
        const unavailable = assignments.find((assignment) =>
          !configuredSubjects.docs.some((subject) => {
            if (String(subject.get("name") ?? "") !== assignment.subject) return false;
            const subjectGrade = String(subject.get("grade") ?? "").trim();
            return !subjectGrade || canonicalGrade(subjectGrade) === data.data.grade;
          }),
        );
        if (unavailable)
          return NextResponse.json(
            { error: `${unavailable.subject} is not configured for ${data.data.grade}. Add it in Subjects first.` },
            { status: 400 },
          );
        const existingAssignments = await Promise.all(
          assignments.map((assignment) => school.collection("teacherAssignments")
            .where("teacherUid", "==", assignment.teacherUid)
            .where("grade", "==", data.data.grade)
            .where("className", "==", data.data.name)
            .where("subject", "==", assignment.subject)
            .where("status", "==", "active")
            .limit(1)
            .get()),
        );
        if (existingAssignments.some((snapshot) => !snapshot.empty))
          return NextResponse.json(
            { error: "An active assignment already exists for this teacher, subject, and class." },
            { status: 409 },
          );
      }
      const profileResults = await Promise.all(
        Array.from(new Set(assignments.map((assignment) => assignment.teacherUid))).map(async (uid) => ({
          uid,
          result: await school.collection("teachers").where("uid", "==", uid).limit(1).get(),
        })),
      );
      const classTeacherUid = data.data.teacherId ?? "";
      const assignmentRefs = assignments.map(() => school.collection("teacherAssignments").doc());
      const auditRef = school.collection("auditLogs").doc();
      const now = new Date();
      const classPayload = Object.fromEntries(
        Object.entries(data.data).filter(([key]) => key !== "id" && key !== "teacherAssignments"),
      );
      await db.runTransaction(async (transaction) => {
        transaction.create(ref, {
          ...classPayload,
          createdAt: now,
          createdBy: context.uid,
          updatedAt: now,
          updatedBy: context.uid,
        });
        assignments.forEach((assignment, index) => {
          transaction.create(assignmentRefs[index], {
            teacherUid: assignment.teacherUid,
            subject: assignment.subject,
            grade: data.data.grade,
            className: data.data.name,
            ...(data.data.academicYearId ? { academicYearId: data.data.academicYearId } : {}),
            classTeacher: assignment.teacherUid === classTeacherUid,
            status: "active",
            schoolId: context.schoolId,
            createdAt: now,
            createdBy: context.uid,
          });
        });
        for (const { uid, result } of profileResults) {
          const profile = result.docs[0];
          if (!profile) continue;
          const teacherAssignments = assignments.filter((assignment) => assignment.teacherUid === uid);
          const old = profile.data() ?? {};
          const mergeValues = (key: "subjects" | "grades" | "classes", additions: string[]) =>
            Array.from(new Set([
              ...(Array.isArray(old[key]) ? old[key].filter((value): value is string => typeof value === "string") : []),
              ...additions,
            ]));
          transaction.set(profile.ref, {
            subjects: mergeValues("subjects", teacherAssignments.map((assignment) => assignment.subject)),
            grades: mergeValues("grades", teacherAssignments.length ? [data.data.grade!] : []),
            classes: mergeValues("classes", teacherAssignments.length ? [data.data.name] : []),
            updatedAt: now,
            updatedBy: context.uid,
          }, { merge: true });
        }
        transaction.create(auditRef, {
          schoolId: context.schoolId,
          actorUid: context.uid,
          action: "configuration.classes.saved",
          recordType: "classes",
          recordId: ref.id,
          teacherAssignments: assignments.length,
          occurredAt: now,
        });
      });
      return NextResponse.json(
        { id: ref.id, ...classPayload, teacherAssignments: assignments.length },
        { status: 201 },
      );
    }
    const id = data.data.id;
    const payload = Object.fromEntries(
      Object.entries(data.data).filter(([key]) => key !== "id" && key !== "teacherAssignments"),
    );
    if (group === "grades" && typeof payload.name === "string")
      payload.name = payload.name.replace(/^Grade ([1-9])$/, "Grade 0$1");
    if (group === "academicYears" && payload.status === "active") {
      const active = await db
        .collection("schools")
        .doc(context.schoolId)
        .collection("academicYears")
        .where("status", "==", "active")
        .get();
      const batch = db.batch();
      for (const doc of active.docs)
        if (doc.id !== ref.id)
          batch.update(doc.ref, { status: "closed", closedAt: new Date(), updatedAt: new Date() });
      batch.set(
        ref,
        {
          ...payload,
          activatedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: context.uid,
          ...(!id ? { createdAt: new Date(), createdBy: context.uid } : {}),
        },
        { merge: true },
      );
      await batch.commit();
    } else
      await ref.set(
        {
          ...payload,
          updatedAt: new Date(),
          updatedBy: context.uid,
          ...(!id ? { createdAt: new Date(), createdBy: context.uid } : {}),
        },
        { merge: true },
      );
    await db
      .collection("schools")
      .doc(context.schoolId)
      .collection("auditLogs")
      .add({
        schoolId: context.schoolId,
        actorUid: context.uid,
        action: `configuration.${group}.saved`,
        recordType: group,
        recordId: ref.id,
        occurredAt: new Date(),
      });
    return NextResponse.json({ id: ref.id, ...payload }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Configuration could not be saved" }, { status: 500 });
  }
}
