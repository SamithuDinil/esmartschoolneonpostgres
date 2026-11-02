import { NextRequest, NextResponse } from "next/server";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { importStudentRows, validateStudentRows } from "@/server/student-import";
import { canonicalizeColumns, parseCsv } from "@/lib/csv";
import {
  STUDENT_COLUMN_ALIASES,
  STUDENT_CSV_COLUMNS,
  STUDENT_REQUIRED_COLUMNS,
  buildSampleCsv,
  sampleFileName,
} from "@/lib/student-csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ROWS = 1000;
const MAX_BYTES = 5 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "students.create"))
    return NextResponse.json({ error: "Student import permission required" }, { status: 403 });
  if (request.nextUrl.searchParams.get("sample") === null)
    return NextResponse.json({ columns: STUDENT_CSV_COLUMNS, required: STUDENT_REQUIRED_COLUMNS });
  return new NextResponse(`\uFEFF${buildSampleCsv("students_import")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${sampleFileName("students_import")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json(
      { error: "Invalid request token. Refresh the page and try again." },
      { status: 403 },
    );
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "students.create"))
    return NextResponse.json({ error: "Student import permission required" }, { status: 403 });
  let text = "";
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0)
      return NextResponse.json({ error: "Choose a CSV file to import." }, { status: 400 });
    if (file.size > MAX_BYTES)
      return NextResponse.json({ error: "The CSV file is larger than 5 MB." }, { status: 400 });
    text = await file.text();
  } catch {
    return NextResponse.json({ error: "The uploaded file could not be read." }, { status: 400 });
  }
  const parsed = parseCsv(text);
  if (!parsed.columns.length)
    return NextResponse.json({ error: "The CSV file is empty." }, { status: 400 });
  const columns = canonicalizeColumns(parsed.columns, STUDENT_CSV_COLUMNS, STUDENT_COLUMN_ALIASES);
  const missing = STUDENT_REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missing.length)
    return NextResponse.json(
      {
        error: `Missing required columns: ${missing.join(", ")}. Download the sample CSV for the exact structure.`,
      },
      { status: 400 },
    );
  if (!parsed.rows.length)
    return NextResponse.json(
      { error: "The CSV has a header but no student rows." },
      { status: 400 },
    );
  if (parsed.rows.length > MAX_ROWS)
    return NextResponse.json(
      {
        error: `A single import can contain at most ${MAX_ROWS.toLocaleString()} students (this file has ${parsed.rows.length.toLocaleString()}). Split the file and import it in parts.`,
      },
      { status: 400 },
    );
  try {
    const entries = parsed.rows.map((values, index) => ({ row: parsed.rowNumbers[index], values }));
    const checked = await validateStudentRows(entries, context.schoolId);
    const written = await importStudentRows(context, checked.accepted);
    const errors = [...checked.issues, ...written.issues].sort((a, b) => a.row - b.row);
    return NextResponse.json({
      imported: written.imported,
      total: parsed.rows.length,
      skipped: parsed.rows.length - written.imported,
      errors,
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "The import could not be completed. Rows imported before the failure are kept; re-upload the file and already-imported students will be skipped as duplicates.",
      },
      { status: 500 },
    );
  }
}
