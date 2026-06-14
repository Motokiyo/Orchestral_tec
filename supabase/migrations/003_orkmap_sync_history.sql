create table if not exists public.orkmap_sync_history (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  type text not null,
  source text not null,
  data jsonb,
  created_at timestamptz not null default now(),
  constraint orkmap_sync_history_type_check check (type in ('concerts', 'photos', 'omr-scores')),
  constraint orkmap_sync_history_source_check check (source in ('incoming', 'previous'))
);

create index if not exists orkmap_sync_history_email_type_created_at_idx
  on public.orkmap_sync_history (email, type, created_at desc);
