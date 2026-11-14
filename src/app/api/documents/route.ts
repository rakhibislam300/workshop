import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { documentListInput, documentUploadInput } from "@/lib/validation";
import { documentIntelligenceAvailable } from "@/lib/document-intelligence";
import { rejectCrossOrigin } from "@/lib/tree-server";

const bucket = "family-documents";
const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "text/plain"]);
const maxBytes = 10 * 1024 * 1024;

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  return { supabase, userId: error ? undefined : data?.claims?.sub };
}

async function hasFamilyAccess(supabase: Awaited<ReturnType<typeof createClient>>, familyId: string, userId: string) {
  const { data, error } = await supabase.from("family_memberships").select("family_id").eq("family_id", familyId).eq("user_id", userId).maybeSingle();
  return !error && Boolean(data);
}

function safeFilename(filename: string) {
  const normalized = filename.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (normalized || "document").slice(0, 120);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = documentListInput.safeParse({
    family_id: url.searchParams.get("family_id"),
    query: url.searchParams.get("q") || undefined,
    category: url.searchParams.get("category") || undefined,
  });
  if (!input.success) return NextResponse.json({ error: input.error.issues[0]?.message ?? "Choose a valid family workspace." }, { status: 400 });
  const { supabase, userId } = await authenticatedClient();
  if (!userId) return NextResponse.json({ error: "Sign in to view documents." }, { status: 401 });
  if (!await hasFamilyAccess(supabase, input.data.family_id, userId)) return NextResponse.json({ error: "You do not have access to this family workspace." }, { status: 403 });
  let query = supabase.from("documents").select("id,title,category,visibility,original_filename,mime_type,size_bytes,created_at,owner_user_id").eq("family_id", input.data.family_id).order("created_at", { ascending: false }).limit(50);
  if (input.data.category) query = query.eq("category", input.data.category);
  if (input.data.query) query = query.ilike("title", `%${input.data.query.replace(/[%_]/g, "\\$&")}%`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load documents." }, { status: 500 });
  const documents = data ?? [];
  const { data: intelligence, error: intelligenceError } = documents.length
    ? await supabase.from("document_intelligence").select("document_id,status,summary,expiry_date,metadata,error_message,processed_at").in("document_id", documents.map((document) => document.id))
    : { data: [], error: null };
  if (intelligenceError) return NextResponse.json({ error: "Could not load document intelligence." }, { status: 500 });
  const byDocumentId = new Map((intelligence ?? []).map((item) => [item.document_id, item]));
  return NextResponse.json({ documents: documents.map((document) => ({ ...document, intelligence: byDocumentId.get(document.id) ?? null })), intelligence_available: documentIntelligenceAvailable() });
}

export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return NextResponse.json({ error: "Request origin denied." }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const rawFile = form?.get("file");
  const input = documentUploadInput.safeParse({
    family_id: form?.get("family_id"), title: form?.get("title"), category: form?.get("category"), visibility: form?.get("visibility"),
  });
  if (!input.success) return NextResponse.json({ error: input.error.issues[0]?.message ?? "Enter valid document details." }, { status: 400 });
  if (!(rawFile instanceof File) || rawFile.size === 0) return NextResponse.json({ error: "Choose a non-empty file to upload." }, { status: 400 });
  if (rawFile.size > maxBytes) return NextResponse.json({ error: "Files must be 10 MB or smaller." }, { status: 413 });
  if (!allowedTypes.has(rawFile.type)) return NextResponse.json({ error: "Only PDF, JPG, PNG, and plain-text files are supported." }, { status: 415 });

  const { supabase, userId } = await authenticatedClient();
  if (!userId) return NextResponse.json({ error: "Sign in to upload a document." }, { status: 401 });
  if (!await hasFamilyAccess(supabase, input.data.family_id, userId)) return NextResponse.json({ error: "You do not have access to this family workspace." }, { status: 403 });

  const documentId = crypto.randomUUID();
  const originalFilename = rawFile.name.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 255) || "document";
  const storagePath = `${input.data.family_id}/${documentId}/${safeFilename(originalFilename)}`;
  const { error: insertError } = await supabase.from("documents").insert({
    id: documentId, family_id: input.data.family_id, owner_user_id: userId, title: input.data.title,
    category: input.data.category, visibility: input.data.visibility, original_filename: originalFilename,
    mime_type: rawFile.type, size_bytes: rawFile.size, storage_path: storagePath,
  });
  if (insertError) return NextResponse.json({ error: "Could not prepare that document upload." }, { status: 400 });

  const { error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, rawFile, { contentType: rawFile.type, upsert: false });
  if (uploadError) {
    await supabase.from("documents").delete().eq("id", documentId);
    return NextResponse.json({ error: "The file could not be securely uploaded. Please try again." }, { status: 502 });
  }
  const { error: intelligenceError } = await supabase.from("document_intelligence").insert({ document_id: documentId, family_id: input.data.family_id, owner_user_id: userId });
  return NextResponse.json({ document: { id: documentId }, intelligence_queued: !intelligenceError, intelligence_available: documentIntelligenceAvailable() }, { status: 201 });
}
