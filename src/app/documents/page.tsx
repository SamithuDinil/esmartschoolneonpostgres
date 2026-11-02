import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { DocumentsPanel } from "@/features/documents/DocumentsPanel";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
export const dynamic = "force-dynamic";
export default async function DocumentsPage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  if (!hasPermission(context.permissions, "documents.read"))
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
              <h3>Document access is restricted</h3>
              <p>Your role does not include private document access.</p>
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
      <DocumentsPanel />
    </AppShell>
  );
}
