import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AnalyticsPanel } from "@/features/analytics/AnalyticsPanel";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
export const dynamic = "force-dynamic";
export default async function AnalyticsPage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  if (
    !hasPermission(context.permissions, "analytics.read") &&
    !hasPermission(context.permissions, "reports.read")
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
            <h3>Analytics access is restricted</h3>
            <p>Reports are available only to authorized school roles.</p>
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
      <AnalyticsPanel />
    </AppShell>
  );
}
