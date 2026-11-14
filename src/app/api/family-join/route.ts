import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { familyIdInput, familyJoinRequestInput, joinRequestReviewInput } from "@/lib/validation";
import { rejectCrossOrigin } from "@/lib/tree-server";

async function session() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  return { supabase, userId: error ? undefined : data?.claims?.sub };
}

export async function GET(request: Request) {
  const parsed = familyIdInput.safeParse({ family_id: new URL(request.url).searchParams.get("family_id") });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid family." }, { status: 400 });
  const { supabase, userId } = await session();
  if (!userId) return NextResponse.json({ error: "Sign in to review join requests." }, { status: 401 });
  const { data, error } = await supabase.rpc("get_family_join_requests", { p_family_id: parsed.data.family_id });
  if (error) return NextResponse.json({ error: "Could not load join requests." }, { status: 403 });
  return NextResponse.json({ requests: data ?? [] });
}

export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return NextResponse.json({ error: "Request origin denied." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const parsed = familyJoinRequestInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid Family Code." }, { status: 400 });
  const { supabase, userId } = await session();
  if (!userId) return NextResponse.json({ error: "Sign in to request access." }, { status: 401 });
  const { error } = await supabase.rpc("request_join_family_by_code", { p_family_code: parsed.data.family_code });
  if (error) return NextResponse.json({ error: error.message || "Could not submit your join request." }, { status: 400 });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (rejectCrossOrigin(request)) return NextResponse.json({ error: "Request origin denied." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const parsed = joinRequestReviewInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid join request." }, { status: 400 });
  const { supabase, userId } = await session();
  if (!userId) return NextResponse.json({ error: "Sign in to review join requests." }, { status: 401 });
  const { data: familyId, error } = await supabase.rpc("review_family_join_request", { p_request_id: parsed.data.id, p_approved: parsed.data.approved });
  if (error || !familyId) return NextResponse.json({ error: error?.message || "Could not review this join request." }, { status: 403 });
  return NextResponse.json({ familyId });
}
