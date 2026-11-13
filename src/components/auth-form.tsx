"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AuthForm({ mode, next = "/dashboard" }: { mode: "login" | "register"; next?: string }) {
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const isRegister = mode === "register";
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    const values = new FormData(event.currentTarget); const email = String(values.get("email") || ""); const password = String(values.get("password") || "");
    try {
      const supabase = createClient();
      if (isRegister) {
        const { data, error: authError } = await supabase.auth.signUp({ email, password, options: { data: { display_name: String(values.get("displayName") || "").trim() }, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` } });
        if (authError) throw authError;
        if (data.session) router.push("/dashboard"); else setNotice("Check your email to confirm your account, then return here to sign in.");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password }); if (authError) throw authError; router.push(next.startsWith("/") ? next : "/dashboard");
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong. Please try again."); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4">
    {isRegister && <label className="block text-sm font-medium text-slate-700">Your name<input name="displayName" required maxLength={80} className="field mt-1" placeholder="e.g. Rina" /></label>}
    <label className="block text-sm font-medium text-slate-700">Email<input name="email" type="email" autoComplete="email" required className="field mt-1" placeholder="you@example.com" /></label>
    <label className="block text-sm font-medium text-slate-700">Password<input name="password" type="password" autoComplete={isRegister ? "new-password" : "current-password"} required minLength={6} className="field mt-1" placeholder="At least 6 characters" /></label>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}{notice && <p role="status" className="rounded-lg bg-teal-50 p-3 text-sm text-teal-800">{notice}</p>}
    <button disabled={busy} className="button w-full">{busy ? "Please wait…" : isRegister ? "Create household" : "Sign in"}</button>
    <p className="text-center text-sm text-slate-600">{isRegister ? "Already have an account?" : "New to Jibon AI?"} <Link className="font-semibold text-teal-700 hover:underline" href={isRegister ? "/auth/login" : "/auth/register"}>{isRegister ? "Sign in" : "Create an account"}</Link></p>
  </form>;
}
