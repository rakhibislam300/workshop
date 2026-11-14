import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { familyIdInput } from "@/lib/validation";
import { rejectCrossOrigin } from "@/lib/tree-server";

export async function GET(request: Request) {
  const parsed = familyIdInput.safeParse({ family_id: new URL(request.url).searchParams.get("family_id") });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid family." }, { status: 400 });
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in to view your Jibon ID." }, { status: 401 });
  const { data, error } = await supabase.rpc("get_jibon_identity", { p_family_id: parsed.data.family_id }).maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Could not load your account identity." }, { status: 403 });
  return NextResponse.json({ identity: data });
}

export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return NextResponse.json({ error: "Request origin denied." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const parsed = familyIdInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid family." }, { status: 400 });
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in to rotate a Family Code." }, { status: 401 });
  const { data: familyCode, error } = await supabase.rpc("rotate_family_invite_code", { p_family_id: parsed.data.family_id });
  if (error || !familyCode) return NextResponse.json({ error: error?.message || "Could not rotate the Family Code." }, { status: 403 });
  return NextResponse.json({ familyCode });
}
