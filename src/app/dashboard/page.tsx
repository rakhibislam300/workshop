import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/dashboard-client";

export const instant = false;
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ family?: string }> }) {
  await connection();
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) redirect("/auth/login");
  const [profile, membershipRows] = await Promise.all([
    supabase.from("profiles").select("display_name,locale").maybeSingle(),
    supabase.from("family_memberships").select("family_id,role,families(id,name)").eq("user_id", userId),
  ]);
  const membershipError = membershipRows.error;
  const families = (membershipRows.data ?? []).flatMap((row) => {
    const family = Array.isArray(row.families) ? row.families[0] : row.families;
    return family ? [{ id: family.id, name: family.name, role: row.role }] : [];
  });
  if (!families.length) throw new Error("No family workspace is available for this account.");
  const requested = (await searchParams).family;
  const activeFamily = families.find((family) => family.id === requested) ?? families[0];
  const [members, tasks, bills, appointments, activities] = await Promise.all([
    supabase.from("family_members").select("id,name,relationship").eq("family_id", activeFamily.id).order("name"),
    supabase.from("tasks").select("id,title,description,due_date,priority,is_completed,assigned_member_id").eq("family_id", activeFamily.id).order("created_at", { ascending: false }),
    supabase.from("bills").select("id,title,amount,category,due_date,is_paid").eq("family_id", activeFamily.id).order("due_date"),
    supabase.from("appointments").select("id,title,appointment_at,location,assigned_member_id").eq("family_id", activeFamily.id).order("appointment_at"),
    supabase.from("family_activity").select("id,action,entity_type,created_at").eq("family_id", activeFamily.id).order("created_at", { ascending: false }).limit(8),
  ]);
  const firstError = [profile.error, membershipError, members.error, tasks.error, bills.error, appointments.error, activities.error].find(Boolean);
  if (firstError) throw new Error(`Could not load household data: ${firstError.message}`);
  const email = typeof claimsData.claims.email === "string" ? claimsData.claims.email : "";
  return <DashboardClient data={{ profile: profile.data, members: members.data ?? [], tasks: tasks.data ?? [], bills: bills.data ?? [], appointments: appointments.data ?? [], activities: activities.data ?? [], families, activeFamily, userId, email }} />;
}
