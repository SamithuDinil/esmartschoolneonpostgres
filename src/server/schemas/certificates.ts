import { z } from "zod";
export const certificateTypes = [
  "enrollment",
  "leaving",
  "character",
  "participation",
  "achievement",
  "completion",
] as const;
export const certificateTypeLabels: Record<(typeof certificateTypes)[number], string> = {
  enrollment: "Student enrollment certificate",
  leaving: "School leaving certificate",
  character: "Character certificate",
  participation: "Participation certificate",
  achievement: "Achievement certificate",
  completion: "Completion certificate",
};
export const certificateRequestSchema = z.object({
  action: z.enum(["request", "approve", "issue"]),
  requestId: z.string().trim().min(1).max(160).optional(),
  certificateType: z.enum(certificateTypes).optional(),
  studentId: z.string().trim().min(1).max(160).optional(),
  remarks: z.string().trim().max(1200).optional(),
});
export type CertificateType = (typeof certificateTypes)[number];
