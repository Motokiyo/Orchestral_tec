-- LOT 5 : les images des plans sortent du JSON des concerts.
-- Migration ADDITIVE : crée une table neuve, ne modifie ni ne supprime rien.
-- À appliquer AVANT de déployer api/plan-image.js (sinon l'envoi des images échoue, les concerts
-- restent en attente sur le téléphone, rien n'est perdu).
--
-- Une ligne = une image de plan d'un compte, rangée sous l'empreinte SHA-256 (hex) de son data URL.
-- Le JSON des concerts ne contient plus que la référence « orkimg:<hash> ».
-- Pas de suppression automatique dans ce lot : une image qui n'est plus référencée reste (orpheline).

create table if not exists public.orkmap_plan_images (
  email text not null,
  hash text not null,
  -- data URL complet (« data:image/jpeg;base64,… »)
  data text not null,
  -- taille du data URL en octets
  bytes integer not null,
  created_at timestamptz not null default now(),
  primary key (email, hash),
  constraint orkmap_plan_images_hash_check check (hash ~ '^[0-9a-f]{64}$')
);

-- RLS activée et AUCUNE politique : seule la clé service_role (qui contourne la RLS)
-- peut lire ou écrire. Les clés anon / authenticated n'ont aucun accès.
alter table public.orkmap_plan_images enable row level security;
revoke all on table public.orkmap_plan_images from anon, authenticated;
