import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type CollaboratorRouteContext = { params: Promise<{ familyId: string }> };

export async function GET(_request: Request, ctx: CollaboratorRouteContext) {
  const { familyId } = await ctx.params;
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in to view collaborators." }, { status: 401 });
  const { data: memberships, error: membershipError } = await supabase.from("family_memberships").select("user_id,role").eq("family_id", familyId);
  if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 403 });
  const ids = (memberships ?? []).map((member) => member.user_id);
  const { data: profiles, error: profileError } = ids.length ? await supabase.from("profiles").select("id,display_name").in("id", ids) : { data: [], error: null };
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 403 });
  const names = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name]));
  return NextResponse.json({ collaborators: (memberships ?? []).map((member) => ({ ...member, display_name: names.get(member.user_id) || "Family member" })) });
}
