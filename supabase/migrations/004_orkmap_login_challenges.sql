-- LOT 1 / C3 : l'état du code de connexion passe côté serveur.
-- Migration ADDITIVE : crée une table neuve, ne modifie ni ne supprime rien.
-- À appliquer AVANT de déployer le code de api/request-code.js et api/verify-code.js.

create table if not exists public.orkmap_login_challenges (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  -- HMAC du code (jamais le code en clair)
  code_hash text not null,
  -- essais déjà consommés (comptés AVANT la comparaison)
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- renseigné à la première réussite : un code ne sert qu'une fois
  used_at timestamptz
);

-- RLS activée et AUCUNE politique : seule la clé service_role (qui contourne la RLS)
-- peut lire ou écrire. Les clés anon / authenticated n'ont aucun accès.
alter table public.orkmap_login_challenges enable row level security;
revoke all on table public.orkmap_login_challenges from anon, authenticated;

-- Limite de débit : compte les demandes récentes d'une adresse.
create index if not exists orkmap_login_challenges_email_created_at_idx
  on public.orkmap_login_challenges (email, created_at desc);
