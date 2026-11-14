import { z } from "zod";
import { childKinds, parentalKinds, treeCommand } from "@/lib/family-tree";
import { familyPermission, photoBucket, rejectCrossOrigin, treeSession } from "@/lib/tree-server";
const fail = (error: string, status = 400) => Response.json({ error }, { status });
export async function GET(request: Request) {
  const { db, userId } = await treeSession();
  if (!userId) return fail("Sign in to see your family tree.", 401);
  const input = z.string().uuid().safeParse(new URL(request.url).searchParams.get("family_id"));
  if (!input.success) return fail("Choose a family.");
  if (!await familyPermission(db, input.data, userId)) return fail("Family access denied.", 403);
  const [people, edges] = await Promise.all([
    db.from("tree_people").select("id,family_id,name,birth_year,death_year,biography,birthplace,linked_user_id,updated_at").eq("family_id", input.data).order("created_at"),
    db.from("tree_edges").select("id,from_person,to_person,kind").eq("family_id", input.data),
  ]);
  if (people.error || edges.error) return fail("Could not load your tree. Please retry.", 500);
  return Response.json({ people: people.data, edges: edges.data }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return fail("Request origin denied.", 403);
  const { db, userId } = await treeSession();
  if (!userId) return fail("Sign in first.", 401);
  const input = treeCommand.safeParse(await request.json().catch(() => null));
  if (!input.success) return fail(input.error.issues[0]?.message ?? "Invalid details.");
  const v = input.data;
  if (!await familyPermission(db, v.family_id, userId, true)) return fail("Only family owners and admins can edit the tree.", 403);
  if (v.action === "delete_person") {
    const { error } = await db.storage.from(photoBucket).remove([`${v.family_id}/${v.id}`]);
    if (error) return fail("Could not remove the photo. Person was kept; please retry.", 502);
  }
  const result = v.action === "create_person" ? await db.rpc("create_tree_person", {
      p_family_id: v.family_id, p_name: v.person.name, p_birth_year: v.person.birth_year, p_death_year: v.person.death_year,
      p_biography: v.person.biography, p_birthplace: v.person.birthplace, p_related_to: v.related_to ?? null,
      p_relationship: v.relationship ?? null, p_co_parent: v.co_parent ?? null, p_account_email: v.account_email ?? null,
    })
    : v.action === "save_person"
    ? v.id ? await db.from("tree_people").update(v.person).eq("id", v.id).eq("family_id", v.family_id).select("id").single()
      : await db.from("tree_people").insert({ ...v.person, family_id: v.family_id }).select("id").single()
    : v.action === "delete_person" ? await db.from("tree_people").delete().eq("id", v.id).eq("family_id", v.family_id).select("id").single()
    : v.action === "add_edge" ? await db.from("tree_edges").insert([
      { family_id: v.family_id, from_person: v.from_person, to_person: v.to_person, kind: v.kind },
      ...(v.co_parent ? [(parentalKinds as readonly string[]).includes(v.kind)
        ? { family_id: v.family_id, from_person: v.co_parent, to_person: v.to_person, kind: "parent" }
        : (childKinds as readonly string[]).includes(v.kind)
          ? { family_id: v.family_id, from_person: v.from_person, to_person: v.co_parent, kind: v.kind }
          : null] : []),
    ].filter((edge): edge is { family_id: string; from_person: string; to_person: string; kind: string } => edge !== null)).select("id")
    : await db.from("tree_edges").delete().eq("id", v.id).eq("family_id", v.family_id).select("id").single();
  if (result.error) {
    const message = result.error.message;
    return fail(message.includes("ancestry loop") ? "This would create an ancestry loop. Check the parent and child order." : result.error.code === "23505" || message.includes("partnership already") ? "That relationship already exists." : "Could not save. Refresh the tree and check the details.");
  }
  const saved = Array.isArray(result.data) ? result.data[0] : result.data;
  const id = typeof saved === "string" ? saved : saved.id;
  let profileEmailDelivery: "queued" | "not_requested" | undefined;
  if (v.action === "create_person" && v.account_email) {
    const { data: claim } = await db.from("tree_profile_claims").select("id").eq("person_id", id).eq("status", "pending").maybeSingle();
    if (claim) {
      const { error: queueError } = await db.rpc("queue_tree_profile_claim_email", { p_claim_id: claim.id });
      profileEmailDelivery = queueError ? "not_requested" : "queued";
    }
  }
  return Response.json({ id, profileEmailDelivery });
}
