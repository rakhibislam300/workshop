import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { collaboratorRoleInput } from "@/lib/validation";
import { rejectCrossOrigin } from "@/lib/tree-server";

type CollaboratorMutationContext = { params: Promise<{ familyId: string; userId: string }> };

export async function PATCH(request: Request, ctx: CollaboratorMutationContext) {
  if (rejectCrossOrigin(request)) return NextResponse.json({ error: "Request origin denied." }, { status: 403 });
  const { familyId, userId } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = collaboratorRoleInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in to manage roles." }, { status: 401 });
  const { error } = await supabase.rpc("update_family_member_role", { p_family_id: familyId, p_user_id: userId, p_role: parsed.data.role });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, ctx: CollaboratorMutationContext) {
  if (rejectCrossOrigin(request)) return NextResponse.json({ error: "Request origin denied." }, { status: 403 });
  const { familyId, userId } = await ctx.params;
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in to remove a collaborator." }, { status: 401 });
  const { error } = await supabase.rpc("remove_family_collaborator", { p_family_id: familyId, p_user_id: userId });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
