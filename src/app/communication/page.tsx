import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { CommunicationPanel } from "@/features/communication/CommunicationPanel";

export const dynamic = "force-dynamic";

export default async function CommunicationPage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  const canManage =
    hasPermission(context.permissions, "announcements.manage") ||
    hasPermission(context.permissions, "announcements.create");
  const canRead = canManage || hasPermission(context.permissions, "announcements.targeted.read");
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  return (
    <AppShell
      schoolName={String(school.data()?.name ?? "My school")}
      userName={context.displayName}
      role={context.role}
      permissions={context.permissions}
    >
      {canRead ? (
        <CommunicationPanel canManage={canManage} />
      ) : (
        <main className="page-content">
          <div className="notice">
            <div>
              <h3>Communication access is restricted</h3>
              <p>
                Only authorized school communicators and targeted recipients can open this center.
              </p>
            </div>
          </div>
        </main>
      )}
    </AppShell>
  );
}
