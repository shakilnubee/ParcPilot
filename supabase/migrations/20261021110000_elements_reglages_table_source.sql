-- ============================================================================
--  DONNÉES — Éléments de réglages en table générique : les ASSURANCES
--  (étape 5 de la migration des réglages vers de vraies tables)
-- ============================================================================
--  Avant : les données d'assurance vivaient dans le bloc JSON app_settings.data :
--    • assureurs         = [ {id, nom, contrat, documents…} ]     (liste à identifiant)
--    • assureurVeh       = { plaque: idAssureur }                 (plaque → valeur)
--    • assuranceEcheance = { plaque: {debut, fin, police} }       (plaque → valeur)
--    • assurancePrimes   = { plaque: {ht, ttc, …} }               (plaque → valeur)
--    • assuranceIgnore   = [ plaque, … ]                          (ensemble de plaques)
--  Une mauvaise écriture du bloc pouvait les effacer en entier.
--
--  Ce fichier crée UNE table générique, prévue pour les prochaines données de travail :
--    • settings_items : 1 élément = 1 ligne (société, collection, clé), valeur complète en jsonb,
--      ordre conservé pour les listes, isolée par société (RLS identique aux autres tables).
--      Les clés (plaques, identifiants) sont gardées TELLES QU'ENREGISTRÉES (règle des plaques) ;
--    • fp_element_enregistrer(société, collection, clé, valeur, ordre) : crée ou remplace UN élément ;
--    • fp_element_archiver(société, collection, clé) : ARCHIVE un élément retiré (deleted_at).
--  Les fonctions n'acceptent qu'une LISTE FERMÉE de collections (ci-dessous) : une nouvelle donnée
--  migrée l'ajoute par une nouvelle migration (create or replace). SECURITY INVOKER → la RLS s'applique.
--  Aucune donnée existante modifiée. Recopie : 20261021110100_assurances_resynchroniser_table.sql.
--  Idempotent. Testé sur le staging avant la production.
-- ============================================================================

begin;

create table if not exists public.settings_items (
  id           bigint generated always as identity primary key,
  societe      text not null,                 -- = app_settings.id (la société)
  collection   text not null,                 -- nom de la clé de réglages (ex. assurancePrimes)
  cle          text not null,                 -- clé de l'élément (plaque, identifiant…) telle qu'enregistrée
  valeur       jsonb not null,                -- valeur complète de l'élément
  ordre        integer not null default 0,    -- position (listes) ; 0 pour les tables « clé → valeur »
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz                    -- archivage (élément retiré dans l'app)
);
create unique index if not exists settings_items_actif_uidx on public.settings_items (societe, collection, cle) where deleted_at is null;
create index if not exists settings_items_soc_coll_idx on public.settings_items (societe, collection, ordre);

grant select, insert, update, delete on public.settings_items to authenticated;
revoke all on public.settings_items from anon;
alter table public.settings_items enable row level security;

drop policy if exists tenant_settings_items on public.settings_items;
create policy tenant_settings_items on public.settings_items
  for all to authenticated
  using      (fp_is_admin() or coalesce(societe, 'PXP') = fp_societe())
  with check (fp_is_admin() or coalesce(societe, 'PXP') = fp_societe());

-- Liste fermée des collections acceptées.
create or replace function public.fp_element_collection_ok(p_collection text)
  returns boolean
  language sql
  immutable
as $$
  select p_collection = any (array['assureurs', 'assureurVeh', 'assuranceEcheance', 'assurancePrimes', 'assuranceIgnore']);
$$;

create or replace function public.fp_element_enregistrer(p_societe text, p_collection text, p_cle text, p_valeur jsonb, p_ordre integer)
  returns integer
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  n integer;
begin
  if coalesce(p_societe, '') = '' or coalesce(p_cle, '') = '' then
    raise exception 'Réglages : société et clé obligatoires' using errcode = '22023';
  end if;
  if not public.fp_element_collection_ok(p_collection) then
    raise exception 'Réglages : collection non prise en charge (%)', p_collection using errcode = '22023';
  end if;
  if p_valeur is null then
    raise exception 'Réglages : valeur manquante (% / %)', p_collection, p_cle using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('fp_element:' || p_societe || ':' || p_collection || ':' || p_cle));

  update public.settings_items set valeur = p_valeur, ordre = coalesce(p_ordre, ordre), updated_at = now()
   where societe = p_societe and collection = p_collection and cle = p_cle and deleted_at is null;
  get diagnostics n = row_count;
  if n = 0 then
    insert into public.settings_items (societe, collection, cle, valeur, ordre)
    values (p_societe, p_collection, p_cle, p_valeur, coalesce(p_ordre, 0));
    get diagnostics n = row_count;
  end if;
  return n;
end $$;

create or replace function public.fp_element_archiver(p_societe text, p_collection text, p_cle text)
  returns integer
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  n integer;
begin
  if coalesce(p_societe, '') = '' or coalesce(p_cle, '') = '' then
    raise exception 'Réglages : société et clé obligatoires' using errcode = '22023';
  end if;
  if not public.fp_element_collection_ok(p_collection) then
    raise exception 'Réglages : collection non prise en charge (%)', p_collection using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('fp_element:' || p_societe || ':' || p_collection || ':' || p_cle));
  update public.settings_items set deleted_at = now(), updated_at = now()
   where societe = p_societe and collection = p_collection and cle = p_cle and deleted_at is null;
  get diagnostics n = row_count;
  return n;   -- 0 = déjà archivé ou inconnu (rejeu sans effet)
end $$;

revoke all on function public.fp_element_enregistrer(text, text, text, jsonb, integer) from public, anon;
revoke all on function public.fp_element_archiver(text, text, text) from public, anon;
grant execute on function public.fp_element_enregistrer(text, text, text, jsonb, integer) to authenticated;
grant execute on function public.fp_element_archiver(text, text, text) to authenticated;

commit;

-- Vérification
select 'table : RLS active' as quoi, relrowsecurity::text as valeur from pg_class where oid = 'public.settings_items'::regclass
union all
select 'fonctions : anon / connecté',
       has_function_privilege('anon', 'public.fp_element_enregistrer(text, text, text, jsonb, integer)', 'execute')::text || ' / ' ||
       has_function_privilege('authenticated', 'public.fp_element_enregistrer(text, text, text, jsonb, integer)', 'execute')::text || ' ; ' ||
       has_function_privilege('anon', 'public.fp_element_archiver(text, text, text)', 'execute')::text || ' / ' ||
       has_function_privilege('authenticated', 'public.fp_element_archiver(text, text, text)', 'execute')::text
union all
select 'table : anon peut lire', has_table_privilege('anon', 'public.settings_items', 'select')::text
union all
select 'lignes dans la table', count(*)::text from public.settings_items;

-- ============================================================================
--  RETOUR ARRIÈRE (l'ancienne version de l'application n'utilise ni la table ni les fonctions) :
--    drop function if exists public.fp_element_enregistrer(text, text, text, jsonb, integer);
--    drop function if exists public.fp_element_archiver(text, text, text);
--    drop function if exists public.fp_element_collection_ok(text);
--    drop table if exists public.settings_items;   -- ⚠️ seulement si rien n'a été écrit depuis la mise en ligne
-- ============================================================================
