import { redirect } from "next/navigation";
import { RegistrationPending } from "@/features/schools/RegistrationPending";
import { getSessionUid } from "@/server/context";

export const dynamic = "force-dynamic";

export default async function RegistrationPendingPage() {
  if (!(await getSessionUid())) redirect("/");
  return <RegistrationPending />;
}
