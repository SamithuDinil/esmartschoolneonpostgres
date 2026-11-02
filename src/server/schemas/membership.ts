import { z } from "zod";

export const memberRoleSchema = z.enum([
  "school_admin",
  "principal",
  "vice_principal",
  "section_head",
  "teacher",
  "class_teacher",
  "subject_teacher",
  "student",
  "parent",
  "accountant",
  "librarian",
  "transport_manager",
  "administrative_staff",
  "staff",
]);

export const schoolSwitchSchema = z.object({
  action: z.literal("switch"),
  schoolId: z.string().trim().min(1).max(128),
});

export const membershipCreateSchema = z.object({
  email: z.string().trim().email().max(254),
  displayName: z.string().trim().min(2).max(120),
  role: memberRoleSchema,
});

export const invitationCreateSchema = membershipCreateSchema;

export const invitationAcceptSchema = z.object({
  token: z.string().trim().min(32).max(256),
});

export const membershipUpdateSchema = z.object({
  uid: z.string().trim().min(1).max(128),
  role: memberRoleSchema.optional(),
  status: z.enum(["active", "suspended", "revoked"]).optional(),
  permissions: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
});

export const ownershipTransferSchema = z.object({
  targetUid: z.string().trim().min(1).max(128),
  confirmation: z.literal("TRANSFER_OWNERSHIP"),
  reauthenticatedIdToken: z.string().min(20).max(20_000),
});

export type MemberRole = z.infer<typeof memberRoleSchema>;
