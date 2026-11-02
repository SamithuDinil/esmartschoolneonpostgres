import { redirect } from "next/navigation";
import { getSchoolContext } from "@/server/context";

export const dynamic = "force-dynamic";

export default async function StudentDashboardPage() {
  const context = await getSchoolContext();
  if (!context || context.role !== "student") redirect("/dashboard");
  redirect("/student-portal");
}
