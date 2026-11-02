import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import {
  canManageAssignment,
  classRoster,
  guardianLinksForUid,
  notificationRecipientsForStudent,
  queueAssignmentNotification,
  studentRecordsForUid,
  teacherAssigned,
} from "@/server/services/assignments";
import { SAFE_ASSIGNMENT_FILE_TYPES } from "@/server/services/assignment-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const assignmentPermissions = [
  "assignments.manage",
  "assignments.manage.assigned",
  "assignments.read",
  "assignments.self.read",
  "assignments.linked.read",
];
const canUseModule = (permissions: readonly string[]) =>
  assignmentPermissions.some((permission) => hasPermission(permissions, permission));
const safeDateTime = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), "Use a valid date and time");
const references = z
  .array(
    z
      .string()
      .url()
      .refine((url) => url.startsWith("https://"), "Reference URLs must use HTTPS"),
  )
  .max(12)
  .default([]);
const createSchema = z.object({
  action: z.literal("create"),
  title: z.string().trim().min(3).max(140),
  instructions: z.string().trim().min(3).max(10000),
  academicYearId: z.string().min(1).max(128),
  grade: z.string().trim().min(1).max(30),
  className: z.string().trim().min(1).max(50),
  subject: z.string().trim().min(1).max(100),
  deadlineAt: safeDateTime,
  publishAt: safeDateTime.optional(),
  allowMultipleAttempts: z.boolean().optional(),
  maxMarks: z.number().min(0).max(10000).default(0),
  referenceLinks: references,
  teacherUid: z.string().optional(),
});
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("publish"),
    assignmentId: z.string().min(1),
    publishAt: safeDateTime.optional(),
  }),
  z.object({ action: z.literal("archive"), assignmentId: z.string().min(1) }),
  z.object({ action: z.literal("duplicate"), assignmentId: z.string().min(1) }),
  z.object({
    action: z.literal("configure"),
    allowedFileTypes: z
      .array(
        z.enum(
          Object.keys(SAFE_ASSIGNMENT_FILE_TYPES) as [
            keyof typeof SAFE_ASSIGNMENT_FILE_TYPES,
            ...(keyof typeof SAFE_ASSIGNMENT_FILE_TYPES)[],
          ],
        ),
      )
      .min(1)
      .max(8),
    maxFileSizeMB: z.number().int().min(1).max(20),
    defaultAllowMultipleAttempts: z.boolean(),
  }),
]);

async function audit(
  root: FirebaseFirestore.DocumentReference,
  schoolId: string,
  uid: string,
  action: string,
  recordId: string,
  changedFields?: string[],
) {
  await root.collection("auditLogs").add({
    schoolId,
    actorUid: uid,
    action,
    recordType: "assignment",
    recordId,
    ...(changedFields ? { changedFields } : {}),
    occurredAt: new Date(),
  });
}

async function publishNow(
  root: FirebaseFirestore.DocumentReference,
  schoolId: string,
  uid: string,
  ref: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData,
) {
  const roster = await classRoster(root, data);
  const now = new Date();
  for (let i = 0; i < roster.length; i += 400) {
    const batch = getAdminServices().db.batch();
    for (const student of roster.slice(i, i + 400))
      batch.set(
        ref.collection("recipients").doc(student.id),
        {
          studentId: student.id,
          grade: data.grade,
          className: data.className,
          academicYearId: data.academicYearId,
          addedAt: now,
          schoolId,
        },
        { merge: true },
      );
    await batch.commit();
  }
  await ref.update({
    status: "published",
    publishedAt: now,
    publishedBy: uid,
    recipientCount: roster.length,
    updatedAt: now,
  });
  for (const student of roster) {
    const targets = await notificationRecipientsForStudent(root, {
      id: student.id,
      ...student.data(),
    });
    if (targets.length)
      await queueAssignmentNotification(root, schoolId, `published_${ref.id}_${student.id}`, {
        type: "assignment_published",
        title: "New assignment",
        message: `${String(data.title)} has been published.`,
        assignmentId: ref.id,
        studentId: student.id,
        targetUids: targets,
      });
  }
}

