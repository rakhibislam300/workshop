import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { invitationTokenInput } from "@/lib/validation";
import { rejectCrossOrigin } from "@/lib/tree-server";

export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return NextResponse.json({ error: "Request origin denied." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const parsed = invitationTokenInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in with the invited email address first." }, { status: 401 });
  const { data: familyId, error } = await supabase.rpc("accept_family_invitation", { p_token: parsed.data.token });
  if (error || !familyId) return NextResponse.json({ error: error?.message || "Could not accept this invitation." }, { status: 400 });
  return NextResponse.json({ familyId });
}
