"use client";
import { FormEvent, useEffect, useState } from "react";
import { BadgeCheck, UserRound } from "lucide-react";
import type { TreePerson } from "@/lib/family-tree";

type Claim = { id: string; person_id: string; status: "pending" | "accepted"; created_at: string; tree_people: TreePerson | TreePerson[] | null };
const asPerson = (value: Claim["tree_people"]) => Array.isArray(value) ? value[0] : value;

export function PersonalTreeProfiles() {
  const [claims, setClaims] = useState<Claim[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  async function load() {
    const response = await fetch("/api/tree-profile-claims", { cache: "no-store" }); const payload = await response.json();
    if (!response.ok) throw new Error(payload.error); setClaims(payload.claims);
  }
  useEffect(() => { const controller = new AbortController(); fetch("/api/tree-profile-claims", { cache: "no-store", signal: controller.signal })
    .then(async response => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error); return payload; })
    .then(payload => setClaims(payload.claims)).catch(e => { if (!controller.signal.aborted) setError(e.message); })
    .finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, []);
  async function command(body: object, success: string) {
    setBusy(true); setError(""); setMessage("");
    try { const response = await fetch("/api/tree-profile-claims", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); await load(); setMessage(success); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save your profile."); return false; }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>, personId: string) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await command({ action: "save_profile", person_id: personId, person: { name: form.get("name"), birth_year: form.get("birth_year") ? Number(form.get("birth_year")) : null, death_year: form.get("death_year") ? Number(form.get("death_year")) : null, birthplace: form.get("birthplace"), biography: form.get("biography") } }, "Your family profile was updated.");
  }
  async function uploadPhoto(personId: string, file: File) {
    setBusy(true); setError(""); setMessage(""); const body = new FormData(); body.set("photo", file);
    try { const response = await fetch(`/api/family-tree/photo/${personId}`, { method: "POST", body }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setMessage("Your profile photo was updated."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not upload your photo."); }
    finally { setBusy(false); }
  }
  if (loading) return <section className="card"><p role="status" className="text-sm text-slate-500">Checking personal family profiles…</p></section>;
  if (!claims.length && !error) return null;
  return <section className="card space-y-5" aria-labelledby="personal-profiles-heading"><div><p className="eyebrow">Your shared details</p><h2 id="personal-profiles-heading" className="flex items-center gap-2 text-xl font-extrabold"><UserRound size={22}/> Personal family profiles</h2><p className="mt-2 text-sm text-slate-600">A family may invite your Jibon account to maintain your own profile. Your edits update that profile wherever it appears in their family tree. Relationship lines remain managed by the family.</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}{message && <p role="status" className="rounded-lg bg-teal-50 p-3 text-sm text-teal-800">{message}</p>}
    {claims.map(claim => { const person = asPerson(claim.tree_people); if (!person) return null; return <div key={claim.id} className="rounded-xl border border-slate-200 p-4">{claim.status === "pending" ? <><h3 className="font-bold">Confirm profile for {person.name}</h3><p className="mt-1 text-sm text-slate-600">Accept only if this family profile describes you. It lets you correct your own details, without giving access to their household data.</p><div className="mt-4 flex flex-wrap gap-2"><button className="button" disabled={busy} onClick={() => void command({ action: "respond", id: claim.id, response: "accept" }, "Profile accepted. You can now keep these details up to date.")}>Accept profile</button><button className="button-secondary" disabled={busy} onClick={() => void command({ action: "respond", id: claim.id, response: "decline" }, "Profile request declined.")}>Decline</button></div></> : <form onSubmit={event => void save(event, person.id)} className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><h3 className="flex items-center gap-2 font-bold"><BadgeCheck className="text-teal-700" size={18}/> Your linked profile</h3><p className="mt-1 text-sm text-slate-500">Only you can update these personal details from your account.</p></div><label className="text-sm font-semibold sm:col-span-2">Full name<input name="name" className="field mt-1" defaultValue={person.name} maxLength={120} required/></label><label className="text-sm font-semibold">Birth year<input name="birth_year" type="number" className="field mt-1" min={1000} max={2200} defaultValue={person.birth_year ?? ""}/></label><label className="text-sm font-semibold">Death year<input name="death_year" type="number" className="field mt-1" min={1000} max={2200} defaultValue={person.death_year ?? ""}/></label><label className="text-sm font-semibold sm:col-span-2">Birthplace / hometown<input name="birthplace" className="field mt-1" defaultValue={person.birthplace} maxLength={160}/></label><label className="text-sm font-semibold sm:col-span-2">Your story<textarea name="biography" className="field mt-1" rows={3} defaultValue={person.biography} maxLength={2000}/></label><label className="text-sm font-semibold sm:col-span-2">Profile photo <span className="font-normal text-slate-500">(JPG, PNG, or WebP · 3 MB max)</span><input type="file" className="mt-2 block w-full text-sm" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadPhoto(person.id, file); event.target.value = ""; }}/></label><button className="button sm:col-span-2" disabled={busy}>Save my profile</button></form>}</div>; })}
  </section>;
}
