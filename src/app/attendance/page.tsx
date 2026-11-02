import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { AttendancePanel } from "@/features/attendance/AttendancePanel";
export const dynamic = "force-dynamic";
export default async function AttendancePage() {
  if (!(await getSessionUid())) redirect("/");
  const c = await getSchoolContext();
  if (!c) redirect("/dashboard");
  if (
    ![
      "attendance.read",
      "attendance.mark",
      "attendance.read.assigned",
      "attendance.mark.assigned",
      "attendance.correct",
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
            <h3>Attendance access is restricted</h3>
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
      <AttendancePanel
        canAssignCover={
          hasPermission(c.permissions, "attendance.mark") ||
          hasPermission(c.permissions, "teachers.manage")
        }
        canViewInsights={hasPermission(c.permissions, "attendance.read")}
        canReviewLeaves={hasPermission(c.permissions, "leave.manage")}
      />
    </AppShell>
  );
}
