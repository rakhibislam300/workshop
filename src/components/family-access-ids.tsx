"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, RefreshCw, Send, ShieldCheck, UserRound } from "lucide-react";
import type { FamilyRole } from "@/lib/types";

type Identity = { jibon_id: string; family_code: string | null; family_code_enabled: boolean; can_manage_family_code: boolean };
type JoinRequest = { request_id: string; requester_jibon_id: string; requester_name: string; created_at: string };

export function FamilyAccessIds({ familyId, role }: { familyId: string; role: FamilyRole }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [familyCode, setFamilyCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canReview = role === "owner" || role === "admin";

  const load = useCallback(async () => {
    setError("");
    try {
      const identityResponse = await fetch(`/api/identity?family_id=${encodeURIComponent(familyId)}`, { cache: "no-store" });
      const identityPayload = await identityResponse.json();
      if (!identityResponse.ok) throw new Error(identityPayload.error || "Could not load your account ID.");
      setIdentity(identityPayload.identity);
      if (canReview) {
        const requestsResponse = await fetch(`/api/family-join?family_id=${encodeURIComponent(familyId)}`, { cache: "no-store" });
        const requestsPayload = await requestsResponse.json();
        if (requestsResponse.ok) setRequests(requestsPayload.requests || []);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load access settings."); }
  }, [familyId, canReview]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setMessage(`${label} copied.`); } catch { setError(`Could not copy the ${label.toLowerCase()}.`); }
  }
  async function rotate() {
    if (!window.confirm("Rotate this Family Code? The current code will stop accepting new join requests.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ family_id: familyId }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not rotate the Family Code.");
      setIdentity((current) => current ? { ...current, family_code: payload.familyCode, family_code_enabled: true } : current); setMessage("Family Code rotated. Share only the new code.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not rotate the Family Code."); } finally { setBusy(false); }
  }
  async function requestJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/family-join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ family_code: familyCode }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not submit your join request.");
      setFamilyCode(""); setMessage("Join request sent. A family owner or admin must approve it.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not submit your join request."); } finally { setBusy(false); }
  }
  async function review(request: JoinRequest, approved: boolean) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/family-join", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: request.request_id, approved }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not review this request.");
      setRequests((current) => current.filter((item) => item.request_id !== request.request_id)); setMessage(approved ? "Join request approved." : "Join request declined.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not review this request."); } finally { setBusy(false); }
  }

  return <section className="card space-y-5" aria-labelledby="access-ids-heading">
    <div className="flex items-center gap-2"><KeyRound className="text-teal-700" size={20}/><div><p className="eyebrow mb-1">Private access</p><h2 id="access-ids-heading" className="font-extrabold">Jibon IDs & Family Code</h2></div></div>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}{message && <p role="status" className="rounded-lg bg-teal-50 p-3 text-sm text-teal-800">{message}</p>}
    {!identity ? <p className="text-sm text-slate-500">Loading your private access settings…</p> : <><div className="rounded-xl bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-bold text-slate-800"><UserRound size={16} className="text-teal-700"/>Your Jibon ID</p><p className="mt-1 text-xs text-slate-500">Share this only with a family owner or admin who wants to invite you.</p></div><button type="button" className="button-secondary shrink-0" onClick={() => void copy(identity.jibon_id, "Jibon ID")}><Copy size={15}/> Copy</button></div><code className="mt-3 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold tracking-wide text-slate-900">{identity.jibon_id}</code></div>
    {identity.can_manage_family_code && identity.family_code && <div className="rounded-xl border border-teal-100 bg-teal-50/60 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-bold text-teal-900"><ShieldCheck size={16}/>Family Code</p><p className="mt-1 text-xs text-teal-800">Anyone with this code can request to join; approval is still required.</p></div><div className="flex gap-2"><button type="button" className="button-secondary" onClick={() => void copy(identity.family_code!, "Family Code")}><Copy size={15}/> Copy</button><button type="button" className="button-secondary" disabled={busy} onClick={() => void rotate()}><RefreshCw size={15}/> Rotate</button></div></div><code className="mt-3 block rounded-lg border border-teal-100 bg-white px-3 py-2 text-sm font-bold tracking-wide text-teal-950">{identity.family_code}</code></div>}
    <form className="rounded-xl border border-slate-200 p-4" onSubmit={requestJoin}><p className="font-bold text-slate-900">Join a family with a code</p><p className="mt-1 text-xs text-slate-500">This sends a request. It never adds you automatically.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={familyCode} onChange={(event) => setFamilyCode(event.target.value.toUpperCase())} className="field" placeholder="JBN-F-XXXXXXXXXX" maxLength={16} required disabled={busy}/><button className="button shrink-0" disabled={busy}><Send size={15}/> Request access</button></div></form>
    {canReview && <div><p className="font-bold text-slate-900">Pending join requests</p>{requests.length ? <ul className="mt-3 space-y-2">{requests.map((request) => <li key={request.request_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm"><div><p className="font-semibold text-slate-800">{request.requester_name || "Jibon member"}</p><p className="text-xs text-slate-500">{request.requester_jibon_id}</p></div><div className="flex gap-2"><button type="button" className="button" disabled={busy} onClick={() => void review(request, true)}>Approve</button><button type="button" className="button-secondary" disabled={busy} onClick={() => void review(request, false)}>Decline</button></div></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No pending requests.</p>}</div>}</>}
  </section>;
}
