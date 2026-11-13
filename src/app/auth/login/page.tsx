import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
export const instant = false;
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) { const next = (await searchParams).next; const safeNext = next?.startsWith("/") ? next : "/dashboard"; return <main className="auth-shell"><Link href="/" className="mb-8 text-xl font-bold text-teal-800">Jibon <span className="text-slate-900">AI</span></Link><section className="auth-card"><p className="eyebrow">Welcome back</p><h1>Sign in to your household</h1><p className="mb-6 text-slate-600">Your everyday life, in one calm place.</p><AuthForm mode="login" next={safeNext} /></section></main>; }
