import { z } from "zod";
export const backupConfigSchema = z.object({
  enabled: z.boolean(),
  scheduleCron: z.string().trim().min(1).max(80),
  retentionDays: z.number().int().min(1).max(3650),
  scheduleTaskUid: z.string().trim().max(200).optional(),
});
export const backupActionSchema = z.object({
  action: z.enum(["request_backup", "restore_test", "resolve_failure"]),
  runId: z.string().trim().max(160).optional(),
  reason: z.string().trim().max(500).optional(),
});
