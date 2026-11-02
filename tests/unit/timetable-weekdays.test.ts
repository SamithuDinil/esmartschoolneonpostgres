import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/server/context", () => ({
  getSchoolContext: async () => ({
    uid: "admin-1",
    schoolId: "school-1",
    role: "school_admin",
    permissions: ["timetable.manage"],
    displayName: "School Admin",
  }),
}));
vi.mock("@/server/permissions", () => ({
  hasPermission: (permissions: string[], permission: string) => permissions.includes(permission),
}));
vi.mock("@/server/csrf", () => ({ hasValidCsrf: () => true }));
vi.mock("@/lib/firebase/admin", () => ({
  getAdminServices: () => { throw new Error("Database should not be reached for invalid weekend payloads"); },
}));

import { POST } from "@/app/api/timetable/route";

describe("school timetable weekdays", () => {
  it("rejects Saturday and Sunday in period configuration", async () => {
    for (const day of [6, 7]) {
      const response = await POST(new NextRequest("http://localhost/api/timetable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "configure",
          academicYearId: "year-1",
          periods: [{ day, period: 1, start: "08:00", end: "08:45", isBreak: false }],
        }),
      }));
      expect(response.status).toBe(400);
    }
  });

  it("rejects lessons scheduled for a weekend", async () => {
    const response = await POST(new NextRequest("http://localhost/api/timetable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save",
        academicYearId: "year-1",
        entry: {
          grade: "2",
          className: "A",
          subject: "Maths",
          teacherUid: "teacher-1",
          classroomId: "room-1",
          day: 6,
          period: 1,
          academicYearId: "year-1",
        },
      }),
    }));
    expect(response.status).toBe(400);
  });
});
