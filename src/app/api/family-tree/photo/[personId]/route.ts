import { z } from "zod";
import { familyPermission, photoBucket, rejectCrossOrigin, treeSession } from "@/lib/tree-server";
type Context = { params: Promise<{ personId: string }> };
const fail = (error: string, status: number) => Response.json({ error }, { status });
async function access(context: Context, edit: boolean) {
  const { db, userId } = await treeSession();
  if (!userId) return { response: fail("Sign in first.", 401) };
  const { personId } = await context.params;
  if (!z.string().uuid().safeParse(personId).success) return { response: fail("Invalid person.", 400) };
  const { data } = await db.from("tree_people").select("family_id").eq("id", personId).maybeSingle();
  if (!data || !await familyPermission(db, data.family_id, userId, edit)) return { response: fail("Photo unavailable.", 404) };
  return { db, path: `${data.family_id}/${personId}` };
}
export async function GET(_request: Request, context: Context) {
  const a = await access(context, false);
  if (a.response) return a.response;
  const { data, error } = await a.db!.storage.from(photoBucket).download(a.path!);
  if (error || !data) return fail("No photo.", 404);
  return new Response(data, { headers: { "Content-Type": data.type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
export async function POST(request: Request, context: Context) {
  if (rejectCrossOrigin(request)) return fail("Request origin denied.", 403);
  const a = await access(context, true);
  if (a.response) return a.response;
  if (Number(request.headers.get("content-length")) > 3 * 1024 * 1024 + 8192) return fail("Photo must be at most 3 MB.", 413);
  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File) || !file.size || file.size > 3145728) return fail("Choose a photo up to 3 MB.", 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
    : [137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b) ? "image/png"
    : new TextDecoder().decode(bytes.slice(0,4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8,12)) === "WEBP" ? "image/webp" : null;
  if (!mime || mime !== file.type) return fail("Choose a valid JPG, PNG, or WebP photo.", 415);
  const { error } = await a.db!.storage.from(photoBucket).upload(a.path!, bytes, { contentType: mime, upsert: true, cacheControl: "0" });
  return error ? fail("Photo upload failed. Please retry.", 502) : Response.json({ ok: true });
}
export async function DELETE(request: Request, context: Context) {
  if (rejectCrossOrigin(request)) return fail("Request origin denied.", 403);
  const a = await access(context, true);
  if (a.response) return a.response;
  const { error } = await a.db!.storage.from(photoBucket).remove([a.path!]);
  return error ? fail("Could not remove photo.", 502) : Response.json({ ok: true });
}
