import "server-only";
import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { getAdminServices } from "@/lib/firebase/admin";
import type { SchoolContext } from "@/server/context";
import type { StudentCreateInput } from "@/server/schemas/student";

export async function listStudents(
  context: SchoolContext,
  limit = 50,
  after?: string,
  search?: string,
) {
  const { db } = getAdminServices();
  const collection = db.collection("schools").doc(context.schoolId).collection("students");
  const pageSize = Math.min(100, Math.max(1, limit));
  if (search?.trim()) {
    const query = search.trim().toLowerCase();
    const snapshot = await collection.orderBy("createdAt", "desc").limit(1000).get();
    const filtered = snapshot.docs.filter((doc) =>
      [
        doc.id,
        doc.get("fullName"),
        doc.get("preferredName"),
        doc.get("admissionNumber"),
        doc.get("grade"),
        doc.get("className"),
        doc.get("guardianName"),
      ].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(query),
      ),
    );
    return {
      items: filtered.slice(0, pageSize).map((doc) => ({ id: doc.id, ...doc.data() })),
      total: filtered.length,
      nextCursor: null,
    };
  }
  let query = collection.orderBy("createdAt", "desc").limit(pageSize);
  if (after) {
    const cursor = await collection.doc(after).get();
    if (!cursor.exists) throw new Error("Invalid pagination cursor.");
    query = collection.orderBy("createdAt", "desc").startAfter(cursor).limit(pageSize);
  }
  const [page, total] = await Promise.all([query.get(), collection.count().get()]);
  return {
    items: page.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    total: total.data().count,
    nextCursor: page.docs.length === pageSize ? (page.docs.at(-1)?.id ?? null) : null,
  };
}

export type StudentCreationShared = {
  academicYears: FirebaseFirestore.QueryDocumentSnapshot[];
  feeTypes: FirebaseFirestore.QueryDocumentSnapshot[];
  guardianByEmail: Map<string, string>;
};

export async function loadStudentCreationShared(
  context: SchoolContext,
): Promise<StudentCreationShared> {
  const schoolRef = getAdminServices().db.collection("schools").doc(context.schoolId);
  const [years, fees] = await Promise.all([
    schoolRef.collection("academicYears").limit(100).get(),
    schoolRef
      .collection("feeTypes")
      .limit(100)
      .get()
      .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
  ]);
  return { academicYears: years.docs, feeTypes: fees.docs, guardianByEmail: new Map() };
}

