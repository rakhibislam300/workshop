import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { appointmentInput, billInput, smartAddResponse, taskInput } from "@/lib/validation";

const schemaGuide = `Return ONLY JSON with: {"kind":"task"|"bill"|"appointment"|null,"proposal":object|null,"needs_clarification":boolean,"questions":string[]}. Today's date is ${new Date().toISOString().slice(0,10)}. Date-only fields must be YYYY-MM-DD. appointment_at must be ISO 8601 with timezone. A task needs title and priority (default medium); bill needs title, amount, category (default Other), due_date; appointment needs title and appointment_at. If an essential field or date interpretation is ambiguous, return kind if known, proposal with known values, needs_clarification true, and a short question. Do not invent dates, amounts, or times.`;

export async function POST(request: Request) {
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to use Smart Add." }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "AI Smart Add is unavailable because no server-side OPENAI_API_KEY is configured." }, { status: 503 });
  const body = await request.json().catch(() => null); const input = typeof body?.input === "string" ? body.input.trim() : "";
  if (!input || input.length > 1000) return NextResponse.json({ error: "Enter an instruction up to 1,000 characters." }, { status: 400 });
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: schemaGuide }, { role: "user", content: input }] }) });
    if (!response.ok) return NextResponse.json({ error: "The AI service could not complete that request. Please use the form instead." }, { status: 502 });
    const result = await response.json(); const content = result.choices?.[0]?.message?.content; const parsed = smartAddResponse.safeParse(JSON.parse(content));
    if (!parsed.success) return NextResponse.json({ error: "The AI returned an invalid proposal. Please rephrase or use the form." }, { status: 422 });
    const output = parsed.data;
    if (output.needs_clarification || !output.kind || !output.proposal) return NextResponse.json(output);
    const validator = output.kind === "task" ? taskInput : output.kind === "bill" ? billInput : appointmentInput;
    const proposal = validator.safeParse(output.proposal);
    if (!proposal.success) return NextResponse.json({ kind: output.kind, proposal: output.proposal, needs_clarification: true, questions: ["Please provide the missing or unclear details before I prepare this."] });
    return NextResponse.json({ ...output, proposal: proposal.data });
  } catch { return NextResponse.json({ error: "AI Smart Add is temporarily unavailable. Manual add remains available." }, { status: 502 }); }
}
