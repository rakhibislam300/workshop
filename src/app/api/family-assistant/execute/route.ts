import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { familyAssistantProposal, familyAssistantProposalToInput } from "@/lib/validation";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) return NextResponse.json({ error: "Sign in to confirm an assistant proposal." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const familyId = typeof body?.family_id === "string" ? body.family_id : "";
  const proposal = familyAssistantProposal.safeParse(body?.proposal);
  const editableInput = proposal.success ? familyAssistantProposalToInput(proposal.data) : null;
  if (!familyId || !proposal.success || !editableInput?.success) return NextResponse.json({ error: "This proposal is invalid or incomplete. Please prepare it again." }, { status: 400 });

  const membership = await supabase.from("family_memberships").select("family_id").eq("family_id", familyId).eq("user_id", userId).maybeSingle();
  if (membership.error || !membership.data) return NextResponse.json({ error: "You no longer have access to this family workspace." }, { status: 403 });

  const { entity, operation, record_id: recordId } = proposal.data;
  const values = editableInput.data;
  let error: { message: string } | null = null;
  let savedRecord: { id: string } | null = null;

  if (entity === "task") {
    if (operation === "create") ({ data: savedRecord, error } = await supabase.from("tasks").insert({ ...values, user_id: userId, family_id: familyId }).select("id").single());
    else ({ data: savedRecord, error } = await supabase.from("tasks").update(values).eq("id", recordId!).eq("family_id", familyId).select("id").maybeSingle());
  } else if (entity === "bill") {
    if (operation === "create") ({ data: savedRecord, error } = await supabase.from("bills").insert({ ...values, user_id: userId, family_id: familyId }).select("id").single());
    else ({ data: savedRecord, error } = await supabase.from("bills").update(values).eq("id", recordId!).eq("family_id", familyId).select("id").maybeSingle());
  } else {
    if (operation === "create") ({ data: savedRecord, error } = await supabase.from("appointments").insert({ ...values, user_id: userId, family_id: familyId }).select("id").single());
    else ({ data: savedRecord, error } = await supabase.from("appointments").update(values).eq("id", recordId!).eq("family_id", familyId).select("id").maybeSingle());
  }
  if (error) return NextResponse.json({ error: "The confirmed change could not be saved. Please check the record and try again." }, { status: 400 });
  if (!savedRecord) return NextResponse.json({ error: "That record is no longer available in this family. Please prepare a new proposal." }, { status: 404 });
  return NextResponse.json({ message: `${entity[0].toUpperCase() + entity.slice(1)} ${operation === "create" ? "created" : "updated"} after your confirmation.` });
}