export async function GET(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "School access required" }, { status: 403 });
  if (!canUseModule(context.permissions))
    return NextResponse.json({ error: "Assignment access denied" }, { status: 403 });
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  try {
    if (request.nextUrl.searchParams.get("analytics") === "1") {
      if (
        !hasPermission(context.permissions, "assignments.read") &&
        !hasPermission(context.permissions, "assignments.manage")
      )
        return NextResponse.json(
          { error: "Assignment analytics permission required" },
          { status: 403 },
        );
      const yearId = request.nextUrl.searchParams.get("academicYearId");
      const all = await root.collection("assignments").limit(500).get();
      const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      for (const doc of all.docs)
        if (
          (!yearId || doc.get("academicYearId") === yearId) &&
          (hasPermission(context.permissions, "assignments.manage") ||
            (await teacherAssigned(root, context.uid, doc.data())))
        )
          docs.push(doc);
      let totalRecipients = 0,
        totalSubmitted = 0,
        late = 0,
        missing = 0,
        marksSum = 0,
        markedCount = 0;
      const bySubject = new Map<
        string,
        {
          subject: string;
          grade: string;
          className: string;
          total: number;
          submitted: number;
          late: number;
          missing: number;
          marks: number;
          marked: number;
        }
      >();
      for (const doc of docs) {
        const [recipients, submissions] = await Promise.all([
          doc.ref.collection("recipients").get(),
          doc.ref.collection("submissions").get(),
        ]);
        const submittedDocs = submissions.docs.filter((s) =>
          [
            "submitted",
            "submitted_late",
            "under_review",
            "reviewed",
            "published",
            "resubmission_requested",
          ].includes(String(s.get("status"))),
        );
        const assignmentLate = submittedDocs.filter((s) => s.get("wasLate") === true).length;
        const deadline = String(doc.get("deadlineAt") ?? "");
        const assignmentMissing = Math.max(
          0,
          deadline && deadline < new Date().toISOString()
            ? recipients.size - submittedDocs.length
            : 0,
        );
        totalRecipients += recipients.size;
        totalSubmitted += submittedDocs.length;
        late += assignmentLate;
        missing += assignmentMissing;
        for (const sub of submissions.docs)
          if (sub.get("status") === "published" && typeof sub.get("awardedMarks") === "number") {
            marksSum += Number(sub.get("awardedMarks"));
            markedCount++;
          }
        const key = `${doc.get("grade")}::${doc.get("className")}::${doc.get("subject")}`;
        const group = bySubject.get(key) ?? {
          subject: String(doc.get("subject")),
          grade: String(doc.get("grade")),
          className: String(doc.get("className")),
          total: 0,
          submitted: 0,
          late: 0,
          missing: 0,
          marks: 0,
          marked: 0,
        };
        group.total += recipients.size;
        group.submitted += submittedDocs.length;
        group.late += assignmentLate;
        group.missing += assignmentMissing;
        for (const sub of submissions.docs)
          if (sub.get("status") === "published" && typeof sub.get("awardedMarks") === "number") {
            group.marks += Number(sub.get("awardedMarks"));
            group.marked++;
          }
        bySubject.set(key, group);
      }
      const assignmentCount = docs.length;
      return NextResponse.json(
        {
          summary: {
            totalAssignments: assignmentCount,
            publishedAssignments: docs.filter((d) => d.get("status") === "published").length,
            pendingSubmissions: Math.max(0, totalRecipients - totalSubmitted),
            completedSubmissions: totalSubmitted,
            lateSubmissions: late,
            missingSubmissions: missing,
            averageMarks: markedCount ? marksSum / markedCount : null,
            submissionCompletionPercent: totalRecipients
              ? Math.round((totalSubmitted / totalRecipients) * 10000) / 100
              : 0,
          },
          groups: [...bySubject.values()].map((g) => ({
            ...g,
            completionPercent: g.total ? Math.round((g.submitted / g.total) * 10000) / 100 : 0,
            averageMarks: g.marked ? g.marks / g.marked : null,
          })),
        },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }

    const [all, students, links, notificationDocs, teacherRows] = await Promise.all([
      root.collection("assignments").orderBy("createdAt", "desc").limit(500).get(),
      context.role === "student" ? studentRecordsForUid(root, context.uid) : Promise.resolve([]),
      context.role === "parent" ? guardianLinksForUid(root, context.uid) : Promise.resolve([]),
      root
        .collection("assignmentNotifications")
        .where("targetUids", "array-contains", context.uid)
        .limit(60)
        .get(),
      hasPermission(context.permissions, "assignments.manage.assigned")
        ? root
            .collection("teacherAssignments")
            .where("teacherUid", "==", context.uid)
            .limit(300)
            .get()
        : Promise.resolve(null),
    ]);
    const manageAll = hasPermission(context.permissions, "assignments.manage");
    const [policyDoc, activeYears, classConfig, subjectConfig, teacherProfiles] = await Promise.all(
      [
        root.collection("settings").doc("assignments").get(),
        root.collection("academicYears").where("status", "==", "active").limit(20).get(),
        manageAll ? root.collection("classes").limit(300).get() : Promise.resolve(null),
        manageAll ? root.collection("subjects").limit(300).get() : Promise.resolve(null),
        manageAll
          ? root.collection("teachers").orderBy("fullName").limit(300).get()
          : Promise.resolve(null),
      ],
    );
    const assignedOptions = (teacherRows?.docs ?? [])
      .filter((doc) => doc.get("status") === "active")
      .map((doc) => ({
        grade: doc.get("grade"),
        className: doc.get("className"),
        subject: doc.get("subject"),
      }));
    const options = {
      academicYears:
        activeYears?.docs.map((doc) => ({
          id: doc.id,
          name: doc.get("name"),
          startDate: doc.get("startDate"),
          endDate: doc.get("endDate"),
        })) ?? [],
      classes: manageAll
        ? classConfig!.docs
            .map((doc) => ({
              id: doc.id,
              grade: doc.get("grade"),
              className: doc.get("name"),
              academicYearId: doc.get("academicYearId"),
            }))
            .filter(
              (item) =>
                !item.academicYearId ||
                activeYears?.docs.some((year) => year.id === item.academicYearId),
            )
        : assignedOptions.map((item) => ({ grade: item.grade, className: item.className })),
      subjects: manageAll
        ? subjectConfig!.docs.map((doc) => ({
            id: doc.id,
            name: doc.get("name"),
            grade: doc.get("grade"),
          }))
        : assignedOptions.map((item) => ({ name: item.subject, grade: item.grade })),
      teachers:
        teacherProfiles?.docs
          .map((doc) => ({
            id: doc.id,
            uid: doc.get("uid"),
            fullName: doc.get("fullName"),
            status: doc.get("status"),
          }))
          .filter((item) => item.status === "active" && typeof item.uid === "string") ?? [],
    };
    const settings = {
      allowedFileTypes:
        policyDoc.get("allowedFileTypes") ?? Object.keys(SAFE_ASSIGNMENT_FILE_TYPES),
      maxFileSizeMB: policyDoc.get("maxFileSizeMB") ?? 10,
      defaultAllowMultipleAttempts: policyDoc.get("defaultAllowMultipleAttempts") === true,
    };
    const studentIds = students.map((s) => s.id);
    const childIds = links.map((l) => String(l.get("studentId")));
    const teacherKeys = new Set(
      (teacherRows?.docs ?? [])
        .filter((d) => d.get("status") === "active")
        .map((d) => `${d.get("grade")}\u0000${d.get("className")}\u0000${d.get("subject")}`),
    );

    for (const doc of all.docs) {
      const d = doc.data();
      const mayRelease =
        hasPermission(context.permissions, "assignments.manage") ||
        hasPermission(context.permissions, "assignments.read") ||
        teacherKeys.has(`${d.grade}\u0000${d.className}\u0000${d.subject}`);
      if (
        mayRelease &&
        doc.get("status") === "scheduled" &&
        typeof doc.get("publishAt") === "string" &&
        doc.get("publishAt") <= new Date().toISOString()
      ) {
        await publishNow(
          root,
          context.schoolId,
          doc.get("createdBy") ?? context.uid,
          doc.ref,
          doc.data(),
        );
      }
    }
    const visible = [];
    const now = new Date().toISOString();
    for (const doc of all.docs) {
      const data = doc.data();
      const assignedTeacher = teacherKeys.has(
        `${data.grade}\u0000${data.className}\u0000${data.subject}`,
      );
      const manager =
        hasPermission(context.permissions, "assignments.manage") ||
        (hasPermission(context.permissions, "assignments.manage.assigned") && assignedTeacher);
      let childStudentIds: string[] = [];
      if (context.role === "student")
        childStudentIds = (
          await Promise.all(
            studentIds.map(async (id) =>
              (await doc.ref.collection("recipients").doc(id).get()).exists ? id : null,
            ),
          )
        ).filter((id): id is string => id !== null);
      if (context.role === "parent")
        childStudentIds = (
          await Promise.all(
            childIds.map(async (id) =>
              (await doc.ref.collection("recipients").doc(id).get()).exists ? id : null,
            ),
          )
        ).filter((id): id is string => id !== null);
      const released =
        data.status === "published" ||
        (data.status === "scheduled" &&
          typeof data.publishAt === "string" &&
          data.publishAt <= now);
      const readAny = hasPermission(context.permissions, "assignments.read");
      if (!manager && !readAny && (!released || childStudentIds.length === 0)) continue;
      const status = released
        ? data.status === "scheduled"
          ? "published"
          : data.status
        : data.status;
      const assignment: FirebaseFirestore.DocumentData = { id: doc.id, ...data, status };
      const progress: Record<string, unknown> = {};
      for (const studentId of childStudentIds) {
        const sub = await doc.ref.collection("submissions").doc(studentId).get();
        const currentStatus = sub.exists
          ? String(sub.get("status"))
          : String(data.deadlineAt ?? "") < now
            ? "missing"
            : "not_started";
        if (
          !sub.exists &&
          currentStatus === "not_started" &&
          typeof data.deadlineAt === "string" &&
          Date.parse(data.deadlineAt) < Date.now() + 24 * 60 * 60 * 1000
        ) {
          const student =
            context.role === "parent"
              ? await root.collection("students").doc(studentId).get()
              : students.find((s) => s.id === studentId);
          if (student?.exists) {
            const targets = await notificationRecipientsForStudent(root, {
              id: studentId,
              ...student.data(),
            });
            const overdue = Date.parse(data.deadlineAt) < Date.now();
            if (targets.length)
              await queueAssignmentNotification(
                root,
                context.schoolId,
                `${overdue ? "overdue" : "deadline"}_${doc.id}_${studentId}_${String(data.deadlineAt).slice(0, 10)}`,
                {
                  type: overdue ? "assignment_overdue" : "deadline_approaching",
                  title: overdue ? "Assignment overdue" : "Deadline approaching",
                  message: `${String(data.title)} is ${overdue ? "overdue" : "due within 24 hours"}.`,
                  assignmentId: doc.id,
                  studentId,
                  targetUids: targets,
                },
              );
          }
        }
        const published = sub.exists && sub.get("status") === "published";
        const childName =
          context.role === "parent"
            ? (await root.collection("students").doc(studentId).get()).get("fullName")
            : undefined;
        progress[studentId] = {
          status: currentStatus,
          awardedMarks: published ? (sub.get("awardedMarks") ?? null) : null,
          feedback: published ? (sub.get("feedback") ?? "") : "",
          submittedAt: sub.get("submittedAt") ?? null,
          ...(typeof childName === "string" ? { studentName: childName } : {}),
          ...(context.role === "student" && sub.exists && currentStatus === "in_progress"
            ? { textResponse: sub.get("textResponse") ?? "" }
            : {}),
        };
        if (context.role === "student") {
          assignment.myStatus = currentStatus;
          assignment.myProgress = progress[studentId];
        }
      }
      if (context.role === "parent") assignment.childrenProgress = progress;
      if (manager || readAny) {
        const [recipients, submissions] = await Promise.all([
          doc.ref.collection("recipients").get(),
          doc.ref.collection("submissions").get(),
        ]);
        assignment.stats = {
          recipients: recipients.size,
          submissions: submissions.size,
          late: submissions.docs.filter((s) => s.get("wasLate") === true).length,
          missing: Math.max(
            0,
            Date.parse(String(data.deadlineAt ?? "")) < Date.now()
              ? recipients.size -
                  submissions.docs.filter((s) => Boolean(s.get("submittedAt"))).length
              : 0,
          ),
        };
      }
      visible.push(assignment);
    }
    const notifications = [...notificationDocs.docs]
      .sort((a, b) => b.createTime.toMillis() - a.createTime.toMillis())
      .slice(0, 30)
      .map((doc) => ({ id: doc.id, ...doc.data() }));
    return NextResponse.json(
      { items: visible, notifications, options, settings },
      { headers: { "Cache-Control": "private,no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Assignment records are unavailable" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "School access required" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const create = createSchema.safeParse(body);
  const action = actionSchema.safeParse(body);
  const { db, bucket } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  try {
    if (action.success && action.data.action === "configure") {
      if (!hasPermission(context.permissions, "assignments.manage"))
        return NextResponse.json(
          { error: "School assignment policy permission required" },
          { status: 403 },
        );
      const { action: _action, ...settings } = action.data;
      await root
        .collection("settings")
        .doc("assignments")
        .set({ ...settings, updatedAt: new Date(), updatedBy: context.uid }, { merge: true });
      await audit(
        root,
        context.schoolId,
        context.uid,
        "assignment.policy.updated",
        "assignments",
        Object.keys(settings),
      );
      return NextResponse.json({ ok: true });
    }
    if (create.success) {
      if (
        !hasPermission(context.permissions, "assignments.manage") &&
        !hasPermission(context.permissions, "assignments.manage.assigned")
      )
        return NextResponse.json(
          { error: "Assignment creation permission required" },
          { status: 403 },
        );
      const data = create.data;
      const year = await root.collection("academicYears").doc(data.academicYearId).get();
      if (!year.exists)
        return NextResponse.json(
          { error: "Academic year not found in this school" },
          { status: 404 },
        );
      if (year.get("status") === "closed")
        return NextResponse.json(
          { error: "Cannot create assignments for a closed academic year" },
          { status: 409 },
        );
      const matchingClasses = await root
        .collection("classes")
        .where("name", "==", data.className)
        .limit(50)
        .get();
      if (
        !matchingClasses.docs.some(
          (row) =>
            row.get("grade") === data.grade &&
            (!row.get("academicYearId") || row.get("academicYearId") === data.academicYearId),
        )
      )
        return NextResponse.json(
          { error: "Class is not configured for this grade and academic year" },
          { status: 400 },
        );
      const matchingSubjects = await root
        .collection("subjects")
        .where("name", "==", data.subject)
        .limit(50)
        .get();
      if (matchingSubjects.empty)
        return NextResponse.json(
          { error: "Subject is not configured for this school" },
          { status: 400 },
        );
      const manager = hasPermission(context.permissions, "assignments.manage");
      const teacherUid = manager ? data.teacherUid || context.uid : context.uid;
      if (
        !manager &&
        !(await teacherAssigned(root, context.uid, {
          grade: data.grade,
          className: data.className,
          subject: data.subject,
        }))
      )
        return NextResponse.json(
          { error: "You are not assigned to this class and subject" },
          { status: 403 },
        );
      if (manager && data.teacherUid) {
        const activeAssignment = await teacherAssigned(root, data.teacherUid, {
          grade: data.grade,
          className: data.className,
          subject: data.subject,
        });
        if (!activeAssignment)
          return NextResponse.json(
            { error: "Selected teacher is not assigned to this class and subject" },
            { status: 400 },
          );
      }
      if (Date.parse(data.deadlineAt) <= Date.now())
        return NextResponse.json(
          { error: "Assignment deadline must be in the future" },
          { status: 400 },
        );
      if (data.publishAt && Date.parse(data.publishAt) <= Date.now())
        return NextResponse.json(
          {
            error: "Scheduled publication time must be in the future; publish immediately instead",
          },
          { status: 400 },
        );
      const ref = root.collection("assignments").doc();
      const policy = await root.collection("settings").doc("assignments").get();
      const record = {
        ...data,
        allowMultipleAttempts:
          data.allowMultipleAttempts ?? policy.get("defaultAllowMultipleAttempts") === true,
        teacherUid,
        status: data.publishAt ? "scheduled" : "draft",
        schoolId: context.schoolId,
        createdBy: context.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ref.set(record);
      if (record.status === "scheduled") {
        const roster = await classRoster(root, record);
        const batch = db.batch();
        for (const student of roster)
          batch.set(
            ref.collection("recipients").doc(student.id),
            {
              studentId: student.id,
              grade: data.grade,
              className: data.className,
              academicYearId: data.academicYearId,
              addedAt: new Date(),
              schoolId: context.schoolId,
            },
            { merge: true },
          );
        await batch.commit();
      }
      await audit(root, context.schoolId, context.uid, "assignment.created", ref.id);
      return NextResponse.json({ id: ref.id, status: record.status }, { status: 201 });
    }
    if (!action.success)
      return NextResponse.json(
        { error: "Invalid assignment operation", fields: action.error.flatten().fieldErrors },
        { status: 400 },
      );
    const data = action.data;
    if (data.action === "configure")
      return NextResponse.json(
        { error: "Assignment policy action was not handled" },
        { status: 400 },
      );
    const source = root.collection("assignments").doc(data.assignmentId);
    const snapshot = await source.get();
    if (!snapshot.exists)
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    const assignment = snapshot.data()!;
    if (!(await canManageAssignment(root, context, assignment)))
      return NextResponse.json(
        { error: "You are not assigned to manage this assignment" },
        { status: 403 },
      );
    if (data.action === "archive") {
      await source.update({
        status: "archived",
        archivedAt: new Date(),
        archivedBy: context.uid,
        updatedAt: new Date(),
      });
      await audit(root, context.schoolId, context.uid, "assignment.archived", source.id);
      return NextResponse.json({ ok: true });
    }
    if (data.action === "duplicate") {
      const copy = root.collection("assignments").doc();
      await copy.set({
        ...assignment,
        title: `${String(assignment.title)} (copy)`.slice(0, 140),
        status: "draft",
        publishAt: null,
        createdBy: context.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
        sourceAssignmentId: source.id,
        publishedAt: null,
        recipientCount: 0,
      });
      const files = await source.collection("attachments").get();
      for (const file of files.docs.slice(0, 50)) {
        const oldPath = file.get("storagePath");
        if (
          typeof oldPath !== "string" ||
          !oldPath.startsWith(`schools/${context.schoolId}/assignments/${source.id}/attachments/`)
        )
          continue;
        const newPath = `schools/${context.schoolId}/assignments/${copy.id}/attachments/${file.id}`;
        await bucket.file(oldPath).copy(bucket.file(newPath));
        await copy
          .collection("attachments")
          .doc(file.id)
          .set({
            ...file.data(),
            storagePath: newPath,
            uploadedAt: new Date(),
            uploadedBy: context.uid,
          });
      }
      await audit(root, context.schoolId, context.uid, "assignment.duplicated", copy.id);
      return NextResponse.json({ id: copy.id, status: "draft" }, { status: 201 });
    }
    if (assignment.status === "published" || assignment.status === "archived")
      return NextResponse.json(
        { error: "This assignment is already published or archived" },
        { status: 409 },
      );
    const publicationAt = data.publishAt;
    if (publicationAt && Date.parse(publicationAt) > Date.now()) {
      const roster = await classRoster(root, assignment);
      const batch = db.batch();
      for (const student of roster)
        batch.set(
          source.collection("recipients").doc(student.id),
          {
            studentId: student.id,
            grade: assignment.grade,
            className: assignment.className,
            academicYearId: assignment.academicYearId,
            addedAt: new Date(),
            schoolId: context.schoolId,
          },
          { merge: true },
        );
      await batch.commit();
      await source.update({ status: "scheduled", publishAt: publicationAt, updatedAt: new Date() });
      await audit(root, context.schoolId, context.uid, "assignment.scheduled", source.id);
      return NextResponse.json({ ok: true, status: "scheduled" });
    }
    await publishNow(root, context.schoolId, context.uid, source, assignment);
    await audit(root, context.schoolId, context.uid, "assignment.published", source.id);
    return NextResponse.json({ ok: true, status: "published" });
  } catch {
    return NextResponse.json({ error: "Assignment operation failed" }, { status: 500 });
  }
}
