import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { invitationTokenInput } from "@/lib/validation";
import { rejectCrossOrigin } from "@/lib/tree-server";

function inviteError(message: string | undefined) {
  if (message?.includes("Sign in with the email address")) return "This invitation is locked to the email address it was sent to. Switch to that account, then open the newest invitation link again.";
  if (message?.includes("invalid, expired, or already used")) return "This invitation link is no longer active. Ask the family owner to create a fresh invitation and use only that newest link.";
  return "This invitation could not be accepted. Confirm you are signed in with the invited email address, then try the newest link again.";
}

export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return NextResponse.json({ error: "Request origin denied." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const parsed = invitationTokenInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in with the invited email address first." }, { status: 401 });
  const { data: familyId, error } = await supabase.rpc("accept_family_invitation", { p_token: parsed.data.token });
  if (error || !familyId) return NextResponse.json({ error: inviteError(error?.message) }, { status: 400 });
  return NextResponse.json({ familyId });
}
