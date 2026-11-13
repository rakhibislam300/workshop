import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

type NotificationContext = { params: Promise<{ notificationId: string }> };
const statusInput = z.object({ read: z.boolean() });

export async function PATCH(request: Request, context: NotificationContext) {
  const { notificationId } = await context.params;
  const body = await request.json().catch(() => null); const input = statusInput.safeParse(body);
  if (!input.success) return NextResponse.json({ error: "Enter a valid notification state." }, { status: 400 });
  const supabase = await createClient(); const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in to update a notification." }, { status: 401 });
  const { data, error } = await supabase.from("in_app_notifications").update(input.data.read ? { status: "read", read_at: new Date().toISOString() } : { status: "delivered", read_at: null }).eq("id", notificationId).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not update that notification." }, { status: 400 });
  if (!data) return NextResponse.json({ error: "That notification is unavailable." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
