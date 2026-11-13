-- Phase 3 follow-up: durable, retryable optional email delivery queue.

create type public.reminder_email_delivery_status as enum ('pending', 'sent', 'failed');

create table public.reminder_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references public.in_app_notifications(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null check (char_length(trim(recipient_email)) between 3 and 320),
  status public.reminder_email_delivery_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  provider_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'sent') = (sent_at is not null))
);

create index reminder_email_deliveries_pending_idx
  on public.reminder_email_deliveries (next_attempt_at)
  where status = 'pending';
create index reminder_email_deliveries_recipient_idx
  on public.reminder_email_deliveries (recipient_user_id, created_at desc);

create trigger reminder_email_deliveries_updated_at before update on public.reminder_email_deliveries
  for each row execute function app_private.set_updated_at();

revoke all on public.reminder_email_deliveries from anon, authenticated;
alter table public.reminder_email_deliveries enable row level security;
create policy reminder_email_deliveries_no_browser_access on public.reminder_email_deliveries for all to authenticated
  using (false) with check (false);

-- Keep delivery records inaccessible to browser roles; the protected server worker
-- uses a server-only service-role credential and verifies its own secret.
create or replace function app_private.materialize_family_reminders()
returns void language plpgsql security definer set search_path = '' as $$
declare
  schedule public.reminder_schedules%rowtype;
  notification_id uuid;
  notification_email text;
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

      select id into notification_id
        from public.in_app_notifications
        where schedule_id = schedule.id and occurrence_at = schedule.next_run_at;

      select user_record.email into notification_email
        from auth.users user_record
        join public.notification_preferences preference
          on preference.user_id = user_record.id
          and preference.family_id = schedule.family_id
        where user_record.id = schedule.recipient_user_id
          and preference.email_enabled;

      if notification_id is not null and notification_email is not null then
        insert into public.reminder_email_deliveries (notification_id, family_id, recipient_user_id, recipient_email)
          values (notification_id, schedule.family_id, schedule.recipient_user_id, notification_email)
          on conflict (notification_id) do nothing;
      end if;

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

revoke all on function app_private.materialize_family_reminders() from public, anon, authenticated;
