import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BackupPanel } from "@/features/backups/BackupPanel";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
export const dynamic = "force-dynamic";
export default async function BackupsPage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  if (
    !hasPermission(context.permissions, "backups.read") &&
    !hasPermission(context.permissions, "backups.manage")
  )
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
              <h3>Backup access is restricted</h3>
              <p>Only authorized administrators can view backup status or recovery controls.</p>
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
      <BackupPanel canManage={hasPermission(context.permissions, "backups.manage")} />
    </AppShell>
  );
}
