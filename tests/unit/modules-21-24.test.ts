import { describe, expect, it } from "vitest";
import { communicationActionSchema } from "../../src/server/schemas/communication";
import { inventoryRecordSchema } from "../../src/server/schemas/inventory";
import { hasPermission, permissionsForRole } from "../../src/server/permissions";

describe("Modules 21–24 request boundaries", () => {
  it("accepts stock movement, maintenance and transfer records", () => {
    expect(
      inventoryRecordSchema.safeParse({
        action: "movement",
        assetId: "asset-1",
        movementType: "stock_out",
        quantity: 2,
        reason: "Issued to lab",
      }).success,
    ).toBe(true);
    expect(
      inventoryRecordSchema.safeParse({
        action: "create_maintenance",
        assetId: "asset-1",
        scheduledDate: "2026-11-03",
        maintenanceType: "Inspection",
      }).success,
    ).toBe(true);
    expect(
      inventoryRecordSchema.safeParse({
        action: "transfer",
        assetId: "asset-1",
        fromLocation: "Block A",
        toLocation: "Block B",
        reason: "Room reallocation",
      }).success,
    ).toBe(true);
  });

  it("requires explicit recipient and delivery fields for announcements", () => {
    const result = communicationActionSchema.safeParse({
      action: "create",
      title: "Exam timetable",
      message: "The timetable is now available.",
      audience: "parents",
      targetRoles: ["parent"],
      targetUids: [],
      channels: ["in_app"],
      scheduledAt: "",
      attachmentName: "",
    });
    expect(result.success).toBe(true);
    expect(
      communicationActionSchema.safeParse({
        action: "create",
        title: "x",
        message: "",
        audience: "school",
        targetRoles: [],
        targetUids: [],
        channels: [],
      }).success,
    ).toBe(false);
  });

  it("keeps portal access explicit and role-scoped", () => {
    expect(hasPermission(permissionsForRole("parent"), "students.linked.read")).toBe(true);
    expect(hasPermission(permissionsForRole("student"), "students.linked.read")).toBe(false);
    expect(hasPermission(permissionsForRole("student"), "profile.self.read")).toBe(true);
  });
});
