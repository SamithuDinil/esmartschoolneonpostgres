import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";

export const dynamic = "force-dynamic";

type SearchResult = {
  id: string;
  category: string;
  label: string;
  subtitle: string;
  href: string;
  searchable: string;
};
const config = [
  {
    key: "students",
    collection: "students",
    permission: "students.read",
    label: "Students",
    idField: "fullName",
    subtitle: "admissionNumber",
    href: "/students",
  },
  {
    key: "teachers",
    collection: "teachers",
    permission: "teachers.read",
    label: "Teachers",
    idField: "fullName",
    subtitle: "employeeNumber",
    href: "/workforce",
  },
  {
    key: "staff",
    collection: "staff",
    permission: "staff.read",
    label: "Staff",
    idField: "fullName",
    subtitle: "employeeNumber",
    href: "/workforce",
  },
  {
    key: "classes",
    collection: "classes",
    permission: "academics.read",
    label: "Classes",
    idField: "name",
    subtitle: "grade",
    href: "/administration",
  },
  {
    key: "subjects",
    collection: "subjects",
    permission: "academics.read",
    label: "Subjects",
    idField: "name",
    subtitle: "code",
    href: "/administration",
  },
  {
    key: "examinations",
    collection: "exams",
    permission: "exams.read",
    label: "Examinations",
    idField: "name",
    subtitle: "subject",
    href: "/exams",
  },
  {
    key: "invoices",
    collection: "invoices",
    permission: "finance.read",
    label: "Invoices",
    idField: "invoiceNumber",
    subtitle: "studentName",
    href: "/finance",
  },
  {
    key: "books",
    collection: "books",
    permission: "library.reports.read",
    label: "Books",
    idField: "title",
    subtitle: "isbn",
    href: "/library",
  },
  {
    key: "announcements",
    collection: "announcements",
    permission: "announcements.targeted.read",
    label: "Announcements",
    idField: "title",
    subtitle: "message",
    href: "/communication",
  },
  {
    key: "documents",
    collection: "documents",
    permission: "documents.read",
    label: "Documents",
    idField: "name",
    subtitle: "documentType",
    href: "/reports",
  },
] as const;

function text(value: unknown) {
  return String(value ?? "").trim();
}
function resultFor(
  item: (typeof config)[number],
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  data: FirebaseFirestore.DocumentData,
): SearchResult {
  const label = text(data[item.idField]) || doc.id;
  const subtitle = text(data[item.subtitle]);
  const searchable = Object.values(data)
    .filter((value) => ["string", "number"].includes(typeof value))
    .join(" ")
    .toLowerCase();
  return { id: doc.id, category: item.label, label, subtitle, href: item.href, searchable };
}

export async function GET(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(context.permissions, "search.global"))
    return NextResponse.json({ error: "Global search is restricted." }, { status: 403 });
  const q = text(request.nextUrl.searchParams.get("q")).toLowerCase();
  const category = text(request.nextUrl.searchParams.get("category"));
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? 1));
  const pageSize = Math.min(
    50,
    Math.max(5, Number(request.nextUrl.searchParams.get("pageSize") ?? 15)),
  );
  const root = getAdminServices().db.collection("schools").doc(context.schoolId);
  const allowed = config.filter(
    (item) =>
      (!category || item.key === category) && hasPermission(context.permissions, item.permission),
  );
  const batches = await Promise.all(
    allowed.map(async (item) => {
      const snapshot = await root
        .collection(item.collection)
        .limit(80)
        .get()
        .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }));
      return snapshot.docs
        .map((doc) => resultFor(item, doc, doc.data()))
        .filter(
          (result) =>
            !q ||
            result.searchable.includes(q) ||
            result.label.toLowerCase().includes(q) ||
            result.subtitle.toLowerCase().includes(q),
        );
    }),
  );
  const all = batches.flat().sort((a, b) => a.label.localeCompare(b.label));
  const start = (page - 1) * pageSize;
  const results = all
    .slice(start, start + pageSize)
    .map((result) =>
      Object.fromEntries(Object.entries(result).filter(([key]) => key !== "searchable")),
    );
  return NextResponse.json(
    {
      results,
      suggestions: results.slice(0, 5),
      total: all.length,
      page,
      pageSize,
      categories: allowed.map((item) => ({ key: item.key, label: item.label })),
    },
    { headers: { "Cache-Control": "private,no-store" } },
  );
}
