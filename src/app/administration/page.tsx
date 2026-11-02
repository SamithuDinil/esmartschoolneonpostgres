import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { AdministrationPanel } from "@/features/schools/AdministrationPanel";
export const dynamic = "force-dynamic";
export default async function AdministrationRoute() {
  const uid = await getSessionUid();
  if (!uid) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  if (!hasPermission(context.permissions, "school.manage"))
    return (
      <AppShell
        schoolName="School"
        userName={context.displayName}
        role={context.role}
        permissions={context.permissions}
      >
        <main className="page-content">
          <div className="notice">
            <div>
              <h3>School administration is restricted</h3>
              <p>Ask a school administrator for access.</p>
            </div>
          </div>
        </main>
      </AppShell>
    );
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  return (
    <AppShell
      schoolName={school.data()?.name ?? "My school"}
      userName={context.displayName}
      role={context.role}
      permissions={context.permissions}
    >
      <AdministrationPanel />
    </AppShell>
  );
}
