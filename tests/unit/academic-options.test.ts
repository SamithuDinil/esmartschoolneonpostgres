import { describe, expect, it } from "vitest";
import {
  buildClassOptions,
  buildGradeOptions,
  normalizeGradeLabel,
} from "@/lib/academic-options";

describe("academic option labels", () => {
  it("orders all configured grade choices numerically and normalizes legacy labels", () => {
    const options = buildGradeOptions(["Grade 3", "Grade 02", "Grade 10"]);
    expect(options.slice(0, 13)).toEqual(
      Array.from({ length: 13 }, (_, index) => `Grade ${String(index + 1).padStart(2, "0")}`),
    );
    expect(options.filter((grade) => grade === "Grade 03")).toHaveLength(1);
    expect(normalizeGradeLabel(" grade 2 ")).toBe("Grade 02");
  });

  it("always orders class sections A through G before legacy values", () => {
    expect(buildClassOptions(["G", "B", "Legacy class"]).slice(0, 7)).toEqual(
      Array.from("ABCDEFG"),
    );
    expect(buildClassOptions(["Legacy class"]).at(-1)).toBe("Legacy class");
  });
});
