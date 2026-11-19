-- Explicitly deny browser-role access to the server-worker-only delivery queue.
drop policy if exists reminder_email_deliveries_no_browser_access on public.reminder_email_deliveries;
create policy reminder_email_deliveries_no_browser_access on public.reminder_email_deliveries for all to authenticated
  using (false) with check (false);
