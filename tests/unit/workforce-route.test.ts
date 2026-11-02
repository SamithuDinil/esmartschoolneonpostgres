import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/server/context", () => ({
  getSchoolContext: async () => ({
    uid: "owner-1",
    schoolId: "school-1",
    role: "school_owner",
    permissions: ["teachers.read", "teachers.manage"],
    displayName: "School Owner",
  }),
}));
vi.mock("@/server/permissions", () => ({
  hasPermission: (permissions: string[], permission: string) => permissions.includes(permission),
}));
vi.mock("@/server/csrf", () => ({ hasValidCsrf: () => true }));
vi.mock("@/server/services/notification-delivery", () => ({
  deliverConfiguredNotification: vi.fn(),
}));
vi.mock("@/lib/firebase/admin", () => {
  const profiles = [
    {
      id: "profile-1",
      data: () => ({
        uid: "teacher-1",
        fullName: "Alex Teacher",
        employeeNumber: "TCH-00001",
        status: "active",
      }),
    },
  ];
  const memberships = [
    {
      id: "teacher-1",
      data: () => ({
        displayName: "Alex Teacher",
        email: "alex@example.edu",
        role: "class_teacher",
        status: "active",
      }),
    },
    {
      id: "teacher-2",
      data: () => ({
        displayName: "Sam Subject",
        email: "sam@example.edu",
        role: "subject_teacher",
        status: "active",
      }),
    },
    {
      id: "teacher-3",
      data: () => ({
        displayName: "Suspended Teacher",
        email: "suspended@example.edu",
        role: "class_teacher",
        status: "suspended",
      }),
    },
    {
      id: "staff-1",
      data: () => ({
        displayName: "Active Staff",
        email: "staff@example.edu",
        role: "administrative_staff",
        status: "active",
      }),
    },
  ];
  const school = {
    collection: (name: string) => {
      if (name === "teachers")
        return {
          orderBy: () => ({ limit: () => ({ get: async () => ({ docs: profiles }) }) }),
        };
      if (name === "memberships") return { get: async () => ({ docs: memberships }) };
      throw new Error(`Unexpected collection: ${name}`);
    },
  };
  return {
    getAdminServices: () => ({ db: { collection: () => ({ doc: () => school }) } }),
  };
});

import { GET } from "@/app/api/workforce/route";

describe("workforce teacher roster", () => {
  it("includes active teacher members and avoids duplicating existing teacher profiles", async () => {
    const response = await GET(new NextRequest("http://localhost/api/workforce?type=teachers"));
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.teacherMembers).toEqual([
      expect.objectContaining({ uid: "teacher-1", role: "class_teacher", profileRegistered: true }),
      expect.objectContaining({ uid: "teacher-2", role: "subject_teacher", profileRegistered: false }),
    ]);
    expect(data.items).toHaveLength(2);
    expect(data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fullName: "Alex Teacher", profileStatus: "Registered" }),
        expect.objectContaining({
          fullName: "Sam Subject",
          profileStatus: "Profile needed",
          membershipStatus: "Active",
        }),
      ]),
    );
    expect(data.items.some((item: { fullName: string }) => item.fullName === "Suspended Teacher")).toBe(false);
    expect(data.items.some((item: { fullName: string }) => item.fullName === "Active Staff")).toBe(false);
  });
});
