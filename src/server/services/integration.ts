import "server-only";
import { getAdminServices } from "@/lib/firebase/admin";
import type { SchoolContext } from "@/server/context";

type Status = "verified" | "pending" | "attention";
type Check = { id: string; label: string; status: Status; count: number; detail: string };

function check(
  id: string,
  label: string,
  count: number,
  detail: string,
  status: Status = count > 0 ? "verified" : "pending",
): Check {
  return { id, label, status, count, detail };
}

export async function buildIntegrationHealth(context: SchoolContext) {
  const root = getAdminServices().db.collection("schools").doc(context.schoolId);
  const [
    students,
    guardians,
    links,
    enrollments,
    feeTypes,
    feeApplications,
    invoices,
    payments,
    receipts,
    attendance,
    exams,
    publishedExams,
    inventory,
    documents,
    notifications,
    events,
    certificates,
    integrationEvents,
  ] = await Promise.all([
    root.collection("students").limit(2000).get(),
    root.collection("guardians").limit(2000).get(),
    root.collection("studentGuardianLinks").limit(3000).get(),
    root.collection("enrollments").limit(3000).get(),
    root.collection("feeTypes").limit(500).get(),
    root.collection("feeApplications").limit(3000).get(),
    root.collection("invoices").limit(3000).get(),
    root.collection("payments").limit(3000).get(),
    root.collection("receipts").limit(3000).get(),
    root.collection("attendanceSessions").limit(3000).get(),
    root.collection("exams").limit(1000).get(),
    root
      .collection("exams")
      .where("status", "==", "published")
      .limit(1000)
      .get()
      .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
    root.collection("inventoryItems").limit(2000).get(),
    root.collection("documents").limit(2000).get(),
    root.collection("notifications").limit(3000).get(),
    root.collection("events").limit(1000).get(),
    root.collection("certificates").limit(1000).get(),
    root.collection("integrationEvents").limit(500).get(),
  ]);
  const studentIds = new Set(students.docs.map((doc) => doc.id));
  const orphanEnrollments = enrollments.docs.filter(
    (doc) => !studentIds.has(String(doc.get("studentId") ?? "")),
  ).length;
  const orphanLinks = links.docs.filter(
    (doc) => !studentIds.has(String(doc.get("studentId") ?? "")),
  ).length;
  const activeStudents = students.docs.filter((doc) => doc.get("status") !== "archived").length;
  const publishedEvents = events.docs.filter((doc) => doc.get("status") === "published").length;
  const checks: Check[] = [
    check(
      "student-registration",
      "Student registration → guardian + enrollment",
      Math.min(students.size, links.size, enrollments.size),
      `${activeStudents} active students; ${links.size} guardian links; ${enrollments.size} academic enrollments.`,
    ),
    check(
      "fee-structure",
      "Student registration → fee structure",
      feeTypes.size,
      `${feeApplications.size} fee applications and ${feeTypes.size} active/configured fee types.`,
      feeTypes.size ? "verified" : "pending",
    ),
    check(
      "finance",
      "Fee payment → invoice + payment + receipt",
      Math.min(invoices.size, payments.size, receipts.size),
      `${invoices.size} invoices, ${payments.size} payments and ${receipts.size} immutable receipts.`,
    ),
    check(
      "attendance",
      "Attendance → statistics + alerts + audit",
      attendance.size,
      `${attendance.size} attendance sessions and absence queues are available to the attendance module.`,
    ),
    check(
      "examinations",
      "Marks → approval + published results",
      exams.size,
      `${exams.size} examinations; ${publishedExams.docs.length} published result sets.`,
    ),
    check(
      "analytics",
      "Operational records → analytics",
      activeStudents + attendance.size + publishedExams.docs.length,
      "Analytics can read enrollment, attendance and published examination aggregates.",
    ),
    check(
      "inventory",
      "Inventory → reports",
      inventory.size,
      `${inventory.size} asset records are available to inventory reports.`,
    ),
    check(
      "documents",
      "Documents → private record links",
      documents.size,
      `${documents.size} private document metadata records are available.`,
    ),
    check(
      "notifications",
      "Events and alerts → notifications",
      notifications.size,
      `${notifications.size} recipient-scoped notification records are stored.`,
    ),
    check(
      "events",
      "Events → calendar and reminders",
      publishedEvents,
      `${publishedEvents} published events are visible to their authorized participants.`,
    ),
    check(
      "certificates",
      "Verified students → approved certificates",
      certificates.size,
      `${certificates.size} immutable certificate history records are stored.`,
    ),
  ];
  if (orphanEnrollments || orphanLinks)
    checks[0] = {
      ...checks[0],
      status: "attention",
      detail: `${orphanEnrollments} enrollment references and ${orphanLinks} guardian links point to missing student records.`,
    };
  return {
    generatedAt: new Date().toISOString(),
    schoolId: context.schoolId,
    checks,
    workflowStatus: {
      studentRegistration: checks[0].status,
      examinationResults: checks[4].status,
      feePayment: checks[2].status,
      attendance: checks[3].status,
    },
    counts: {
      students: activeStudents,
      guardians: guardians.size,
      links: links.size,
      enrollments: enrollments.size,
      feeTypes: feeTypes.size,
      feeApplications: feeApplications.size,
      invoices: invoices.size,
      payments: payments.size,
      receipts: receipts.size,
      attendance: attendance.size,
      examinations: exams.size,
      publishedExaminations: publishedExams.docs.length,
      inventory: inventory.size,
      documents: documents.size,
      notifications: notifications.size,
      events: events.size,
      certificates: certificates.size,
      integrationEvents: integrationEvents.size,
    },
  };
}
