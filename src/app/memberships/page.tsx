import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { MembershipPanel } from "@/features/schools/MembershipPanel";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { GroupLinkManager, RegistrationRequestReview } from "@/features/schools/GroupRegistration";

export const dynamic = "force-dynamic";

export default async function MembershipsPage() {
  if (!(await getSessionUid())) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  const canRead = hasPermission(context.permissions, "memberships.read");
  const canReview =
    context.role === "principal" || hasPermission(context.permissions, "memberships.manage");
  return (
    <AppShell
      schoolName={school.data()?.name ?? "My school"}
      userName={context.displayName}
      role={context.role}
      permissions={context.permissions}
    >
      {canRead && (
        <MembershipPanel
          canManage={hasPermission(context.permissions, "memberships.manage")}
          isOwner={context.role === "school_owner"}
        />
      )}
      {canReview && (
        <>
          <GroupLinkManager />
          <RegistrationRequestReview />
        </>
      )}
    </AppShell>
  );
}
