import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const settingsSchema = z.object({
  general: z.object({
    name: z.string().trim().min(2).max(120),
    logoUrl: z.string().trim().max(800),
    phone: z.string().trim().max(40),
    email: z.email().max(254).or(z.literal("")),
    timezone: z.string().trim().max(80),
    preferredLanguage: z.enum(["en", "si", "ta"]),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase()),
    dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]),
    academicYearId: z.string().trim().max(160),
  }),
  academic: z.object({
    examinationTypes: z.array(z.string().trim().min(1).max(80)).max(30),
    gradingSystem: z.string().trim().max(120),
    attendanceRule: z.string().trim().max(500),
    attendanceLowThreshold: z.number().min(0).max(100),
    activeTermId: z.string().trim().max(160),
  }),
  security: z.object({
    passwordMinLength: z.number().int().min(8).max(64),
    sessionDurationDays: z.number().int().min(1).max(90),
    accountActivation: z.enum(["admin_only", "email_verification", "manual_review"]),
    loginRestriction: z.enum(["none", "school_domain", "approved_devices"]),
    auditLogAccess: z.enum(["leadership", "school_admin_only"]),
  }),
  notifications: z.object({
    emailEnabled: z.boolean(),
    emailProvider: z.enum(["none", "resend"]),
    emailFrom: z.email().max(254).or(z.literal("")),
    smsEnabled: z.boolean(),
    smsProvider: z.enum(["none", "twilio"]),
    smsFrom: z.string().trim().max(40),
    whatsappEnabled: z.boolean(),
    templates: z
      .record(z.string().max(80), z.string().max(1000))
      .refine((value) => Object.keys(value).length <= 30),
    defaultPreference: z.enum(["in_app", "email", "all_configured"]),
  }),
  ai: z.object({ enabled: z.boolean(), allowModelExplanation: z.boolean() }),
});

function denied(message = "System settings access is restricted.") {
  return NextResponse.json({ error: message }, { status: 403 });
}
function rootFor(schoolId: string) {
  return getAdminServices().db.collection("schools").doc(schoolId);
}

export async function GET() {
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "settings.manage")) return denied();
  try {
    const root = rootFor(context.schoolId);
    const [school, system, academicYears, terms, grades, classes, subjects] = await Promise.all([
      root.get(),
      root.collection("settings").doc("system").get(),
      root.collection("academicYears").limit(100).get(),
      root.collection("terms").limit(100).get(),
      root.collection("grades").limit(100).get(),
      root.collection("classes").limit(200).get(),
      root.collection("subjects").limit(200).get(),
    ]);
    const schoolData = school.data() ?? {};
    const config = system.data() ?? {};
    return NextResponse.json(
      {
        general: {
          name: schoolData.name ?? "",
          logoUrl: schoolData.logoUrl ?? "",
          phone: schoolData.phone ?? "",
          email: schoolData.email ?? "",
          timezone: config.general?.timezone ?? schoolData.timezone ?? "Asia/Colombo",
          preferredLanguage:
            config.general?.preferredLanguage ?? schoolData.preferredLanguage ?? "en",
          currency: schoolData.currency ?? config.general?.currency ?? "LKR",
          dateFormat: config.general?.dateFormat ?? "DD/MM/YYYY",
          academicYearId: config.general?.academicYearId ?? "",
        },
        academic: {
          examinationTypes: config.academic?.examinationTypes ?? [
            "Term test",
            "Mid-year",
            "Final examination",
          ],
          gradingSystem: config.academic?.gradingSystem ?? "School default",
          attendanceRule:
            config.academic?.attendanceRule ??
            "Present and late count toward attendance; excused is excluded.",
          attendanceLowThreshold: Number(config.academic?.attendanceLowThreshold ?? 80),
          activeTermId: config.academic?.activeTermId ?? "",
        },
        security: {
          passwordMinLength: Number(config.security?.passwordMinLength ?? 8),
          sessionDurationDays: Number(config.security?.sessionDurationDays ?? 5),
          accountActivation: config.security?.accountActivation ?? "email_verification",
          loginRestriction: config.security?.loginRestriction ?? "none",
          auditLogAccess: config.security?.auditLogAccess ?? "leadership",
        },
        notifications: {
          emailEnabled: config.notifications?.emailEnabled === true,
          emailProvider: config.notifications?.emailProvider ?? "none",
          emailFrom: config.notifications?.emailFrom ?? "",
          smsEnabled: config.notifications?.smsEnabled === true,
          smsProvider: config.notifications?.smsProvider ?? "none",
          smsFrom: config.notifications?.smsFrom ?? "",
          whatsappEnabled: config.notifications?.whatsappEnabled === true,
          templates: config.notifications?.templates ?? {},
          defaultPreference: config.notifications?.defaultPreference ?? "in_app",
        },
        ai: {
          enabled: config.ai?.enabled === true,
          allowModelExplanation: config.ai?.allowModelExplanation === true,
        },
        options: {
          academicYears: academicYears.docs.map((doc) => ({
            id: doc.id,
            name: doc.get("name"),
            status: doc.get("status"),
          })),
          terms: terms.docs.map((doc) => ({
            id: doc.id,
            name: doc.get("name"),
            status: doc.get("status"),
          })),
          grades: grades.docs.map((doc) => ({ id: doc.id, name: doc.get("name") })),
          classes: classes.docs.map((doc) => ({
            id: doc.id,
            name: doc.get("name"),
            grade: doc.get("grade"),
          })),
          subjects: subjects.docs.map((doc) => ({
            id: doc.id,
            name: doc.get("name"),
            grade: doc.get("grade"),
          })),
        },
        providerState: {
          email:
            config.notifications?.emailProvider !== "resend"
              ? "not_configured"
              : Boolean(process.env.EMAIL_PROVIDER_API_KEY && config.notifications?.emailFrom)
                ? "ready"
                : "credentials_required",
          sms:
            config.notifications?.smsProvider !== "twilio"
              ? "not_configured"
              : Boolean(
                    process.env.SMS_PROVIDER_API_KEY &&
                    process.env.SMS_TWILIO_ACCOUNT_SID &&
                    config.notifications?.smsFrom,
                  )
                ? "ready"
                : "gateway_credentials_required",
          whatsapp: "not_available",
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "System settings could not be loaded." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "settings.manage")) return denied();
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Please review the settings values.", fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  try {
    const root = rootFor(context.schoolId);
    const now = new Date();
    await root.set(
      {
        name: parsed.data.general.name,
        logoUrl: parsed.data.general.logoUrl,
        phone: parsed.data.general.phone,
        email: parsed.data.general.email,
        timezone: parsed.data.general.timezone,
        preferredLanguage: parsed.data.general.preferredLanguage,
        currency: parsed.data.general.currency,
        updatedAt: now,
        updatedBy: context.uid,
      },
      { merge: true },
    );
    await root
      .collection("settings")
      .doc("system")
      .set(
        {
          ...parsed.data,
          updatedAt: now,
          updatedBy: context.uid,
          providerCredentials:
            "Managed outside browser settings; no secret is accepted by this endpoint.",
        },
        { merge: true },
      );
    await root.collection("auditLogs").add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: "system.settings.updated",
      recordType: "settings",
      recordId: "system",
      changedGroups: Object.keys(parsed.data),
      occurredAt: now,
    });
    return NextResponse.json({
      ok: true,
      savedAt: now.toISOString(),
      aiEnabled: parsed.data.ai.enabled,
    });
  } catch {
    return NextResponse.json({ error: "System settings could not be saved." }, { status: 500 });
  }
}
