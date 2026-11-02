import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AssignmentsPanel } from "@/features/assignments/AssignmentsPanel";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";

export const dynamic = "force-dynamic";

export default async function AssignmentsPage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  const canAccess = [
    "assignments.manage",
    "assignments.manage.assigned",
    "assignments.read",
    "assignments.self.read",
    "assignments.linked.read",
  ].some((permission) => hasPermission(context.permissions, permission));
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  const appShell = (children: React.ReactNode) => (
    <AppShell
      schoolName={String(school.get("name") ?? "My school")}
      userName={context.displayName}
      role={context.role}
      permissions={context.permissions}
    >
      {children}
    </AppShell>
  );
  if (!canAccess)
    return appShell(
      <main className="page-content">
        <div className="notice">
          <h3>Assignment access is restricted</h3>
          <p>
            Ask your school administrator to grant the appropriate class, student or guardian
            assignment permission.
          </p>
        </div>
      </main>,
    );
  return appShell(
    <AssignmentsPanel
      role={context.role}
      canManage={
        hasPermission(context.permissions, "assignments.manage") ||
        hasPermission(context.permissions, "assignments.manage.assigned")
      }
      isStudent={context.role === "student"}
      isParent={context.role === "parent"}
    />,
  );
}
