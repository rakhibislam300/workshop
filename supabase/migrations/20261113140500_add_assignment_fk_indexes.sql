-- Cover composite household-member assignment foreign keys.
create index tasks_assigned_member_user_idx on public.tasks (assigned_member_id, user_id);
create index appointments_assigned_member_user_idx on public.appointments (assigned_member_id, user_id);
