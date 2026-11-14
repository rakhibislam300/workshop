import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { familyInvitationInput } from "@/lib/validation";
import { rejectCrossOrigin } from "@/lib/tree-server";

type InvitationRouteContext = { params: Promise<{ familyId: string }> };
type CreatedInvitation = { invitation_id: string; invitation_token: string | null; direct: boolean; reissued: boolean };

export async function GET(_request: Request, ctx: InvitationRouteContext) {
  const { familyId } = await ctx.params;
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in to view invitations." }, { status: 401 });
  const [{ data, error }, { data: myTreeProfiles, error: treeError }] = await Promise.all([
    supabase.from("family_invitations").select("id,invited_email,status,email_delivery_status,expires_at,created_at,invitee_name,invitee_relationship,inviter_tree_person_id").eq("family_id", familyId).order("created_at", { ascending: false }),
    supabase.from("tree_people").select("id,name").eq("family_id", familyId).eq("linked_user_id", claims.claims.sub).order("created_at"),
  ]);
  if (error || treeError) return NextResponse.json({ error: "Could not load household invitations. Please retry." }, { status: 403 });
  return NextResponse.json({ invitations: data, myTreeProfiles: myTreeProfiles ?? [] });
}

export async function POST(request: Request, ctx: InvitationRouteContext) {
  if (rejectCrossOrigin(request)) return NextResponse.json({ error: "Request origin denied." }, { status: 403 });
  const { familyId } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = familyInvitationInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (authError || !userId) return NextResponse.json({ error: "Sign in to invite a collaborator." }, { status: 401 });
  const { data: created, error } = await supabase.rpc("create_relationship_aware_family_invitation", {
    p_family_id: familyId,
    p_email: parsed.data.email ?? null,
    p_jibon_id: parsed.data.jibon_id ?? null,
    p_invitee_name: parsed.data.invitee_name,
    p_invitee_relationship: parsed.data.invitee_relationship,
    p_inviter_tree_person_id: parsed.data.inviter_tree_person_id,
  }).single();
  const data = created as CreatedInvitation | null;
  if (error || !data) return NextResponse.json({ error: error?.message || "Could not create the household invitation." }, { status: 400 });
  if (data.direct) return NextResponse.json({ delivery: "inbox", direct: true, reissued: data.reissued }, { status: 201 });
  if (!data.invitation_token) return NextResponse.json({ error: "Could not create the secure invitation link." }, { status: 500 });
  const token = data.invitation_token;
  const { error: queueError } = await supabase.rpc("queue_family_invitation_email", { p_invitation_id: data.invitation_id, p_token: token });
  return NextResponse.json({ invitationUrl: `${new URL(request.url).origin}/invitations/accept?token=${token}`, emailDelivery: queueError ? "not_requested" : "queued", reissued: data.reissued }, { status: 201 });
}

export async function DELETE(request: Request, ctx: InvitationRouteContext) {
  if (rejectCrossOrigin(request)) return NextResponse.json({ error: "Request origin denied." }, { status: 403 });
  const { familyId } = await ctx.params;
  const invitationId = new URL(request.url).searchParams.get("id");
  if (!invitationId) return NextResponse.json({ error: "Invitation id is required." }, { status: 400 });
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in to cancel an invitation." }, { status: 401 });
  const { error } = await supabase.from("family_invitations").delete().eq("id", invitationId).eq("family_id", familyId);
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
