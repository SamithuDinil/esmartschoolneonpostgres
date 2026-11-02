import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { getAdminServices } from "@/lib/firebase/admin";
import { StudentRegistry } from "@/features/students/StudentRegistry";

export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  const canRead = hasPermission(context.permissions, "students.read");
  if (!canRead)
    return (
      <AppShell
        schoolName="School"
        userName={context.displayName}
        role={context.role}
        permissions={context.permissions}
      >
        <main className="page-content">
          <div className="notice">
            <Users size={18} />
            <div>
              <h3>Student records are not available to this role</h3>
              <p>Ask your school administrator if you need student access.</p>
            </div>
          </div>
        </main>
      </AppShell>
    );
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  return (
    <AppShell
      schoolName={school.data()?.name ?? "My school"}
      userName={context.displayName}
      role={context.role}
      permissions={context.permissions}
    >
      <StudentRegistry
        canCreate={hasPermission(context.permissions, "students.create")}
        canApprove={hasPermission(context.permissions, "students.approve")}
      />
    </AppShell>
  );
}
