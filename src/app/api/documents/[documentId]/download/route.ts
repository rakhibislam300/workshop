import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type DownloadContext = { params: Promise<{ documentId: string }> };

export async function GET(_request: Request, context: DownloadContext) {
  const { documentId } = await context.params;
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in to open a document." }, { status: 401 });
  const { data: document, error } = await supabase.from("documents").select("storage_path,original_filename").eq("id", documentId).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not find that document." }, { status: 400 });
  if (!document) return NextResponse.json({ error: "That document is unavailable." }, { status: 404 });
  const { data, error: signedUrlError } = await supabase.storage.from("family-documents").createSignedUrl(document.storage_path, 300);
  if (signedUrlError || !data?.signedUrl) return NextResponse.json({ error: "Could not prepare a secure document link." }, { status: 502 });
  return NextResponse.json({ url: data.signedUrl, expires_in_seconds: 300, filename: document.original_filename });
}
