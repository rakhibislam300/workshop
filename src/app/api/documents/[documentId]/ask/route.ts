import { NextResponse } from "next/server";
import { answerDocumentQuestion } from "@/lib/document-intelligence";
import { geminiAvailable } from "@/lib/gemini";
import { createClient } from "@/lib/supabase/server";
import { documentQuestionInput } from "@/lib/validation";
import { rejectCrossOrigin } from "@/lib/tree-server";

type AskContext = { params: Promise<{ documentId: string }> };

export async function POST(request: Request, context: AskContext) {
  if (rejectCrossOrigin(request)) return NextResponse.json({ error: "Request origin denied." }, { status: 403 });
  const { documentId } = await context.params;
  const input = documentQuestionInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.issues[0]?.message ?? "Enter a valid document question." }, { status: 400 });
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in to ask about a document." }, { status: 401 });
  if (!geminiAvailable()) return NextResponse.json({ error: "Document Q&A is unavailable because no server-side GEMINI_API_KEY is configured." }, { status: 503 });
  const { data: document, error: documentError } = await supabase.from("documents").select("id,title").eq("id", documentId).maybeSingle();
  if (documentError || !document) return NextResponse.json({ error: "That document is unavailable." }, { status: 404 });
  const { data: intelligence, error: intelligenceError } = await supabase.from("document_intelligence").select("status,extracted_text,summary").eq("document_id", documentId).maybeSingle();
  if (intelligenceError || !intelligence || intelligence.status !== "ready" || !intelligence.extracted_text) return NextResponse.json({ error: "This document has not finished processing yet." }, { status: 409 });
  try {
    const answer = await answerDocumentQuestion({ title: document.title, text: intelligence.extracted_text, summary: intelligence.summary, question: input.data.question });
    return NextResponse.json({ answer });
  } catch {
    return NextResponse.json({ error: "Document Q&A is temporarily unavailable. Please retry or use the document details." }, { status: 502 });
  }
}
