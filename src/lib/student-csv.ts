import { canonicalizeRecord, toCsv } from "@/lib/csv";

export const STUDENT_REQUIRED_COLUMNS = [
  "admissionNumber",
  "fullName",
  "dateOfBirth",
  "gender",
  "grade",
  "className",
  "admissionDate",
  "guardianName",
  "guardianEmail",
  "guardianPhone",
] as const;
export const STUDENT_OPTIONAL_COLUMNS = [
  "nameWithInitials",
  "preferredName",
  "nationality",
  "address",
  "admissionCategory",
  "previousSchool",
  "studentEmail",
  "emergencyName",
  "emergencyPhone",
  "emergencyRelationship",
  "workflowState",
] as const;
export const STUDENT_CSV_COLUMNS = [
  ...STUDENT_REQUIRED_COLUMNS,
  ...STUDENT_OPTIONAL_COLUMNS,
] as const;

export const STUDENT_COLUMN_ALIASES: Record<string, readonly string[]> = {
  admissionNumber: [
    "admission id",
    "admission number",
    "admission no",
    "admission_number",
    "admission_id",
    "student id",
  ],
  fullName: ["full name", "name", "student name", "student_name"],
  dateOfBirth: ["date of birth", "dob", "birth date", "birthdate", "date_of_birth"],
  gender: ["sex"],
  grade: ["grade level", "class grade"],
  className: ["class name", "class", "section", "class_name"],
  admissionDate: ["admission date", "admitted on", "date of admission", "admission_date"],
  guardianName: ["guardian name", "parent name", "guardian", "parent", "guardian_name"],
  guardianEmail: ["guardian email", "parent email", "guardian_email"],
  guardianPhone: [
    "guardian phone",
    "parent phone",
    "guardian mobile",
    "parent mobile",
    "guardian_phone",
    "guardian contact",
  ],
  nameWithInitials: ["name with initials", "initials name"],
  preferredName: ["preferred name", "nickname", "call name"],
  admissionCategory: ["admission category", "category"],
  previousSchool: ["previous school", "last school"],
  studentEmail: ["student email", "email"],
  emergencyName: ["emergency contact", "emergency contact name", "emergency name"],
  emergencyPhone: ["emergency phone", "emergency contact phone"],
  emergencyRelationship: ["emergency relationship", "emergency relation"],
  workflowState: ["workflow state", "status", "admission status"],
};

export const STUDENT_SAMPLE_ROWS: Record<string, string>[] = [
  {
    admissionNumber: "SAMPLE-2026-001",
    fullName: "SAMPLE Nimali Perera",
    nameWithInitials: "N. Perera",
    preferredName: "Nimali",
    dateOfBirth: "2014-03-15",
    gender: "female",
    nationality: "Sri Lankan",
    address: "12 Temple Road, Colombo 07",
    grade: "Grade 6",
    className: "A",
    admissionDate: "2026-01-12",
    admissionCategory: "regular",
    previousSchool: "",
    studentEmail: "",
    guardianName: "Sunil Perera",
    guardianEmail: "sunil.perera@example.com",
    guardianPhone: "0771234567",
    emergencyName: "Kamala Perera",
    emergencyPhone: "0712345678",
    emergencyRelationship: "Mother",
    workflowState: "submitted",
  },
  {
    admissionNumber: "SAMPLE-2026-002",
    fullName: "SAMPLE Kasun Fernando",
    nameWithInitials: "K. Fernando",
    preferredName: "",
    dateOfBirth: "2013-11-02",
    gender: "male",
    nationality: "Sri Lankan",
    address: "45 Lake Drive, Kandy",
    grade: "Grade 7",
    className: "B",
    admissionDate: "2026-01-12",
    admissionCategory: "transfer",
    previousSchool: "Royal Primary School",
    studentEmail: "",
    guardianName: "Anura Fernando",
    guardianEmail: "anura.fernando@example.com",
    guardianPhone: "0765551234",
    emergencyName: "",
    emergencyPhone: "",
    emergencyRelationship: "",
    workflowState: "submitted",
  },
  {
    admissionNumber: "SAMPLE-2026-003",
    fullName: "SAMPLE Aisha Rahman",
    nameWithInitials: "",
    preferredName: "",
    dateOfBirth: "2015-07-21",
    gender: "undisclosed",
    nationality: "",
    address: "",
    grade: "Grade 5",
    className: "A",
    admissionDate: "2026-02-01",
    admissionCategory: "regular",
    previousSchool: "",
    studentEmail: "",
    guardianName: "Farah Rahman",
    guardianEmail: "farah.rahman@example.com",
    guardianPhone: "0701239876",
    emergencyName: "",
    emergencyPhone: "",
    emergencyRelationship: "",
    workflowState: "waiting_list",
  },
];

export const MARKS_CSV_COLUMNS = ["studentId", "examId", "marks"] as const;
export const PAYMENTS_CSV_COLUMNS = [
  "invoiceId",
  "amount",
  "paymentDate",
  "method",
  "reference",
  "verified",
] as const;

