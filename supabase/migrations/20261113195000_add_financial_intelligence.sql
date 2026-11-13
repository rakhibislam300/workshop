-- Phase 6: exact-money, family-scoped financial records and planning.

create type public.finance_record_type as enum ('income', 'expense');
create type public.finance_category_kind as enum ('income', 'expense', 'both');
create type public.finance_frequency as enum ('monthly', 'yearly');

create table public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 80),
  kind public.finance_category_kind not null default 'expense',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id)
);
create unique index financial_categories_family_name_key on public.financial_categories (family_id, lower(name));
create index financial_categories_creator_idx on public.financial_categories (created_by);

create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  category_id uuid,
  type public.finance_record_type not null,
  title text not null check (char_length(trim(title)) between 1 and 160),
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null default 'INR' check (currency = 'INR'),
  occurred_on date not null default current_date,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, family_id) references public.financial_categories(id, family_id) on delete restrict
);
create index financial_transactions_family_date_idx on public.financial_transactions (family_id, occurred_on desc);
create index financial_transactions_family_type_date_idx on public.financial_transactions (family_id, type, occurred_on desc);
create index financial_transactions_category_idx on public.financial_transactions (category_id);
create index financial_transactions_creator_idx on public.financial_transactions (created_by);

create table public.monthly_budgets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  category_id uuid not null,
  month_start date not null check (month_start = date_trunc('month', month_start)::date),
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null default 'INR' check (currency = 'INR'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, category_id, month_start),
  foreign key (category_id, family_id) references public.financial_categories(id, family_id) on delete restrict
);
create index monthly_budgets_family_month_idx on public.monthly_budgets (family_id, month_start);
create index monthly_budgets_category_idx on public.monthly_budgets (category_id);
create index monthly_budgets_creator_idx on public.monthly_budgets (created_by);

create table public.recurring_bills (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  category_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 160),
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null default 'INR' check (currency = 'INR'),
  frequency public.finance_frequency not null default 'monthly',
  next_due_date date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, family_id) references public.financial_categories(id, family_id) on delete restrict
);
create index recurring_bills_due_idx on public.recurring_bills (family_id, next_due_date) where is_active;
create index recurring_bills_category_idx on public.recurring_bills (category_id);
create index recurring_bills_creator_idx on public.recurring_bills (created_by);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  category_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 160),
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null default 'INR' check (currency = 'INR'),
  frequency public.finance_frequency not null default 'monthly',
  next_renewal_date date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, family_id) references public.financial_categories(id, family_id) on delete restrict
);
create index subscriptions_renewal_idx on public.subscriptions (family_id, next_renewal_date) where is_active;
create index subscriptions_category_idx on public.subscriptions (category_id);
create index subscriptions_creator_idx on public.subscriptions (created_by);

create function app_private.prevent_finance_owner_or_family_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.created_by is distinct from old.created_by then raise exception 'The original creator cannot be changed'; end if;
  if new.family_id is distinct from old.family_id then raise exception 'The family workspace cannot be changed'; end if;
  return new;
end;
$$;
revoke all on function app_private.prevent_finance_owner_or_family_change() from public;

create trigger financial_categories_updated_at before update on public.financial_categories for each row execute function app_private.set_updated_at();
create trigger financial_transactions_updated_at before update on public.financial_transactions for each row execute function app_private.set_updated_at();
create trigger monthly_budgets_updated_at before update on public.monthly_budgets for each row execute function app_private.set_updated_at();
create trigger recurring_bills_updated_at before update on public.recurring_bills for each row execute function app_private.set_updated_at();
create trigger subscriptions_updated_at before update on public.subscriptions for each row execute function app_private.set_updated_at();
create trigger financial_categories_immutable before update on public.financial_categories for each row execute function app_private.prevent_finance_owner_or_family_change();
create trigger financial_transactions_immutable before update on public.financial_transactions for each row execute function app_private.prevent_finance_owner_or_family_change();
create trigger monthly_budgets_immutable before update on public.monthly_budgets for each row execute function app_private.prevent_finance_owner_or_family_change();
create trigger recurring_bills_immutable before update on public.recurring_bills for each row execute function app_private.prevent_finance_owner_or_family_change();
create trigger subscriptions_immutable before update on public.subscriptions for each row execute function app_private.prevent_finance_owner_or_family_change();
create trigger financial_categories_activity after insert or update or delete on public.financial_categories for each row execute function app_private.log_family_activity();
create trigger financial_transactions_activity after insert or update or delete on public.financial_transactions for each row execute function app_private.log_family_activity();
create trigger monthly_budgets_activity after insert or update or delete on public.monthly_budgets for each row execute function app_private.log_family_activity();
create trigger recurring_bills_activity after insert or update or delete on public.recurring_bills for each row execute function app_private.log_family_activity();
create trigger subscriptions_activity after insert or update or delete on public.subscriptions for each row execute function app_private.log_family_activity();

