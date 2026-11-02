import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ResultsPanel } from "@/features/results/ResultsPanel";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
export const dynamic = "force-dynamic";
export default async function ResultsPage() {
  if (!(await getSessionUid())) redirect("/");
  const c = await getSchoolContext();
  if (!c) redirect("/dashboard");
  const allowed = [
    "exams.read",
    "exams.read.assigned",
    "marks.enter.assigned",
    "exams.manage",
    "reports.read",
    "results.published.self.read",
    "results.published.linked.read",
  ].some((p) => hasPermission(c.permissions, p));
  if (!allowed)
    return (
      <AppShell
        schoolName="School"
        userName={c.displayName}
        role={c.role}
        permissions={c.permissions}
      >
        <main className="page-content">
          <div className="notice">
            <h3>Result access is restricted</h3>
          </div>
        </main>
      </AppShell>
    );
  const school = await getAdminServices().db.collection("schools").doc(c.schoolId).get();
  return (
    <AppShell
      schoolName={school.get("name") ?? "My school"}
      userName={c.displayName}
      role={c.role}
      permissions={c.permissions}
    >
      <ResultsPanel canConfigure={hasPermission(c.permissions, "academics.manage")} />
    </AppShell>
  );
}
