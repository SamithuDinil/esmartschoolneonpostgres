import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BulkOperationsPanel } from "@/features/bulk/BulkOperationsPanel";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
export const dynamic = "force-dynamic";
export default async function BulkOperationsPage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  if (!hasPermission(context.permissions, "bulk.manage"))
    return (
      <AppShell
        schoolName={school.get("name") ?? "My school"}
        userName={context.displayName}
        role={context.role}
        permissions={context.permissions}
      >
        <main className="page-content">
          <div className="notice">
            <div>
              <h3>Bulk management is restricted</h3>
              <p>This workspace is available to authorized school administrators only.</p>
            </div>
          </div>
        </main>
      </AppShell>
    );
  return (
    <AppShell
      schoolName={school.get("name") ?? "My school"}
      userName={context.displayName}
      role={context.role}
      permissions={context.permissions}
    >
      <BulkOperationsPanel />
    </AppShell>
  );
}
