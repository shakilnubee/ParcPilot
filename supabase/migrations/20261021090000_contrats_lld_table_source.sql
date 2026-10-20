-- ============================================================================
--  DONNÉES — Contrats de location longue durée (LLD) : table dédiée, SOURCE de vérité
--  (étape 3 de la migration des réglages vers de vraies tables)
-- ============================================================================
--  Avant : les contrats LLD (Ayvens, Localease…, page Contrats → « Leasing (LLD) »)
--  vivaient dans le bloc JSON app_settings.data.localeaseContrats = [ {id, immat,
--  loyerTTC, dureeMois, debut, fin, docs, avenants…} ]. Une mauvaise écriture du bloc
--  pouvait les effacer en entier.
--
--  Ce fichier crée :
--    • la table lease_contracts : 1 contrat = 1 ligne (identifiant stable `contrat_id`),
--      ORDRE d'affichage conservé, isolée par société (RLS identique aux autres tables).
--      Le contrat complet est gardé tel quel dans `contrat` (rien n'est perdu) ; la plaque
--      en est extraite automatiquement (`immat`) pour les recherches et automatisations ;
--    • fp_contrat_lld_enregistrer(société, id, ordre, contrat) : crée ou remplace UN contrat ;
--    • fp_contrat_lld_archiver(société, id) : ARCHIVE un contrat supprimé dans l'app
--      (deleted_at) — jamais d'effacement définitif.
--  SECURITY INVOKER → la RLS s'applique : une société ne peut ni lire, ni modifier, ni
--  créer les contrats d'une autre. Un contrat illisible (pas un objet, identifiant qui ne
--  correspond pas) est REFUSÉ (erreur visible dans l'app, l'écriture reste en file).
--  Aucune donnée existante modifiée. Recopie : 20261021090100_contrats_lld_resynchroniser_table.sql.
--  Idempotent. Testé sur le staging avant la production.
-- ============================================================================

begin;

create table if not exists public.lease_contracts (
  id           bigint generated always as identity primary key,
  societe      text not null,                 -- = app_settings.id (la société)
  contrat_id   text not null,                 -- identifiant stable du contrat dans l'app (« lld-… »)
  ordre        integer not null default 0,    -- position d'affichage dans la liste
  contrat      jsonb not null,                -- le contrat complet, tel que l'app l'enregistre
  immat        text generated always as (nullif(btrim(contrat ->> 'immat'), '')) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz                    -- archivage (contrat supprimé dans l'app)
);
-- Un seul contrat ACTIF par identifiant et par société (les archives ne comptent pas).
create unique index if not exists lease_contracts_actif_uidx on public.lease_contracts (societe, contrat_id) where deleted_at is null;
create index if not exists lease_contracts_soc_ordre_idx on public.lease_contracts (societe, ordre);

grant select, insert, update, delete on public.lease_contracts to authenticated;
revoke all on public.lease_contracts from anon;
alter table public.lease_contracts enable row level security;

drop policy if exists tenant_lease_contracts on public.lease_contracts;
create policy tenant_lease_contracts on public.lease_contracts
  for all to authenticated
  using      (fp_is_admin() or coalesce(societe, 'PXP') = fp_societe())
  with check (fp_is_admin() or coalesce(societe, 'PXP') = fp_societe());

create or replace function public.fp_contrat_lld_enregistrer(p_societe text, p_id text, p_ordre integer, p_contrat jsonb)
  returns integer
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  n integer;
begin
  if coalesce(p_societe, '') = '' or coalesce(p_id, '') = '' then
    raise exception 'Contrats LLD : société et identifiant obligatoires' using errcode = '22023';
  end if;
  if p_contrat is null or jsonb_typeof(p_contrat) <> 'object' then
    raise exception 'Contrats LLD : contrat illisible (%)', p_id using errcode = '22023';
  end if;
  if coalesce(p_contrat ->> 'id', '') <> p_id then
    raise exception 'Contrats LLD : l''identifiant du contrat ne correspond pas (%)', p_id using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('fp_lld:' || p_societe || ':' || p_id));

  update public.lease_contracts
     set contrat = p_contrat, ordre = coalesce(p_ordre, ordre), updated_at = now()
   where societe = p_societe and contrat_id = p_id and deleted_at is null;
  get diagnostics n = row_count;
  if n = 0 then
    insert into public.lease_contracts (societe, contrat_id, ordre, contrat)
    values (p_societe, p_id, coalesce(p_ordre, 0), p_contrat);
    get diagnostics n = row_count;
  end if;
  return n;
end $$;

create or replace function public.fp_contrat_lld_archiver(p_societe text, p_id text)
  returns integer
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  n integer;
begin
  if coalesce(p_societe, '') = '' or coalesce(p_id, '') = '' then
    raise exception 'Contrats LLD : société et identifiant obligatoires' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('fp_lld:' || p_societe || ':' || p_id));
  update public.lease_contracts set deleted_at = now(), updated_at = now()
   where societe = p_societe and contrat_id = p_id and deleted_at is null;
  get diagnostics n = row_count;
  return n;   -- 0 = déjà archivé ou inconnu (rejeu sans effet)
end $$;

revoke all on function public.fp_contrat_lld_enregistrer(text, text, integer, jsonb) from public, anon;
revoke all on function public.fp_contrat_lld_archiver(text, text) from public, anon;
grant execute on function public.fp_contrat_lld_enregistrer(text, text, integer, jsonb) to authenticated;
grant execute on function public.fp_contrat_lld_archiver(text, text) to authenticated;

commit;

-- Vérification
select 'table : RLS active' as quoi, relrowsecurity::text as valeur from pg_class where oid = 'public.lease_contracts'::regclass
union all
select 'fonctions : anon / connecté',
       has_function_privilege('anon', 'public.fp_contrat_lld_enregistrer(text, text, integer, jsonb)', 'execute')::text || ' / ' ||
       has_function_privilege('authenticated', 'public.fp_contrat_lld_enregistrer(text, text, integer, jsonb)', 'execute')::text || ' ; ' ||
       has_function_privilege('anon', 'public.fp_contrat_lld_archiver(text, text)', 'execute')::text || ' / ' ||
       has_function_privilege('authenticated', 'public.fp_contrat_lld_archiver(text, text)', 'execute')::text
union all
select 'table : anon peut lire', has_table_privilege('anon', 'public.lease_contracts', 'select')::text;

-- ============================================================================
--  RETOUR ARRIÈRE (l'ancienne version de l'application n'utilise ni la table ni les fonctions) :
--    drop function if exists public.fp_contrat_lld_enregistrer(text, text, integer, jsonb);
--    drop function if exists public.fp_contrat_lld_archiver(text, text);
--    drop table if exists public.lease_contracts;   -- ⚠️ seulement si rien n'a été écrit depuis la mise en ligne
-- ============================================================================
