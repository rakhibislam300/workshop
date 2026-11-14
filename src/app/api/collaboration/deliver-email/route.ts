import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { collaborationAppUrl, collaborationEmailAvailable } from "@/lib/collaboration-email";

type Delivery = {
  id: string;
  kind: "family_invitation" | "tree_profile_claim";
  recipient_email: string;
  invitation_token: string | null;
  attempts: number;
  family_invitation_id: string | null;
  tree_profile_claim_id: string | null;
};

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);

function isAuthorized(request: Request) {
  const expected = process.env.COLLABORATION_EMAIL_WORKER_SECRET;
  const received = request.headers.get("x-collaboration-email-worker-secret");
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected); const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function markCancelled(admin: ReturnType<typeof createAdminClient>, delivery: Delivery) {
  await admin.from("collaboration_email_deliveries").update({ status: "cancelled" }).eq("id", delivery.id);
}

async function isStillPending(admin: ReturnType<typeof createAdminClient>, delivery: Delivery) {
  if (delivery.kind === "family_invitation" && delivery.family_invitation_id) {
    const { data } = await admin.from("family_invitations").select("status,expires_at").eq("id", delivery.family_invitation_id).maybeSingle();
    return data?.status === "pending" && new Date(data.expires_at).getTime() > Date.now();
  }
  if (delivery.kind === "tree_profile_claim" && delivery.tree_profile_claim_id) {
    const { data } = await admin.from("tree_profile_claims").select("status").eq("id", delivery.tree_profile_claim_id).maybeSingle();
    return data?.status === "pending";
  }
  return false;
}

export async function POST(request: Request) {
  if (!collaborationEmailAvailable()) return NextResponse.json({ error: "Collaboration email is not configured." }, { status: 503 });
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized collaboration email worker." }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.from("collaboration_email_deliveries")
    .select("id,kind,recipient_email,invitation_token,attempts,family_invitation_id,tree_profile_claim_id")
    .eq("status", "pending").lte("next_attempt_at", new Date().toISOString()).order("next_attempt_at").limit(20);
  if (error) return NextResponse.json({ error: "Could not load queued collaboration emails." }, { status: 500 });

  let sent = 0; let retried = 0; let cancelled = 0;
  for (const delivery of (data ?? []) as Delivery[]) {
    if (!await isStillPending(admin, delivery)) { await markCancelled(admin, delivery); cancelled += 1; continue; }
    const appUrl = collaborationAppUrl();
    const invitationUrl = `${appUrl}/invitations/accept?token=${encodeURIComponent(delivery.invitation_token ?? "")}`;
    const claimUrl = `${appUrl}/dashboard?profile-claim=${encodeURIComponent(delivery.tree_profile_claim_id ?? "")}`;
    const isInvitation = delivery.kind === "family_invitation";
    const subject = isInvitation ? "You are invited to a Jibon AI household" : "A family tree profile is ready for you";
    const actionUrl = isInvitation ? invitationUrl : claimUrl;
    const copy = isInvitation
      ? "A family member invited you to collaborate in their household. Sign in with this email address to accept the invite."
      : "A family member requested that you manage your own profile in their private family tree. Sign in to review the request.";
    const providerResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `jibon-collaboration/${delivery.id}` },
      body: JSON.stringify({ from: process.env.REMINDER_FROM_EMAIL, to: [delivery.recipient_email], subject, html: `<p>${escapeHtml(copy)}</p><p><a href="${escapeHtml(actionUrl)}">Open Jibon AI</a></p><p>If you were not expecting this, you can ignore this email.</p>` }),
    });
    const body = await providerResponse.json().catch(() => ({})) as { id?: string; message?: string };
    if (providerResponse.ok && body.id) {
      await admin.from("collaboration_email_deliveries").update({ status: "sent", provider_id: body.id, sent_at: new Date().toISOString(), last_error: null }).eq("id", delivery.id);
      const parentTable = isInvitation ? "family_invitations" : "tree_profile_claims";
      const parentId = isInvitation ? delivery.family_invitation_id : delivery.tree_profile_claim_id;
      await admin.from(parentTable).update({ email_delivery_status: "sent" }).eq("id", parentId!);
      sent += 1;
      continue;
    }
    const attempts = delivery.attempts + 1; const failed = attempts >= 5;
    await admin.from("collaboration_email_deliveries").update({ status: failed ? "failed" : "pending", attempts, next_attempt_at: new Date(Date.now() + Math.min(60 * 60 * 1000, 60_000 * 2 ** attempts)).toISOString(), last_error: String(body.message || "Email provider rejected the request.").slice(0, 500) }).eq("id", delivery.id);
    if (failed) {
      const parentTable = isInvitation ? "family_invitations" : "tree_profile_claims";
      const parentId = isInvitation ? delivery.family_invitation_id : delivery.tree_profile_claim_id;
      await admin.from(parentTable).update({ email_delivery_status: "failed" }).eq("id", parentId!);
    } else retried += 1;
  }
  return NextResponse.json({ processed: data?.length ?? 0, sent, retried, cancelled });
}
