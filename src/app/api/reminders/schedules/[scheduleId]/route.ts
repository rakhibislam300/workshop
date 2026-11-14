import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/tree-server";

type ScheduleContext = { params: Promise<{ scheduleId: string }> };
const toggleInput = z.object({ is_enabled: z.boolean() });

async function clientForReminder() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  return { supabase, userId: error ? undefined : data?.claims?.sub };
}

export async function PATCH(request: Request, context: ScheduleContext) {
  if (rejectCrossOrigin(request)) return NextResponse.json({ error: "Request origin denied." }, { status: 403 });
  const { scheduleId } = await context.params;
  const body = await request.json().catch(() => null); const input = toggleInput.safeParse(body);
  if (!input.success) return NextResponse.json({ error: "Enter a valid reminder state." }, { status: 400 });
  const { supabase, userId } = await clientForReminder();
  if (!userId) return NextResponse.json({ error: "Sign in to update a reminder." }, { status: 401 });
  const { data, error } = await supabase.from("reminder_schedules").update({ is_enabled: input.data.is_enabled }).eq("id", scheduleId).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not update that reminder." }, { status: 400 });
  if (!data) return NextResponse.json({ error: "That reminder is unavailable." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, context: ScheduleContext) {
  if (rejectCrossOrigin(request)) return NextResponse.json({ error: "Request origin denied." }, { status: 403 });
  const { scheduleId } = await context.params;
  const { supabase, userId } = await clientForReminder();
  if (!userId) return NextResponse.json({ error: "Sign in to remove a reminder." }, { status: 401 });
  const { data, error } = await supabase.from("reminder_schedules").delete().eq("id", scheduleId).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not remove that reminder." }, { status: 400 });
  if (!data) return NextResponse.json({ error: "That reminder is unavailable." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
