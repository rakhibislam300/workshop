"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { edgeKinds } from "@/lib/family-tree";

type InvitationPreview = { family_name: string; inviter_name: string; invitee_name: string | null; invitee_relationship: keyof typeof edgeKinds | null; expires_at: string };

export function InvitationAccept({ token, signedInEmail, preview }: { token: string; signedInEmail: string; preview: InvitationPreview | null }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function accept() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/family-invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not accept the invitation.");
      router.push(`/dashboard?family=${payload.familyId}`);
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not accept the invitation."); } finally { setBusy(false); }
  }
  const switchAccountHref = `/auth/login?next=${encodeURIComponent(`/invitations/accept?token=${token}`)}`;
  const relationship = preview?.invitee_relationship ? edgeKinds[preview.invitee_relationship] : null;
  return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">Family invitation</p><h1>Join this family workspace</h1><p className="mb-4 text-slate-600">Confirm to share tasks, bills, appointments, and household updates with this family.</p>{preview && <div className="mb-4 rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm text-teal-950"><p className="font-bold">{preview.inviter_name} invited you to {preview.family_name}.</p>{relationship && <p className="mt-1">You will appear in the family tree as their <span className="font-semibold">{relationship.replace(/ of$/, "").toLowerCase()}</span>.</p>}<p className="mt-2 text-xs text-teal-800">Your linked profile and this declared relationship are created only after you accept.</p></div>}<div className="mb-6 rounded-xl bg-slate-50 p-3 text-sm text-slate-700"><p>Accepting as <span className="font-bold">{signedInEmail}</span></p><p className="mt-1 text-xs text-slate-500">The invitation works only for the exact email address chosen by the family owner.</p><Link href={switchAccountHref} className="mt-2 inline-block text-xs font-bold text-teal-700 hover:underline">Use a different account</Link></div>{error && <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<button onClick={accept} disabled={busy} className="button w-full">{busy ? "Joining…" : "Accept invitation"}</button></section></main>;
}
