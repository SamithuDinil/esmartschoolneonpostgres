import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { AiAssistantPanel } from "@/features/ai/AiAssistantPanel";

export const dynamic = "force-dynamic";
export default async function AiAssistantPage() {
  const uid = await getSessionUid();
  if (!uid) redirect("/");
  const context = await getSchoolContext();
  if (!context) redirect("/dashboard");
  const school = await getAdminServices().db.collection("schools").doc(context.schoolId).get();
  if (!hasPermission(context.permissions, "ai.assistant"))
    return (
      <AppShell
        schoolName={String(school.get("name") ?? "School")}
        userName={context.displayName}
        role={context.role}
        permissions={context.permissions}
      >
        <main className="page-content">
          <div className="notice">
            <div>
              <h3>AI assistant is restricted</h3>
              <p>Ask a school administrator for access to aggregate operational summaries.</p>
            </div>
          </div>
        </main>
      </AppShell>
    );
  return (
    <AppShell
      schoolName={String(school.get("name") ?? "School")}
      userName={context.displayName}
      role={context.role}
      permissions={context.permissions}
    >
      <AiAssistantPanel />
    </AppShell>
  );
}
