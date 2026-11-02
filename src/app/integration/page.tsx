import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { IntegrationPanel } from "@/features/integration/IntegrationPanel";

export const dynamic = "force-dynamic";
export default async function IntegrationPage() {
  const uid = await getSessionUid();
  if (!uid) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  if (!hasPermission(context.permissions, "integration.read"))
    return (
      <AppShell
        schoolName={String(school.get("name") ?? "School")}
        userName={context.displayName}
        role={context.role}
        permissions={context.permissions}
      >
        <main className="page-content">
          <div className="notice">
            <div>
              <h3>Integration health is restricted</h3>
              <p>Ask a school administrator or reporting lead for access.</p>
            </div>
          </div>
        </main>
      </AppShell>
    );
  return (
    <AppShell
      schoolName={String(school.get("name") ?? "School")}
      userName={context.displayName}
      role={context.role}
      permissions={context.permissions}
    >
      <IntegrationPanel />
    </AppShell>
  );
}
