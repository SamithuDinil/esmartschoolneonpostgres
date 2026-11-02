import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { WelfarePanel } from "@/features/welfare/WelfarePanel";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
export const dynamic = "force-dynamic";
export default async function WelfarePage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  if (
    !hasPermission(context.permissions, "welfare.read") &&
    !hasPermission(context.permissions, "welfare.manage")
  )
    return (
      <AppShell
        schoolName="School"
        userName={context.displayName}
        role={context.role}
        permissions={context.permissions}
      >
        <main className="page-content">
          <div className="notice">
            <h3>Welfare access is restricted</h3>
            <p>Only specifically authorized school personnel can open sensitive welfare records.</p>
          </div>
        </main>
      </AppShell>
    );
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  return (
    <AppShell
      schoolName={school.get("name") ?? "My school"}
      userName={context.displayName}
      role={context.role}
      permissions={context.permissions}
    >
      <WelfarePanel canManage={hasPermission(context.permissions, "welfare.manage")} />
    </AppShell>
  );
}
