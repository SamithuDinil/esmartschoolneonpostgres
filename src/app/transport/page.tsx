import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { TransportPanel } from "@/features/transport/TransportPanel";

export const dynamic = "force-dynamic";

export default async function TransportPage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  const canRead =
    hasPermission(context.permissions, "transport.read") ||
    hasPermission(context.permissions, "transport.manage");
  const canManage = hasPermission(context.permissions, "transport.manage");
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  return (
    <AppShell
      schoolName={school.data()?.name ?? "My school"}
      userName={context.displayName}
      role={context.role}
      permissions={context.permissions}
    >
      {canRead ? (
        <TransportPanel canManage={canManage} />
      ) : (
        <main className="page-content">
          <div className="notice">
            <div>
              <h3>Transport access is restricted</h3>
              <p>
                Your role does not have transport.read or transport.manage for the active school.
              </p>
            </div>
          </div>
        </main>
      )}
    </AppShell>
  );
}
