import { NextRequest, NextResponse } from "next/server";
import { getSchoolContext } from "@/server/context";
import { studentCreateSchema } from "@/server/schemas/student";
import { createStudent, listStudents } from "@/server/services/students";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { getAdminServices } from "@/lib/firebase/admin";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context)
    return NextResponse.json(
      { error: "School access is not active for this account." },
      { status: 403 },
    );
  if (!hasPermission(context.permissions, "students.read")) {
    return NextResponse.json(
      { error: "You do not have permission to view student records." },
      { status: 403 },
    );
  }
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100)
    return NextResponse.json({ error: "Limit must be between 1 and 100." }, { status: 400 });
  try {
    const result = await listStudents(
      context,
      rawLimit,
      request.nextUrl.searchParams.get("after") ?? undefined,
      request.nextUrl.searchParams.get("q") ?? undefined,
    );
    if (request.nextUrl.searchParams.get("format") === "csv") {
      const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
      const headers = [
        "studentId",
        "admissionNumber",
        "fullName",
        "preferredName",
        "dateOfBirth",
        "admissionDate",
        "grade",
        "className",
        "status",
        "guardianName",
        "guardianEmail",
        "guardianPhone",
      ];
      const csv = [
        headers.join(","),
        ...result.items.map((student) => {
          const record = student as Record<string, unknown>;
          return headers.map((header) => escape(record[header])).join(",");
        }),
      ].join("\n");
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=edusphere-students.csv",
          "Cache-Control": "private, no-store",
        },
      });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Student records could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json(
      { error: "This secure request expired. Please reload and retry." },
      { status: 403 },
    );
  const context = await getSchoolContext();
  if (!context)
    return NextResponse.json(
      { error: "School access is not active for this account." },
      { status: 403 },
    );
  if (!hasPermission(context.permissions, "students.create"))
    return NextResponse.json(
      { error: "You do not have permission to register students." },
      { status: 403 },
    );
  const parsed = studentCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "Please check the student information and try again.",
        fields: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  try {
    const student = await createStudent(context, parsed.data);
    return NextResponse.json(
      { student },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (cause) {
    if (cause instanceof Error && cause.message === "POTENTIAL_DUPLICATE")
      return NextResponse.json(
        {
          error:
            "Possible duplicate found: a student with the same name and date of birth is already registered. Review the existing record before proceeding.",
        },
        { status: 409 },
      );
    if (cause instanceof Error && cause.message === "ADMISSION_ID_EXISTS")
      return NextResponse.json(
        {
          error:
            "That admission ID is already in use in this school. Choose a unique admission ID.",
        },
        { status: 409 },
      );
    if (cause instanceof Error && cause.message === "ACADEMIC_YEAR_CLOSED")
      return NextResponse.json(
        {
          error:
            "Admission date falls in a closed academic year; closed-year records are read-only.",
        },
        { status: 409 },
      );
    return NextResponse.json(
      { error: "Student registration could not be saved." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "students.approve"))
    return NextResponse.json({ error: "Admission approval permission required" }, { status: 403 });
  const parsed = z
    .object({
      studentId: z.string().min(1),
      decision: z.enum(["approve", "reject", "waiting_list"]),
      reason: z.string().max(500).optional(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid admission decision" }, { status: 400 });
  try {
    const { db } = getAdminServices();
    const ref = db
      .collection("schools")
      .doc(context.schoolId)
      .collection("students")
      .doc(parsed.data.studentId);
    const current = await ref.get();
    if (!current.exists)
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    const status =
      parsed.data.decision === "approve"
        ? "active"
        : parsed.data.decision === "reject"
          ? "rejected"
          : "waiting_list";
    await ref.update({
      status,
      workflowState: status,
      decisionReason: parsed.data.reason ?? "",
      decidedAt: new Date(),
      decidedBy: context.uid,
      updatedAt: new Date(),
    });
    await db
      .collection("schools")
      .doc(context.schoolId)
      .collection("admissionHistory")
      .add({
        schoolId: context.schoolId,
        studentId: ref.id,
        admissionNumber: current.get("admissionNumber"),
        action: `application.${parsed.data.decision}`,
        reason: parsed.data.reason ?? "",
        actorUid: context.uid,
        occurredAt: new Date(),
      });
    return NextResponse.json({ ok: true, status });
  } catch {
    return NextResponse.json(
      { error: "Admission decision could not be recorded" },
      { status: 500 },
    );
  }
}
