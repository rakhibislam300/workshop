import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { invitationTokenInput } from "@/lib/validation";
import { InvitationAccept } from "@/components/invitation-accept";
export const instant = false;

export default async function InvitationAcceptPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  if (!invitationTokenInput.safeParse({ token }).success) redirect("/auth/login");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect(`/auth/login?next=${encodeURIComponent(`/invitations/accept?token=${token}`)}`);
  return <InvitationAccept token={token} />;
}
