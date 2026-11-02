import "server-only";
import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { getAdminServices } from "@/lib/firebase/admin";
import { ROLE_PERMISSIONS, permissionsForRole } from "@/server/permissions";
import type { SchoolCreateInput } from "@/server/schemas/school";

function academicDates(label: string) {
  const [startYear, endYear = startYear] = label.split("-").map(Number);
  return { startDate: `${startYear}-01-01`, endDate: `${endYear}-12-31` };
}

export async function createSchoolForUser(
  uid: string,
  displayName: string,
  input: SchoolCreateInput,
  email = "",
) {
  const { db } = getAdminServices();
  const userRef = db.collection("users").doc(uid);
  const schoolRef = db.collection("schools").doc();
  const membershipRef = schoolRef.collection("memberships").doc(uid);
  const auditRef = schoolRef.collection("auditLogs").doc();
  const yearId = input.academicYear.replace("-", "_");
  const yearRef = schoolRef.collection("academicYears").doc(yearId);
  const code = input.schoolCode.toUpperCase();
  const dates = academicDates(input.academicYear);

  return db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    const duplicateCodes = await transaction.get(
      db.collection("schools").where("schoolCodeNormalized", "==", code).limit(1),
    );
    if (duplicateCodes.docs.length) throw new Error("SCHOOL_CODE_TAKEN");
    if (userSnap.data()?.activeSchoolId) throw new Error("USER_ALREADY_HAS_SCHOOL");

    const createdAt = FieldValue.serverTimestamp();
    transaction.create(schoolRef, {
      id: schoolRef.id,
      name: input.name,
      shortName: input.shortName || input.name,
      schoolCode: input.schoolCode.toUpperCase(),
      schoolCodeNormalized: code,
      schoolType: input.schoolType,
      email: input.email,
      phone: input.phone,
      address: input.address,
      district: input.district,
      province: input.province,
      country: input.country,
      logoUrl: input.logoUrl || "",
      description: input.description,
      currency: input.currency,
      timeZone: input.timeZone,
      status: "active",
      ownerUid: uid,
      createdBy: uid,
      createdAt,
      updatedAt: createdAt,
    });
    transaction.create(membershipRef, {
      uid,
      email,
      displayName,
      role: "school_owner",
      status: "active",
      permissions: [...permissionsForRole("school_owner")],
      isOwner: true,
      createdAt,
      updatedAt: createdAt,
    });
    transaction.create(yearRef, {
      name: input.academicYear,
      ...dates,
      status: "active",
      createdAt,
      createdBy: uid,
      isCurrent: true,
    });
    transaction.set(schoolRef.collection("settings").doc("general"), {
      name: input.name,
      logoUrl: input.logoUrl || "",
      email: input.email,
      phone: input.phone,
      address: input.address,
      district: input.district,
      province: input.province,
      country: input.country,
      schoolType: input.schoolType,
      description: input.description,
      language: "en",
      currency: input.currency,
      timeZone: input.timeZone,
      academicYearId: yearId,
      updatedAt: createdAt,
    });
    transaction.set(schoolRef.collection("settings").doc("system"), {
      general: {
        name: input.name,
        logoUrl: input.logoUrl || "",
        phone: input.phone,
        email: input.email,
        timezone: input.timeZone,
        preferredLanguage: "en",
        currency: input.currency,
        dateFormat: "DD/MM/YYYY",
        academicYearId: yearId,
      },
      academic: {
        examinationTypes: ["Term test", "Mid-year", "Final examination"],
        gradingSystem: "School default",
        attendanceRule: "Present and late count toward attendance; excused is excluded.",
        attendanceLowThreshold: 80,
        activeTermId: "",
      },
      security: {
        passwordMinLength: 8,
        sessionDurationDays: 5,
        accountActivation: "email_verification",
        loginRestriction: "none",
        auditLogAccess: "school_admin_only",
      },
      notifications: {
        emailEnabled: false,
        smsEnabled: false,
        whatsappEnabled: false,
        templates: {},
        defaultPreference: "in_app",
      },
      ai: { enabled: false, allowModelExplanation: false },
      updatedAt: createdAt,
    });
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      if (role === "super_admin") continue;
      transaction.set(schoolRef.collection("roleDefinitions").doc(role), {
        role,
        permissions: [...permissions],
        isDefault: true,
        createdAt,
      });
    }
    transaction.set(
      userRef,
      { displayName, email, activeSchoolId: schoolRef.id, updatedAt: createdAt },
      { merge: true },
    );
    transaction.create(auditRef, {
      schoolId: schoolRef.id,
      actorUid: uid,
      action: "school.created",
      recordType: "school",
      recordId: schoolRef.id,
      changeSummary: "School owner workspace provisioned",
      occurredAt: new Date(),
    });
    return { schoolId: schoolRef.id, schoolName: input.name };
  });
}
