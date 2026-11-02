import { redirect } from "next/navigation";
import SchoolDashboard from "@/features/dashboard/SchoolDashboard";
import { getSchoolContext } from "@/server/context";

export const dynamic = "force-dynamic";

export default async function PrincipalDashboardPage() {
  const context = await getSchoolContext();
  if (context?.role !== "principal") redirect("/dashboard");
  return <SchoolDashboard roleRoute="principal" />;
}
