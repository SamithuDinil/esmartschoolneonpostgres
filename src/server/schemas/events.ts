import { z } from "zod";

export const eventCategories = [
  "examination",
  "school_holiday",
  "parent_meeting",
  "sports_meet",
  "educational_trip",
  "cultural_event",
  "club_activity",
  "school_ceremony",
] as const;
const participants = z.enum(["school", "teachers", "parents", "students", "selected"]);

export const eventCreateSchema = z.object({
  action: z.literal("create"),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).default(""),
  category: z.enum(eventCategories),
  participants,
  targetRoles: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  targetUids: z.array(z.string().trim().min(1).max(160)).max(500).default([]),
  startAt: z.string().trim().min(8).max(40),
  endAt: z.string().trim().min(8).max(40),
  location: z.string().trim().max(240).default(""),
  reminderMinutes: z.array(z.number().int().min(0).max(10080)).max(5).default([]),
});

export const eventChangeSchema = z.object({
  action: z.enum(["edit", "publish", "cancel", "delete"]),
  eventId: z.string().trim().min(1).max(160),
  title: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().max(4000).optional(),
  category: z.enum(eventCategories).optional(),
  participants: participants.optional(),
  targetRoles: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  targetUids: z.array(z.string().trim().min(1).max(160)).max(500).optional(),
  startAt: z.string().trim().min(8).max(40).optional(),
  endAt: z.string().trim().min(8).max(40).optional(),
  location: z.string().trim().max(240).optional(),
  reminderMinutes: z.array(z.number().int().min(0).max(10080)).max(5).optional(),
});

export const eventActionSchema = z.discriminatedUnion("action", [
  eventCreateSchema,
  eventChangeSchema,
]);
export type EventAction = z.infer<typeof eventActionSchema>;
