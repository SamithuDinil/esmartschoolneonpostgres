import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminServices: () => ({}) }));

describe("upload signatures and constant-time compare", () => {
  it("rejects spoofed content types", async () => {
    const { signatureMatches } = await import("@/server/services/assignment-files");
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
    expect(signatureMatches("image/png", png)).toBe(true);
    expect(signatureMatches("image/jpeg", png)).toBe(false);
    expect(signatureMatches("application/pdf", Buffer.from("<script>alert(1)</script>"))).toBe(
      false,
    );
    const zipOnly = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from("random")]);
    expect(
      signatureMatches(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        zipOnly,
      ),
    ).toBe(false);
    expect(
      signatureMatches(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Buffer.concat([zipOnly, Buffer.from("xl/workbook.xml")]),
      ),
    ).toBe(true);
  });
  it("safeEqual compares correctly regardless of length", async () => {
    const { safeEqual } = await import("@/server/secure-compare");
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
