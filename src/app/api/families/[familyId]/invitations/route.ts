import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { familyInvitationInput } from "@/lib/validation";

async function sha256(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type InvitationRouteContext = { params: Promise<{ familyId: string }> };

export async function GET(_request: Request, ctx: InvitationRouteContext) {
  const { familyId } = await ctx.params;
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in to view invitations." }, { status: 401 });
  const { data, error } = await supabase.from("family_invitations").select("id,invited_email,status,expires_at,created_at").eq("family_id", familyId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ invitations: data });
}

export async function POST(request: Request, ctx: InvitationRouteContext) {
  const { familyId } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = familyInvitationInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (authError || !userId) return NextResponse.json({ error: "Sign in to invite a collaborator." }, { status: 401 });
  const token = crypto.randomUUID();
  const { error } = await supabase.from("family_invitations").insert({ family_id: familyId, invited_email: parsed.data.email.toLowerCase(), invited_by: userId, token_hash: await sha256(token) });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ invitationUrl: `${new URL(request.url).origin}/invitations/accept?token=${token}` }, { status: 201 });
}

export async function DELETE(request: Request, ctx: InvitationRouteContext) {
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
