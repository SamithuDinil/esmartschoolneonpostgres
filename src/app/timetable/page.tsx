import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { TimetablePanel } from "@/features/timetable/TimetablePanel";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
export const dynamic = "force-dynamic";
export default async function TimetablePage() {
  if (!(await getSessionUid())) redirect("/");
  const c = await getSchoolContext();
  if (!c) redirect("/dashboard");
  const allowed = ["academics.read", "academics.manage", "teachers.self.read"].some((p) =>
    hasPermission(c.permissions, p),
  );
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
            <h3>Timetable access is restricted</h3>
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
      <TimetablePanel
        canManage={
          hasPermission(c.permissions, "academics.manage") ||
          hasPermission(c.permissions, "timetable.manage")
        }
      />
    </AppShell>
  );
}
