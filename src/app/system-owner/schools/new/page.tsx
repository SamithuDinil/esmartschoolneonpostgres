import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Platform multi-school registration path removed; use self-service /setup. */
export default function NewSystemOwnerSchoolPage() {
  redirect("/setup");
}
