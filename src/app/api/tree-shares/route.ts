import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { familyIdInput, treeShareInviteInput, treeShareResponseInput, treeShareRevokeInput } from "@/lib/validation";
import { rejectCrossOrigin } from "@/lib/tree-server";

async function session() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  return { supabase, userId: error ? undefined : data?.claims?.sub };
}

export async function GET(request: Request) {
  const familyId = new URL(request.url).searchParams.get("family_id");
  const { supabase, userId } = await session();
  if (!userId) return NextResponse.json({ error: "Sign in to view tree shares." }, { status: 401 });
  if (familyId) {
    const parsed = familyIdInput.safeParse({ family_id: familyId });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid family." }, { status: 400 });
    const { data, error } = await supabase.rpc("get_family_tree_shares", { p_family_id: parsed.data.family_id });
    if (error) return NextResponse.json({ error: "Could not load tree shares." }, { status: 403 });
    return NextResponse.json({ shares: data ?? [] });
  }
  const { data, error } = await supabase.rpc("get_my_tree_shares");
  if (error) return NextResponse.json({ error: "Could not load shared trees." }, { status: 500 });
  return NextResponse.json({ shares: data ?? [] });
}

export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return NextResponse.json({ error: "Request origin denied." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const { supabase, userId } = await session();
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (body?.action === "invite") {
    const parsed = treeShareInviteInput.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid Jibon ID." }, { status: 400 });
    const { error } = await supabase.rpc("invite_tree_viewer", { p_family_id: parsed.data.family_id, p_jibon_id: parsed.data.jibon_id });
    if (error) return NextResponse.json({ error: error.message || "Could not share this tree." }, { status: 403 });
    return NextResponse.json({ ok: true }, { status: 201 });
  }
  if (body?.action === "respond") {
    const parsed = treeShareResponseInput.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid tree share." }, { status: 400 });
    const { data: familyId, error } = await supabase.rpc("respond_tree_share", { p_share_id: parsed.data.id, p_accept: parsed.data.accept });
    if (error || !familyId) return NextResponse.json({ error: error?.message || "Could not respond to this tree share." }, { status: 403 });
    return NextResponse.json({ familyId });
  }
  if (body?.action === "revoke") {
    const parsed = treeShareRevokeInput.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid tree share." }, { status: 400 });
    const { error } = await supabase.rpc("revoke_tree_share", { p_share_id: parsed.data.id });
    if (error) return NextResponse.json({ error: error.message || "Could not revoke this tree share." }, { status: 403 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown tree-share action." }, { status: 400 });
}
