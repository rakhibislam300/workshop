import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { financeMonthInput } from "@/lib/validation";

function nextMonth(month: string) { const [year, value] = month.split("-").map(Number); return `${value === 12 ? year + 1 : year}-${String(value === 12 ? 1 : value + 1).padStart(2, "0")}-01`; }
function csvCell(value: unknown) { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }

export async function GET(request: Request) {
  const url = new URL(request.url); const input = financeMonthInput.safeParse({ family_id: url.searchParams.get("family_id"), month: url.searchParams.get("month") });
  if (!input.success) return NextResponse.json({ error: "Choose a valid family and month." }, { status: 400 });
  const supabase = await createClient(); const { data: claims, error: authError } = await supabase.auth.getClaims(); const userId = claims?.claims?.sub;
  if (authError || !userId) return NextResponse.json({ error: "Sign in to export finances." }, { status: 401 });
  const membership = await supabase.from("family_memberships").select("family_id").eq("family_id", input.data.family_id).eq("user_id", userId).maybeSingle();
  if (membership.error || !membership.data) return NextResponse.json({ error: "You do not have access to this family workspace." }, { status: 403 });
  const start = `${input.data.month}-01`; const end = nextMonth(input.data.month);
  const { data, error } = await supabase.from("financial_transactions").select("occurred_on,type,title,category_id,amount,currency,notes").eq("family_id", input.data.family_id).gte("occurred_on", start).lt("occurred_on", end).order("occurred_on", { ascending: false }).limit(1000);
  if (error) return NextResponse.json({ error: "Could not export the financial records." }, { status: 500 });
  const { data: categories, error: categoryError } = await supabase.from("financial_categories").select("id,name").eq("family_id", input.data.family_id);
  if (categoryError) return NextResponse.json({ error: "Could not export the financial categories." }, { status: 500 });
  const categoryNames = new Map((categories ?? []).map((category) => [category.id, category.name]));
  const rows = ["Date,Type,Title,Category,Amount,Currency,Notes", ...(data ?? []).map((item) => [item.occurred_on, item.type, item.title, item.category_id ? categoryNames.get(item.category_id) ?? "" : "", item.amount, item.currency, item.notes].map(csvCell).join(","))];
  return new NextResponse(rows.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="jibon-finances-${input.data.month}.csv"`, "Cache-Control": "no-store" } });
}
