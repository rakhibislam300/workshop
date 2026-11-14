"use client";

import { useCallback, useEffect, useState } from "react";
import { Inbox, RefreshCw, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { edgeKinds } from "@/lib/family-tree";

type Invitation = { invitation_id: string; family_name: string; inviter_name: string; invitee_name: string | null; invitee_relationship: keyof typeof edgeKinds | null; expires_at: string; created_at: string };

export function FamilyInvitationInbox() {
  const router = useRouter();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/family-invitations/inbox", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load your invitation inbox.");
      setInvitations(payload.invitations || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load your invitation inbox.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function accept(invitation: Invitation) {
    setBusyId(invitation.invitation_id);
    setError("");
    try {
      const response = await fetch("/api/family-invitations/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: invitation.invitation_id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not accept this invitation.");
      router.push(`/dashboard?family=${payload.familyId}`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not accept this invitation.");
      setBusyId(null);
    }
  }

  return <section className="card" aria-labelledby="household-inbox-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2"><Inbox className="text-teal-700" size={20}/><div><p className="eyebrow mb-1">Your inbox</p><h2 id="household-inbox-heading" className="font-extrabold">Household invitations</h2></div></div>
      <button className="button-secondary" type="button" onClick={() => void load()} disabled={loading || busyId !== null}><RefreshCw size={15} aria-hidden="true"/> Refresh</button>
    </div>
    <p className="mt-2 text-sm text-slate-600">Invitations sent to your Jibon ID or signed-in email appear here. Accepting shares the selected family&apos;s household dashboard and creates the stated family-tree connection.</p>
    {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {loading ? <p role="status" className="mt-4 text-sm text-slate-500">Checking for invitations…</p> : invitations.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">No pending household invitations for this account.</p> : <ul className="mt-4 space-y-3">{invitations.map((invitation) => { const relationship = invitation.invitee_relationship ? edgeKinds[invitation.invitee_relationship] : null; return <li key={invitation.invitation_id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-teal-100 bg-teal-50/60 p-4"><div className="min-w-0"><p className="flex items-center gap-2 font-bold text-slate-900"><Users size={16} className="shrink-0 text-teal-700" aria-hidden="true"/><span className="truncate">{invitation.family_name}</span></p>{relationship && <p className="mt-1 text-sm text-teal-900">{invitation.inviter_name} invited you as their {relationship.replace(/ of$/, "").toLowerCase()}.</p>}<p className="mt-1 text-xs text-slate-600">Expires {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(invitation.expires_at))}</p></div><button type="button" className="button shrink-0" disabled={busyId !== null} onClick={() => void accept(invitation)}>{busyId === invitation.invitation_id ? "Joining…" : "Accept invitation"}</button></li>; })}</ul>}
  </section>;
}
