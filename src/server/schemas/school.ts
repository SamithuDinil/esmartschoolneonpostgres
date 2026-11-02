import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).optional().default("");

export const schoolCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  schoolCode: z
    .string()
    .trim()
    .min(2)
    .max(24)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Use letters, numbers, hyphens or underscores only."),
  shortName: z.string().trim().max(40).optional().default(""),
  schoolType: z
    .enum(["national", "provincial", "private", "international", "other"])
    .default("private"),
  email: z.email().max(254),
  phone: z.string().trim().min(7).max(40),
  address: z.string().trim().min(5).max(500),
  district: z.string().trim().min(2).max(100),
  province: z.string().trim().min(2).max(100),
  country: z
    .string()
    .trim()
    .length(2)
    .default("LK")
    .transform((value) => value.toUpperCase()),
  logoUrl: z.url().max(800).or(z.literal("")).default(""),
  description: optionalText(1000),
  academicYear: z
    .string()
    .trim()
    .regex(/^\d{4}(?:-\d{4})?$/, "Use a year such as 2026 or 2026-2027.")
    .default(String(new Date().getFullYear())),
  timeZone: z.string().trim().min(3).max(64).default("Asia/Colombo"),
  currency: z
    .string()
    .trim()
    .length(3)
    .default("LKR")
    .transform((value) => value.toUpperCase()),
});

export type SchoolCreateInput = z.infer<typeof schoolCreateSchema>;
