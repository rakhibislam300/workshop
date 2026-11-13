"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function InvitationAccept({ token }: { token: string }) {
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
  return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">Family invitation</p><h1>Join this family workspace</h1><p className="mb-6 text-slate-600">Confirm to share tasks, bills, appointments, and household updates with this family.</p>{error && <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<button onClick={accept} disabled={busy} className="button w-full">{busy ? "Joining…" : "Accept invitation"}</button></section></main>;
}
