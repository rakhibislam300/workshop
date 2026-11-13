import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type DocumentContext = { params: Promise<{ documentId: string }> };

export async function DELETE(_request: Request, context: DocumentContext) {
  const { documentId } = await context.params;
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in to remove a document." }, { status: 401 });
  const { data: document, error: selectError } = await supabase.from("documents").select("id,storage_path,preview_path").eq("id", documentId).maybeSingle();
  if (selectError) return NextResponse.json({ error: "Could not find that document." }, { status: 400 });
  if (!document) return NextResponse.json({ error: "That document is unavailable or you cannot remove it." }, { status: 404 });
  const paths = [document.storage_path, document.preview_path].filter((path): path is string => Boolean(path));
  const { error: storageError } = await supabase.storage.from("family-documents").remove(paths);
  if (storageError) return NextResponse.json({ error: "Could not securely remove the stored file. Your document record has been kept." }, { status: 502 });
  const { data: deleted, error: deleteError } = await supabase.from("documents").delete().eq("id", documentId).select("id").maybeSingle();
  if (deleteError) return NextResponse.json({ error: "The file was removed, but its record could not be removed. Please contact the household owner." }, { status: 500 });
  if (!deleted) return NextResponse.json({ error: "That document is unavailable or you cannot remove it." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
