import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";

export const dynamic = "force-dynamic";

function row(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {};
  const result: Record<string, unknown> = { id: doc.id };
  for (const [key, value] of Object.entries(data)) {
    if (
      value &&
      typeof value === "object" &&
      "toDate" in value &&
      typeof value.toDate === "function"
    )
      result[key] = value.toDate().toISOString();
    else if (value instanceof Date) result[key] = value.toISOString();
    else if (
      ["string", "number", "boolean"].includes(typeof value) ||
      value === null ||
      Array.isArray(value)
    )
      result[key] = value;
  }
  return result;
}

async function limited(root: FirebaseFirestore.DocumentReference, collection: string, limit = 50) {
  try {
    return (await root.collection(collection).limit(limit).get()).docs.map(row);
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const mode = request.nextUrl.searchParams.get("portal") ?? "student";
  if (mode === "parent" && !hasPermission(context.permissions, "students.linked.read"))
    return NextResponse.json({ error: "Parent portal access is restricted." }, { status: 403 });
  if (mode === "student" && !hasPermission(context.permissions, "profile.self.read"))
    return NextResponse.json({ error: "Student portal access is restricted." }, { status: 403 });
  const root = getAdminServices().db.collection("schools").doc(context.schoolId);
  const requestedStudentId = request.nextUrl.searchParams.get("studentId");
  let students: Record<string, unknown>[] = [];
  if (mode === "parent") {
    const links = await root
      .collection("studentGuardianLinks")
      .where("guardianUid", "==", context.uid)
      .where("status", "==", "active")
      .limit(100)
      .get()
      .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }));
    students = (
      await Promise.all(
        links.docs.map(async (link) => {
          const studentId = link.get("studentId");
          if (typeof studentId !== "string") return null;
          const snapshot = await root.collection("students").doc(studentId).get();
          return snapshot.exists && snapshot.get("status") !== "archived" ? row(snapshot) : null;
        }),
      )
    ).filter((item): item is Record<string, unknown> => Boolean(item));
  } else {
    const [byAccount, byUser] = await Promise.all([
      root.collection("students").where("accountUid", "==", context.uid).limit(10).get(),
      root.collection("students").where("userUid", "==", context.uid).limit(10).get(),
    ]);
    const unique = new Map([...byAccount.docs, ...byUser.docs].map((doc) => [doc.id, row(doc)]));
    students = [...unique.values()].filter((student) => student.status !== "archived");
  }
  const selected =
    (requestedStudentId
      ? students.find((student) => student.id === requestedStudentId)
      : undefined) ?? students[0];
  const selectedId = typeof selected?.id === "string" ? selected.id : null;
  const allAnnouncements = await limited(root, "announcements", 100);
  const audienceRole = mode === "parent" ? "parent" : "student";
  const announcements = allAnnouncements.filter((item) => {
    const grades = Array.isArray(item.targetGrades) ? item.targetGrades : [];
    const classes = Array.isArray(item.targetClasses) ? item.targetClasses : [];
    const gradeMatch = grades.length === 0 || (selected && grades.includes(selected.grade));
    const classMatch = classes.length === 0 || (selected && classes.includes(selected.className));
    return (
      item.status === "published" &&
      gradeMatch &&
      classMatch &&
      (item.audience === "school" ||
        (item.audience === "parents" && audienceRole === "parent") ||
        (item.audience === "students" && audienceRole === "student") ||
        (Array.isArray(item.targetRoles) && item.targetRoles.includes(context.role)) ||
        (Array.isArray(item.targetUids) && item.targetUids.includes(context.uid)))
    );
  });
  const [
    attendanceSessions,
    publishedExams,
    upcomingExams,
    invoices,
    payments,
    reports,
    assignments,
    timetable,
    events,
    messages,
    notifications,
  ] = await Promise.all([
    limited(root, "attendanceSessions", 500),
    root
      .collection("exams")
      .where("status", "==", "published")
      .limit(100)
      .get()
      .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
    root
      .collection("exams")
      .where("status", "==", "scheduled")
      .limit(100)
      .get()
      .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
    limited(root, "invoices", 100),
    limited(root, "payments", 100),
    limited(root, "documents", 50),
    limited(root, "assignments", 100),
    limited(root, "timetableEntries", 100),
    limited(root, "events", 50),
    limited(root, "messages", 50),
    limited(root, "notifications", 50),
  ]);
  const classScoped = (items: Record<string, unknown>[]) =>
    selected
      ? items.filter(
          (item) =>
            !item.studentId ||
            item.studentId === selectedId ||
            (item.grade === selected.grade && item.className === selected.className),
        )
      : [];
  const scoped = (items: Record<string, unknown>[]) =>
    selectedId ? items.filter((item) => item.studentId === selectedId) : [];
  const attendance = selectedId
    ? ((
        await Promise.all(
          attendanceSessions
            .filter(
              (session) =>
                session.grade === selected?.grade && session.className === selected?.className,
            )
            .map(async (session) => {
              const sessionId = String(session.id);
              const record = await root
                .collection("attendanceSessions")
                .doc(sessionId)
                .collection("records")
                .doc(selectedId)
                .get();
              return record.exists
                ? {
                    ...session,
                    id: `${sessionId}_${selectedId}`,
                    status: record.get("status"),
                    studentId: selectedId,
                  }
                : null;
            }),
        )
      ).filter(Boolean) as Record<string, unknown>[])
    : [];
  const published = publishedExams.docs.filter(
    (exam) =>
      selected &&
      exam.get("grade") === selected.grade &&
      exam.get("className") === selected.className,
  );
  const results = selectedId
    ? ((
        await Promise.all(
          published.map(async (exam) => {
            const mark = await exam.ref.collection("marks").doc(selectedId).get();
            return mark.exists
              ? {
                  id: `${exam.id}_${selectedId}`,
                  studentId: selectedId,
                  examName: exam.get("name"),
                  subject: exam.get("subject"),
                  marks: mark.get("marks"),
                  maxMarks: exam.get("maxMarks"),
                  status: "published",
                }
              : null;
          }),
        )
      ).filter(Boolean) as Record<string, unknown>[])
    : [];
  const examinations = classScoped(upcomingExams.docs.map(row));
  const leaveRequests = selectedId
    ? (await root.collection("studentLeaveRequests").where("studentId", "==", selectedId).limit(50).get()).docs.map(row)
    : [];
  return NextResponse.json(
    {
      mode,
      students,
      selectedStudentId: selectedId,
      attendance,
      leaveRequests,
      results,
      examinations,
      invoices: scoped(invoices),
      payments: scoped(payments),
      reports: scoped(reports).filter(
        (item) => item.status === "published" || item.documentStatus === "published",
      ),
      assignments: classScoped(assignments),
      timetable: classScoped(timetable).filter((item) => item.status === "published"),
      events: classScoped(events),
      messages: scoped(messages),
      notifications: notifications.filter((item) => item.recipientUid === context.uid),
      announcements,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
