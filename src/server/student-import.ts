import "server-only";
import { getAdminServices } from "@/lib/firebase/admin";
import type { SchoolContext } from "@/server/context";
import { studentCreateSchema, type StudentCreateInput } from "@/server/schemas/student";
import { createStudent, loadStudentCreationShared } from "@/server/services/students";
import { normalizeStudentRecord } from "@/lib/student-csv";

export type RowIssue = { row: number; message: string };
export type CleanStudentRow = { row: number; data: StudentCreateInput };

const FIELD_LABELS: Record<string, string> = {
  admissionNumber: "Admission ID",
  fullName: "Full name",
  dateOfBirth: "Date of birth",
  gender: "Gender",
  grade: "Grade",
  className: "Class",
  admissionDate: "Admission date",
  guardianName: "Guardian name",
  guardianEmail: "Guardian email",
  guardianPhone: "Guardian phone",
  studentEmail: "Student email",
  workflowState: "Workflow state",
};

export function normalizedKey(fullName: string, dateOfBirth: string) {
  return `${fullName.toLowerCase().replace(/\s+/g, " ").trim()}|${dateOfBirth}`;
}

export function validateStudentRow(raw: Record<string, unknown>): {
  data?: StudentCreateInput;
  message?: string;
} {
  const record = normalizeStudentRecord(raw);
  const parsed = studentCreateSchema.safeParse(record);
  if (!parsed.success) {
    const problems = [
      ...new Set(
        parsed.error.issues.map((issue) => {
          const key = String(issue.path[0] ?? "row");
          const label = FIELD_LABELS[key] ?? key;
          const value = record[key] ?? "";
          if (!value) return `${label} is required`;
          if (key === "dateOfBirth" || key === "admissionDate")
            return `${label} "${value}" is not a valid date (use YYYY-MM-DD)`;
          if (key === "gender")
            return `Gender "${value}" must be female, male, other or undisclosed`;
          if (key.toLowerCase().includes("email"))
            return `${label} "${value}" is not a valid email`;
          if (key === "guardianPhone") return `${label} "${value}" must be 7-24 characters`;
          return `${label} is invalid`;
        }),
      ),
    ];
    return { message: problems.join("; ") };
  }
  const today = new Date().toISOString().slice(0, 10);
  const data = parsed.data;
  if (!data.admissionNumber?.trim())
    return { message: "Admission ID is required for imported students" };
  if (data.dateOfBirth > today)
    return { message: `Date of birth "${data.dateOfBirth}" is in the future` };
  if (data.dateOfBirth < "1950-01-01")
    return { message: `Date of birth "${data.dateOfBirth}" is not realistic` };
  if (data.admissionDate < data.dateOfBirth)
    return { message: "Admission date is before the date of birth" };
  return { data };
}

export async function validateStudentRows(
  rows: Array<{ row: number; values: Record<string, unknown> }>,
  schoolId: string,
) {
  const issues: RowIssue[] = [];
  const clean: CleanStudentRow[] = [];
  const seen = new Map<string, number>();
  const seenAdmissionIds = new Map<string, number>();
  for (const entry of rows) {
    const result = validateStudentRow(entry.values);
    if (!result.data) {
      issues.push({ row: entry.row, message: result.message ?? "Row is invalid" });
      continue;
    }
    const key = normalizedKey(result.data.fullName, result.data.dateOfBirth);
    const first = seen.get(key);
    if (first) {
      issues.push({
        row: entry.row,
        message: `Duplicate of row ${first} in this file (same name and date of birth)`,
      });
      continue;
    }
    seen.set(key, entry.row);
    const admissionId = result.data.admissionNumber?.trim().toUpperCase();
    if (admissionId) {
      const earlierRow = seenAdmissionIds.get(admissionId);
      if (earlierRow) {
        issues.push({
          row: entry.row,
          message: `Admission ID duplicates row ${earlierRow} in this file`,
        });
        continue;
      }
      seenAdmissionIds.set(admissionId, entry.row);
    }
    clean.push({ row: entry.row, data: result.data });
  }
  const collection = getAdminServices()
    .db.collection("schools")
    .doc(schoolId)
    .collection("students");
  const accepted: CleanStudentRow[] = [];
  for (let offset = 0; offset < clean.length; offset += 25) {
    const chunk = clean.slice(offset, offset + 25);
    const found = await Promise.all(
      chunk.map(async (entry) => {
        const [samePerson, sameAdmissionId] = await Promise.all([
          collection
            .where("normalizedName", "==", entry.data.fullName.toLowerCase().replace(/\s+/g, " "))
            .where("dateOfBirth", "==", entry.data.dateOfBirth)
            .limit(1)
            .get(),
          entry.data.admissionNumber
            ? Promise.all([
                collection.doc(entry.data.admissionNumber.trim().toUpperCase()).get(),
                collection
                  .where("admissionNumber", "==", entry.data.admissionNumber.trim().toUpperCase())
                  .limit(1)
                  .get(),
              ])
            : Promise.resolve(null),
        ]);
        return {
          duplicatePerson: !samePerson.empty,
          duplicateId: sameAdmissionId
            ? sameAdmissionId[0].exists || !sameAdmissionId[1].empty
            : false,
        };
      }),
    );
    chunk.forEach((entry, index) => {
      if (found[index].duplicateId)
        issues.push({ row: entry.row, message: "Admission ID already exists in this school" });
      else if (found[index].duplicatePerson)
        issues.push({
          row: entry.row,
          message: "A student with the same name and date of birth already exists",
        });
      else accepted.push(entry);
    });
  }
  issues.sort((a, b) => a.row - b.row);
  return { accepted, issues };
}

export async function importStudentRows(context: SchoolContext, rows: CleanStudentRow[]) {
  const shared = await loadStudentCreationShared(context);
  let imported = 0;
  const issues: RowIssue[] = [];
  for (const entry of rows) {
    try {
      await createStudent(context, entry.data, shared);
      imported += 1;
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      issues.push({
        row: entry.row,
        message:
          code === "POTENTIAL_DUPLICATE"
            ? "A student with the same name and date of birth already exists"
            : code === "ACADEMIC_YEAR_CLOSED"
              ? "The admission date falls in a closed academic year"
              : "Could not save this row",
      });
    }
  }
  return { imported, issues };
}
