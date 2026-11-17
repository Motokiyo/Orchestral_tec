-- LOT 1 / C3 (suite) : demande de code ATOMIQUE, limites par adresse et par IP.
-- Migration ADDITIVE : ajoute une colonne et une fonction, ne supprime rien.
-- À appliquer APRES 004, AVANT de déployer le code de api/request-code.js.
--
-- Pourquoi une fonction : « compter les demandes récentes » puis « insérer » en deux
-- appels laisse passer deux requêtes simultanées. Ici le verrou par adresse
-- (pg_advisory_xact_lock) fait attendre la seconde jusqu'à la fin de la première.

alter table public.orkmap_login_challenges add column if not exists ip text;

create index if not exists orkmap_login_challenges_ip_created_at_idx
  on public.orkmap_login_challenges (ip, created_at desc)
  where ip is not null;

create or replace function public.orkmap_request_login_challenge(
  p_email text,
  p_ip text,
  p_id uuid,
  p_code_hash text,
  p_expires_at timestamptz,
  p_replace_id uuid default null,
  p_min_interval_seconds integer default 60,
  p_max_per_hour integer default 5,
  p_max_per_hour_ip integer default 10
) returns jsonb
language plpgsql
as $$
declare
  v_now timestamptz;
  v_times timestamptz[];
  v_wait integer;
begin
  -- Verrous pris toujours dans le même ordre (adresse, puis IP) : pas d'interblocage.
  perform pg_advisory_xact_lock(hashtext('orkmap-login:' || p_email));
  if p_ip is not null then
    perform pg_advisory_xact_lock(hashtext('orkmap-login-ip:' || p_ip));
  end if;

  -- L'heure est lue APRES l'attente du verrou.
  v_now := clock_timestamp();

  -- Limite par adresse : 1 par minute, 5 par heure.
  select coalesce(array_agg(created_at order by created_at desc), '{}')
    into v_times
    from public.orkmap_login_challenges
   where email = p_email and created_at > v_now - interval '1 hour';

  if array_length(v_times, 1) is not null
     and v_times[1] > v_now - make_interval(secs => p_min_interval_seconds) then
    v_wait := ceil(extract(epoch from (v_times[1] + make_interval(secs => p_min_interval_seconds) - v_now)))::integer;
    return jsonb_build_object('ok', false, 'reason', 'email_interval', 'retry_after', greatest(1, v_wait));
  end if;

  if coalesce(array_length(v_times, 1), 0) >= p_max_per_hour then
    v_wait := ceil(extract(epoch from (v_times[p_max_per_hour] + interval '1 hour' - v_now)))::integer;
    return jsonb_build_object('ok', false, 'reason', 'email_hour', 'retry_after', greatest(1, v_wait));
  end if;

  -- Limite par IP : p_max_per_hour_ip par heure, toutes adresses confondues.
  if p_ip is not null then
    select coalesce(array_agg(created_at order by created_at desc), '{}')
      into v_times
      from public.orkmap_login_challenges
     where ip = p_ip and created_at > v_now - interval '1 hour';
    if coalesce(array_length(v_times, 1), 0) >= p_max_per_hour_ip then
      v_wait := ceil(extract(epoch from (v_times[p_max_per_hour_ip] + interval '1 hour' - v_now)))::integer;
      return jsonb_build_object('ok', false, 'reason', 'ip_hour', 'retry_after', greatest(1, v_wait));
    end if;
  end if;

  -- Seul le défi lié au navigateur qui redemande un code est annulé.
  if p_replace_id is not null then
    update public.orkmap_login_challenges
       set used_at = v_now
     where id = p_replace_id and email = p_email and used_at is null;
  end if;

  insert into public.orkmap_login_challenges (id, email, code_hash, attempts, created_at, expires_at, ip)
  values (p_id, p_email, p_code_hash, 0, v_now, p_expires_at, p_ip);

  return jsonb_build_object('ok', true);
end;
$$;

-- Réservée à la clé service_role (le serveur) : ni anon ni authenticated.
revoke all on function public.orkmap_request_login_challenge(text, text, uuid, text, timestamptz, uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.orkmap_request_login_challenge(text, text, uuid, text, timestamptz, uuid, integer, integer, integer) to service_role;
