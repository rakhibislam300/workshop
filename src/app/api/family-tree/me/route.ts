import { z } from "zod";
import { rejectCrossOrigin, treeSession } from "@/lib/tree-server";

const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return fail("Request origin denied.", 403);
  const input = z.object({ family_id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!input.success) return fail("Choose a valid family.");
  const { db, userId } = await treeSession();
  if (!userId) return fail("Sign in first.", 401);
  const { data: personId, error } = await db.rpc("ensure_my_family_tree_profile", { p_family_id: input.data.family_id });
  if (error || !personId) return fail(error?.message || "Could not create your linked family profile.", 403);
  return Response.json({ personId });
}
