import { z } from "zod";
import { personInput } from "@/lib/family-tree";
import { rejectCrossOrigin, treeSession } from "@/lib/tree-server";

const claimCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("respond"), id: z.string().uuid(), response: z.enum(["accept", "decline"]) }),
  z.object({ action: z.literal("save_profile"), person_id: z.string().uuid(), person: personInput }),
]);
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { db, userId } = await treeSession();
  if (!userId) return fail("Sign in to manage your family profile.", 401);
  const { data, error } = await db.from("tree_profile_claims")
    .select("id,person_id,family_id,status,created_at,tree_people(id,name,birth_year,death_year,biography,birthplace,linked_user_id)")
    .eq("claimant_id", userId).in("status", ["pending", "accepted"]).order("created_at", { ascending: false });
  if (error) return fail("Could not load your profile requests.", 500);
  return Response.json({ claims: data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return fail("Request origin denied.", 403);
  const { db, userId } = await treeSession();
  if (!userId) return fail("Sign in first.", 401);
  const input = claimCommand.safeParse(await request.json().catch(() => null));
  if (!input.success) return fail(input.error.issues[0]?.message ?? "Invalid profile request.");
  if (input.data.action === "respond") {
    const { error } = await db.rpc("respond_tree_profile_claim", { p_claim_id: input.data.id, p_action: input.data.response });
    return error ? fail(error.code === "P0001" ? error.message : "Could not update that profile request.") : Response.json({ ok: true });
  }
  const { data: current, error: readError } = await db.from("tree_people").select("linked_user_id").eq("id", input.data.person_id).maybeSingle();
  if (readError || !current || current.linked_user_id !== userId) return fail("You can only update your accepted profile.", 403);
  const { error } = await db.from("tree_people").update(input.data.person).eq("id", input.data.person_id);
  return error ? fail("Could not save your profile.") : Response.json({ ok: true });
}
