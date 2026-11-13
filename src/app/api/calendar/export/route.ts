import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const query = z.object({ family_id: z.string().uuid() });
const escapeIcs = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const stamp = (value: string) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export async function GET(request: Request) {
  const input = query.safeParse({ family_id: new URL(request.url).searchParams.get("family_id") }); if (!input.success) return NextResponse.json({ error: "Choose a valid family workspace." }, { status: 400 });
  const supabase = await createClient(); const { data: claims, error: authError } = await supabase.auth.getClaims(); const userId = claims?.claims?.sub;
  if (authError || !userId) return NextResponse.json({ error: "Sign in to export the calendar." }, { status: 401 });
  const membership = await supabase.from("family_memberships").select("family_id").eq("family_id", input.data.family_id).eq("user_id", userId).maybeSingle(); if (membership.error || !membership.data) return NextResponse.json({ error: "You do not have access to this family workspace." }, { status: 403 });
  const { data, error } = await supabase.from("appointments").select("id,title,appointment_at,location").eq("family_id", input.data.family_id).order("appointment_at").limit(500); if (error) return NextResponse.json({ error: "Could not export appointments." }, { status: 500 });
  const events = (data ?? []).map((item) => ["BEGIN:VEVENT", `UID:${item.id}@jibon-ai`, `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART:${stamp(item.appointment_at)}`, `SUMMARY:${escapeIcs(item.title)}`, item.location ? `LOCATION:${escapeIcs(item.location)}` : "", "END:VEVENT"].filter(Boolean).join("\r\n"));
  return new NextResponse(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Jibon AI//Family Calendar//EN", events, "END:VCALENDAR", ""].join("\r\n"), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": "attachment; filename=\"jibon-family-calendar.ics\"", "Cache-Control": "no-store" } });
}
