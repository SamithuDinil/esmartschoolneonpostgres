import "server-only";
import type { DocumentReference } from "firebase-admin/firestore";
import { hasPermission } from "@/server/permissions";
import type { SchoolContext } from "@/server/context";

export async function teacherAssigned(
  root: DocumentReference,
  uid: string,
  assignment: FirebaseFirestore.DocumentData,
) {
  const rows = await root
    .collection("teacherAssignments")
    .where("teacherUid", "==", uid)
    .limit(300)
    .get();
  return rows.docs.some(
    (row) =>
      row.get("status") === "active" &&
      row.get("grade") === assignment.grade &&
      row.get("className") === assignment.className &&
      row.get("subject") === assignment.subject,
  );
}

export async function canManageAssignment(
  root: DocumentReference,
  context: SchoolContext,
  assignment: FirebaseFirestore.DocumentData,
) {
  if (hasPermission(context.permissions, "assignments.manage")) return true;
  if (!hasPermission(context.permissions, "assignments.manage.assigned")) return false;
  return teacherAssigned(root, context.uid, assignment);
}

export async function classRoster(
  root: DocumentReference,
  assignment: FirebaseFirestore.DocumentData,
) {
  if (typeof assignment.academicYearId === "string" && assignment.academicYearId) {
    const enrollments = await root
      .collection("enrollments")
      .where("academicYearId", "==", assignment.academicYearId)
      .limit(1500)
      .get();
    const matching = enrollments.docs.filter(
      (row) =>
        row.get("grade") === assignment.grade &&
        row.get("className") === assignment.className &&
        row.get("status") === "active",
    );
    if (matching.length) {
      const students = await Promise.all(
        matching.map((row) =>
          root
            .collection("students")
            .doc(String(row.get("studentId")))
            .get(),
        ),
      );
      return students.filter((row) => row.exists && row.get("status") !== "archived");
    }
  }
  const fallback = await root
    .collection("students")
    .where("grade", "==", assignment.grade)
    .where("className", "==", assignment.className)
    .limit(500)
    .get();
  return fallback.docs.filter((row) => row.get("status") !== "archived");
}

export async function studentRecordsForUid(root: DocumentReference, uid: string) {
  const [byAccount, byUser] = await Promise.all([
    root.collection("students").where("accountUid", "==", uid).limit(20).get(),
    root.collection("students").where("userUid", "==", uid).limit(20).get(),
  ]);
  const unique = new Map(
    [...byAccount.docs, ...byUser.docs]
      .filter((row) => row.get("status") !== "archived")
      .map((row) => [row.id, row]),
  );
  return [...unique.values()];
}

export async function guardianLinksForUid(root: DocumentReference, uid: string) {
  const snap = await root
    .collection("studentGuardianLinks")
    .where("guardianUid", "==", uid)
    .where("status", "==", "active")
    .limit(100)
    .get();
  return snap.docs.filter((link) => (link.get("accessPermissions") ?? []).includes("assignments"));
}

export async function notificationRecipientsForStudent(
  root: DocumentReference,
  student: FirebaseFirestore.DocumentData,
) {
  const users = new Set<string>();
  if (typeof student.accountUid === "string") users.add(student.accountUid);
  if (typeof student.userUid === "string") users.add(student.userUid);
  if (typeof student.id === "string") {
    const links = await root
      .collection("studentGuardianLinks")
      .where("studentId", "==", student.id)
      .where("status", "==", "active")
      .limit(20)
      .get();
    for (const link of links.docs)
      if (
        (link.get("accessPermissions") ?? []).includes("assignments") &&
        typeof link.get("guardianUid") === "string"
      )
        users.add(link.get("guardianUid"));
  }
  return [...users];
}

export async function queueAssignmentNotification(
  root: DocumentReference,
  schoolId: string,
  eventId: string,
  payload: FirebaseFirestore.DocumentData,
) {
  try {
    await root
      .collection("assignmentNotifications")
      .doc(eventId)
      .create({ ...payload, schoolId, createdAt: new Date(), deliveryStatus: "queued" });
  } catch {
    // Deterministic event IDs keep dashboard-triggered queueing idempotent.
  }
}

export async function canViewAssignment(
  root: DocumentReference,
  context: SchoolContext,
  assignmentRef: DocumentReference,
  assignment: FirebaseFirestore.DocumentData,
) {
  const status = assignment.status;
  const visibleNow =
    status === "published" ||
    (status === "scheduled" &&
      typeof assignment.publishAt === "string" &&
      assignment.publishAt <= new Date().toISOString());
  if (!visibleNow) return false;
  if (await canManageAssignment(root, context, assignment)) return true;
  if (hasPermission(context.permissions, "assignments.read")) return true;
  if (context.role === "student" && hasPermission(context.permissions, "assignments.self.read")) {
    const students = await studentRecordsForUid(root, context.uid);
    for (const student of students)
      if ((await assignmentRef.collection("recipients").doc(student.id).get()).exists) return true;
    return false;
  }
  if (context.role === "parent" && hasPermission(context.permissions, "assignments.linked.read")) {
    const links = await guardianLinksForUid(root, context.uid);
    for (const link of links)
      if (
        (
          await assignmentRef
            .collection("recipients")
            .doc(String(link.get("studentId")))
            .get()
        ).exists
      )
        return true;
  }
  return false;
}

export function normalizedDeadlineStatus(
  assignment: FirebaseFirestore.DocumentData,
  submission?: FirebaseFirestore.DocumentData | null,
) {
  if (submission?.status) return submission.status;
  const deadline = typeof assignment.deadlineAt === "string" ? assignment.deadlineAt : "";
  return deadline && deadline < new Date().toISOString() ? "missing" : "not_started";
}

/** Batched variant of notificationRecipientsForStudent: one `in` query per 30 students instead of one per student. */
export async function notificationRecipientsForStudents(
  root: DocumentReference,
  students: Array<{ id: string } & FirebaseFirestore.DocumentData>,
) {
  const result = new Map<string, Set<string>>();
  for (const student of students) {
    const users = new Set<string>();
    if (typeof student.accountUid === "string") users.add(student.accountUid);
    if (typeof student.userUid === "string") users.add(student.userUid);
    result.set(student.id, users);
  }
  const ids = students.map((student) => student.id);
  for (let i = 0; i < ids.length; i += 30) {
    const links = await root
      .collection("studentGuardianLinks")
      .where("studentId", "in", ids.slice(i, i + 30))
      .where("status", "==", "active")
      .get();
    for (const link of links.docs) {
      const guardianUid = link.get("guardianUid");
      if (
        (link.get("accessPermissions") ?? []).includes("assignments") &&
        typeof guardianUid === "string"
      )
        result.get(String(link.get("studentId")))?.add(guardianUid);
    }
  }
  return new Map([...result].map(([id, users]) => [id, [...users]]));
}