export async function createStudent(
  context: SchoolContext,
  input: StudentCreateInput,
  shared?: StudentCreationShared,
) {
  const { db } = getAdminServices();
  const schoolRef = db.collection("schools").doc(context.schoolId);
  const guardianKey = input.guardianEmail.trim().toLowerCase();
  const reusedGuardianId = shared?.guardianByEmail.get(guardianKey);
  const guardianRef = reusedGuardianId
    ? schoolRef.collection("guardians").doc(reusedGuardianId)
    : schoolRef.collection("guardians").doc();
  const year = Number(input.admissionDate.slice(0, 4));
  const configuredYears = shared
    ? { docs: shared.academicYears }
    : await schoolRef.collection("academicYears").limit(100).get();
  const matchingYear = configuredYears.docs.find((doc) => {
    const start = doc.get("startDate");
    const end = doc.get("endDate");
    return (
      typeof start === "string" &&
      typeof end === "string" &&
      input.admissionDate >= start &&
      input.admissionDate <= end
    );
  });
  const activeYear = configuredYears.docs.find((doc) => doc.get("status") === "active");
  const academicYearDoc = matchingYear ?? activeYear;
  if (matchingYear?.get("status") === "closed") throw new Error("ACADEMIC_YEAR_CLOSED");
  const academicYearId = academicYearDoc?.id ?? null;
  const feeTypes = shared
    ? { docs: shared.feeTypes }
    : await schoolRef
        .collection("feeTypes")
        .limit(100)
        .get()
        .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }));
  const activeFeeTypes = feeTypes.docs.filter((doc) => doc.get("active") !== false);
  const counterRef = schoolRef.collection("counters").doc(`admission_${year}`);

  const result = await db.runTransaction(async (transaction) => {
    const duplicateQuery = schoolRef
      .collection("students")
      .where("normalizedName", "==", input.fullName.toLowerCase().replace(/\s+/g, " "))
      .where("dateOfBirth", "==", input.dateOfBirth)
      .limit(5);
    const possibleDuplicates = await transaction.get(duplicateQuery);
    if (!possibleDuplicates.empty) throw new Error("POTENTIAL_DUPLICATE");
    const suppliedAdmissionNumber = input.admissionNumber?.trim().toUpperCase() ?? "";
    let sequence: number | null = null;
    let admissionNumber = suppliedAdmissionNumber;
    let studentRef: FirebaseFirestore.DocumentReference;
    if (suppliedAdmissionNumber) {
      studentRef = schoolRef.collection("students").doc(admissionNumber);
      const [existingKey, existingAdmission] = await Promise.all([
        transaction.get(studentRef),
        transaction.get(
          schoolRef.collection("students").where("admissionNumber", "==", admissionNumber).limit(1),
        ),
      ]);
      if (existingKey.exists || !existingAdmission.empty) throw new Error("ADMISSION_ID_EXISTS");
    } else {
      const counter = await transaction.get(counterRef);
      sequence = Number(counter.data()?.value ?? 0) + 1;
      const collection = schoolRef.collection("students");
      while (true) {
        admissionNumber = `ES-${year}-${String(sequence).padStart(5, "0")}`;
        studentRef = collection.doc(admissionNumber);
        const [existingKey, existingAdmission] = await Promise.all([
          transaction.get(studentRef),
          transaction.get(collection.where("admissionNumber", "==", admissionNumber).limit(1)),
        ]);
        if (!existingKey.exists && existingAdmission.empty) break;
        sequence += 1;
      }
      transaction.set(
        counterRef,
        { value: sequence, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    }
    const linkRef = schoolRef
      .collection("studentGuardianLinks")
      .doc(`${studentRef.id}_${guardianRef.id}`);
    transaction.create(studentRef, {
      ...input,
      normalizedName: input.fullName.toLowerCase().replace(/\s+/g, " "),
      admissionNumber,
      academicYearId,
      academicYear: year,
      status: input.workflowState === "waiting_list" ? "waiting_list" : "pending_review",
      workflowState: input.workflowState,
      schoolId: context.schoolId,
      guardianIds: [guardianRef.id],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: context.uid,
    });
    if (!reusedGuardianId)
      transaction.create(guardianRef, {
        schoolId: context.schoolId,
        fullName: input.guardianName,
        email: input.guardianEmail,
        phone: input.guardianPhone,
        emergencyName: input.emergencyName,
        emergencyPhone: input.emergencyPhone,
        emergencyRelationship: input.emergencyRelationship,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: context.uid,
      });
    transaction.create(linkRef, {
      schoolId: context.schoolId,
      studentId: studentRef.id,
      guardianId: guardianRef.id,
      guardianUid: null,
      relationship: "guardian",
      createdAt: FieldValue.serverTimestamp(),
    });
    const enrollmentRef = schoolRef.collection("enrollments").doc(`${studentRef.id}_${year}`);
    transaction.create(enrollmentRef, {
      schoolId: context.schoolId,
      studentId: studentRef.id,
      academicYear: year,
      academicYearId,
      grade: input.grade,
      className: input.className,
      startDate: input.admissionDate,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
    });
    const auditRef = schoolRef.collection("auditLogs").doc();
    transaction.create(auditRef, {
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: "student.created",
      recordType: "student",
      recordId: studentRef.id,
      occurredAt: FieldValue.serverTimestamp(),
    });
    const historyRef = schoolRef.collection("admissionHistory").doc();
    transaction.create(historyRef, {
      schoolId: context.schoolId,
      studentId: studentRef.id,
      admissionNumber,
      action: "application.submitted",
      actorUid: context.uid,
      occurredAt: FieldValue.serverTimestamp(),
    });
    const accessRef = schoolRef.collection("accessProvisioning").doc(studentRef.id);
    transaction.set(
      accessRef,
      {
        schoolId: context.schoolId,
        studentId: studentRef.id,
        status: "pending_account_link",
        reason:
          "Student registration creates a pending access record until an authorized account is linked.",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    for (const feeType of activeFeeTypes) {
      const applicationRef = schoolRef
        .collection("feeApplications")
        .doc(`${studentRef.id}_${feeType.id}_${year}`);
      transaction.set(
        applicationRef,
        {
          schoolId: context.schoolId,
          studentId: studentRef.id,
          feeTypeId: feeType.id,
          academicYearId,
          academicYear: year,
          status: "pending_invoice",
          source: "student_registration",
          createdAt: FieldValue.serverTimestamp(),
          createdBy: context.uid,
        },
        { merge: true },
      );
    }
    const integrationRef = schoolRef
      .collection("integrationEvents")
      .doc(`student-registration-${studentRef.id}`);
    transaction.create(integrationRef, {
      schoolId: context.schoolId,
      eventType: "student_registered",
      recordId: studentRef.id,
      admissionNumber,
      linkedGuardianId: guardianRef.id,
      academicEnrollmentId: enrollmentRef.id,
      feeApplications: activeFeeTypes.length,
      accessProvisioning: "pending_account_link",
      occurredAt: FieldValue.serverTimestamp(),
      actorUid: context.uid,
    });
    return { id: studentRef.id, admissionNumber };
  });
  if (shared && !reusedGuardianId) shared.guardianByEmail.set(guardianKey, guardianRef.id);
  return result;
}
