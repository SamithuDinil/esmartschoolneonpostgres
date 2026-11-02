import { describe, expect, it } from "vitest";
import { deterministicAnswer, type AiSnapshot } from "../../src/server/services/ai-core";
import { hasPermission, permissionsForRole } from "../../src/server/permissions";

const snapshot: AiSnapshot = {
  attendanceToday: { sessions: 2, absent: 7, present: 83, late: 4, excused: 2, percentage: 92.2 },
  lowAttendance: [{ label: "Grade 8 · A", percentage: 71.4, sessions: 2 }],
  examination: { publishedExams: 3, marks: 80, average: 68.5 },
  overdueInvoices: { count: 4, balance: 12000 },
  eventsThisWeek: [
    { title: "Sports meet", startAt: "2026-10-24T09:00:00.000Z", category: "sports" },
  ],
  administration: { activeStudents: 120, teachers: 18, inventoryAssets: 40, documents: 12 },
};

describe("Modules 38–40 boundaries", () => {
  it("routes natural-language questions to aggregate-only answers", () => {
    expect(deterministicAnswer("How many students were absent today?", snapshot)).toContain(
      "7 absent",
    );
    expect(deterministicAnswer("Which classes have low attendance?", snapshot)).toContain(
      "Grade 8 · A",
    );
    expect(deterministicAnswer("Which invoices are overdue?", snapshot, "LKR")).toContain(
      "LKR 12,000",
    );
    expect(deterministicAnswer("What events are scheduled this week?", snapshot)).toContain(
      "Sports meet",
    );
  });

  it("does not grant AI or integration access to student or parent roles", () => {
    expect(hasPermission(permissionsForRole("student"), "ai.assistant")).toBe(false);
    expect(hasPermission(permissionsForRole("parent"), "integration.read")).toBe(false);
    expect(hasPermission(permissionsForRole("principal"), "ai.assistant")).toBe(true);
    expect(hasPermission(permissionsForRole("school_admin"), "integration.read")).toBe(true);
  });
});
