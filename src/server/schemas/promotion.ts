import { z } from "zod";

export const promotionOutcome = z.enum([
  "promote",
  "repeat",
  "transfer",
  "graduation",
  "completion",
]);
export const promotionPreviewSchema = z.object({
  action: z.literal("preview"),
  academicYearId: z.string().trim().min(1).max(160),
  grade: z.string().trim().min(1).max(40),
  className: z.string().trim().min(1).max(80),
  destinationGrade: z.string().trim().min(1).max(40),
  destinationClass: z.string().trim().min(1).max(80),
  outcome: promotionOutcome.default("promote"),
});
export const promotionConfirmSchema = z.object({
  action: z.literal("confirm"),
  academicYearId: z.string().trim().min(1).max(160),
  destinationAcademicYearId: z.string().trim().min(1).max(160).optional(),
  studentIds: z.array(z.string().trim().min(1)).min(1).max(1000),
  destinationGrade: z.string().trim().min(1).max(40),
  destinationClass: z.string().trim().min(1).max(80),
  outcome: promotionOutcome,
});
export const promotionActionSchema = z.discriminatedUnion("action", [
  promotionPreviewSchema,
  promotionConfirmSchema,
]);
export type PromotionAction = z.infer<typeof promotionActionSchema>;
