import { describe, expect, it } from "vitest";
import { dateFromValue, isFutureDate } from "../../src/lib/date-value";
import { hasPermission, permissionsForRole } from "../../src/server/permissions";
import { schoolCreateSchema } from "../../src/server/schemas/school";
import { studentCreateSchema } from "../../src/server/schemas/student";
import {
  invitationAcceptSchema,
  membershipCreateSchema,
  schoolSwitchSchema,
} from "../../src/server/schemas/membership";

const studentPayload = {
  fullName: "Fictional Student",
  preferredName: "Fiction",
  dateOfBirth: "2014-05-12",
  gender: "undisclosed",
  grade: "Grade 6",
  className: "A",
  admissionDate: "2026-01-12",
  guardianName: "Fictional Guardian",
  guardianEmail: "guardian@example.test",
  guardianPhone: "+94770000000",
};

describe("request validation", () => {
  it("accepts a complete student registration payload", () => {
    expect(studentCreateSchema.safeParse(studentPayload).success).toBe(true);
  });

  it("rejects malformed guardian contacts and incomplete student names", () => {
    expect(
      studentCreateSchema.safeParse({ ...studentPayload, guardianEmail: "not-an-email" }).success,
    ).toBe(false);
    expect(studentCreateSchema.safeParse({ ...studentPayload, fullName: " " }).success).toBe(false);
  });

  it("applies Sri Lankan school defaults without accepting malformed codes", () => {
    const parsed = schoolCreateSchema.parse({
      name: "Fictional College",
      schoolCode: "FICTIONAL",
      email: "office@example.test",
      phone: "+94770000000",
      address: "Fictional Road",
      district: "Colombo",
      province: "Western",
    });
    expect(parsed.country).toBe("LK");
    expect(parsed.currency).toBe("LKR");
    expect(schoolCreateSchema.safeParse({ name: "A", currency: "LKR" }).success).toBe(false);
  });
  it("accepts only explicit tenant switches and school-local member roles", () => {
    expect(schoolSwitchSchema.safeParse({ action: "switch", schoolId: "school-b" }).success).toBe(
      true,
    );
    expect(schoolSwitchSchema.safeParse({ action: "switch", schoolId: "" }).success).toBe(false);
    expect(
      membershipCreateSchema.safeParse({
        email: "teacher@example.test",
        displayName: "Fictional Teacher",
        role: "subject_teacher",
      }).success,
    ).toBe(true);
    expect(
      membershipCreateSchema.safeParse({
        email: "teacher@example.test",
        displayName: "Fictional Teacher",
        role: "super_admin",
      }).success,
    ).toBe(false);
    expect(invitationAcceptSchema.safeParse({ token: "a".repeat(64) }).success).toBe(true);
    expect(invitationAcceptSchema.safeParse({ token: "short" }).success).toBe(false);
  });
});

describe("permission grants", () => {
  it("requires the exact named permission and never grants by role label alone", () => {
    expect(hasPermission(["students.read"], "students.read")).toBe(true);
    expect(hasPermission(["students.read"], "students.create")).toBe(false);
    expect(hasPermission([], "students.read")).toBe(false);
  });

  it("keeps the staff role least-privileged by default", () => {
    expect(permissionsForRole("staff")).toEqual([]);
  });

  it("separates school ownership transfer from principals and legacy administrators", () => {
    expect(hasPermission(permissionsForRole("school_owner"), "school.ownership.transfer")).toBe(
      true,
    );
    expect(hasPermission(permissionsForRole("principal"), "school.ownership.transfer")).toBe(false);
    expect(hasPermission(permissionsForRole("school_admin"), "school.ownership.transfer")).toBe(
      false,
    );
  });
  it("gives principals comprehensive authority only within their school", () => {
    expect(hasPermission(permissionsForRole("principal"), "memberships.manage")).toBe(true);
    expect(hasPermission(permissionsForRole("principal"), "students.approve")).toBe(true);
    expect(hasPermission(permissionsForRole("principal"), "settings.manage")).toBe(true);
    expect(hasPermission(permissionsForRole("principal"), "school.ownership.transfer")).toBe(false);
    expect(hasPermission(permissionsForRole("principal"), "platform.schools.manage")).toBe(false);
  });
});

describe("Realtime Database invitation expiry values", () => {
  const now = Date.parse("2026-10-30T12:00:00.000Z");

  it("accepts a future ISO expiration written by the RTDB adapter", () => {
    const expiry = "2026-11-06T12:00:00.000Z";
    expect(dateFromValue(expiry)?.toISOString()).toBe(expiry);
    expect(isFutureDate(expiry, now)).toBe(true);
  });

  it("rejects expired or malformed expiration values", () => {
    expect(isFutureDate("2026-10-29T12:00:00.000Z", now)).toBe(false);
    expect(isFutureDate("not-a-date", now)).toBe(false);
    expect(dateFromValue(undefined)).toBeNull();
  });

  it("continues accepting legacy Firebase Timestamp values", () => {
    const expiry = new Date("2026-11-06T12:00:00.000Z");
    expect(isFutureDate({ toDate: () => expiry }, now)).toBe(true);
    expect(isFutureDate({ seconds: expiry.getTime() / 1000 }, now)).toBe(true);
  });
});
