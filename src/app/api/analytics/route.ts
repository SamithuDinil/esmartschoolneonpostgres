import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown> & { id: string };
function text(value: unknown) {
  return String(value ?? "");
}
function number(value: unknown) {
  return Number(value ?? 0) || 0;
}
function dateValue(value: unknown) {
  return text(value).slice(0, 10);
}
function within(value: unknown, from: string, to: string) {
  const date = dateValue(value);
  return (!from || date >= from) && (!to || date <= to);
}
async function rows(
  root: FirebaseFirestore.DocumentReference,
  collection: string,
  limit = 1000,
): Promise<Row[]> {
  try {
    const snapshot = await root.collection(collection).limit(limit).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch {
    return [];
  }
}
function filterStudents(students: Row[], grade: string, className: string) {
  return students.filter(
    (item) =>
      (!grade || text(item.grade) === grade) &&
      (!className || text(item.className) === className) &&
      item.status !== "archived",
  );
}
function groupAverage(items: Row[], groupKey: string, valueKey: string) {
  const groups = new Map<string, { total: number; count: number }>();
  items.forEach((item) => {
    const key = text(item[groupKey]) || "Unspecified";
    const entry = groups.get(key) ?? { total: 0, count: 0 };
    entry.total += number(item[valueKey]);
    entry.count += 1;
    groups.set(key, entry);
  });
  return [...groups.entries()]
    .map(([label, value]) => ({
      label,
      average: value.count ? Math.round((value.total / value.count) * 100) / 100 : 0,
      count: value.count,
    }))
    .sort((a, b) => b.average - a.average);
}
function groupCount(items: Row[], key: string) {
  const groups = new Map<string, number>();
  items.forEach((item) => {
    const label = text(item[key]) || "Unspecified";
    groups.set(label, (groups.get(label) ?? 0) + 1);
  });
  return [...groups.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export async function GET(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (
    !hasPermission(context.permissions, "analytics.read") &&
    !hasPermission(context.permissions, "reports.read")
  )
    return NextResponse.json({ error: "Analytics access is restricted." }, { status: 403 });
  const from = text(request.nextUrl.searchParams.get("from"));
  const to = text(request.nextUrl.searchParams.get("to"));
  const grade = text(request.nextUrl.searchParams.get("grade"));
  const className = text(request.nextUrl.searchParams.get("className"));
  const root = getAdminServices().db.collection("schools").doc(context.schoolId);
  const [
    students,
    exams,
    attendance,
    invoices,
    payments,
    expenses,
    teachers,
    staffAttendance,
    libraryLoans,
    inventory,
  ] = await Promise.all([
    rows(root, "students", 5000),
    rows(root, "exams", 500),
    rows(root, "attendanceSessions", 5000),
    rows(root, "invoices", 5000),
    rows(root, "payments", 5000),
    rows(root, "expenses", 3000),
    rows(root, "teachers", 1000),
    rows(root, "workforceAttendance", 3000),
    rows(root, "libraryLoans", 3000),
    rows(root, "inventoryItems", 3000),
  ]);
  const selectedStudents = filterStudents(students, grade, className);
  const selectedIds = new Set(selectedStudents.map((item) => item.id));
  const selectedAttendance = attendance.filter(
    (item) =>
      (!item.studentId || selectedIds.has(text(item.studentId))) &&
      within(item.date ?? item.attendanceDate, from, to),
  );
  const selectedInvoices = invoices.filter(
    (item) =>
      (!item.studentId || selectedIds.has(text(item.studentId))) &&
      within(item.createdAt ?? item.issueDate ?? item.dueDate, from, to),
  );
  const selectedPayments = payments.filter(
    (item) =>
      (!item.studentId || selectedIds.has(text(item.studentId))) &&
      within(item.createdAt ?? item.paymentDate, from, to),
  );
  const selectedExpenses = expenses.filter((item) =>
    within(item.expenseDate ?? item.createdAt, from, to),
  );
  const attendancePresent = selectedAttendance.filter((item) =>
    ["present", "late"].includes(text(item.status).toLowerCase()),
  ).length;
  const attendanceAbsent = selectedAttendance.filter(
    (item) => text(item.status).toLowerCase() === "absent",
  ).length;
  const publishedExams = exams.filter(
    (item) =>
      ["published", "approved"].includes(text(item.status)) &&
      within(item.examinationDate ?? item.createdAt, from, to),
  );
  const academicRows = publishedExams.map((item) => ({
    ...item,
    mark: number(item.averageMark ?? item.average ?? item.percentage),
  }));
  const invoiceOutstanding = selectedInvoices.reduce(
    (sum, item) => sum + number(item.balance ?? number(item.total) - number(item.paidAmount)),
    0,
  );
  const collected = selectedPayments.reduce((sum, item) => sum + number(item.amount), 0);
  const approvedExpenses = selectedExpenses
    .filter((item) => text(item.status) === "approved")
    .reduce((sum, item) => sum + number(item.amount), 0);
  return NextResponse.json(
    {
      filters: { from, to, grade, className },
      academic: {
        examinationCount: publishedExams.length,
        averagePerformance: academicRows.length
          ? Math.round(
              (academicRows.reduce((sum, item) => sum + item.mark, 0) / academicRows.length) * 100,
            ) / 100
          : 0,
        byGrade: groupAverage(academicRows, "grade", "mark"),
        bySubject: groupAverage(academicRows, "subject", "mark"),
        historical: groupCount(publishedExams, "academicYearId"),
      },
      attendance: {
        records: selectedAttendance.length,
        present: attendancePresent,
        absent: attendanceAbsent,
        percentage: selectedAttendance.length
          ? Math.round((attendancePresent / selectedAttendance.length) * 10000) / 100
          : 0,
        daily: groupCount(selectedAttendance, "date"),
        byGrade: groupCount(selectedAttendance, "grade"),
        byClass: groupCount(selectedAttendance, "className"),
      },
      finance: {
        invoiceCount: selectedInvoices.length,
        collected,
        outstanding: invoiceOutstanding,
        payments: selectedPayments.length,
        expenses: approvedExpenses,
        monthlyCollections: groupSum(selectedPayments, "createdAt", "amount"),
        expenseCategories: groupSum(selectedExpenses, "expenseDate", "amount", "category"),
      },
      administrative: {
        enrollment: selectedStudents.length,
        newAdmissions: students.filter((item) => within(item.admissionDate, from, to)).length,
        transfers: students.filter((item) => within(item.transferDate, from, to)).length,
        teachers: teachers.filter((item) => item.status !== "archived").length,
        staffAttendance: staffAttendance.filter((item) => within(item.date, from, to)).length,
        libraryUsage: libraryLoans.filter((item) =>
          within(item.issueDate ?? item.createdAt, from, to),
        ).length,
        inventoryAssets: inventory.length,
        inventoryUnits: inventory.reduce((sum, item) => sum + number(item.quantity), 0),
      },
    },
    { headers: { "Cache-Control": "private,no-store" } },
  );
}

function groupSum(items: Row[], dateKey: string, valueKey: string, categoryKey?: string) {
  const groups = new Map<string, number>();
  items.forEach((item) => {
    const date = item[dateKey] ?? item.createdAt ?? item.paymentDate;
    const label = categoryKey
      ? text(item[categoryKey]) || "Other"
      : dateValue(date).slice(0, 7) || "Unspecified";
    groups.set(label, (groups.get(label) ?? 0) + number(item[valueKey]));
  });
  return [...groups.entries()]
    .map(([label, total]) => ({ label, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
