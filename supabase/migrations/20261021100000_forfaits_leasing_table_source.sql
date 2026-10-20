-- ============================================================================
--  DONNÉES — Forfaits de leasing par plaque : table dédiée, SOURCE de vérité
--  (étape 4 de la migration des réglages vers de vraies tables)
-- ============================================================================
--  Avant : les forfaits de leasing saisis dans l'app (page Contrats → leasing par véhicule,
--  fiche véhicule : forfait km, durée, début, prix du km supplémentaire, loyer…) vivaient
--  dans le bloc JSON app_settings.data.leasingContrats = { plaque: {…} }. Une mauvaise
--  écriture du bloc pouvait les effacer en entier.
--
--  Ce fichier crée :
--    • la table lease_overrides : 1 plaque = 1 ligne, isolée par société (RLS identique aux
--      autres tables). La clé de plaque est gardée TELLE QU'ENREGISTRÉE (`cle`, formats mixtes
--      « HG-763-VP » / « HG763VP » : règle des plaques, ne jamais réécrire une clé) ; le forfait
--      complet est gardé tel quel dans `forfait` ; la plaque normalisée (`immat_norm`, A-Z0-9) est
--      calculée pour les recherches et automatisations ;
--    • fp_forfait_leasing_enregistrer(société, clé, forfait) : crée ou remplace UN forfait ;
--    • fp_forfait_leasing_archiver(société, clé) : ARCHIVE un forfait retiré dans l'app
--      (deleted_at) — jamais d'effacement définitif.
--  SECURITY INVOKER → la RLS s'applique. Un forfait illisible (pas un objet) est REFUSÉ.
--  Aucune donnée existante modifiée. Recopie : 20261021100100_forfaits_leasing_resynchroniser_table.sql.
--  Idempotent. Testé sur le staging avant la production.
-- ============================================================================

begin;

create table if not exists public.lease_overrides (
  id           bigint generated always as identity primary key,
  societe      text not null,                 -- = app_settings.id (la société)
  cle          text not null,                 -- clé de plaque telle qu'enregistrée dans l'app
  forfait      jsonb not null,                -- le forfait complet, tel que l'app l'enregistre
  immat_norm   text generated always as (upper(regexp_replace(cle, '[^A-Za-z0-9]', '', 'g'))) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz                    -- archivage (forfait retiré dans l'app)
);
-- Un seul forfait ACTIF par clé et par société (les archives ne comptent pas).
create unique index if not exists lease_overrides_actif_uidx on public.lease_overrides (societe, cle) where deleted_at is null;
create index if not exists lease_overrides_soc_immat_idx on public.lease_overrides (societe, immat_norm);

grant select, insert, update, delete on public.lease_overrides to authenticated;
revoke all on public.lease_overrides from anon;
alter table public.lease_overrides enable row level security;

drop policy if exists tenant_lease_overrides on public.lease_overrides;
create policy tenant_lease_overrides on public.lease_overrides
  for all to authenticated
  using      (fp_is_admin() or coalesce(societe, 'PXP') = fp_societe())
  with check (fp_is_admin() or coalesce(societe, 'PXP') = fp_societe());

create or replace function public.fp_forfait_leasing_enregistrer(p_societe text, p_cle text, p_forfait jsonb)
  returns integer
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  n integer;
begin
  if coalesce(p_societe, '') = '' or coalesce(btrim(p_cle), '') = '' then
    raise exception 'Forfaits leasing : société et plaque obligatoires' using errcode = '22023';
  end if;
  if p_forfait is null or jsonb_typeof(p_forfait) <> 'object' then
    raise exception 'Forfaits leasing : forfait illisible (%)', p_cle using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('fp_forfait:' || p_societe || ':' || p_cle));

  update public.lease_overrides set forfait = p_forfait, updated_at = now()
   where societe = p_societe and cle = p_cle and deleted_at is null;
  get diagnostics n = row_count;
  if n = 0 then
    insert into public.lease_overrides (societe, cle, forfait) values (p_societe, p_cle, p_forfait);
    get diagnostics n = row_count;
  end if;
  return n;
end $$;

create or replace function public.fp_forfait_leasing_archiver(p_societe text, p_cle text)
  returns integer
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  n integer;
begin
  if coalesce(p_societe, '') = '' or coalesce(btrim(p_cle), '') = '' then
    raise exception 'Forfaits leasing : société et plaque obligatoires' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('fp_forfait:' || p_societe || ':' || p_cle));
  update public.lease_overrides set deleted_at = now(), updated_at = now()
   where societe = p_societe and cle = p_cle and deleted_at is null;
  get diagnostics n = row_count;
  return n;   -- 0 = déjà archivé ou inconnu (rejeu sans effet)
end $$;

revoke all on function public.fp_forfait_leasing_enregistrer(text, text, jsonb) from public, anon;
revoke all on function public.fp_forfait_leasing_archiver(text, text) from public, anon;
grant execute on function public.fp_forfait_leasing_enregistrer(text, text, jsonb) to authenticated;
grant execute on function public.fp_forfait_leasing_archiver(text, text) to authenticated;

commit;

-- Vérification
select 'table : RLS active' as quoi, relrowsecurity::text as valeur from pg_class where oid = 'public.lease_overrides'::regclass
union all
select 'fonctions : anon / connecté',
       has_function_privilege('anon', 'public.fp_forfait_leasing_enregistrer(text, text, jsonb)', 'execute')::text || ' / ' ||
       has_function_privilege('authenticated', 'public.fp_forfait_leasing_enregistrer(text, text, jsonb)', 'execute')::text || ' ; ' ||
       has_function_privilege('anon', 'public.fp_forfait_leasing_archiver(text, text)', 'execute')::text || ' / ' ||
       has_function_privilege('authenticated', 'public.fp_forfait_leasing_archiver(text, text)', 'execute')::text
union all
select 'table : anon peut lire', has_table_privilege('anon', 'public.lease_overrides', 'select')::text
union all
select 'lignes dans la table', count(*)::text from public.lease_overrides;

-- ============================================================================
--  RETOUR ARRIÈRE (l'ancienne version de l'application n'utilise ni la table ni les fonctions) :
--    drop function if exists public.fp_forfait_leasing_enregistrer(text, text, jsonb);
--    drop function if exists public.fp_forfait_leasing_archiver(text, text);
--    drop table if exists public.lease_overrides;   -- ⚠️ seulement si rien n'a été écrit depuis la mise en ligne
-- ============================================================================
