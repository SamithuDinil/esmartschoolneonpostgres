import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminServices: () => ({ db: {} }) }));
vi.mock("@/server/services/students", () => ({
  createStudent: vi.fn(),
  loadStudentCreationShared: vi.fn(),
}));

import { canonicalizeColumns, parseCsv, toCsv } from "@/lib/csv";
import {
  STUDENT_CSV_COLUMNS,
  STUDENT_REQUIRED_COLUMNS,
  STUDENT_COLUMN_ALIASES,
  STUDENT_SAMPLE_ROWS,
  buildSampleCsv,
  normalizeDate,
  normalizeGrade,
  normalizePhone,
  normalizeStudentRecord,
} from "@/lib/student-csv";
import { validateStudentRow } from "@/server/student-import";

describe("csv parser", () => {
  it("handles quotes, embedded newlines, escaped quotes, BOM and CRLF", () => {
    const parsed = parseCsv(
      '\uFEFFname,address\r\n"Perera, N","12 Temple Rd\nColombo 07"\r\n"He said ""hi""",x\r\n\r\n',
    );
    expect(parsed.columns).toEqual(["name", "address"]);
    expect(parsed.rows).toEqual([
      { name: "Perera, N", address: "12 Temple Rd\nColombo 07" },
      { name: 'He said "hi"', address: "x" },
    ]);
    expect(parsed.rowNumbers).toEqual([2, 3]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(parseCsv("a;b\n1;2").rows).toEqual([{ a: "1", b: "2" }]);
    expect(parseCsv("a\tb\n1\t2").rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("round-trips through toCsv", () => {
    const rows = [{ a: "x,y", b: 'q"r', c: "line1\nline2" }];
    expect(parseCsv(toCsv(["a", "b", "c"], rows)).rows).toEqual(rows);
  });

  it("maps header aliases to canonical columns", () => {
    expect(
      canonicalizeColumns(
        ["Full Name", "DOB", "Parent Email"],
        STUDENT_CSV_COLUMNS,
        STUDENT_COLUMN_ALIASES,
      ),
    ).toEqual(["fullName", "dateOfBirth", "guardianEmail"]);
  });
});

describe("student csv normalization", () => {
  it("normalizes dates, grades, phones", () => {
    expect(normalizeDate("15/03/2014")).toBe("2014-03-15");
    expect(normalizeDate("2014/3/5")).toBe("2014-03-05");
    expect(normalizeDate("31/02/2014")).toBe("31/02/2014");
    expect(normalizeGrade("6")).toBe("Grade 6");
    expect(normalizeGrade("grade6")).toBe("Grade 6");
    expect(normalizeGrade("A/L")).toBe("A/L");
    expect(normalizePhone("+94 77 123 4567")).toBe("0771234567");
    expect(normalizePhone("771234567")).toBe("0771234567");
  });

  it("downloads a sample whose header matches required columns and whose rows validate", () => {
    const parsed = parseCsv(buildSampleCsv("students_import"));
    expect(parsed.columns).toEqual([...STUDENT_CSV_COLUMNS]);
    for (const column of STUDENT_REQUIRED_COLUMNS) expect(parsed.columns).toContain(column);
    expect(parsed.rows).toHaveLength(STUDENT_SAMPLE_ROWS.length);
    for (const row of parsed.rows) {
      const result = validateStudentRow(row);
      expect(result.message).toBeUndefined();
      expect(result.data?.fullName).toBeTruthy();
    }
  });

  it("accepts blank optional columns, mixed-case gender and alternate headers", () => {
    const result = validateStudentRow({
      "Admission ID": "ST-100",
      "Full Name": "Test Student",
      DOB: "14/06/2014",
      Gender: "Female",
      Grade: "6",
      Class: "A",
      "Admission Date": "2026-01-12",
      "Guardian Name": "Parent One",
      "Guardian Email": "PARENT@Example.com",
      "Guardian Phone": "077 123 4567",
      workflowState: "",
      studentEmail: "",
      nameWithInitials: "",
    });
    expect(result.message).toBeUndefined();
    expect(result.data).toMatchObject({
      gender: "female",
      grade: "Grade 6",
      dateOfBirth: "2014-06-14",
      guardianEmail: "parent@example.com",
      guardianPhone: "0771234567",
      workflowState: "submitted",
    });
  });

  it("reports readable, field-specific errors", () => {
    const result = validateStudentRow({
      fullName: "",
      dateOfBirth: "not a date",
      gender: "x",
      grade: "6",
      className: "A",
      admissionDate: "2026-01-12",
      guardianName: "P",
      guardianEmail: "bad",
      guardianPhone: "1",
    });
    expect(result.data).toBeUndefined();
    expect(result.message).toContain("Full name is required");
    expect(result.message).toContain("Date of birth");
    expect(result.message).toContain("Gender");
    expect(result.message).toContain("Guardian email");
  });

  it("requires a supplied admission ID for bulk imports", () => {
    const result = validateStudentRow({
      fullName: "No ID",
      dateOfBirth: "2014-01-01",
      gender: "male",
      grade: "1",
      className: "A",
      admissionDate: "2026-01-12",
      guardianName: "Parent",
      guardianEmail: "p@example.com",
      guardianPhone: "0771234567",
    });
    expect(result.message).toContain("Admission ID is required");
  });

  it("rejects future birth dates and admission before birth", () => {
    const base = {
      admissionNumber: "FUTURE-1",
      fullName: "Future Child",
      gender: "male",
      grade: "1",
      className: "A",
      guardianName: "Parent",
      guardianEmail: "p@example.com",
      guardianPhone: "0771234567",
    };
    expect(
      validateStudentRow({ ...base, dateOfBirth: "2999-01-01", admissionDate: "2999-02-01" })
        .message,
    ).toContain("future");
    expect(
      validateStudentRow({ ...base, dateOfBirth: "2014-01-01", admissionDate: "2013-01-01" })
        .message,
    ).toContain("before");
  });

  it("normalizeStudentRecord defaults the workflow", () => {
    expect(normalizeStudentRecord({ workflowState: "Waiting List" }).workflowState).toBe(
      "waiting_list",
    );
    expect(normalizeStudentRecord({}).workflowState).toBe("submitted");
  });
});
