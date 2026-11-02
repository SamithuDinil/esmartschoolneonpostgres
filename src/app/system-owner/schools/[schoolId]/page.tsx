import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Platform school management removed in isolated-schools redesign. */
export default function SchoolDetailPage() {
  redirect("/dashboard");
}
