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
  // Keep membership lookup independent from the families relation. A relation
  // join can return an empty embedded record while an invitation/new-account
  // transition is settling, even though the membership itself is valid.
  const [profile, initialMembershipRows] = await Promise.all([
    supabase.from("profiles").select("display_name,locale").maybeSingle(),
    supabase.from("family_memberships").select("family_id,role").eq("user_id", userId),
  ]);
  if (profile.error) {
    // A profile is convenience data, not a reason to lock someone out of their
    // household. The profile editor can repair it after the dashboard loads.
    console.error("dashboard-profile-load-failed", { userId, code: profile.error.code, message: profile.error.message });
  }
  if (initialMembershipRows.error) {
    console.error("dashboard-membership-load-failed", { userId, code: initialMembershipRows.error.code, message: initialMembershipRows.error.message });
    throw new Error("Could not load family membership.");
  }

  let memberships = initialMembershipRows.data ?? [];
  if (memberships.length === 0) {
    // Defensive recovery for accounts created before the automatic-workspace
    // trigger was installed. The RPC creates a private owner workspace only
    // for the authenticated caller.
    const displayName = profile.data?.display_name?.trim();
    const { error: workspaceError } = await supabase.rpc("create_family", {
      p_name: displayName ? `${displayName}'s household` : "My household",
    });
    if (workspaceError) {
      console.error("dashboard-workspace-recovery-failed", { userId, code: workspaceError.code, message: workspaceError.message });
      throw new Error("Could not prepare a family workspace.");
    }
    const refreshedMemberships = await supabase.from("family_memberships").select("family_id,role").eq("user_id", userId);
    if (refreshedMemberships.error) {
      console.error("dashboard-membership-refresh-failed", { userId, code: refreshedMemberships.error.code, message: refreshedMemberships.error.message });
      throw new Error("Could not load the new family workspace.");
    }
    memberships = refreshedMemberships.data ?? [];
  }

  const familyIds = [...new Set(memberships.map((membership) => membership.family_id))];
  const familyRows = await supabase.from("families").select("id,name").in("id", familyIds);
  if (familyRows.error) {
    console.error("dashboard-family-load-failed", { userId, code: familyRows.error.code, message: familyRows.error.message });
    throw new Error("Could not load family workspace.");
  }
  const familyNames = new Map((familyRows.data ?? []).map((family) => [family.id, family.name]));
  const families = memberships.flatMap((membership) => {
    const name = familyNames.get(membership.family_id);
    return name ? [{ id: membership.family_id, name, role: membership.role }] : [];
  });
  if (!families.length) {
    console.error("dashboard-family-membership-mismatch", { userId, membershipCount: memberships.length, visibleFamilyCount: familyRows.data?.length ?? 0 });
    throw new Error("No family workspace is available for this account.");
  }
  const requested = (await searchParams).family;
  const activeFamily = families.find((family) => family.id === requested) ?? families[0];
  const [members, tasks, bills, appointments, activities] = await Promise.all([
    supabase.from("family_members").select("id,name,relationship").eq("family_id", activeFamily.id).order("name"),
    supabase.from("tasks").select("id,title,description,due_date,priority,is_completed,assigned_member_id").eq("family_id", activeFamily.id).order("created_at", { ascending: false }),
    supabase.from("bills").select("id,title,amount,category,due_date,is_paid").eq("family_id", activeFamily.id).order("due_date"),
    supabase.from("appointments").select("id,title,appointment_at,location,assigned_member_id").eq("family_id", activeFamily.id).order("appointment_at"),
    supabase.from("family_activity").select("id,action,entity_type,created_at").eq("family_id", activeFamily.id).order("created_at", { ascending: false }).limit(8),
  ]);
  const firstCoreError = [members.error, tasks.error, bills.error, appointments.error].find(Boolean);
  if (firstCoreError) {
    console.error("dashboard-core-data-load-failed", { userId, familyId: activeFamily.id, code: firstCoreError.code, message: firstCoreError.message });
    throw new Error("Could not load household data.");
  }
  if (activities.error) {
    // Activity history is secondary; never prevent tasks, bills, or calendar
    // data from opening when a history row is temporarily unavailable.
    console.error("dashboard-activity-load-failed", { userId, familyId: activeFamily.id, code: activities.error.code, message: activities.error.message });
  }
  const email = typeof claimsData.claims.email === "string" ? claimsData.claims.email : "";
  return <DashboardClient data={{ profile: profile.error ? null : profile.data, members: members.data ?? [], tasks: tasks.data ?? [], bills: bills.data ?? [], appointments: appointments.data ?? [], activities: activities.error ? [] : activities.data ?? [], families, activeFamily, userId, email }} />;
}
