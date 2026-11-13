-- Phase 7: family-scoped shared shopping lists and lightweight inventory signals.

create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 120),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id)
);
create index shopping_lists_family_active_idx on public.shopping_lists (family_id, created_at desc) where not is_archived;
create index shopping_lists_creator_idx on public.shopping_lists (created_by);

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null,
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 160),
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit text not null default 'item' check (char_length(trim(unit)) between 1 and 24),
  is_purchased boolean not null default false,
  is_low_stock boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (list_id, family_id) references public.shopping_lists(id, family_id) on delete cascade
);
create index shopping_items_list_status_idx on public.shopping_items (list_id, is_purchased, created_at);
create index shopping_items_family_low_stock_idx on public.shopping_items (family_id, created_at desc) where is_low_stock and not is_purchased;
create index shopping_items_creator_idx on public.shopping_items (created_by);

create function app_private.prevent_shopping_owner_or_family_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.created_by is distinct from old.created_by then raise exception 'The original creator cannot be changed'; end if;
  if new.family_id is distinct from old.family_id then raise exception 'The family workspace cannot be changed'; end if;
  return new;
end;
$$;
revoke all on function app_private.prevent_shopping_owner_or_family_change() from public;

create trigger shopping_lists_updated_at before update on public.shopping_lists for each row execute function app_private.set_updated_at();
create trigger shopping_items_updated_at before update on public.shopping_items for each row execute function app_private.set_updated_at();
create trigger shopping_lists_immutable before update on public.shopping_lists for each row execute function app_private.prevent_shopping_owner_or_family_change();
create trigger shopping_items_immutable before update on public.shopping_items for each row execute function app_private.prevent_shopping_owner_or_family_change();
create trigger shopping_lists_activity after insert or update or delete on public.shopping_lists for each row execute function app_private.log_family_activity();
create trigger shopping_items_activity after insert or update or delete on public.shopping_items for each row execute function app_private.log_family_activity();

revoke all on public.shopping_lists, public.shopping_items from anon, authenticated;
grant select, insert, update, delete on public.shopping_lists, public.shopping_items to authenticated;
alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;

create policy shopping_lists_select_member on public.shopping_lists for select to authenticated using ((select app_private.has_family_access(family_id)));
create policy shopping_lists_insert_member on public.shopping_lists for insert to authenticated with check (created_by = (select auth.uid()) and (select app_private.has_family_access(family_id)));
create policy shopping_lists_update_member on public.shopping_lists for update to authenticated using ((select app_private.has_family_access(family_id))) with check ((select app_private.has_family_access(family_id)));
create policy shopping_lists_delete_member on public.shopping_lists for delete to authenticated using ((select app_private.has_family_access(family_id)));

create policy shopping_items_select_member on public.shopping_items for select to authenticated using ((select app_private.has_family_access(family_id)));
create policy shopping_items_insert_member on public.shopping_items for insert to authenticated with check (created_by = (select auth.uid()) and (select app_private.has_family_access(family_id)));
create policy shopping_items_update_member on public.shopping_items for update to authenticated using ((select app_private.has_family_access(family_id))) with check ((select app_private.has_family_access(family_id)));
create policy shopping_items_delete_member on public.shopping_items for delete to authenticated using ((select app_private.has_family_access(family_id)));
