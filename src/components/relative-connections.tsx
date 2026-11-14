"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link2, ShieldCheck } from "lucide-react";
import { inverseRelation, relationLabels, type RelativeConnection } from "@/lib/family-tree";

export function RelativeConnections({ userId, displayName, onAddPerson }: { userId: string; displayName: string; onAddPerson?: (name: string) => void }) {
  const [connections, setConnections] = useState<RelativeConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [accepting, setAccepting] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/relative-connections", { cache: "no-store" }); const p = await r.json();
      if (!r.ok) throw new Error(p.error); setConnections(p.connections);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load invitations."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/relative-connections", { cache: "no-store", signal: controller.signal })
      .then(async r => { const p = await r.json(); if (!r.ok) throw new Error(p.error); return p; })
      .then(p => setConnections(p.connections))
      .catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  async function command(body: object, success: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const r = await fetch("/api/relative-connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const p = await r.json(); if (!r.ok) throw new Error(p.error);
      setMessage(success); setAccepting(null); await load(); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); return false; }
    finally { setBusy(false); }
  }
  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
    if (await command({ action: "invite", email: f.get("email"), name: f.get("name"), relationship: f.get("relationship"), consent: f.get("consent") === "on" }, "Invitation saved. They can review it in their Family tree invitation inbox. No email was sent.")) form.reset();
  }
  async function accept(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    await command({ action: "accept", id, name: f.get("name"), consent: f.get("consent") === "on" }, "Relationship confirmed. Your household permissions have not changed.");
  }
  return <section className="card space-y-5" aria-labelledby="connections-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">Across households</p><h2 id="connections-heading" className="flex items-center gap-2 text-xl font-extrabold"><Link2 size={22}/> Relative connections</h2><p className="mt-2 max-w-2xl text-sm text-slate-600">Have relatives using Jibon with their own family? Send a relationship invitation. Both people keep their own family workspace.</p></div><button className="button-secondary" disabled={busy} onClick={() => { setError(""); void load(); }}>Refresh inbox</button></div>
    <div className="flex gap-3 rounded-xl bg-teal-50 p-4 text-sm text-teal-900"><ShieldCheck className="shrink-0" size={20}/><p>Only your chosen name and declared relationship are shared. Accepting does not share photos, family trees, documents, bills, or tasks. Requests expire after 14 days and arrive inside Jibon.</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-teal-50 p-3 text-sm text-teal-800">{message}</p>}
    <details className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer font-bold text-teal-800">Invite a relative</summary><form onSubmit={invite} className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-semibold">Their account email<input className="field mt-1" name="email" type="email" autoComplete="off" maxLength={320} required/></label>
      <label className="text-sm font-semibold">Your name to share<input className="field mt-1" name="name" defaultValue={displayName} maxLength={120} required/></label>
      <label className="text-sm font-semibold">They are my<select name="relationship" className="field mt-1" defaultValue="cousin">{Object.entries(relationLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="flex items-start gap-2 self-center text-sm text-slate-600"><input className="mt-1" type="checkbox" name="consent" required/>I agree to share this name and relationship with the invited account.</label>
      <button className="button sm:col-span-2" disabled={busy}>Send relationship invitation</button>
    </form></details>
    {loading ? <p role="status" className="text-sm text-slate-500">Loading invitations…</p> : !connections.length ? <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No relative connections yet. Your incoming requests will appear here.</p> : <ul className="space-y-3">{connections.map(c => {
      const outgoing = c.sender_id === userId;
      const name = outgoing ? c.recipient_name || c.recipient_email : c.sender_name;
      const relation = relationLabels[outgoing ? c.relationship : inverseRelation[c.relationship]];
      return <li key={c.id} className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="break-all font-bold">{name}</p><p className="mt-1 text-sm text-slate-600">{c.status === "accepted" ? `Your ${relation.toLowerCase()}` : `${outgoing ? "Sent" : "Received"} · Proposed relationship: your ${relation.toLowerCase()}`}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${c.status === "accepted" ? "bg-teal-100 text-teal-900" : "bg-slate-100 text-slate-600"}`}>{c.status === "revoked" ? "Disconnected" : c.status}</span></div>
        {c.status === "pending" && <p className="mt-2 text-xs text-slate-500">Expires {new Date(c.expires_at).toLocaleDateString()}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {c.status === "pending" && (outgoing ? <button className="button-secondary" disabled={busy} onClick={() => void command({ action: "cancel", id: c.id }, "Invitation cancelled.")}>Cancel invitation</button> : <><button className="button" disabled={busy} onClick={() => setAccepting(c.id)}>Review & accept</button><button className="button-secondary" disabled={busy} onClick={() => void command({ action: "decline", id: c.id }, "Invitation declined.")}>Decline</button></>)}
          {c.status === "accepted" && <><button className="button-secondary" disabled={busy} onClick={() => { if (confirm("Disconnect this relationship? Separately saved tree profiles will remain.")) void command({ action: "disconnect", id: c.id }, "Relationship disconnected."); }}>Disconnect</button>{onAddPerson && <button className="button-secondary" onClick={() => onAddPerson(name)}>Use name in my tree</button>}</>}
          {!outgoing && ["pending", "accepted", "revoked", "declined"].includes(c.status) && <button className="button-secondary" disabled={busy} onClick={() => { if (confirm("Block further relationship invitations between these accounts?")) void command({ action: "block", id: c.id }, "Connection blocked."); }}>Block</button>}
        </div>
        {accepting === c.id && c.status === "pending" && <form onSubmit={e => void accept(e,c.id)} className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4"><p className="text-sm">Confirm that <b>{name}</b> is your <b>{relation.toLowerCase()}</b>. Decline if the relationship is incorrect.</p><label className="block text-sm font-semibold">Your name to share<input name="name" className="field mt-1" defaultValue={displayName} maxLength={120} required/></label><label className="flex gap-2 text-sm"><input type="checkbox" name="consent" required/>I agree to share this name and confirm this relationship.</label><div className="flex gap-2"><button disabled={busy} className="button">Confirm relationship</button><button type="button" className="button-secondary" onClick={() => setAccepting(null)}>Back</button></div></form>}
      </li>;
    })}</ul>}
    <p className="text-xs leading-relaxed text-slate-500">Connections belong to your account across all your workspaces. Adding a name to your tree creates a separate local profile; trees are not automatically merged. Either person can disconnect. Blocking prevents new invitations; unblocking is not yet available.</p>
  </section>;
}
