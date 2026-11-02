export const GRADE_OPTIONS = Array.from(
  { length: 13 },
  (_, index) => `Grade ${String(index + 1).padStart(2, "0")}`,
);

export const CLASS_OPTIONS = Array.from("ABCDEFG");

export function normalizeGradeLabel(value: string): string {
  const match = value.trim().match(/^grade\s*0*(\d{1,2})$/i);
  if (!match) return value.trim();
  const grade = Number(match[1]);
  return grade >= 1 && grade <= 13
    ? `Grade ${String(grade).padStart(2, "0")}`
    : value.trim();
}

function gradeNumber(value: string): number | null {
  const match = normalizeGradeLabel(value).match(/^Grade (\d{2})$/);
  return match ? Number(match[1]) : null;
}

export function compareGradeLabels(a: string, b: string): number {
  const gradeA = gradeNumber(a);
  const gradeB = gradeNumber(b);
  if (gradeA !== null && gradeB !== null) return gradeA - gradeB;
  if (gradeA !== null) return -1;
  if (gradeB !== null) return 1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function buildGradeOptions(values: string[]): string[] {
  return Array.from(new Set([...GRADE_OPTIONS, ...values.map(normalizeGradeLabel).filter(Boolean)]))
    .sort(compareGradeLabels);
}

export function compareClassLabels(a: string, b: string): number {
  const indexA = CLASS_OPTIONS.indexOf(a.toUpperCase());
  const indexB = CLASS_OPTIONS.indexOf(b.toUpperCase());
  if (indexA >= 0 && indexB >= 0) return indexA - indexB;
  if (indexA >= 0) return -1;
  if (indexB >= 0) return 1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function buildClassOptions(values: string[]): string[] {
  return Array.from(new Set([...CLASS_OPTIONS, ...values.map((value) => value.trim()).filter(Boolean)]))
    .sort(compareClassLabels);
}
