import { describe, expect, it } from "vitest";
import { bulkActionSchema } from "../../src/server/schemas/bulk";
import { promotionActionSchema } from "../../src/server/schemas/promotion";
import { hasPermission, permissionsForRole } from "../../src/server/permissions";

describe("Modules 29–32 boundaries", () => {
  it("requires preview records and rejects empty bulk imports", () => {
    expect(
      bulkActionSchema.safeParse({
        action: "preview",
        operation: "students_import",
        columns: ["fullName"],
        records: [{ fullName: "A Student" }],
      }).success,
    ).toBe(true);
    expect(
      bulkActionSchema.safeParse({
        action: "preview",
        operation: "marks_import",
        columns: [],
        records: [],
      }).success,
    ).toBe(false);
  });
  it("keeps promotion outcomes and destination fields explicit", () => {
    expect(
      promotionActionSchema.safeParse({
        action: "confirm",
        academicYearId: "2026",
        studentIds: ["student-1"],
        destinationGrade: "Grade 8",
        destinationClass: "B",
        outcome: "promote",
      }).success,
    ).toBe(true);
    expect(
      promotionActionSchema.safeParse({
        action: "confirm",
        academicYearId: "2026",
        studentIds: [],
        destinationGrade: "Grade 8",
        destinationClass: "B",
        outcome: "promote",
      }).success,
    ).toBe(false);
  });
  it("limits sensitive workflows to granted roles", () => {
    expect(hasPermission(permissionsForRole("school_admin"), "bulk.manage")).toBe(true);
    expect(hasPermission(permissionsForRole("student"), "bulk.manage")).toBe(false);
    expect(hasPermission(permissionsForRole("parent"), "notifications.read")).toBe(true);
  });
});
