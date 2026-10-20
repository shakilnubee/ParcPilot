-- ============================================================================
--  DONNÉES — Forfaits de leasing : recopie UNIQUE des réglages vers la table
--  `lease_overrides`, juste avant que la table devienne la source
-- ============================================================================
--  ⚠️ ÉCRIT DANS LA BASE : en production, uniquement avec accord, après une
--  sauvegarde vérifiée, juste avant la mise en ligne du code qui lit la table.
--  Le bloc JSON des réglages n'est PAS modifié.
--    1) COMPARAISON (lecture seule)  2) RECOPIE (transaction)  3) CONTRÔLE (= 1, 0 écart attendu)
--  Aucun effacement : un forfait présent SEULEMENT dans la table est ARCHIVÉ (deleted_at).
--  Pas de table temporaire (l'éditeur Supabase la signalait à tort comme « sans RLS »).
--  La ligne « global » (archive gelée) est ignorée. Idempotent.
--  ⚠️ L'éditeur SQL affiche le résultat de la PREMIÈRE requête (comparaison d'AVANT) : pour le
--     contrôle, relancer la requête 1 seule.
-- ============================================================================

-- ── 1) COMPARAISON (lecture seule) ──────────────────────────────────────────
with reglages as (
  select s.id as societe, f.key as cle, f.value as forfait
    from public.app_settings s
    cross join lateral jsonb_each(case when jsonb_typeof(s.data::jsonb -> 'leasingContrats') = 'object'
                                       then s.data::jsonb -> 'leasingContrats' else '{}'::jsonb end) f
   where s.id <> 'global' and jsonb_typeof(f.value) = 'object' and btrim(f.key) <> ''
),
tableau as (
  select societe, cle, forfait from public.lease_overrides where deleted_at is null and societe <> 'global'
)
select coalesce(r.societe, t.societe) as societe,
       count(*) filter (where r.societe is not null) as dans_reglages,
       count(*) filter (where t.societe is not null) as dans_table,
       count(*) filter (where r.societe is null)     as seulement_table,
       count(*) filter (where t.societe is null)     as seulement_reglages
  from reglages r
  full join tableau t on t.societe = r.societe and t.cle = r.cle and t.forfait = r.forfait
 group by 1 order by 1;

-- ── 2) RECOPIE (écrit dans la base) ────────────────────────────────────────
begin;

-- a) Archiver ce qui n'existe que dans la table (aucun effacement définitif).
update public.lease_overrides d set deleted_at = now(), updated_at = now()
 where d.deleted_at is null
   and d.societe in (select id from public.app_settings where id <> 'global')
   and not exists (
     select 1 from public.app_settings s
      cross join lateral jsonb_each(case when jsonb_typeof(s.data::jsonb -> 'leasingContrats') = 'object'
                                         then s.data::jsonb -> 'leasingContrats' else '{}'::jsonb end) f
      where s.id = d.societe and f.key = d.cle and jsonb_typeof(f.value) = 'object');

-- b) Mettre à jour les forfaits déjà présents.
update public.lease_overrides d set forfait = f.value, updated_at = now()
  from public.app_settings s
  cross join lateral jsonb_each(case when jsonb_typeof(s.data::jsonb -> 'leasingContrats') = 'object'
                                     then s.data::jsonb -> 'leasingContrats' else '{}'::jsonb end) f
 where s.id <> 'global' and d.deleted_at is null and d.societe = s.id and d.cle = f.key
   and jsonb_typeof(f.value) = 'object' and d.forfait is distinct from f.value;

-- c) Ajouter les autres.
insert into public.lease_overrides (societe, cle, forfait)
select s.id, f.key, f.value
  from public.app_settings s
  cross join lateral jsonb_each(case when jsonb_typeof(s.data::jsonb -> 'leasingContrats') = 'object'
                                     then s.data::jsonb -> 'leasingContrats' else '{}'::jsonb end) f
 where s.id <> 'global' and jsonb_typeof(f.value) = 'object' and btrim(f.key) <> ''
   and not exists (select 1 from public.lease_overrides d
                    where d.deleted_at is null and d.societe = s.id and d.cle = f.key);

commit;

-- ── 3) CONTRÔLE : relancer la requête de l'étape 1 SEULE → seulement_table = seulement_reglages = 0.
--       Archives (requête à part) :
--       select societe, count(*) from public.lease_overrides where deleted_at is not null group by 1;

-- ============================================================================
--  RETOUR ARRIÈRE : inutile côté données (les réglages restent intacts et complets).
-- ============================================================================
