import { z } from "zod";

export const announcementSchema = z.object({
  action: z.literal("create"),
  title: z.string().trim().min(3).max(160),
  message: z.string().trim().min(5).max(5000),
  audience: z.enum(["school", "teachers", "parents", "students", "selected"]),
  targetRoles: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  targetGrades: z.array(z.string().trim().min(1).max(30)).max(30).default([]),
  targetClasses: z.array(z.string().trim().min(1).max(60)).max(60).default([]),
  targetUids: z.array(z.string().trim().min(1).max(160)).max(500).default([]),
  channels: z
    .array(z.enum(["in_app", "email", "sms", "whatsapp"]))
    .min(1)
    .max(4),
  scheduledAt: z.string().trim().max(40).optional().default(""),
  attachmentName: z.string().trim().max(160).optional().default(""),
});

export const communicationActionSchema = z.discriminatedUnion("action", [
  announcementSchema,
  z.object({
    action: z.literal("edit"),
    announcementId: z.string().trim().min(1).max(160),
    title: z.string().trim().min(3).max(160),
    message: z.string().trim().min(5).max(5000),
  }),
  z.object({
    action: z.enum(["publish", "archive", "mark_read"]),
    announcementId: z.string().trim().min(1).max(160),
  }),
]);
export type CommunicationInput = z.infer<typeof communicationActionSchema>;
