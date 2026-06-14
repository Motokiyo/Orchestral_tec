create table if not exists public.orkmap_user_data (
  email text not null,
  type text not null,
  data jsonb,
  updated_at timestamptz not null default now(),
  primary key (email, type),
  constraint orkmap_user_data_type_check check (type in ('concerts', 'photos', 'omr-scores'))
);

alter table public.orkmap_user_data enable row level security;

create index if not exists orkmap_user_data_updated_at_idx
  on public.orkmap_user_data (updated_at desc);
