import { describe, expect, it } from "vitest";
import { hasPermission, permissionsForRole } from "../../src/server/permissions";
import { certificateRequestSchema } from "../../src/server/schemas/certificates";
import { backupConfigSchema } from "../../src/server/schemas/backups";
import { languageLabels, languages } from "../../src/lib/i18n/messages";

describe("Modules 33–37 validation", () => {
  it("requires a certificate action and valid controlled type", () => {
    expect(
      certificateRequestSchema.safeParse({
        action: "request",
        studentId: "student-1",
        certificateType: "enrollment",
      }).success,
    ).toBe(true);
    expect(
      certificateRequestSchema.safeParse({
        action: "request",
        studentId: "student-1",
        certificateType: "unofficial",
      }).success,
    ).toBe(false);
  });
  it("bounds backup retention and requires a six-field schedule string", () => {
    expect(
      backupConfigSchema.safeParse({
        enabled: true,
        scheduleCron: "0 0 2 * * *",
        retentionDays: 30,
      }).success,
    ).toBe(true);
    expect(
      backupConfigSchema.safeParse({ enabled: true, scheduleCron: "", retentionDays: 0 }).success,
    ).toBe(false);
  });
  it("keeps translated language choices explicit and leadership permissions scoped", () => {
    expect(languages).toEqual(["en", "si", "ta"]);
    expect(languageLabels.si).toContain("සිංහල");
    expect(hasPermission(permissionsForRole("school_admin"), "certificate.approve")).toBe(true);
    expect(hasPermission(permissionsForRole("student"), "audit.read")).toBe(false);
    expect(hasPermission(permissionsForRole("parent"), "backups.manage")).toBe(false);
  });
});
