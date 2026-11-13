import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
export default function RegisterPage() { return <main className="auth-shell"><Link href="/" className="mb-8 text-xl font-bold text-teal-800">Jibon <span className="text-slate-900">AI</span></Link><section className="auth-card"><p className="eyebrow">Start today</p><h1>Create your household</h1><p className="mb-6 text-slate-600">One dashboard for the things your family needs to remember.</p><AuthForm mode="register" /></section></main>; }
