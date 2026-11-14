"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { GitBranch, Trash2, Users } from "lucide-react";
import { edgeKinds } from "@/lib/family-tree";
import type { FamilyRole } from "@/lib/types";

type Collaborator = { user_id: string; role: FamilyRole; display_name: string };
type TreeProfile = { id: string; name: string };
type Invitation = {
  id: string; invited_email: string; status: string;
  invitee_name?: string | null; invitee_relationship?: keyof typeof edgeKinds | null;
  email_delivery_status?: "not_requested" | "queued" | "sent" | "failed" | "cancelled";
};

export function FamilyManagement({ familyId, role, userId }: { familyId: string; role: FamilyRole; userId: string }) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [myTreeProfiles, setMyTreeProfiles] = useState<TreeProfile[]>([]);
  const [method, setMethod] = useState<"jibon" | "email">("jibon");
  const [recipient, setRecipient] = useState("");
  const [inviteeName, setInviteeName] = useState("");
  const [relationship, setRelationship] = useState<keyof typeof edgeKinds>("sibling");
  const [inviterTreePersonId, setInviterTreePersonId] = useState("");
  const [latestLink, setLatestLink] = useState("");
  const [delivery, setDelivery] = useState<Invitation["email_delivery_status"]>();
  const [reissued, setReissued] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const canInvite = role === "owner" || role === "admin";
  const isOwner = role === "owner";

  const load = useCallback(async () => {
    const collaboratorResponse = await fetch(`/api/families/${familyId}/collaborators`);
    const collaboratorPayload = await collaboratorResponse.json();
    if (collaboratorResponse.ok) setCollaborators(collaboratorPayload.collaborators || []);
    if (canInvite) {
      const inviteResponse = await fetch(`/api/families/${familyId}/invitations`, { cache: "no-store" });
      const invitePayload = await inviteResponse.json();
      if (inviteResponse.ok) {
        const profiles = invitePayload.myTreeProfiles || [];
        setInvitations(invitePayload.invitations || []);
        setMyTreeProfiles(profiles);
        setInviterTreePersonId(current => current || profiles[0]?.id || "");
      }
    }
  }, [familyId, canInvite]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage(""); setLatestLink(""); setDelivery(undefined); setReissued(false);
    try {
      const response = await fetch(`/api/families/${familyId}/invitations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [method === "jibon" ? "jibon_id" : "email"]: recipient,
          invitee_name: inviteeName,
          invitee_relationship: relationship,
          inviter_tree_person_id: inviterTreePersonId,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not create the invitation.");
      setRecipient(""); setInviteeName(""); setLatestLink(payload.invitationUrl || "");
      setDelivery(payload.emailDelivery); setReissued(Boolean(payload.reissued));
      setMessage(payload.direct ? "Relationship-aware invitation delivered to their Jibon inbox." : "Relationship-aware secure invitation created.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the invitation.");
    } finally { setBusy(false); }
  }

  async function updateRole(member: Collaborator, nextRole: FamilyRole) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/families/${familyId}/collaborators/${member.user_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: nextRole }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update the role."); }
    finally { setBusy(false); }
  }

  async function remove(member: Collaborator) {
    if (!window.confirm(`Remove ${member.display_name} from this family? Their access to shared data will end.`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/families/${familyId}/collaborators/${member.user_id}`, { method: "DELETE" });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove the collaborator."); }
    finally { setBusy(false); }
  }

  async function cancel(invitation: Invitation) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/families/${familyId}/invitations?id=${invitation.id}`, { method: "DELETE" });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not cancel the invitation."); }
    finally { setBusy(false); }
  }

  return <section className="card" aria-labelledby="family-members-heading">
    <div className="flex items-center gap-2"><Users className="text-teal-700" size={20}/><div><p className="eyebrow mb-1">Collaboration</p><h2 id="family-members-heading" className="font-extrabold">Family members</h2></div></div>
    <p className="mt-2 text-sm text-slate-600">Household invitations add a workspace member and, after acceptance, place their linked profile in your family tree. For view-only relatives, use the separate tree-sharing option in Family tree.</p>
    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {message && <p role="status" className="mt-3 rounded-lg bg-teal-50 p-3 text-sm text-teal-800">{message}</p>}
    <ul className="mt-4 divide-y divide-slate-100">{collaborators.map((member) => <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><p className="font-semibold text-slate-800">{member.display_name}{member.user_id === userId ? " (you)" : ""}</p><p className="text-xs capitalize text-slate-500">{member.role}</p></div>{isOwner && member.user_id !== userId ? <div className="flex items-center gap-2"><select aria-label={`Role for ${member.display_name}`} className="field w-auto py-1.5 text-sm" value={member.role} disabled={busy} onChange={(event) => void updateRole(member, event.target.value as FamilyRole)}><option value="member">Member</option><option value="admin">Admin</option><option value="owner">Owner</option></select><button aria-label={`Remove ${member.display_name}`} disabled={busy} onClick={() => void remove(member)} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={16}/></button></div> : <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold capitalize text-slate-600">{member.role}</span>}</li>)}</ul>
    {canInvite && <div className="mt-5 rounded-xl border border-teal-100 bg-teal-50/40 p-4">
      <div className="flex items-start gap-2"><GitBranch className="mt-0.5 shrink-0 text-teal-700" size={18}/><div><h3 className="font-bold text-teal-950">Invite a household member</h3><p className="mt-1 text-sm text-teal-900">Their workspace access and declared relationship are confirmed together. They can correct their personal details after accepting.</p></div></div>
      {!myTreeProfiles.length ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Add your own linked profile in <span className="font-semibold">Family tree</span> before sending a relationship-aware invitation. This keeps the connection anchored to you.</p> : <form onSubmit={invite} className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2 flex gap-2 rounded-xl bg-white p-1 text-sm font-bold"><button type="button" onClick={() => setMethod("jibon")} disabled={busy} className={`flex-1 rounded-lg px-3 py-2 ${method === "jibon" ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}>Jibon ID</button><button type="button" onClick={() => setMethod("email")} disabled={busy} className={`flex-1 rounded-lg px-3 py-2 ${method === "email" ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}>Email link</button></div>
        <label className="text-sm font-semibold text-slate-700">{method === "jibon" ? "Their Jibon ID" : "Their email address"}<input value={recipient} onChange={event => setRecipient(method === "jibon" ? event.target.value.toUpperCase() : event.target.value)} type={method === "jibon" ? "text" : "email"} autoComplete={method === "email" ? "email" : "off"} className="field mt-1" maxLength={method === "jibon" ? 16 : 320} placeholder={method === "jibon" ? "JBN-U-XXXXXXXXXX" : "family@example.com"} required disabled={busy}/></label>
        <label className="text-sm font-semibold text-slate-700">Their full name<input value={inviteeName} onChange={event => setInviteeName(event.target.value)} className="field mt-1" maxLength={120} placeholder="e.g. Samira Rahman" required disabled={busy}/></label>
        <label className="text-sm font-semibold text-slate-700">They are your<select value={relationship} onChange={event => setRelationship(event.target.value as keyof typeof edgeKinds)} className="field mt-1" disabled={busy}>{Object.entries(edgeKinds).map(([key, label]) => <option key={key} value={key}>{label.replace(/ of$/, "")}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">Connect to your profile<select value={inviterTreePersonId} onChange={event => setInviterTreePersonId(event.target.value)} className="field mt-1" required disabled={busy}>{myTreeProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        <p className="text-xs leading-relaxed text-slate-600 sm:col-span-2">Example: choosing <span className="font-semibold">Sister</span> means the invited person will be recorded as your sister after they accept. No tree record is created before acceptance.</p>
        <button className="button sm:col-span-2" disabled={busy}>{method === "jibon" ? "Send to Jibon inbox" : "Create secure invitation"}</button>
      </form>}
      {latestLink && <><label className="mt-4 block text-sm font-semibold text-teal-800">Secure invitation link<input className="field mt-1 text-xs" readOnly value={latestLink} onFocus={(event) => event.currentTarget.select()}/></label><p className="mt-2 text-xs text-slate-600">{reissued ? "The previous pending invitation was cancelled. Share only this newest link." : delivery === "queued" ? "Email is queued for secure delivery. Keep this link as a fallback." : "Email delivery is not configured, so share this link only with the invited email address."}</p></>}
      <div className="mt-4 space-y-2">{invitations.filter((invitation) => invitation.status === "pending").map((invitation) => <div key={invitation.id} className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm"><span className="min-w-0"><span className="block truncate text-amber-900">Pending: {invitation.invitee_name || invitation.invited_email}</span>{invitation.invitee_relationship && <span className="block text-xs text-amber-800">Relationship: {edgeKinds[invitation.invitee_relationship]}</span>}<span className="text-xs text-amber-700">{invitation.email_delivery_status === "sent" ? "Email sent" : invitation.email_delivery_status === "queued" ? "Email queued" : invitation.email_delivery_status === "failed" ? "Email failed — share the link" : "Awaiting acceptance"}</span></span><button type="button" disabled={busy} onClick={() => void cancel(invitation)} className="font-bold text-amber-800 hover:underline">Cancel</button></div>)}</div>
    </div>}
  </section>;
}
