import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { RoleAccessPanel } from "@/features/permissions/RoleAccessPanel";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";

export const dynamic = "force-dynamic";
export default async function RoleAccessPage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  if (!["school_owner", "school_admin", "principal"].includes(context.role)) redirect("/dashboard");
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  return <AppShell schoolName={school.get("name") ?? "My school"} userName={context.displayName} role={context.role} permissions={context.permissions}><RoleAccessPanel /></AppShell>;
}
