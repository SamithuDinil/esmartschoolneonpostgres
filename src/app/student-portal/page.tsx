import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { StudentPortal } from "@/features/portals/StudentPortal";

export const dynamic = "force-dynamic";

export default async function StudentPortalPage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  return (
    <AppShell
      schoolName={String(school.data()?.name ?? "My school")}
      userName={context.displayName}
      role={context.role}
      permissions={context.permissions}
    >
      {hasPermission(context.permissions, "profile.self.read") ? (
        <StudentPortal />
      ) : (
        <main className="page-content">
          <div className="notice">
            <div>
              <h3>Student portal access is restricted</h3>
              <p>Your school account does not have a self-scoped student grant.</p>
            </div>
          </div>
        </main>
      )}
    </AppShell>
  );
}
