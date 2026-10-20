-- ============================================================================
--  DONNÉES — Congés : recopie UNIQUE des congés des réglages vers la table
--  `driver_absences`, juste avant que la table devienne la source
-- ============================================================================
--  Jusqu'ici l'application LISAIT les congés dans app_settings.data.condConges
--  (la référence) et n'entretenait la table qu'« au mieux ». La table peut donc
--  différer (écritures perdues, doublons). Avant de basculer la lecture sur la
--  table, on la reconstruit à l'identique de la référence, société par société.
--
--  ⚠️ ÉCRIT DANS LA BASE : à appliquer en production uniquement avec accord, après
--  une sauvegarde vérifiée, et JUSTE AVANT / APRÈS la mise en ligne du code qui lit
--  la table (voir JOURNAL.md). Le bloc JSON des réglages n'est PAS modifié.
--
--  Étapes :
--    1) COMPARAISON (lecture seule) : à lancer seule d'abord, pour voir les écarts ;
--    2) RECOPIE (dans une transaction) : pour chaque société ayant des réglages,
--       efface ses lignes de driver_absences puis réinsère les congés des réglages ;
--    3) CONTRÔLE : même comparaison, doit afficher 0 écart partout.
--  La ligne « global » (archive gelée) est ignorée.
-- ============================================================================

-- ── 1) COMPARAISON (lecture seule) ──────────────────────────────────────────
with reglages as (
  select s.id as societe, k.cond_key,
         (c ->> 'debut')::date as debut, (c ->> 'fin')::date as fin, coalesce(c ->> 'motif', '') as motif
    from public.app_settings s
    cross join lateral jsonb_each(case when jsonb_typeof(s.data::jsonb -> 'condConges') = 'object'
                                       then s.data::jsonb -> 'condConges' else '{}'::jsonb end) as k(cond_key, liste)
    cross join lateral jsonb_array_elements(case when jsonb_typeof(k.liste) = 'array' then k.liste else '[]'::jsonb end) c
   where s.id <> 'global' and nullif(c ->> 'debut', '') is not null and nullif(c ->> 'fin', '') is not null
),
tableau as (
  select societe, cond_key, debut, fin, coalesce(motif, '') as motif
    from public.driver_absences where deleted_at is null and societe <> 'global'
)
select coalesce(r.societe, t.societe) as societe,
       count(*) filter (where r.societe is not null) as dans_reglages,
       count(*) filter (where t.societe is not null) as dans_table,
       count(*) filter (where r.societe is null)     as seulement_table,
       count(*) filter (where t.societe is null)     as seulement_reglages
  from (select *, row_number() over (partition by societe, cond_key, debut, fin, motif) as n from reglages) r
  full join (select *, row_number() over (partition by societe, cond_key, debut, fin, motif) as n from tableau) t
    using (societe, cond_key, debut, fin, motif, n)
 group by 1
 order by 1;

-- ── 2) RECOPIE (écrit dans la base) ────────────────────────────────────────
begin;

delete from public.driver_absences d
 using public.app_settings s
 where d.societe = s.id and s.id <> 'global';

insert into public.driver_absences (societe, cond_key, debut, fin, motif)
select s.id, k.cond_key, (c ->> 'debut')::date, (c ->> 'fin')::date, coalesce(c ->> 'motif', '')
  from public.app_settings s
  cross join lateral jsonb_each(case when jsonb_typeof(s.data::jsonb -> 'condConges') = 'object'
                                     then s.data::jsonb -> 'condConges' else '{}'::jsonb end) as k(cond_key, liste)
  cross join lateral jsonb_array_elements(case when jsonb_typeof(k.liste) = 'array' then k.liste else '[]'::jsonb end) c
 where s.id <> 'global' and nullif(c ->> 'debut', '') is not null and nullif(c ->> 'fin', '') is not null;

commit;

-- ── 3) CONTRÔLE : relancer la requête de l'étape 1 → « seulement_table » et
--       « seulement_reglages » doivent valoir 0 pour chaque société.

-- ============================================================================
--  RETOUR ARRIÈRE : inutile côté données (les réglages, intacts, restent la copie de
--  référence) ; en cas de besoin, relancer l'étape 2 recopie à nouveau les réglages.
-- ============================================================================