revoke all on public.financial_categories, public.financial_transactions, public.monthly_budgets, public.recurring_bills, public.subscriptions from anon, authenticated;
grant select, insert, update, delete on public.financial_categories, public.financial_transactions, public.monthly_budgets, public.recurring_bills, public.subscriptions to authenticated;
alter table public.financial_categories enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.monthly_budgets enable row level security;
alter table public.recurring_bills enable row level security;
alter table public.subscriptions enable row level security;

create policy financial_categories_select_member on public.financial_categories for select to authenticated using ((select app_private.has_family_access(family_id)));
create policy financial_categories_insert_member on public.financial_categories for insert to authenticated with check (created_by = (select auth.uid()) and (select app_private.has_family_access(family_id)));
create policy financial_categories_update_member on public.financial_categories for update to authenticated using ((select app_private.has_family_access(family_id))) with check ((select app_private.has_family_access(family_id)));
create policy financial_categories_delete_member on public.financial_categories for delete to authenticated using ((select app_private.has_family_access(family_id)));

create policy financial_transactions_select_member on public.financial_transactions for select to authenticated using ((select app_private.has_family_access(family_id)));
create policy financial_transactions_insert_member on public.financial_transactions for insert to authenticated with check (created_by = (select auth.uid()) and (select app_private.has_family_access(family_id)));
create policy financial_transactions_update_member on public.financial_transactions for update to authenticated using ((select app_private.has_family_access(family_id))) with check ((select app_private.has_family_access(family_id)));
create policy financial_transactions_delete_member on public.financial_transactions for delete to authenticated using ((select app_private.has_family_access(family_id)));

create policy monthly_budgets_select_member on public.monthly_budgets for select to authenticated using ((select app_private.has_family_access(family_id)));
create policy monthly_budgets_insert_member on public.monthly_budgets for insert to authenticated with check (created_by = (select auth.uid()) and (select app_private.has_family_access(family_id)));
create policy monthly_budgets_update_member on public.monthly_budgets for update to authenticated using ((select app_private.has_family_access(family_id))) with check ((select app_private.has_family_access(family_id)));
create policy monthly_budgets_delete_member on public.monthly_budgets for delete to authenticated using ((select app_private.has_family_access(family_id)));

create policy recurring_bills_select_member on public.recurring_bills for select to authenticated using ((select app_private.has_family_access(family_id)));
create policy recurring_bills_insert_member on public.recurring_bills for insert to authenticated with check (created_by = (select auth.uid()) and (select app_private.has_family_access(family_id)));
create policy recurring_bills_update_member on public.recurring_bills for update to authenticated using ((select app_private.has_family_access(family_id))) with check ((select app_private.has_family_access(family_id)));
create policy recurring_bills_delete_member on public.recurring_bills for delete to authenticated using ((select app_private.has_family_access(family_id)));

create policy subscriptions_select_member on public.subscriptions for select to authenticated using ((select app_private.has_family_access(family_id)));
create policy subscriptions_insert_member on public.subscriptions for insert to authenticated with check (created_by = (select auth.uid()) and (select app_private.has_family_access(family_id)));
create policy subscriptions_update_member on public.subscriptions for update to authenticated using ((select app_private.has_family_access(family_id))) with check ((select app_private.has_family_access(family_id)));
create policy subscriptions_delete_member on public.subscriptions for delete to authenticated using ((select app_private.has_family_access(family_id)));
