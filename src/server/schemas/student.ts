import { z } from "zod";

export const studentCreateSchema = z.object({
  admissionNumber: z
    .string()
    .trim()
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/)
    .optional()
    .or(z.literal("")),
  fullName: z.string().trim().min(2).max(120),
  nameWithInitials: z.string().trim().max(120).optional().default(""),
  preferredName: z.string().trim().max(80).optional().default(""),
  dateOfBirth: z.string().date(),
  gender: z.enum(["female", "male", "other", "undisclosed"]),
  nationality: z.string().trim().max(80).optional().default(""),
  address: z.string().trim().max(500).optional().default(""),
  grade: z.string().trim().min(1).max(20),
  className: z.string().trim().min(1).max(40),
  admissionDate: z.string().date(),
  admissionCategory: z.string().trim().max(60).optional().default("regular"),
  previousSchool: z.string().trim().max(160).optional().default(""),
  studentEmail: z.email().max(254).or(z.literal("")).optional().default(""),
  guardianName: z.string().trim().min(2).max(120),
  guardianEmail: z.email().max(254),
  guardianPhone: z.string().trim().min(7).max(24),
  emergencyName: z.string().trim().max(120).optional().default(""),
  emergencyPhone: z.string().trim().max(24).optional().default(""),
  emergencyRelationship: z.string().trim().max(60).optional().default(""),
  photoPath: z.string().trim().max(500).optional().default(""),
  workflowState: z.enum(["submitted", "waiting_list"]).optional().default("submitted"),
});

export type StudentCreateInput = z.infer<typeof studentCreateSchema>;
