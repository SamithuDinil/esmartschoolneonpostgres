import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** System-owner dashboard removed in isolated-schools redesign. */
export default function SystemOwnerDashboard() {
  redirect("/dashboard");
}
