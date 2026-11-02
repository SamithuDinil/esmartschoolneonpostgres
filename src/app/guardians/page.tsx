import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { GuardianDirectory } from "@/features/students/GuardianDirectory";
export const dynamic = "force-dynamic";
export default async function GuardianPage() {
  if (!(await getSessionUid())) redirect("/");
  const c = await getSchoolContext();
  if (!c) redirect("/dashboard");
  const parent = c.role === "parent";
  if (!parent && !hasPermission(c.permissions, "guardians.read"))
    return (
      <AppShell
        schoolName="School"
        userName={c.displayName}
        role={c.role}
        permissions={c.permissions}
      >
        <main className="page-content">
          <div className="notice">
            <h3>Guardian directory access is restricted</h3>
          </div>
        </main>
      </AppShell>
    );
  const school = await getAdminServices().db.collection("schools").doc(c.schoolId).get();
  return (
    <AppShell
      schoolName={school.data()?.name ?? "My school"}
      userName={c.displayName}
      role={c.role}
      permissions={c.permissions}
    >
      <GuardianDirectory parent={parent} canManage={hasPermission(c.permissions, "guardians.manage")} />
    </AppShell>
  );
}
