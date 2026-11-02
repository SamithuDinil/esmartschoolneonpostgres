import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { StudentProfile } from "@/features/students/StudentProfile";
export const dynamic = "force-dynamic";
export default async function StudentProfileRoute({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  if (!(await getSessionUid())) redirect("/");
  const c = await getSchoolContext();
  if (!c || !hasPermission(c.permissions, "students.read")) redirect("/students");
  const school = await getAdminServices().db.collection("schools").doc(c.schoolId).get();
  const { studentId } = await params;
  return (
    <AppShell
      schoolName={school.data()?.name ?? "My school"}
      userName={c.displayName}
      role={c.role}
      permissions={c.permissions}
    >
      <StudentProfile
        studentId={studentId}
        canLinkAccount={hasPermission(c.permissions, "students.account.link")}
        canManageRecords={c.role === "school_owner" || c.role === "principal"}
      />
    </AppShell>
  );
}
