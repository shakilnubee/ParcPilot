-- ============================================================================
--  DONNÉES — Affectations : recopie UNIQUE des réglages vers la table
--  `vehicle_assignments`, juste avant que la table devienne la source
-- ============================================================================
--  ⚠️ ÉCRIT DANS LA BASE : en production, uniquement avec accord, après une
--  sauvegarde vérifiée, juste avant la mise en ligne du code qui lit la table.
--  Le bloc JSON des réglages n'est PAS modifié.
--    1) COMPARAISON (lecture seule)  2) RECOPIE (transaction)  3) CONTRÔLE (= 1, 0 écart attendu)
--  Les périodes présentes SEULEMENT dans la table sont ARCHIVÉES (deleted_at), jamais effacées.
--  La ligne « global » (archive gelée) est ignorée. Idempotent.
-- ============================================================================

-- ── 1) COMPARAISON (lecture seule) ──────────────────────────────────────────
with reglages as (
  select s.id as societe, v.key as veh_id, e.ord::int as ordre, btrim(e.a ->> 'conducteur') as conducteur,
         left(nullif(e.a ->> 'debut', ''), 10)::date as debut, left(nullif(e.a ->> 'fin', ''), 10)::date as fin,
         round(nullif(e.a ->> 'kmDebut', '')::numeric)::int as km_debut, round(nullif(e.a ->> 'kmFin', '')::numeric)::int as km_fin,
         coalesce((e.a ->> 'kmDebutManuel')::boolean, false) as km_debut_manuel,
         coalesce((e.a ->> 'kmFinManuel')::boolean, false) as km_fin_manuel,
         coalesce((e.a ->> 'debutManuel')::boolean, false) as debut_manuel
    from public.app_settings s
    cross join lateral jsonb_each(case when jsonb_typeof(s.data::jsonb -> 'affectations') = 'object'
                                       then s.data::jsonb -> 'affectations' else '{}'::jsonb end) v
    cross join lateral jsonb_array_elements(case when jsonb_typeof(v.value) = 'array' then v.value else '[]'::jsonb end) with ordinality as e(a, ord)
   where s.id <> 'global' and jsonb_typeof(e.a) = 'object' and nullif(btrim(e.a ->> 'conducteur'), '') is not null
),
tableau as (
  select societe, veh_id, ordre, conducteur, debut, fin, km_debut, km_fin, km_debut_manuel, km_fin_manuel, debut_manuel
    from public.vehicle_assignments where deleted_at is null and societe <> 'global'
),
ecarts as (
  select coalesce(r.societe, t.societe) as societe,
         count(*) filter (where r.societe is not null) as dans_reglages,
         count(*) filter (where t.societe is not null) as dans_table,
         count(*) filter (where r.societe is null)     as seulement_table,
         count(*) filter (where t.societe is null)     as seulement_reglages
    from reglages r
    full join tableau t
      on  t.societe = r.societe and t.veh_id = r.veh_id and t.ordre = r.ordre and t.conducteur = r.conducteur
      and t.debut is not distinct from r.debut and t.fin is not distinct from r.fin
      and t.km_debut is not distinct from r.km_debut and t.km_fin is not distinct from r.km_fin
      and t.km_debut_manuel = r.km_debut_manuel and t.km_fin_manuel = r.km_fin_manuel and t.debut_manuel = r.debut_manuel
   group by 1
)
select e.*,
       (select count(*) from public.vehicle_assignments a where a.deleted_at is not null and a.societe = e.societe) as archives
  from ecarts e order by 1;

-- ── 2) RECOPIE (écrit dans la base) ────────────────────────────────────────
begin;

-- a) Archiver ce qui n'existe que dans la table (aucun effacement définitif).
with reglages as (
  select s.id as societe, v.key as veh_id, e.ord::int as ordre, btrim(e.a ->> 'conducteur') as conducteur,
         left(nullif(e.a ->> 'debut', ''), 10)::date as debut, left(nullif(e.a ->> 'fin', ''), 10)::date as fin
    from public.app_settings s
    cross join lateral jsonb_each(case when jsonb_typeof(s.data::jsonb -> 'affectations') = 'object'
                                       then s.data::jsonb -> 'affectations' else '{}'::jsonb end) v
    cross join lateral jsonb_array_elements(case when jsonb_typeof(v.value) = 'array' then v.value else '[]'::jsonb end) with ordinality as e(a, ord)
   where s.id <> 'global' and jsonb_typeof(e.a) = 'object' and nullif(btrim(e.a ->> 'conducteur'), '') is not null
)
update public.vehicle_assignments d set deleted_at = now(), updated_at = now()
 where d.deleted_at is null
   and d.societe in (select id from public.app_settings where id <> 'global')
   and not exists (select 1 from reglages r
                    where r.societe = d.societe and r.veh_id = d.veh_id and r.conducteur = d.conducteur
                      and r.debut is not distinct from d.debut and r.fin is not distinct from d.fin);

-- b) Repartir des réglages pour tout le reste.
delete from public.vehicle_assignments d
 using public.app_settings s
 where d.societe = s.id and s.id <> 'global' and d.deleted_at is null;

insert into public.vehicle_assignments
       (societe, veh_id, ordre, conducteur, debut, fin, km_debut, km_fin, km_debut_manuel, km_fin_manuel, debut_manuel, extra)
select s.id, v.key, e.ord::int, btrim(e.a ->> 'conducteur'),
       left(nullif(e.a ->> 'debut', ''), 10)::date, left(nullif(e.a ->> 'fin', ''), 10)::date,
       round(nullif(e.a ->> 'kmDebut', '')::numeric)::int, round(nullif(e.a ->> 'kmFin', '')::numeric)::int,
       coalesce((e.a ->> 'kmDebutManuel')::boolean, false),
       coalesce((e.a ->> 'kmFinManuel')::boolean, false),
       coalesce((e.a ->> 'debutManuel')::boolean, false),
       e.a - array['conducteur', 'debut', 'fin', 'kmDebut', 'kmFin', 'kmDebutManuel', 'kmFinManuel', 'debutManuel']
  from public.app_settings s
  cross join lateral jsonb_each(case when jsonb_typeof(s.data::jsonb -> 'affectations') = 'object'
                                     then s.data::jsonb -> 'affectations' else '{}'::jsonb end) v
  cross join lateral jsonb_array_elements(case when jsonb_typeof(v.value) = 'array' then v.value else '[]'::jsonb end) with ordinality as e(a, ord)
 where s.id <> 'global' and jsonb_typeof(e.a) = 'object' and nullif(btrim(e.a ->> 'conducteur'), '') is not null;

commit;

-- ── 3) CONTRÔLE : relancer la requête de l'étape 1 → seulement_table = seulement_reglages = 0.
--       (Compter les archives dans une requête à part, jamais dans le SELECT groupé : erreur 42803.)

-- ============================================================================
--  RETOUR ARRIÈRE : inutile côté données (les réglages restent intacts et complets).
-- ============================================================================
