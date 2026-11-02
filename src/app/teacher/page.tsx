import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { TeacherDashboard } from "@/features/workforce/TeacherDashboard";
export const dynamic = "force-dynamic";
export default async function TeacherPage() {
  if (!(await getSessionUid())) redirect("/");
  const c = await getSchoolContext();
  if (!c) redirect("/dashboard");
  if (
    !hasPermission(c.permissions, "teachers.self.read") &&
    !hasPermission(c.permissions, "teachers.read")
  )
    return (
      <AppShell
        schoolName="School"
        userName={c.displayName}
        role={c.role}
        permissions={c.permissions}
      >
        <main className="page-content">
          <div className="notice">
            <h3>Teacher dashboard is not available to this role</h3>
          </div>
        </main>
      </AppShell>
    );
  const s = await getAdminServices().db.collection("schools").doc(c.schoolId).get();
  return (
    <AppShell
      schoolName={s.data()?.name ?? "My school"}
      userName={c.displayName}
      role={c.role}
      permissions={c.permissions}
    >
      <TeacherDashboard permissions={c.permissions} />
    </AppShell>
  );
}
