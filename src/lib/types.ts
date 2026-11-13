export type Priority = "low" | "medium" | "high";

export type FamilyMember = { id: string; name: string; relationship: string | null };
export type Task = { id: string; title: string; description: string | null; due_date: string | null; priority: Priority; is_completed: boolean; assigned_member_id: string | null };
export type Bill = { id: string; title: string; amount: number | string; category: string; due_date: string; is_paid: boolean };
export type Appointment = { id: string; title: string; appointment_at: string; location: string | null; assigned_member_id: string | null };
export type FamilyRole = "owner" | "admin" | "member";
export type Family = { id: string; name: string; role: FamilyRole };
export type Activity = { id: string; action: string; entity_type: string; created_at: string };
export type DocumentCategory = "identity" | "medical" | "finance" | "home" | "education" | "other";
export type DocumentVisibility = "private" | "family";
export type VaultDocument = { id: string; title: string; category: DocumentCategory; visibility: DocumentVisibility; original_filename: string; mime_type: string; size_bytes: number; created_at: string; owner_user_id: string };

export type WorkspaceData = { profile: { display_name: string } | null; members: FamilyMember[]; tasks: Task[]; bills: Bill[]; appointments: Appointment[]; activities: Activity[]; families: Family[]; activeFamily: Family; userId: string; email: string };
