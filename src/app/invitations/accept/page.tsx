import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { invitationTokenInput } from "@/lib/validation";
import { InvitationAccept } from "@/components/invitation-accept";
import { edgeKinds } from "@/lib/family-tree";
export const instant = false;
type InvitationPreview = { family_name: string; inviter_name: string; invitee_name: string | null; invitee_relationship: keyof typeof edgeKinds | null; expires_at: string };

export default async function InvitationAcceptPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  if (!invitationTokenInput.safeParse({ token }).success) redirect("/auth/login");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect(`/auth/login?next=${encodeURIComponent(`/invitations/accept?token=${token}`)}`);
  const email = typeof data.claims.email === "string" ? data.claims.email : "your current account";
  const { data: preview } = await supabase.rpc("get_family_invitation_preview", { p_token: token }).maybeSingle();
  return <InvitationAccept token={token} signedInEmail={email} preview={preview as InvitationPreview | null} />;
}
