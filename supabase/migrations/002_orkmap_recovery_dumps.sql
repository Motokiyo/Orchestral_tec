create table if not exists public.orkmap_recovery_dumps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source_origin text,
  dump_type text not null,
  record_key text not null,
  payload jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists orkmap_recovery_dumps_created_at_idx
  on public.orkmap_recovery_dumps (created_at desc);

create index if not exists orkmap_recovery_dumps_email_idx
  on public.orkmap_recovery_dumps (email);
