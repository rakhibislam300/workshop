import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { notificationPreferenceInput, reminderScheduleInput } from "@/lib/validation";

const familyQuery = z.string().uuid();

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  return { supabase, userId: error ? undefined : userId };
}

async function verifyFamilyAccess(supabase: Awaited<ReturnType<typeof createClient>>, familyId: string, userId: string) {
  const { data, error } = await supabase.from("family_memberships").select("family_id").eq("family_id", familyId).eq("user_id", userId).maybeSingle();
  return !error && Boolean(data);
}

export async function GET(request: Request) {
  const familyId = familyQuery.safeParse(new URL(request.url).searchParams.get("family_id"));
  if (!familyId.success) return NextResponse.json({ error: "A valid family workspace is required." }, { status: 400 });
  const { supabase, userId } = await authenticatedClient();
  if (!userId) return NextResponse.json({ error: "Sign in to view reminders." }, { status: 401 });
  if (!await verifyFamilyAccess(supabase, familyId.data, userId)) return NextResponse.json({ error: "You do not have access to this family workspace." }, { status: 403 });
  const [schedules, notifications, preferences] = await Promise.all([
    supabase.from("reminder_schedules").select("id,entity_type,entity_id,source_title,scheduled_for,timezone,recurrence,next_run_at,is_enabled,delivery_attempts,last_error").eq("family_id", familyId.data).order("next_run_at"),
    supabase.from("in_app_notifications").select("id,title,body,occurrence_at,status,read_at,created_at").eq("family_id", familyId.data).order("created_at", { ascending: false }).limit(30),
    supabase.from("notification_preferences").select("timezone,in_app_enabled,email_enabled").eq("family_id", familyId.data).eq("user_id", userId).maybeSingle(),
  ]);
  const error = [schedules.error, notifications.error, preferences.error].find(Boolean);
  if (error) return NextResponse.json({ error: "Could not load your persistent reminders." }, { status: 500 });
  return NextResponse.json({ schedules: schedules.data ?? [], notifications: notifications.data ?? [], preferences: preferences.data ?? { timezone: "Asia/Kolkata", in_app_enabled: true, email_enabled: false } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const input = reminderScheduleInput.safeParse(body);
  if (!input.success) return NextResponse.json({ error: input.error.issues[0]?.message ?? "Enter valid reminder details." }, { status: 400 });
  const { supabase, userId } = await authenticatedClient();
  if (!userId) return NextResponse.json({ error: "Sign in to schedule a reminder." }, { status: 401 });
  const details = input.data;
  if (!await verifyFamilyAccess(supabase, details.family_id, userId)) return NextResponse.json({ error: "You do not have access to this family workspace." }, { status: 403 });

  const source = details.entity_type === "task"
    ? await supabase.from("tasks").select("title").eq("id", details.entity_id).eq("family_id", details.family_id).maybeSingle()
    : details.entity_type === "bill"
      ? await supabase.from("bills").select("title").eq("id", details.entity_id).eq("family_id", details.family_id).maybeSingle()
      : await supabase.from("appointments").select("title").eq("id", details.entity_id).eq("family_id", details.family_id).maybeSingle();
  if (source.error || !source.data) return NextResponse.json({ error: "That household record is no longer available." }, { status: 404 });
  const { data, error } = await supabase.from("reminder_schedules").insert({
    family_id: details.family_id, created_by: userId, recipient_user_id: userId, entity_type: details.entity_type,
    entity_id: details.entity_id, source_title: source.data.title, scheduled_for: details.scheduled_for,
    timezone: details.timezone, recurrence: details.recurrence, next_run_at: details.scheduled_for,
  }).select("id").single();
  if (error || !data) return NextResponse.json({ error: "Could not save that reminder. Check the selected time zone and try again." }, { status: 400 });
  return NextResponse.json({ schedule: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const input = notificationPreferenceInput.safeParse(body);
  if (!input.success) return NextResponse.json({ error: input.error.issues[0]?.message ?? "Enter valid notification preferences." }, { status: 400 });
  const { supabase, userId } = await authenticatedClient();
  if (!userId) return NextResponse.json({ error: "Sign in to update reminder preferences." }, { status: 401 });
  if (!await verifyFamilyAccess(supabase, input.data.family_id, userId)) return NextResponse.json({ error: "You do not have access to this family workspace." }, { status: 403 });
  const { error } = await supabase.from("notification_preferences").upsert({ ...input.data, user_id: userId, email_enabled: false });
  if (error) return NextResponse.json({ error: "Could not save notification preferences. Check the selected time zone and try again." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
