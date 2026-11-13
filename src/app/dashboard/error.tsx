"use client";

export default function DashboardError({ reset }: { reset: () => void }) {
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5"><section className="max-w-md rounded-2xl border border-rose-100 bg-white p-6 text-center shadow-sm"><p className="eyebrow text-rose-700">Couldn’t load the dashboard</p><h1 className="text-2xl font-extrabold text-slate-950">Your data is still safe.</h1><p className="mt-3 text-sm leading-6 text-slate-600">Please check your connection, then try loading your household again.</p><button className="button mt-5" onClick={reset}>Try again</button></section></main>;
}
