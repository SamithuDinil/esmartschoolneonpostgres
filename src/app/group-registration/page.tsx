import { GroupRegistration } from "@/features/schools/GroupRegistration";
export const dynamic = "force-dynamic";
export default async function GroupRegistrationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  return <GroupRegistration token={params.token ?? ""} />;
}
