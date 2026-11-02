import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { EventsPanel } from "@/features/events/EventsPanel";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
export const dynamic = "force-dynamic";
export default async function EventsPage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  if (
    !hasPermission(context.permissions, "events.read") &&
    !hasPermission(context.permissions, "events.manage")
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
            <h3>Calendar access is restricted</h3>
            <p>Your role does not include event access.</p>
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
      <EventsPanel canManage={hasPermission(context.permissions, "events.manage")} />
    </AppShell>
  );
}
