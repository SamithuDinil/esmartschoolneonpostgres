import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { promotionActionSchema } from "@/server/schemas/promotion";

export const dynamic = "force-dynamic";
function rootFor(schoolId: string) {
  return getAdminServices().db.collection("schools").doc(schoolId);
}
function serialize(data: FirebaseFirestore.DocumentData) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function"
        ? value.toDate().toISOString()
        : value instanceof Date
          ? value.toISOString()
          : value,
    ]),
  );
}
async function capacityFor(
  root: FirebaseFirestore.DocumentReference,
  grade: string,
  className: string,
) {
  const capacityDoc = await root
    .collection("classes")
    .doc(`${grade}_${className}`.replace(/[^a-zA-Z0-9_-]/g, "_"))
    .get()
    .catch(() => null);
  const configured = capacityDoc?.get("capacity");
  return Number.isFinite(Number(configured)) && Number(configured) > 0 ? Number(configured) : 40;
}

export async function GET() {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(context.permissions, "promotion.manage"))
    return NextResponse.json(
      { error: "Promotion management permission required." },
      { status: 403 },
    );
  const root = rootFor(context.schoolId);
  const years = await root
    .collection("academicYears")
    .limit(20)
    .get()
    .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }));
  const students = await root
    .collection("students")
    .limit(1000)
    .get()
    .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }));
  const activeStudents = students.docs.filter((doc) => doc.get("status") !== "archived");
  return NextResponse.json({
    academicYears: years.docs.map((doc) => ({ id: doc.id, ...serialize(doc.data()) })),
    grades: [
      ...new Set(activeStudents.map((doc) => String(doc.get("grade") ?? "")).filter(Boolean)),
    ].sort(),
    classes: [
      ...new Set(activeStudents.map((doc) => String(doc.get("className") ?? "")).filter(Boolean)),
    ].sort(),
  });
}

