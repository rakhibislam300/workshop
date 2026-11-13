"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, LoaderCircle, SendHorizontal, X } from "lucide-react";

type Proposal = {
  operation: "create" | "update";
  entity: "task" | "bill" | "appointment";
  record_id: string | null;
  fields: Record<string, string | number | boolean | null>;
};
type AssistantReply = { kind: "answer" | "proposal"; message: string; proposal: Proposal | null };

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
function proposalDetails(proposal: Proposal) {
  const details = Object.entries(proposal.fields).filter(([, value]) => value !== null && value !== "").map(([key, value]) => {
    const label = key.replaceAll("_", " ");
    return `${label}: ${key === "amount" && typeof value === "number" ? money(value) : String(value)}`;
  });
  return details;
}

export function FamilyAssistant({ familyId }: { familyId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState(""); const [reply, setReply] = useState<AssistantReply | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setReply(null);
    try {
      const response = await fetch("/api/family-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ family_id: familyId, message }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "The assistant could not respond.");
      setReply(payload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The assistant could not respond."); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!reply?.proposal) return; setBusy(true); setError("");
    try {
      const response = await fetch("/api/family-assistant/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ family_id: familyId, proposal: reply.proposal }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "The confirmed change could not be saved.");
      setReply({ kind: "answer", message: payload.message, proposal: null }); setMessage(""); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The confirmed change could not be saved."); } finally { setBusy(false); }
  }
  return <section className="card border-teal-100 bg-gradient-to-br from-teal-50 via-white to-white"><div className="flex items-start gap-3"><div className="rounded-xl bg-teal-700 p-2 text-white"><Bot size={20}/></div><div><p className="eyebrow text-teal-700">Context-aware assistant</p><h2 className="font-extrabold text-slate-950">Ask about this family workspace</h2><p className="mt-1 text-sm text-slate-600">Summaries, due items, and schedule conflicts stay inside the active family. Changes are always previewed first.</p></div></div><form onSubmit={ask} className="mt-4 flex gap-2"><input value={message} onChange={(event) => setMessage(event.target.value)} className="field" placeholder="What is overdue, or add a bill for ₹900 due Friday" maxLength={1200} required/><button className="button shrink-0" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" size={16}/> : <SendHorizontal size={16}/>} Ask</button></form>{error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}{reply && <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm"><p className="whitespace-pre-wrap text-slate-700">{reply.message}</p>{reply.proposal && <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50 p-3"><p className="font-bold capitalize text-teal-900">Proposed {reply.proposal.operation}: {reply.proposal.entity}</p><ul className="mt-2 space-y-1 text-xs text-slate-700">{proposalDetails(reply.proposal).map((detail) => <li key={detail}>{detail}</li>)}</ul><p className="mt-3 text-xs font-semibold text-teal-800">Nothing has been saved yet.</p><div className="mt-3 flex gap-2"><button onClick={confirm} className="button" disabled={busy}><Check size={16}/> Confirm & save</button><button onClick={() => setReply(null)} className="button-secondary" disabled={busy}><X size={16}/> Discard</button></div></div>}</div>}</section>;
}
