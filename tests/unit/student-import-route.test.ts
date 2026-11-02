import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const created: string[] = [];
const existing = new Set<string>();

vi.mock("server-only", () => ({}));
vi.mock("@/server/csrf", () => ({ hasValidCsrf: () => true }));
vi.mock("@/server/context", () => ({
  getSchoolContext: async () => ({
    uid: "owner",
    schoolId: "s1",
    role: "school_owner",
    permissions: ["students.create"],
    displayName: "Owner",
  }),
}));
vi.mock("@/lib/firebase/admin", () => ({
  getAdminServices: () => ({
    db: {
      collection: () => ({
        doc: () => ({
          collection: () => ({
            doc: () => ({ get: async () => ({ exists: false }) }),
            where: (field: string, _op: string, value: string) =>
              field === "normalizedName"
                ? {
                    where: (_g: string, _p: string, dob: string) => ({
                      limit: () => ({
                        get: async () => ({ empty: !existing.has(`${value}|${dob}`) }),
                      }),
                    }),
                  }
                : { limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) },
          }),
        }),
      }),
    },
  }),
}));
vi.mock("@/server/services/students", () => ({
  loadStudentCreationShared: async () => ({
    academicYears: [],
    feeTypes: [],
    guardianByEmail: new Map(),
  }),
  createStudent: async (_c: unknown, input: { fullName: string }) => {
    created.push(input.fullName);
    return { id: "x", admissionNumber: "ES-1" };
  },
}));

import { GET, POST } from "@/app/api/students/import/route";
import { buildSampleCsv } from "@/lib/student-csv";

function uploadRequest(csv: string) {
  const form = new FormData();
  form.append("file", new File([csv], "students.csv", { type: "text/csv" }));
  return new NextRequest("http://localhost/api/students/import", { method: "POST", body: form });
}

beforeEach(() => {
  created.length = 0;
  existing.clear();
});

describe("student import route", () => {
  it("serves the sample csv as a download", async () => {
    const response = await GET(new NextRequest("http://localhost/api/students/import?sample=1"));
    expect(response.headers.get("content-disposition")).toContain("students-import-sample.csv");
    const body = await response.text();
    expect(body).toContain(
      "admissionNumber,fullName,dateOfBirth,gender,grade,className,admissionDate,guardianName,guardianEmail,guardianPhone",
    );
  });

  it("imports the downloaded sample unchanged", async () => {
    const response = await POST(uploadRequest(buildSampleCsv("students_import")));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ imported: 3, total: 3, errors: [] });
    expect(created).toHaveLength(3);
  });

  it("reports missing columns with a helpful message", async () => {
    const response = await POST(uploadRequest("fullName,gender\nA B,male\n"));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("dateOfBirth");
  });

  it("imports valid rows, skips invalid, in-file and existing duplicates, and numbers rows like the spreadsheet", async () => {
    existing.add("old student|2012-05-05");
    const header =
      "admissionNumber,fullName,dateOfBirth,gender,grade,className,admissionDate,guardianName,guardianEmail,guardianPhone";
    const csv = [
      header,
      "G-100,Good One,2014-01-01,Male,6,A,2026-01-10,Parent A,a@example.com,0771111111",
      "G-101,Bad Date,31/02/2014,male,6,A,2026-01-10,Parent B,b@example.com,0772222222",
      "G-102,Good One,2014-01-01,male,6,A,2026-01-10,Parent A,a@example.com,0771111111",
      "G-103,Old Student,2012-05-05,female,7,B,2026-01-10,Parent C,c@example.com,0773333333",
      "G-104,Good Two,15/03/2013,F,Grade 7,B,2026-01-10,Parent A,a@example.com,0771111111",
    ].join("\n");
    const response = await POST(uploadRequest(csv));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(created).toEqual(["Good One", "Good Two"]);
    expect(body.imported).toBe(2);
    expect(body.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5]);
    expect(body.errors[0].message).toContain("Date of birth");
    expect(body.errors[1].message).toContain("Duplicate of row 2");
    expect(body.errors[2].message).toContain("already exists");
  });

  it("rejects an empty upload", async () => {
    const response = await POST(uploadRequest(""));
    expect(response.status).toBe(400);
  });
});
