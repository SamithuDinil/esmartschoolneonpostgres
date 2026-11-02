import { describe, expect, it } from "vitest";
import { eventActionSchema } from "../../src/server/schemas/events";
import { welfareRecordSchema } from "../../src/server/schemas/welfare";
import { hasPermission, permissionsForRole } from "../../src/server/permissions";

describe("Modules 25–28 boundaries", () => {
  it("requires the welfare incident audit fields", () => {
    expect(
      welfareRecordSchema.safeParse({
        action: "create",
        studentId: "student-1",
        incidentDate: "2026-10-24",
        category: "bullying",
        summary: "Incident recorded",
        staffNotes: "Restricted note",
        investigationStatus: "open",
        followUpAction: "Guardian meeting",
        resolution: "",
      }).success,
    ).toBe(true);
    expect(
      welfareRecordSchema.safeParse({
        action: "create",
        studentId: "student-1",
        incidentDate: "2026-10-24",
        category: "bullying",
        summary: "",
      }).success,
    ).toBe(false);
  });

  it("validates event categories, participants and lifecycle changes", () => {
    expect(
      eventActionSchema.safeParse({
        action: "create",
        title: "Sports meet",
        description: "Inter-house meet",
        category: "sports_meet",
        participants: "students",
        targetRoles: [],
        targetUids: [],
        startAt: "2026-11-01T09:00",
        endAt: "2026-11-01T16:00",
        location: "Main grounds",
        reminderMinutes: [1440],
      }).success,
    ).toBe(true);
    expect(
      eventActionSchema.safeParse({ action: "edit", eventId: "event-1", title: "Updated ceremony" })
        .success,
    ).toBe(true);
    expect(
      eventActionSchema.safeParse({
        action: "create",
        title: "Meeting",
        category: "unknown",
        participants: "school",
        startAt: "2026-11-01",
        endAt: "2026-11-02",
      }).success,
    ).toBe(false);
  });

  it("keeps welfare access separate from ordinary student access", () => {
    expect(hasPermission(permissionsForRole("principal"), "welfare.read")).toBe(true);
    expect(hasPermission(permissionsForRole("student"), "welfare.read")).toBe(false);
    expect(hasPermission(permissionsForRole("school_admin"), "analytics.read")).toBe(true);
  });
});
