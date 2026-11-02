import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Platform control center removed in isolated-schools redesign. */
export default function PlatformPage() {
  redirect("/dashboard");
}
