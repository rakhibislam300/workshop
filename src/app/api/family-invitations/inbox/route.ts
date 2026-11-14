import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { invitationIdInput } from "@/lib/validation";
import { rejectCrossOrigin } from "@/lib/tree-server";

function acceptError(message: string | undefined) {
  if (message?.includes("Sign in with the email address")) return "This invitation is for a different email address. Sign in with the invited account, then try again.";
  if (message?.includes("invalid, expired, or already used")) return "This invitation is no longer active. Ask the family owner to send a new one.";
  return "This invitation could not be accepted. Refresh your inbox and try again.";
}

export async function GET() {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in to view your invitation inbox." }, { status: 401 });
  const { data, error } = await supabase.rpc("get_my_family_invitations");
  if (error) return NextResponse.json({ error: "Could not load your invitation inbox." }, { status: 500 });
  return NextResponse.json({ invitations: data ?? [] });
}

export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return NextResponse.json({ error: "Request origin denied." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const parsed = invitationIdInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid invitation." }, { status: 400 });
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in with the invited email address first." }, { status: 401 });
  const { data: familyId, error } = await supabase.rpc("accept_family_invitation_by_id", { p_invitation_id: parsed.data.id });
  if (error || !familyId) return NextResponse.json({ error: acceptError(error?.message) }, { status: 400 });
  return NextResponse.json({ familyId });
}
