import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { ExamsPanel } from "@/features/exams/ExamsPanel";
export const dynamic = "force-dynamic";
export default async function ExamsPage() {
  if (!(await getSessionUid())) redirect("/");
  const c = await getSchoolContext();
  if (!c) redirect("/dashboard");
  if (
    ![
      "exams.read",
      "exams.read.assigned",
      "exams.manage",
      "marks.enter",
      "marks.enter.assigned",
      "exams.approve",
    ].some((p) => hasPermission(c.permissions, p))
  )
    return (
      <AppShell
        schoolName="School"
        userName={c.displayName}
        role={c.role}
        permissions={c.permissions}
      >
        <main className="page-content">
          <div className="notice">
            <h3>Examination access is restricted</h3>
          </div>
        </main>
      </AppShell>
    );
  const s = await getAdminServices().db.collection("schools").doc(c.schoolId).get();
  return (
    <AppShell
      schoolName={s.data()?.name ?? "My school"}
      userName={c.displayName}
      role={c.role}
      permissions={c.permissions}
    >
      <ExamsPanel />
    </AppShell>
  );
}
