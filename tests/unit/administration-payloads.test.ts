import { describe, expect, it } from "vitest";
import { z } from "zod";

const recordSchema = z.object({
  name: z.string().trim().min(1),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  capacity: z.number().int().min(1).optional(),
});

function dropEmpty(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => !(typeof v === "string" && v.trim() === "")),
  );
}

describe("administration form payloads", () => {
  it("rejects blank dates unless blanks are dropped first", () => {
    const form = { name: "Grade 6", startDate: "", endDate: "", capacity: undefined };
    expect(recordSchema.safeParse(form).success).toBe(false);
    expect(recordSchema.safeParse(dropEmpty(form)).success).toBe(true);
  });
});