export async function POST(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(context.permissions, "promotion.manage"))
    return NextResponse.json(
      { error: "Promotion management permission required." },
      { status: 403 },
    );
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const parsed = promotionActionSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "The promotion request is invalid.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  const action = parsed.data;
  const root = rootFor(context.schoolId);
  try {
    if (action.action === "preview") {
      const eligibleSnapshot = await root
        .collection("students")
        .where("grade", "==", action.grade)
        .where("className", "==", action.className)
        .limit(1000)
        .get();
      const eligible = eligibleSnapshot.docs
        .filter(
          (doc) =>
            !["archived", "graduated", "transferred"].includes(String(doc.get("status") ?? "")),
        )
        .map((doc) => ({
          id: doc.id,
          fullName: doc.get("fullName") ?? "",
          admissionNumber: doc.get("admissionNumber") ?? "",
          grade: doc.get("grade") ?? "",
          className: doc.get("className") ?? "",
          status: doc.get("status") ?? "active",
        }));
      const targetSnapshot = await root
        .collection("students")
        .where("grade", "==", action.destinationGrade)
        .where("className", "==", action.destinationClass)
        .limit(1000)
        .get();
      const currentTargetCount = targetSnapshot.docs.filter(
        (doc) => doc.get("status") !== "archived",
      ).length;
      const capacity = await capacityFor(root, action.destinationGrade, action.destinationClass);
      const sameClass =
        action.grade === action.destinationGrade && action.className === action.destinationClass;
      const remaining = Math.max(
        0,
        capacity -
          (sameClass ? Math.max(0, currentTargetCount - eligible.length) : currentTargetCount),
      );
      return NextResponse.json({
        eligible,
        count: eligible.length,
        capacity,
        currentTargetCount,
        remaining,
        canProceed:
          action.outcome === "graduation" ||
          action.outcome === "completion" ||
          remaining >= eligible.length,
      });
    }
    const destinationYear = action.destinationAcademicYearId ?? action.academicYearId;
    const selected = await Promise.all(
      action.studentIds.map((id) => root.collection("students").doc(id).get()),
    );
    const missing = selected.filter((student) => !student.exists).map((student) => student.id);
    if (missing.length)
      return NextResponse.json(
        { error: `Students not found: ${missing.join(", ")}` },
        { status: 404 },
      );
    if (["promote", "repeat"].includes(action.outcome)) {
      const destination = await root
        .collection("students")
        .where("grade", "==", action.destinationGrade)
        .where("className", "==", action.destinationClass)
        .limit(1000)
        .get();
      const existing = destination.docs.filter(
        (doc) => doc.get("status") !== "archived" && !action.studentIds.includes(doc.id),
      ).length;
      const capacity = await capacityFor(root, action.destinationGrade, action.destinationClass);
      if (existing + action.studentIds.length > capacity)
        return NextResponse.json(
          {
            error: `Destination class capacity is ${capacity}; ${existing} places are already occupied.`,
          },
          { status: 409 },
        );
    }
    const { db } = getAdminServices();
    for (let offset = 0; offset < selected.length; offset += 100) {
      const chunk = selected.slice(offset, offset + 100);
      await db.runTransaction(async (transaction) => {
        const oldEnrollments = new Map<string, FirebaseFirestore.DocumentSnapshot>();
        for (const student of chunk)
          oldEnrollments.set(
            student.id,
            await transaction.get(
              root.collection("enrollments").doc(`${student.id}_${action.academicYearId}`),
            ),
          );
        for (const student of chunk) {
          const studentRef = root.collection("students").doc(student.id);
          const oldEnrollmentRef = root
            .collection("enrollments")
            .doc(`${student.id}_${action.academicYearId}`);
          const oldEnrollment = oldEnrollments.get(student.id)!;
          const historyRef = root.collection("enrollmentHistory").doc();
          const studentPatch: Record<string, unknown> = {
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: context.uid,
            lastEnrollmentOutcome: action.outcome,
          };
          if (action.outcome === "graduation") studentPatch.status = "graduated";
          else if (action.outcome === "completion") studentPatch.status = "completed";
          else if (action.outcome === "transfer") studentPatch.status = "transferred";
          else {
            studentPatch.grade = action.destinationGrade;
            studentPatch.className = action.destinationClass;
            studentPatch.status = "active";
          }
          transaction.update(studentRef, studentPatch);
          if (oldEnrollment.exists)
            transaction.update(oldEnrollmentRef, {
              status: "completed",
              completionReason: action.outcome,
              completedAt: FieldValue.serverTimestamp(),
              updatedBy: context.uid,
            });
          transaction.create(historyRef, {
            schoolId: context.schoolId,
            studentId: student.id,
            fromAcademicYearId: action.academicYearId,
            toAcademicYearId: destinationYear,
            fromGrade: student.get("grade") ?? null,
            fromClassName: student.get("className") ?? null,
            toGrade: ["promote", "repeat"].includes(action.outcome)
              ? action.destinationGrade
              : null,
            toClassName: ["promote", "repeat"].includes(action.outcome)
              ? action.destinationClass
              : null,
            outcome: action.outcome,
            actorUid: context.uid,
            occurredAt: FieldValue.serverTimestamp(),
          });
          if (["promote", "repeat"].includes(action.outcome))
            transaction.create(
              root
                .collection("enrollments")
                .doc(
                  `${student.id}_${destinationYear}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                ),
              {
                schoolId: context.schoolId,
                studentId: student.id,
                academicYearId: destinationYear,
                grade: action.destinationGrade,
                className: action.destinationClass,
                status: "active",
                sourceEnrollmentId: oldEnrollment.exists ? oldEnrollment.id : null,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: context.uid,
              },
            );
        }
      });
    }
    await root.collection("auditLogs").add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: "students.promotion.completed",
      recordType: "promotion",
      recordId: `${action.academicYearId}_${Date.now()}`,
      studentIds: action.studentIds,
      outcome: action.outcome,
      occurredAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({
      ok: true,
      processed: action.studentIds.length,
      outcome: action.outcome,
      historyRetained: true,
    });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Promotion failed." },
      { status: 400 },
    );
  }
}
