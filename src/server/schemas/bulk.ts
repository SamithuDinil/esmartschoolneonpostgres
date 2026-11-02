import { z } from "zod";

export const bulkOperation = z.enum(["students_import", "marks_import", "payments_import"]);
export const bulkPreviewSchema = z.object({
  action: z.literal("preview"),
  operation: bulkOperation,
  columns: z.array(z.string().trim().min(1).max(80)).min(1).max(60),
  records: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
  maxMarks: z.number().positive().max(100000).optional(),
});
export const bulkConfirmSchema = z.object({
  action: z.literal("confirm"),
  previewId: z.string().trim().min(1).max(160),
});
export const recurringInvoiceSchema = z.object({
  action: z.literal("recurring_invoices"),
  studentIds: z.array(z.string().trim().min(1)).min(1).max(1000),
  chargeType: z.string().trim().min(1).max(40),
  amount: z.number().positive().max(100000000),
  dueDate: z.string().trim().min(8).max(30),
  description: z.string().trim().max(240).default(""),
});
export const feeReminderSchema = z.object({
  action: z.literal("fee_reminders"),
  invoiceIds: z.array(z.string().trim().min(1)).min(1).max(1000),
  channel: z.enum(["in_app", "email", "sms"]).default("in_app"),
});
export const classUpdateSchema = z.object({
  action: z.literal("class_update"),
  studentIds: z.array(z.string().trim().min(1)).min(1).max(1000),
  grade: z.string().trim().min(1).max(40),
  className: z.string().trim().min(1).max(80),
});
export const resultGenerationSchema = z.object({
  action: z.literal("generate_results"),
  examId: z.string().trim().min(1).max(160),
});
export const bulkActionSchema = z.discriminatedUnion("action", [
  bulkPreviewSchema,
  bulkConfirmSchema,
  recurringInvoiceSchema,
  feeReminderSchema,
  classUpdateSchema,
  resultGenerationSchema,
]);
export type BulkAction = z.infer<typeof bulkActionSchema>;
