import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { SchoolSetupForm } from "@/features/schools/SchoolSetupForm";
import { getSchoolContext, getSessionUid } from "@/server/context";

export const dynamic = "force-dynamic";

/**
 * Self-service school setup for any authenticated user who does not yet have
 * an active school workspace (isolated-schools redesign).
 */
export default async function SchoolSetupPage() {
  const uid = await getSessionUid();
  if (!uid) redirect("/");

  const context = await getSchoolContext();
  if (context) redirect("/dashboard");

  return (
    <AppShell schoolName="New school" userName="You" role="school_owner" permissions={[]}>
      <main className="page-content">
        <SchoolSetupForm />
      </main>
    </AppShell>
  );
}
