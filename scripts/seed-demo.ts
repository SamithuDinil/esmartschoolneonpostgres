import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, createRtdbFirestoreCompat, RtdbDocumentReference } from "../src/lib/firebase/rtdb-firestore-compat";
import { getPostgresPool } from "../src/lib/postgres";
import { permissionsForRole } from "../src/server/permissions";

const serviceAccountRaw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON;
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const adminUid = process.env.DEMO_ADMIN_UID;
if (!serviceAccountRaw || !projectId || !adminUid) {
  throw new Error("Set Firebase Admin credentials, Firebase project ID, and DEMO_ADMIN_UID before running the demo seed.");
}
const serviceAccount = JSON.parse(serviceAccountRaw) as { project_id?: string; client_email?: string; private_key?: string };
if (serviceAccount.project_id !== projectId || !serviceAccount.client_email || !serviceAccount.private_key) {
  throw new Error("Firebase Admin service-account configuration does not match the selected project.");
}
const app = getApps()[0] ?? initializeApp({
  credential: cert(serviceAccount as Parameters<typeof cert>[0]),
  projectId,
});
const db = createRtdbFirestoreCompat(getPostgresPool());
const schoolId = "edusphere-fictional-demo-school";
const school = db.collection("schools").doc(schoolId);
const stamp = FieldValue.serverTimestamp();

async function merge(ref: RtdbDocumentReference, data: Record<string, unknown>) {
  await ref.set(data, { merge: true });
}

async function main(adminUid: string) {
  await merge(school, {
    id: schoolId,
    name: "Silverleaf Demonstration School",
    shortName: "Silverleaf Demo",
    country: "LK",
    currency: "LKR",
    timeZone: "Asia/Colombo",
    isDemo: true,
    demoNotice: "Fictional demonstration records; not real student information.",
    updatedAt: stamp,
  });
  await merge(school.collection("settings").doc("general"), { language: "en", currency: "LKR", timeZone: "Asia/Colombo", updatedAt: stamp });
  await merge(school.collection("memberships").doc(adminUid), {
    uid: adminUid,
    role: "school_admin",
    status: "active",
    permissions: [...permissionsForRole("school_admin")],
    updatedAt: stamp,
  });
  await merge(db.collection("users").doc(adminUid), { activeSchoolId: schoolId, displayName: "Demo School Administrator", updatedAt: stamp });

  const academicYear = school.collection("academicYears").doc("2026");
  await merge(academicYear, { name: "2026 (Demo)", startDate: "2026-01-01", endDate: "2026-12-31", status: "active", updatedAt: stamp });
  await merge(school.collection("classes").doc("grade-6-a"), { name: "A", section: "A", grade: "Grade 6", capacity: 30, academicYearId: academicYear.id, status: "active", isDemo: true });
  for (const [id, code, name] of [["mathematics","MATH","Mathematics"],["english","ENG","English"],["science","SCI","Science"]]) {
    await merge(school.collection("subjects").doc(id), { code, name, grade: "Grade 6", isDemo: true });
  }
  const students = [
    { id: "demo-student-001", fullName: "Nimali Perera", admissionNumber: "DEMO-2026-0001" },
    { id: "demo-student-002", fullName: "Kasun Fernando", admissionNumber: "DEMO-2026-0002" },
    { id: "demo-student-003", fullName: "Ayesha Jayawardena", admissionNumber: "DEMO-2026-0003" },
  ];
  for (const student of students) {
    await merge(school.collection("students").doc(student.id), { ...student, grade: "Grade 6", className: "A", dateOfBirth: "2014-06-15", gender: "undisclosed", admissionDate: "2026-01-12", status: "active", schoolId, isDemo: true, createdAt: stamp, updatedAt: stamp });
  }
  await merge(school.collection("teachers").doc("demo-teacher-001"), { fullName: "Ruwan Senanayake", employeeId: "DEMO-T-001", subjects: ["Mathematics"], isDemo: true });
  await merge(school.collection("exams").doc("demo-term-1"), { name: "Term 1 Assessment (Demo)", academicYearId: academicYear.id, term: "Term 1", grade: "Grade 6", className: "A", subject: "Mathematics", examinationDate: "2026-06-15", maxMarks: 100, minimumPassingMarks: 40, status: "published", isDemo: true });
  await merge(school.collection("exams").doc("demo-term-1").collection("marks").doc("demo-student-001"), { studentId: "demo-student-001", marks: 86, maxMarks: 100, grade: "A", status: "published", isDemo: true });
  await merge(school.collection("auditLogs").doc("demo-seed-initialized"), { schoolId, actorUid: adminUid, action: "demo.seed.initialized", recordType: "school", recordId: schoolId, isDemo: true, occurredAt: stamp });
  console.log("Fictional Silverleaf Demonstration School seed merged successfully.");
}

main(adminUid).catch((error) => {
  console.error(error);
  process.exit(1);
});
