import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { InventoryPanel } from "@/features/inventory/InventoryPanel";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  const allowed =
    hasPermission(context.permissions, "inventory.read") ||
    hasPermission(context.permissions, "inventory.manage") ||
    hasPermission(context.permissions, "inventory.reports.read");
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  return (
    <AppShell
      schoolName={String(school.data()?.name ?? "My school")}
      userName={context.displayName}
      role={context.role}
      permissions={context.permissions}
    >
      {allowed ? (
        <InventoryPanel canManage={hasPermission(context.permissions, "inventory.manage")} />
      ) : (
        <main className="page-content">
          <div className="notice">
            <div>
              <h3>Inventory access is restricted</h3>
              <p>Your role does not include an inventory grant for this school.</p>
            </div>
          </div>
        </main>
      )}
    </AppShell>
  );
}
