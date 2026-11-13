import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { familyCreateInput } from "@/lib/validation";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = familyCreateInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return NextResponse.json({ error: "Sign in to create a family." }, { status: 401 });
  const { data: familyId, error } = await supabase.rpc("create_family", { p_name: parsed.data.name });
  if (error || !familyId) return NextResponse.json({ error: error?.message || "Could not create the family." }, { status: 400 });
  return NextResponse.json({ familyId });
}
