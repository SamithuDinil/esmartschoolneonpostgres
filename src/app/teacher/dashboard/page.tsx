import { redirect } from "next/navigation";
import { getSchoolContext } from "@/server/context";

export const dynamic = "force-dynamic";

export default async function TeacherDashboardPage() {
  const context = await getSchoolContext();
  if (!context || !["teacher", "class_teacher", "subject_teacher"].includes(context.role))
    redirect("/dashboard");
  redirect("/teacher");
}
