import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyzeDocumentSource, documentIntelligenceAvailable } from "@/lib/document-intelligence";

type IntelligenceJob = { document_id: string; status: "queued" | "processing"; attempts: number; updated_at: string };

function authorized(request: Request) {
  const expected = process.env.DOCUMENT_INTELLIGENCE_WORKER_SECRET;
  const received = request.headers.get("x-document-intelligence-secret");
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected); const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function POST(request: Request) {
  if (!documentIntelligenceAvailable()) return NextResponse.json({ error: "Document intelligence is not configured. Add the server-only worker secret, service-role key, and OpenAI key." }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized document processor." }, { status: 401 });
  const admin = createAdminClient();
  const now = new Date(); const staleBefore = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const [queued, stale] = await Promise.all([
    admin.from("document_intelligence").select("document_id,status,attempts,updated_at").eq("status", "queued").lte("next_attempt_at", now.toISOString()).lt("attempts", 3).order("next_attempt_at").limit(2),
    admin.from("document_intelligence").select("document_id,status,attempts,updated_at").eq("status", "processing").lt("updated_at", staleBefore).lt("attempts", 3).limit(2),
  ]);
  if (queued.error || stale.error) return NextResponse.json({ error: "Could not load document processing jobs." }, { status: 500 });
  let processed = 0; let retried = 0; let failed = 0;
  for (const candidate of [...(queued.data ?? []), ...(stale.data ?? [])] as IntelligenceJob[]) {
    if (processed >= 2) break;
    const { data: claimed, error: claimError } = await admin.from("document_intelligence")
      .update({ status: "processing", attempts: candidate.attempts + 1, error_message: null })
      .eq("document_id", candidate.document_id).eq("status", candidate.status).eq("attempts", candidate.attempts)
      .select("document_id,attempts").maybeSingle();
    if (claimError || !claimed) continue;
    processed += 1;
    try {
      const { data: document, error: documentError } = await admin.from("documents").select("id,storage_path,mime_type,original_filename").eq("id", candidate.document_id).maybeSingle();
      if (documentError || !document) throw new Error("The source document is no longer available.");
      const { data: blob, error: downloadError } = await admin.storage.from("family-documents").download(document.storage_path);
      if (downloadError || !blob) throw new Error("The source file could not be downloaded for processing.");
      const analysis = await analyzeDocumentSource({ blob, mimeType: document.mime_type, filename: document.original_filename });
      const { error: saveError } = await admin.from("document_intelligence").update({
        status: "ready", extracted_text: analysis.extracted_text, summary: analysis.summary,
        metadata: { document_type: analysis.document_type, issuer: analysis.issuer, important_dates: analysis.important_dates, confidence: analysis.confidence },
        expiry_date: analysis.expiry_date, processor_model: process.env.OPENAI_MODEL || "gpt-4.1-mini", error_message: null, processed_at: new Date().toISOString(), next_attempt_at: new Date().toISOString(),
      }).eq("document_id", candidate.document_id);
      if (saveError) throw new Error("The extracted document data could not be saved.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Document processing failed.";
      const retry = claimed.attempts < 3;
      await admin.from("document_intelligence").update({
        status: retry ? "queued" : "failed", error_message: message.slice(0, 500),
        next_attempt_at: new Date(Date.now() + Math.min(60 * 60 * 1000, 60_000 * 2 ** claimed.attempts)).toISOString(), processed_at: null,
      }).eq("document_id", candidate.document_id);
      if (retry) retried += 1; else failed += 1;
    }
  }
  return NextResponse.json({ processed, retried, failed });
}
