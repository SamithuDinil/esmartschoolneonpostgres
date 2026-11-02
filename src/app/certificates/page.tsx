import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { CertificatePanel } from "@/features/certificates/CertificatePanel";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
export const dynamic = "force-dynamic";
export default async function CertificatesPage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  const canRead =
    hasPermission(context.permissions, "certificate.read") ||
    hasPermission(context.permissions, "certificate.manage") ||
    hasPermission(context.permissions, "certificate.approve");
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  if (!canRead)
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
              <h3>Certificate access is restricted</h3>
              <p>Only authorized school personnel can prepare or issue official certificates.</p>
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
      <CertificatePanel
        canApprove={hasPermission(context.permissions, "certificate.approve")}
        canIssue={hasPermission(context.permissions, "certificate.manage")}
        canManage={hasPermission(context.permissions, "certificate.manage")}
      />
    </AppShell>
  );
}
