import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { ParentPortal } from "@/features/portals/ParentPortal";

export const dynamic = "force-dynamic";

export default async function ParentPortalPage() {
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
      {hasPermission(context.permissions, "students.linked.read") ? (
        <ParentPortal />
      ) : (
        <main className="page-content">
          <div className="notice">
            <div>
              <h3>Parent portal access is restricted</h3>
              <p>Guardian access is limited to verified linked children.</p>
            </div>
          </div>
        </main>
      )}
    </AppShell>
  );
}
