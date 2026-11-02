import { ParentInvitationAcceptance } from "@/features/schools/ParentInvitationAcceptance";

export default async function ParentInvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const params = await searchParams;
  return <ParentInvitationAcceptance token={params.token ?? ""} />;
}
