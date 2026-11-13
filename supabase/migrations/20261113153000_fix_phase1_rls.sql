-- Corrective verification migration for Phase 1 collaboration controls.
-- Explicit role revocations are required because this project grants RPC execute
-- directly to anon/authenticated by default, and appointments need family policies.

revoke all on function public.create_family(text) from public, anon;
revoke all on function public.accept_family_invitation(uuid) from public, anon;
grant execute on function public.create_family(text) to authenticated;
grant execute on function public.accept_family_invitation(uuid) to authenticated;

drop policy if exists appointments_select_member on public.appointments;
drop policy if exists appointments_insert_member on public.appointments;
drop policy if exists appointments_update_member on public.appointments;
drop policy if exists appointments_delete_member on public.appointments;
create policy appointments_select_member on public.appointments for select to authenticated
  using ((select app_private.has_family_access(family_id)));
create policy appointments_insert_member on public.appointments for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app_private.has_family_access(family_id)));
create policy appointments_update_member on public.appointments for update to authenticated
  using ((select app_private.has_family_access(family_id)))
  with check ((select app_private.has_family_access(family_id)));
create policy appointments_delete_member on public.appointments for delete to authenticated
  using ((select app_private.has_family_access(family_id)));
