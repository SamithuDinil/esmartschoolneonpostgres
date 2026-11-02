import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
export const dynamic = "force-dynamic";
export default async function ClassRosterPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  if (!(await getSessionUid())) redirect("/");
  const c = await getSchoolContext();
  if (!c || !hasPermission(c.permissions, "students.read")) redirect("/students");
  const { classId } = await params;
  const { db } = getAdminServices();
  const school = db.collection("schools").doc(c.schoolId);
  const [doc, schoolDoc] = await Promise.all([
    school.collection("classes").doc(classId).get(),
    school.get(),
  ]);
  if (!doc.exists) notFound();
  const cls = doc.data()!;
  let students: Array<{
    id: string;
    admissionNumber: string;
    fullName: string;
    status: string;
    guardianPhone: string;
  }>;
  if (typeof cls.academicYearId === "string") {
    const enrollments = await school
      .collection("enrollments")
      .where("academicYearId", "==", cls.academicYearId)
      .limit(1500)
      .get();
    const relevant = enrollments.docs.filter(
      (e) =>
        e.get("grade") == cls.grade &&
        e.get("className") == cls.name &&
        e.get("status") === "active",
    );
    const records = await Promise.all(
      relevant.map((e) => school.collection("students").doc(e.get("studentId")).get()),
    );
    students = records
      .filter((s) => s.exists)
      .map((s) => ({
        id: s.id,
        admissionNumber: s.get("admissionNumber") ?? "—",
        fullName: s.get("fullName") ?? "—",
        status: s.get("status") ?? "active",
        guardianPhone: s.get("guardianPhone") ?? "—",
      }));
  } else {
    const roster = await school
      .collection("students")
      .where("grade", "==", cls.grade)
      .where("className", "==", cls.name)
      .limit(500)
      .get();
    students = roster.docs
      .filter((s) => s.get("status") !== "archived")
      .map((s) => ({
        id: s.id,
        admissionNumber: s.get("admissionNumber") ?? "—",
        fullName: s.get("fullName") ?? "—",
        status: s.get("status") ?? "active",
        guardianPhone: s.get("guardianPhone") ?? "—",
      }));
  }
  return (
    <AppShell
      schoolName={schoolDoc.data()?.name ?? "My school"}
      userName={c.displayName}
      role={c.role}
      permissions={c.permissions}
    >
      <main className="page-content">
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              Class roster · {String(cls.academicYearId ?? "School-wide")}
            </div>
            <h1>
              {String(cls.grade)} {String(cls.section ?? "")}
            </h1>
            <p>
              {String(cls.name)} · {students.length} enrolled
              {typeof cls.capacity === "number"
                ? ` · ${Math.max(0, Number(cls.capacity) - students.length)} seat${Math.max(0, Number(cls.capacity) - students.length) === 1 ? "" : "s"} available of ${cls.capacity}`
                : " · Capacity not set"}
            </p>
          </div>
          <Link href="/administration" className="btn-secondary">
            Administration
          </Link>
        </div>
        <section className="panel" style={{ padding: 18 }}>
          <h2>Students</h2>
          {students.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Admission number</th>
                    <th>Student name</th>
                    <th>Status</th>
                    <th>Guardian contact</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id}>
                      <td>{s.admissionNumber}</td>
                      <td>
                        <Link href={`/students/${s.id}`}>{s.fullName}</Link>
                      </td>
                      <td>{s.status}</td>
                      <td>{s.guardianPhone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No students are enrolled in this configured class.</p>
          )}
        </section>
        <p className="panel-subtitle" style={{ marginTop: 14 }}>
          For year-specific classes the roster is sourced from enrollment records for that academic
          year, not the student’s latest class. Attendance, exam results and reports require their
          respective modules.
        </p>
      </main>
    </AppShell>
  );
}
