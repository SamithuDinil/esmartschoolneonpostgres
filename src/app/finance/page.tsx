import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { FinancePanel } from "@/features/finance/FinancePanel";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  const schoolName = school.data()?.name ?? "My school";
  const canRead = hasPermission(context.permissions, "finance.read");
  const canManage = hasPermission(context.permissions, "finance.manage");
  const canApprove = hasPermission(context.permissions, "finance.expenses.approve");
  return (
    <AppShell
      schoolName={schoolName}
      userName={context.displayName}
      role={context.role}
      permissions={context.permissions}
    >
      {canRead ? (
        <FinancePanel
          canManage={canManage}
          canApprove={canApprove}
          currency={school.data()?.currency ?? "LKR"}
        />
      ) : (
        <main className="page-content">
          <div className="notice">
            <div>
              <h3>Finance access is restricted</h3>
              <p>
                Your school role does not grant finance.read. Ask a school administrator to assign
                the finance permission.
              </p>
            </div>
          </div>
        </main>
      )}
    </AppShell>
  );
}
