import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { getAdminServices } from "@/lib/firebase/admin";
import { ROLE_PERMISSIONS } from "@/server/permissions";
import type { SchoolCreateInput } from "@/server/schemas/school";

function schoolYearDates(label: string) {
  const [startYear, endYear = startYear] = label.split("-").map(Number);
  return { startDate: `${startYear}-01-01`, endDate: `${endYear}-12-31` };
}

export async function createSchoolBySystemOwner(
  ownerUid: string,
  input: SchoolCreateInput,
  principal: { name: string; email: string },
  origin: string,
) {
  const { db } = getAdminServices();
  const schoolRef = db.collection("schools").doc();
  const yearId = input.academicYear.replace("-", "_");
  const yearRef = schoolRef.collection("academicYears").doc(yearId);
  const createdAt = new Date();
  const code = input.schoolCode.trim().toUpperCase();
  const normalizedEmail = principal.email.trim().toLowerCase();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const invitationRef = schoolRef.collection("invitations").doc(tokenHash);
  const tokenRef = db.collection("invitationTokens").doc(tokenHash);
  const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const dates = schoolYearDates(input.academicYear);

  await db.runTransaction(async (transaction) => {
    const duplicates = await transaction.get(
      db.collection("schools").where("schoolCodeNormalized", "==", code).limit(1),
    );
    if (!duplicates.empty) throw new Error("SCHOOL_CODE_TAKEN");
    transaction.create(schoolRef, {
      id: schoolRef.id,
      name: input.name,
      shortName: input.shortName || input.name,
      slug: input.schoolCode.toLowerCase().replaceAll("_", "-"),
      schoolCode: code,
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
      status: "setup_pending",
      planId: "free",
      ownerUid: null,
      createdBy: ownerUid,
      createdAt,
      updatedAt: createdAt,
      subscriptionExpiresAt: null,
    });
    transaction.create(yearRef, {
      name: input.academicYear,
      ...dates,
      status: "active",
      createdAt,
      createdBy: ownerUid,
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
      if (role !== "super_admin")
        transaction.set(schoolRef.collection("roleDefinitions").doc(role), {
          role,
          permissions: [...permissions],
          isDefault: true,
          createdAt,
        });
    }
    transaction.create(invitationRef, {
      email: normalizedEmail,
      displayName: principal.name.trim(),
      role: "principal",
      status: "pending",
      invitedBy: ownerUid,
      createdAt,
      expiresAt,
      singleUse: true,
    });
    transaction.create(tokenRef, {
      schoolId: schoolRef.id,
      email: normalizedEmail,
      status: "pending",
      expiresAt,
      createdAt,
    });
    transaction.create(schoolRef.collection("auditLogs").doc(), {
      schoolId: schoolRef.id,
      actorUid: ownerUid,
      action: "school.created",
      recordType: "school",
      recordId: schoolRef.id,
      changeSummary: "System Owner registered school; principal acceptance and setup are pending",
      occurredAt: createdAt,
    });
    transaction.create(db.collection("platformAuditLogs").doc(), {
      actorUid: ownerUid,
      action: "school.created",
      schoolId: schoolRef.id,
      schoolCode: code,
      principalEmail: normalizedEmail,
      occurredAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    schoolId: schoolRef.id,
    schoolName: input.name,
    invitationUrl: `${origin}/invite?token=${encodeURIComponent(token)}`,
    invitationExpiresAt: expiresAt.toISOString(),
  };
}
