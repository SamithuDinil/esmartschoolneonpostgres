import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { LibraryPanel } from "@/features/library/LibraryPanel";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  const canRead =
    hasPermission(context.permissions, "library.manage") ||
    hasPermission(context.permissions, "library.reports.read");
  if (!canRead) {
    return (
      <AppShell
        schoolName="School"
        userName={context.displayName}
        role={context.role}
        permissions={context.permissions}
      >
        <main className="page-content">
          <div className="notice">
            <h3>Library access is restricted</h3>
            <p>Your role does not include library management or reporting access.</p>
          </div>
        </main>
      </AppShell>
    );
  }
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  return (
    <AppShell
      schoolName={String(school.data()?.name ?? "My school")}
      userName={context.displayName}
      role={context.role}
      permissions={context.permissions}
    >
      <LibraryPanel canManage={hasPermission(context.permissions, "library.manage")} />
    </AppShell>
  );
}
