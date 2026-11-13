import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailReminderAvailable } from "@/lib/reminder-email";

type EmailDelivery = { id: string; recipient_email: string; attempts: number; notification_id: string; in_app_notifications: { title: string; body: string }[] };
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character] ?? character);

function isAuthorized(request: Request) {
  const expected = process.env.REMINDER_WORKER_SECRET;
  const received = request.headers.get("x-reminder-worker-secret");
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected); const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function POST(request: Request) {
  if (!emailReminderAvailable()) return NextResponse.json({ error: "Email reminders are not configured." }, { status: 503 });
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized reminder worker." }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.from("reminder_email_deliveries").select("id,recipient_email,attempts,notification_id,in_app_notifications(title,body)").eq("status", "pending").lte("next_attempt_at", new Date().toISOString()).order("next_attempt_at").limit(20);
  if (error) return NextResponse.json({ error: "Could not load queued emails." }, { status: 500 });
  let sent = 0; let retried = 0;
  for (const delivery of (data ?? []) as EmailDelivery[]) {
    const notification = delivery.in_app_notifications[0];
    if (!notification) continue;
    const providerResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `jibon-reminder/${delivery.notification_id}` },
      body: JSON.stringify({ from: process.env.REMINDER_FROM_EMAIL, to: [delivery.recipient_email], subject: notification.title, html: `<p>${escapeHtml(notification.body)}</p><p>Open Jibon AI to view or manage this reminder.</p>` }),
    });
    const responseBody = await providerResponse.json().catch(() => ({})) as { id?: string; message?: string };
    if (providerResponse.ok && responseBody.id) {
      await admin.from("reminder_email_deliveries").update({ status: "sent", provider_id: responseBody.id, sent_at: new Date().toISOString(), last_error: null }).eq("id", delivery.id);
      sent += 1;
      continue;
    }
    const attempts = delivery.attempts + 1; const failed = attempts >= 5;
    await admin.from("reminder_email_deliveries").update({ status: failed ? "failed" : "pending", attempts, next_attempt_at: new Date(Date.now() + Math.min(60 * 60 * 1000, 60_000 * 2 ** attempts)).toISOString(), last_error: String(responseBody.message || "Email provider rejected the request.").slice(0, 500) }).eq("id", delivery.id);
    if (!failed) retried += 1;
  }
  return NextResponse.json({ processed: data?.length ?? 0, sent, retried });
}
