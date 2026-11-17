-- LOT 1 / I4 : active la sécurité par lignes (RLS) sur deux tables qui contiennent
-- des copies complètes des données (noms de musiciens compris).
-- Migration ADDITIVE et réversible (alter table ... disable row level security).
-- Sans effet sur l'application : elle n'accède à ces tables qu'avec la clé
-- service_role (api/sync.js, api/recovery-dump.js), qui contourne la RLS.
-- Aucune politique n'est créée : les clés anon et authenticated n'ont donc aucun accès.

alter table public.orkmap_sync_history enable row level security;
alter table public.orkmap_recovery_dumps enable row level security;