export const MARKS_COLUMN_ALIASES: Record<string, readonly string[]> = {
  studentId: ["student id", "student"],
  examId: ["exam id", "exam"],
  marks: ["mark", "score", "marks obtained"],
};
export const PAYMENTS_COLUMN_ALIASES: Record<string, readonly string[]> = {
  invoiceId: ["invoice id", "invoice"],
  amount: ["paid amount", "payment amount"],
  paymentDate: ["payment date", "date paid", "date"],
  method: ["payment method"],
  reference: ["ref", "receipt", "receipt number"],
  verified: ["is verified", "confirmed"],
};

export type ImportOperation = "students_import" | "marks_import" | "payments_import";

export function columnsFor(operation: ImportOperation): readonly string[] {
  return operation === "students_import"
    ? STUDENT_CSV_COLUMNS
    : operation === "marks_import"
      ? MARKS_CSV_COLUMNS
      : PAYMENTS_CSV_COLUMNS;
}
export function requiredFor(operation: ImportOperation): readonly string[] {
  return operation === "students_import" ? STUDENT_REQUIRED_COLUMNS : columnsFor(operation);
}
export function aliasesFor(operation: ImportOperation): Record<string, readonly string[]> {
  return operation === "students_import"
    ? STUDENT_COLUMN_ALIASES
    : operation === "marks_import"
      ? MARKS_COLUMN_ALIASES
      : PAYMENTS_COLUMN_ALIASES;
}
export function sampleFileName(operation: ImportOperation): string {
  return operation === "students_import"
    ? "students-import-sample.csv"
    : operation === "marks_import"
      ? "marks-import-sample.csv"
      : "payments-import-sample.csv";
}
export function buildSampleCsv(operation: ImportOperation): string {
  if (operation === "students_import") return toCsv(STUDENT_CSV_COLUMNS, STUDENT_SAMPLE_ROWS);
  if (operation === "marks_import")
    return toCsv(MARKS_CSV_COLUMNS, [
      { studentId: "STUDENT_DOCUMENT_ID", examId: "EXAM_DOCUMENT_ID", marks: "78" },
    ]);
  return toCsv(PAYMENTS_CSV_COLUMNS, [
    {
      invoiceId: "INVOICE_DOCUMENT_ID",
      amount: "2500.00",
      paymentDate: "2026-02-10",
      method: "bank_transfer",
      reference: "BANK-REF-0001",
      verified: "true",
    },
  ]);
}

const GENDER_MAP: Record<string, string> = {
  f: "female",
  female: "female",
  girl: "female",
  woman: "female",
  m: "male",
  male: "male",
  boy: "male",
  man: "male",
  other: "other",
  o: "other",
  undisclosed: "undisclosed",
  unknown: "undisclosed",
  "prefer not to say": "undisclosed",
  "": "",
};

export function normalizeDate(value: string): string {
  const text = value.trim();
  if (!text) return "";
  let year = "";
  let month = "";
  let day = "";
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (match) [, year, month, day] = match;
  else if ((match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)))
    [, day, month, year] = match;
  else if (/^\d{5}$/.test(text)) {
    const serial = Number(text);
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return date.toISOString().slice(0, 10);
  } else return text;
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return text;
  const iso = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== iso ? text : iso;
}

export function normalizeGrade(value: string): string {
  const text = value.trim().replace(/\s+/g, " ");
  const match = text.match(/^(?:grade|gr|g|class|std|standard)?\s*0?(\d{1,2})$/i);
  if (match) {
    const number = Number(match[1]);
    if (number >= 1 && number <= 13) return `Grade ${number}`;
  }
  return text;
}

export function normalizePhone(value: string): string {
  let text = value.trim().replace(/[\s().-]/g, "");
  if (/^\+?94\d{9}$/.test(text)) text = `0${text.replace(/^\+?94/, "")}`;
  else if (/^\d{9}$/.test(text)) text = `0${text}`;
  return text;
}

export function normalizeStudentRecord(input: Record<string, unknown>): Record<string, string> {
  const record = canonicalizeRecord(input, STUDENT_CSV_COLUMNS, STUDENT_COLUMN_ALIASES);
  const output: Record<string, string> = { ...record };
  output.dateOfBirth = normalizeDate(record.dateOfBirth ?? "");
  output.admissionDate = normalizeDate(record.admissionDate ?? "");
  const gender = (record.gender ?? "").toLowerCase().trim();
  output.gender = gender in GENDER_MAP ? GENDER_MAP[gender] : gender;
  output.grade = normalizeGrade(record.grade ?? "");
  output.guardianPhone = normalizePhone(record.guardianPhone ?? "");
  if (record.emergencyPhone) output.emergencyPhone = normalizePhone(record.emergencyPhone);
  output.guardianEmail = (record.guardianEmail ?? "").toLowerCase();
  if (record.studentEmail) output.studentEmail = record.studentEmail.toLowerCase();
  const workflow = (record.workflowState ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  output.workflowState =
    workflow === "waiting_list" || workflow === "waitlist" || workflow === "waiting"
      ? "waiting_list"
      : "submitted";
  if (!record.admissionCategory) output.admissionCategory = "regular";
  return output;
}
