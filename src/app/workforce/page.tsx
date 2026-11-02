import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { WorkforcePanel } from "@/features/workforce/WorkforcePanel";
export const dynamic = "force-dynamic";
export default async function WorkforcePage() {
  if (!(await getSessionUid())) redirect("/");
  const c = await getSchoolContext();
  if (!c) redirect("/dashboard");
  if (
    !hasPermission(c.permissions, "teachers.manage") &&
    !hasPermission(c.permissions, "staff.manage")
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
            <h3>Workforce management is restricted</h3>
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
      <WorkforcePanel
        canManageTeachers={hasPermission(c.permissions, "teachers.manage")}
        canManageStaff={hasPermission(c.permissions, "staff.manage")}
      />
    </AppShell>
  );
}
