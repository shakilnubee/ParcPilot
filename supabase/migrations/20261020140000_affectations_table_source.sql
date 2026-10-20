-- ============================================================================
--  DONNÉES — Affectations véhicule ↔ conducteur : table dédiée, SOURCE de vérité
--  (étape 2 de la migration des réglages vers de vraies tables)
-- ============================================================================
--  Avant : l'historique « qui conduit quel véhicule, depuis quand, avec quels km »
--  vivait dans le bloc JSON app_settings.data.affectations = { vehId: [périodes] }.
--  Une mauvaise écriture du bloc pouvait l'effacer en entier.
--
--  Ce fichier crée :
--    • la table vehicle_assignments : 1 période = 1 ligne, ORDRE conservé (l'écran
--      modifie une période par sa position), isolée par société (RLS identique aux
--      autres tables) ; les champs inconnus éventuels sont gardés dans `extra` ;
--    • la fonction fp_affectations_remplacer(société, véhicule, périodes) : remplace
--      en UNE transaction les périodes d'UN véhicule (verrou par véhicule).
--      SECURITY INVOKER → la RLS s'applique ; une date ou un km invalide est REFUSÉ
--      (erreur visible dans l'app, l'écriture reste en file) plutôt que perdu.
--  Les lignes archivées (deleted_at) ne sont jamais touchées.
--  Aucune donnée existante modifiée. Recopie : 20261020140100_affectations_resynchroniser_table.sql.
--  Idempotent. Testé sur le staging avant la production.
-- ============================================================================

begin;

create table if not exists public.vehicle_assignments (
  id               bigint generated always as identity primary key,
  societe          text not null,            -- = app_settings.id (la société)
  veh_id           text not null,            -- id du véhicule (vehicules.id) ; pas de clé étrangère : l'historique survit au véhicule
  ordre            integer not null default 0,  -- position dans la liste du véhicule (l'écran édite par position)
  conducteur       text not null,
  debut            date,
  fin              date,                     -- null = affectation EN COURS
  km_debut         integer,
  km_fin           integer,
  km_debut_manuel  boolean not null default false,
  km_fin_manuel    boolean not null default false,
  debut_manuel     boolean not null default false,
  extra            jsonb not null default '{}'::jsonb,   -- tout autre champ de la période (rien n'est perdu)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz                -- archivage (jamais d'effacement définitif par la recopie)
);
create index if not exists vehicle_assignments_soc_veh_idx on public.vehicle_assignments (societe, veh_id, ordre);

grant select, insert, update, delete on public.vehicle_assignments to authenticated;
revoke all on public.vehicle_assignments from anon;
alter table public.vehicle_assignments enable row level security;

drop policy if exists tenant_vehicle_assignments on public.vehicle_assignments;
create policy tenant_vehicle_assignments on public.vehicle_assignments
  for all to authenticated
  using      (fp_is_admin() or coalesce(societe, 'PXP') = fp_societe())
  with check (fp_is_admin() or coalesce(societe, 'PXP') = fp_societe());

create or replace function public.fp_affectations_remplacer(p_societe text, p_veh_id text, p_periodes jsonb)
  returns integer
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  n integer;
  cles constant text[] := array['conducteur', 'debut', 'fin', 'kmDebut', 'kmFin', 'kmDebutManuel', 'kmFinManuel', 'debutManuel'];
begin
  if coalesce(p_societe, '') = '' or coalesce(p_veh_id, '') = '' then
    raise exception 'Affectations : société et véhicule obligatoires' using errcode = '22023';
  end if;
  if p_periodes is not null and jsonb_typeof(p_periodes) <> 'array' then
    raise exception 'Affectations : liste attendue' using errcode = '22023';
  end if;
  -- Contrôle AVANT tout effacement : une date ou un km illisible fait échouer l'écriture entière.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_periodes, '[]'::jsonb)) a
     where jsonb_typeof(a) = 'object' and nullif(btrim(a ->> 'conducteur'), '') is not null
       and (   (nullif(a ->> 'debut', '') is not null and (a ->> 'debut') !~ '^\d{4}-\d{2}-\d{2}')
            or (nullif(a ->> 'fin', '')   is not null and (a ->> 'fin')   !~ '^\d{4}-\d{2}-\d{2}')
            or (jsonb_typeof(a -> 'kmDebut') not in ('number', 'null') and nullif(a ->> 'kmDebut', '') is not null and (a ->> 'kmDebut') !~ '^\d+(\.\d+)?$')
            or (jsonb_typeof(a -> 'kmFin')   not in ('number', 'null') and nullif(a ->> 'kmFin', '')   is not null and (a ->> 'kmFin')   !~ '^\d+(\.\d+)?$'))
  ) then
    raise exception 'Affectations : date ou km illisible pour le véhicule %', p_veh_id using errcode = '22007';
  end if;

  perform pg_advisory_xact_lock(hashtext('fp_affectations:' || p_societe || ':' || p_veh_id));

  delete from public.vehicle_assignments
   where societe = p_societe and veh_id = p_veh_id and deleted_at is null;

  insert into public.vehicle_assignments
         (societe, veh_id, ordre, conducteur, debut, fin, km_debut, km_fin, km_debut_manuel, km_fin_manuel, debut_manuel, extra)
  select p_societe, p_veh_id, e.ord::int, btrim(e.a ->> 'conducteur'),
         left(nullif(e.a ->> 'debut', ''), 10)::date,
         left(nullif(e.a ->> 'fin', ''), 10)::date,
         round(nullif(e.a ->> 'kmDebut', '')::numeric)::int,
         round(nullif(e.a ->> 'kmFin', '')::numeric)::int,
         coalesce((e.a ->> 'kmDebutManuel')::boolean, false),
         coalesce((e.a ->> 'kmFinManuel')::boolean, false),
         coalesce((e.a ->> 'debutManuel')::boolean, false),
         e.a - cles
    from jsonb_array_elements(coalesce(p_periodes, '[]'::jsonb)) with ordinality as e(a, ord)
   where jsonb_typeof(e.a) = 'object' and nullif(btrim(e.a ->> 'conducteur'), '') is not null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.fp_affectations_remplacer(text, text, jsonb) from public, anon;
grant execute on function public.fp_affectations_remplacer(text, text, jsonb) to authenticated;

commit;

-- Vérification
select 'table' as quoi, relrowsecurity::text as valeur from pg_class where oid = 'public.vehicle_assignments'::regclass
union all
select 'fonction : anon / connecté',
       has_function_privilege('anon', 'public.fp_affectations_remplacer(text, text, jsonb)', 'execute')::text || ' / ' ||
       has_function_privilege('authenticated', 'public.fp_affectations_remplacer(text, text, jsonb)', 'execute')::text
union all
select 'table : anon peut lire', has_table_privilege('anon', 'public.vehicle_assignments', 'select')::text;

-- ============================================================================
--  RETOUR ARRIÈRE (l'ancienne version de l'application n'utilise ni la table ni la fonction) :
--    drop function if exists public.fp_affectations_remplacer(text, text, jsonb);
--    drop table if exists public.vehicle_assignments;   -- ⚠️ seulement si rien n'a été écrit depuis la mise en ligne
-- ============================================================================
