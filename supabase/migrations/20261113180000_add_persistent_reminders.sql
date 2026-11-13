-- Phase 3: persistent, timezone-aware in-app reminders.
-- Delivery is intentionally database-local: no email provider or external worker is required.

create extension if not exists pg_cron with schema pg_catalog;

create type public.reminder_entity_type as enum ('task', 'bill', 'appointment');
create type public.reminder_recurrence as enum ('none', 'daily', 'weekly', 'monthly');
create type public.reminder_notification_status as enum ('delivered', 'read');

create function app_private.is_valid_timezone(p_timezone text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone);
$$;

create function app_private.next_reminder_run(p_current timestamptz, p_timezone text, p_recurrence public.reminder_recurrence)
returns timestamptz language sql stable set search_path = '' as $$
  select case p_recurrence
    when 'daily' then ((p_current at time zone p_timezone) + interval '1 day') at time zone p_timezone
    when 'weekly' then ((p_current at time zone p_timezone) + interval '7 days') at time zone p_timezone
    when 'monthly' then ((p_current at time zone p_timezone) + interval '1 month') at time zone p_timezone
    else null
  end;
$$;

create table public.notification_preferences (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Kolkata' check (app_private.is_valid_timezone(timezone)),
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table public.reminder_schedules (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  entity_type public.reminder_entity_type not null,
  entity_id uuid not null,
  source_title text not null check (char_length(trim(source_title)) between 1 and 160),
  scheduled_for timestamptz not null,
  timezone text not null default 'Asia/Kolkata' check (app_private.is_valid_timezone(timezone)),
  recurrence public.reminder_recurrence not null default 'none',
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  is_enabled boolean not null default true,
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (created_by = recipient_user_id),
  check (next_run_at >= scheduled_for)
);

create table public.in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.reminder_schedules(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  body text not null check (char_length(trim(body)) between 1 and 400),
  occurrence_at timestamptz not null,
  status public.reminder_notification_status not null default 'delivered',
  delivery_attempts integer not null default 1 check (delivery_attempts >= 1),
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (schedule_id, occurrence_at),
  check ((status = 'read') = (read_at is not null))
);

create index reminder_schedules_due_idx on public.reminder_schedules (next_run_at) where is_enabled;
create index reminder_schedules_recipient_idx on public.reminder_schedules (recipient_user_id, family_id, next_run_at desc);
create index in_app_notifications_recipient_status_idx on public.in_app_notifications (recipient_user_id, status, created_at desc);
create index in_app_notifications_family_idx on public.in_app_notifications (family_id, created_at desc);

create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function app_private.set_updated_at();
create trigger reminder_schedules_updated_at before update on public.reminder_schedules
  for each row execute function app_private.set_updated_at();

-- Run in a transaction every minute. The unique schedule/occurrence key makes a
-- restart or overlapping run idempotent; a failed delivery leaves next_run_at due
-- so the next cron run retries it.
create function app_private.materialize_family_reminders()
returns void language plpgsql security definer set search_path = '' as $$
declare
  schedule public.reminder_schedules%rowtype;
begin
  for schedule in
    select candidate.*
    from public.reminder_schedules candidate
    join public.family_memberships membership
      on membership.family_id = candidate.family_id
      and membership.user_id = candidate.recipient_user_id
    left join public.notification_preferences preference
      on preference.family_id = candidate.family_id
      and preference.user_id = candidate.recipient_user_id
    where candidate.is_enabled
      and candidate.next_run_at <= now()
      and coalesce(preference.in_app_enabled, true)
    for update of candidate skip locked
  loop
    begin
      insert into public.in_app_notifications (schedule_id, family_id, recipient_user_id, title, body, occurrence_at)
      values (
        schedule.id,
        schedule.family_id,
        schedule.recipient_user_id,
        'Reminder: ' || schedule.source_title,
        'Scheduled for ' || to_char(schedule.next_run_at at time zone schedule.timezone, 'DD Mon YYYY, HH24:MI') || ' (' || schedule.timezone || ')',
        schedule.next_run_at
      ) on conflict (schedule_id, occurrence_at) do nothing;

      update public.reminder_schedules
        set last_run_at = schedule.next_run_at,
            next_run_at = coalesce(app_private.next_reminder_run(schedule.next_run_at, schedule.timezone, schedule.recurrence), schedule.next_run_at),
            is_enabled = case when schedule.recurrence = 'none' then false else true end,
            delivery_attempts = 0,
            last_error = null
        where id = schedule.id;
    exception when others then
      update public.reminder_schedules
        set delivery_attempts = delivery_attempts + 1,
            last_error = sqlerrm
        where id = schedule.id;
    end;
  end loop;
end;
$$;

revoke all on function app_private.is_valid_timezone(text) from public;
revoke all on function app_private.next_reminder_run(timestamptz, text, public.reminder_recurrence) from public;
revoke all on function app_private.materialize_family_reminders() from public, anon, authenticated;

revoke all on public.notification_preferences, public.reminder_schedules, public.in_app_notifications from anon, authenticated;
grant select, insert, update, delete on public.notification_preferences, public.reminder_schedules to authenticated;
grant select on public.in_app_notifications to authenticated;
grant update (status, read_at) on public.in_app_notifications to authenticated;

alter table public.notification_preferences enable row level security;
alter table public.reminder_schedules enable row level security;
alter table public.in_app_notifications enable row level security;

create policy notification_preferences_own on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid()) and (select app_private.has_family_access(family_id)))
  with check (user_id = (select auth.uid()) and (select app_private.has_family_access(family_id)));
create policy reminder_schedules_own on public.reminder_schedules for all to authenticated
  using (recipient_user_id = (select auth.uid()) and (select app_private.has_family_access(family_id)))
  with check (
    recipient_user_id = (select auth.uid())
    and created_by = (select auth.uid())
    and (select app_private.has_family_access(family_id))
  );
create policy in_app_notifications_recipient on public.in_app_notifications for select to authenticated
  using (recipient_user_id = (select auth.uid()) and (select app_private.has_family_access(family_id)));
create policy in_app_notifications_recipient_update on public.in_app_notifications for update to authenticated
  using (recipient_user_id = (select auth.uid()) and (select app_private.has_family_access(family_id)))
  with check (recipient_user_id = (select auth.uid()) and (select app_private.has_family_access(family_id)));

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'jibon-ai-materialize-reminders') then
    perform cron.schedule('jibon-ai-materialize-reminders', '* * * * *', 'select app_private.materialize_family_reminders();');
  end if;
end $$;
