import { createClient } from "@/lib/supabase/server";
export const photoBucket = "family-tree-photos";
export async function treeSession() {
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  return { db, userId: error ? undefined : data?.claims.sub };
}
export async function familyPermission(db: Awaited<ReturnType<typeof createClient>>, familyId: string, userId: string, edit = false) {
  const { data, error } = await db.from("family_memberships").select("role").eq("family_id", familyId).eq("user_id", userId).maybeSingle();
  return !error && !!data && (!edit || data.role === "owner" || data.role === "admin");
}
export function rejectCrossOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin !== null && origin !== new URL(request.url).origin;
}
