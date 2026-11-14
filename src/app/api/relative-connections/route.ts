import { connectionCommand } from "@/lib/family-tree";
import { rejectCrossOrigin, treeSession } from "@/lib/tree-server";
const fail = (error: string, status = 400) => Response.json({ error }, { status });
export async function GET() {
  const { db, userId } = await treeSession();
  if (!userId) return fail("Sign in first.", 401);
  const { data, error } = await db.from("relative_connections").select("id,sender_id,recipient_id,recipient_email,sender_name,recipient_name,relationship,status,expires_at").order("created_at", { ascending: false });
  if (error) return fail("Could not load invitations.", 500);
  return Response.json({ connections: data.map(c => ({ ...c, status: c.status === "pending" && new Date(c.expires_at).getTime() <= Date.now() ? "expired" : c.status })) }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return fail("Request origin denied.", 403);
  const { db, userId } = await treeSession();
  if (!userId) return fail("Sign in first.", 401);
  const input = connectionCommand.safeParse(await request.json().catch(() => null));
  if (!input.success) return fail(input.error.issues[0]?.message ?? "Invalid invitation.");
  const v = input.data;
  const { error } = v.action === "invite"
    ? await db.rpc("invite_relative", { p_email: v.email, p_name: v.name, p_relationship: v.relationship })
    : await db.rpc("respond_relative", { p_id: v.id, p_action: v.action, p_name: v.action === "accept" ? v.name : null });
  if (error) return fail(error.code === "P0001" ? error.message : "Could not update this invitation. Refresh and retry.");
  return Response.json({ ok: true });
}
