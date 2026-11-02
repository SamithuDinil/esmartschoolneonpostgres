import { z } from "zod";

const status = z.enum(["open", "investigating", "resolved", "closed"]);
const category = z.enum([
  "behavior",
  "bullying",
  "safeguarding",
  "attendance",
  "property",
  "academic_integrity",
  "other",
]);

export const welfareIncidentSchema = z.object({
  action: z.literal("create"),
  studentId: z.string().trim().min(1).max(160),
  incidentDate: z.string().trim().min(8).max(30),
  category,
  summary: z.string().trim().min(3).max(500),
  staffNotes: z.string().trim().max(5000).default(""),
  investigationStatus: status.default("open"),
  followUpAction: z.string().trim().max(2000).default(""),
  resolution: z.string().trim().max(2000).default(""),
});

export const welfareUpdateSchema = z.object({
  action: z.literal("update"),
  incidentId: z.string().trim().min(1).max(160),
  investigationStatus: status.optional(),
  staffNotes: z.string().trim().max(5000).optional(),
  followUpAction: z.string().trim().max(2000).optional(),
  resolution: z.string().trim().max(2000).optional(),
});

export const welfareRecordSchema = z.discriminatedUnion("action", [
  welfareIncidentSchema,
  welfareUpdateSchema,
]);
export type WelfareRecord = z.infer<typeof welfareRecordSchema>;
