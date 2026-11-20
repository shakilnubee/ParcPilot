-- ============================================================================
--  GOOGLE — Compteur d'usage des API (fondation « gratuit maîtrisé »), Lot 2a
-- ============================================================================
--  But : avant d'activer la moindre API Google payante (Lot 2b), compter l'usage
--  de façon FIABLE — y compris quand plusieurs utilisateurs appellent EN MÊME
--  TEMPS — par société, par API et par mois, pour alerter à 80 % et COUPER à 90 %
--  de la limite gratuite applicable. Aucune clé ni appel Google ici : c'est la
--  plomberie de comptage, rien d'autre.
--
--  Ce fichier crée :
--    • la table google_api_usage : 1 ligne = (société, api, mois AAAA-MM) → compteur
--      d'unités consommées (appels OU éléments de matrice OU chargements de carte),
--      isolée par société (RLS identique aux autres tables), LECTURE SEULE côté client ;
--    • la fonction fp_quota_consommer(société, api, unités, plafond) : en UNE
--      transaction (verrou par société+api+mois), vérifie le seuil 90 % AVANT de
--      compter, incrémente seulement si autorisé, et renvoie l'état (compteur,
--      plafond, %, autorisé, suspendu). SECURITY DEFINER, réservée au service_role
--      (appelée uniquement par l'Edge Function google-quota, jamais par le client).
--
--  ⚠️ Écriture SEULEMENT via la fonction (service_role). Le client LIT la table
--  (RLS par société) pour afficher la conso ; il ne peut pas la modifier.
--  Aucune donnée existante touchée. Idempotent. À TESTER d'abord sur le staging
--  (appliqué automatiquement par la CI sur toute PR), appliqué en PRODUCTION
--  seulement avec accord explicite, après sauvegarde vérifiée (cf. JOURNAL.md).
-- ============================================================================

begin;

create table if not exists public.google_api_usage (
  id              bigint generated always as identity primary key,
  societe         text not null,            -- = app_settings.id (la société)
  api             text not null,            -- 'geocoding' | 'places' | 'routes' | 'maps_js' | 'maps_embed' | …
  periode         text not null,            -- mois UTC au format 'AAAA-MM'
  compteur        bigint not null default 0,-- unités consommées ce mois (appels / éléments de matrice / chargements)
  plafond         bigint,                   -- plafond gratuit appliqué au dernier comptage (info d'affichage)
  suspendu        boolean not null default false,  -- true dès que la coupure 90 % est atteinte
  suspendu_raison text,
  updated_at      timestamptz not null default now(),
  unique (societe, api, periode)
);
create index if not exists google_api_usage_soc_periode_idx on public.google_api_usage (societe, periode);

grant select on public.google_api_usage to authenticated;   -- LECTURE SEULE (affichage conso)
revoke insert, update, delete on public.google_api_usage from authenticated;
revoke all on public.google_api_usage from anon;
alter table public.google_api_usage enable row level security;

drop policy if exists tenant_google_api_usage on public.google_api_usage;
create policy tenant_google_api_usage on public.google_api_usage
  for select to authenticated
  using (fp_is_admin() or coalesce(societe, 'PXP') = fp_societe());

-- Consomme des unités de quota de façon atomique et renvoie la décision.
--  • p_unites  = nombre d'unités de CET appel (1 appel, ou N éléments de matrice, …)
--  • p_plafond = limite gratuite mensuelle applicable (fournie par l'Edge Function,
--    JAMAIS par le navigateur → un client ne peut pas relever sa propre limite).
--  Seuil de COUPURE = 90 % du plafond : si (compteur + unités) le dépasse, on n'incrémente
--  PAS et on renvoie autorise = false (l'appel Google n'aura pas lieu). Le verrou
--  consultatif par (société, api, mois) sérialise les appels simultanés → pas de
--  dépassement par course entre deux lecteurs.
create or replace function public.fp_quota_consommer(
    p_societe text, p_api text, p_unites integer, p_plafond bigint)
  returns table (compteur bigint, plafond bigint, pct numeric, autorise boolean, suspendu boolean)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_periode  text := to_char((now() at time zone 'utc'), 'YYYY-MM');
  v_unites   integer := greatest(coalesce(p_unites, 1), 0);
  v_plafond  bigint := nullif(p_plafond, 0);
  v_actuel   bigint := 0;
  v_seuil    bigint;
  v_ok       boolean;
begin
  if coalesce(p_societe, '') = '' or coalesce(p_api, '') = '' then
    raise exception 'Quota Google : société et api obligatoires' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('fp_quota:' || p_societe || ':' || p_api || ':' || v_periode));

  select u.compteur into v_actuel
    from public.google_api_usage u
   where u.societe = p_societe and u.api = p_api and u.periode = v_periode;
  v_actuel := coalesce(v_actuel, 0);

  -- Sans plafond connu (null) : on compte mais on n'autorise jamais la coupure (prudence → bloqué).
  if v_plafond is null then
    v_ok := false;
    v_seuil := null;
  else
    v_seuil := floor(v_plafond * 0.90);
    v_ok := (v_actuel + v_unites) <= v_seuil;
  end if;

  if v_ok then
    insert into public.google_api_usage as u (societe, api, periode, compteur, plafond, suspendu, updated_at)
    values (p_societe, p_api, v_periode, v_unites, v_plafond, false, now())
    on conflict (societe, api, periode) do update
      set compteur = u.compteur + v_unites,
          plafond  = coalesce(v_plafond, u.plafond),
          suspendu = false,
          updated_at = now()
    returning u.compteur into v_actuel;
  else
    -- Coupure : on marque suspendu (sans incrémenter) pour l'afficher dans Parc Pilot.
    insert into public.google_api_usage as u (societe, api, periode, compteur, plafond, suspendu, suspendu_raison, updated_at)
    values (p_societe, p_api, v_periode, v_actuel, v_plafond, true, 'Limite gratuite mensuelle atteinte (90 %)', now())
    on conflict (societe, api, periode) do update
      set plafond = coalesce(v_plafond, u.plafond),
          suspendu = true,
          suspendu_raison = 'Limite gratuite mensuelle atteinte (90 %)',
          updated_at = now()
    returning u.compteur into v_actuel;
  end if;

  return query select
    v_actuel,
    v_plafond,
    case when v_plafond is null or v_plafond = 0 then null else round((v_actuel::numeric / v_plafond) * 100, 1) end,
    v_ok,
    (v_plafond is not null and v_actuel >= floor(v_plafond * 0.90));
end $$;

revoke all on function public.fp_quota_consommer(text, text, integer, bigint) from public, anon, authenticated;
grant execute on function public.fp_quota_consommer(text, text, integer, bigint) to service_role;

commit;

-- Vérification
select 'table : RLS active' as quoi, relrowsecurity::text as valeur from pg_class where oid = 'public.google_api_usage'::regclass
union all
select 'table : anon peut lire', has_table_privilege('anon', 'public.google_api_usage', 'select')::text
union all
select 'table : connecté peut lire / écrire',
       has_table_privilege('authenticated', 'public.google_api_usage', 'select')::text || ' / ' ||
       has_table_privilege('authenticated', 'public.google_api_usage', 'insert')::text
union all
select 'fonction : anon / connecté / service_role',
       has_function_privilege('anon', 'public.fp_quota_consommer(text, text, integer, bigint)', 'execute')::text || ' / ' ||
       has_function_privilege('authenticated', 'public.fp_quota_consommer(text, text, integer, bigint)', 'execute')::text || ' / ' ||
       has_function_privilege('service_role', 'public.fp_quota_consommer(text, text, integer, bigint)', 'execute')::text;

-- ============================================================================
--  RETOUR ARRIÈRE (aucune fonctionnalité ne lit la table/fonction tant que le Lot 2b
--  n'est pas activé avec une clé) :
--    drop function if exists public.fp_quota_consommer(text, text, integer, bigint);
--    drop table if exists public.google_api_usage;   -- ⚠️ seulement si rien n'a été écrit depuis la mise en ligne
-- ============================================================================
