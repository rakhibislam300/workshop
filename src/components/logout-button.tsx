"use client";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
export function LogoutButton() { const router = useRouter(); return <button className="text-sm font-semibold text-slate-600 hover:text-teal-700" onClick={async () => { await createClient().auth.signOut(); router.push("/"); }}>Sign out</button>; }
