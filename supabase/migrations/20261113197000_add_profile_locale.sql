-- Phase 8: persist each account's text-language choice without changing family data.
alter table public.profiles add column locale text not null default 'en'
  check (locale in ('en', 'as', 'hi', 'bn'));
