-- Explicitly deny browser-role access to the server-worker-only delivery queue.
create policy reminder_email_deliveries_no_browser_access on public.reminder_email_deliveries for all to authenticated
  using (false) with check (false);
