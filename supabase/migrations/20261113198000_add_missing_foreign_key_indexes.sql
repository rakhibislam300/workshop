-- Phase 9: index every foreign key identified by the Supabase performance advisor.
-- These indexes speed up family-scoped joins and referential actions without
-- changing application data or authorization behavior.

create index if not exists families_created_by_idx on public.families (created_by);
create index if not exists family_activity_actor_user_idx on public.family_activity (actor_user_id);
create index if not exists family_ai_requests_family_idx on public.family_ai_requests (family_id);
create index if not exists family_invitations_accepted_by_idx on public.family_invitations (accepted_by);
create index if not exists family_invitations_invited_by_idx on public.family_invitations (invited_by);

create index if not exists financial_transactions_category_family_idx
  on public.financial_transactions (category_id, family_id);
create index if not exists monthly_budgets_category_family_idx
  on public.monthly_budgets (category_id, family_id);
create index if not exists recurring_bills_category_family_idx
  on public.recurring_bills (category_id, family_id);
create index if not exists subscriptions_category_family_idx
  on public.subscriptions (category_id, family_id);

create index if not exists notification_preferences_user_idx
  on public.notification_preferences (user_id);
create index if not exists reminder_email_deliveries_family_idx
  on public.reminder_email_deliveries (family_id);
create index if not exists reminder_schedules_created_by_idx
  on public.reminder_schedules (created_by);
create index if not exists reminder_schedules_family_idx
  on public.reminder_schedules (family_id);
create index if not exists shopping_items_list_family_idx
  on public.shopping_items (list_id, family_id);
