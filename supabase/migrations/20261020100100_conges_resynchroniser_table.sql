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
--    2) RECOPIE (dans une transaction), pour chaque société ayant des réglages :
--       a) ARCHIVE (deleted_at = maintenant) les congés présents SEULEMENT dans la
--          table : rien n'est effacé, ils restent récupérables (jamais affichés) ;
--       b) efface ses autres lignes, puis réinsère les congés des réglages ;
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

-- a) Archiver ce qui n'existe que dans la table (ex. congé supprimé dans l'app dont l'effacement
--    n'avait pas atteint la table… ou congé perdu des réglages : on ne tranche pas, on garde).
with reglages as (
  select s.id as societe, k.cond_key,
         (c ->> 'debut')::date as debut, (c ->> 'fin')::date as fin, coalesce(c ->> 'motif', '') as motif
    from public.app_settings s
    cross join lateral jsonb_each(case when jsonb_typeof(s.data::jsonb -> 'condConges') = 'object'
                                       then s.data::jsonb -> 'condConges' else '{}'::jsonb end) as k(cond_key, liste)
    cross join lateral jsonb_array_elements(case when jsonb_typeof(k.liste) = 'array' then k.liste else '[]'::jsonb end) c
   where s.id <> 'global' and nullif(c ->> 'debut', '') is not null and nullif(c ->> 'fin', '') is not null
)
update public.driver_absences d set deleted_at = now(), updated_at = now()
 where d.deleted_at is null
   and d.societe in (select id from public.app_settings where id <> 'global')
   and not exists (select 1 from reglages r
                    where r.societe = d.societe and r.cond_key = d.cond_key and r.debut = d.debut
                      and r.fin = d.fin and r.motif = coalesce(d.motif, ''));

-- b) Repartir des réglages pour tout le reste.
delete from public.driver_absences d
 using public.app_settings s
 where d.societe = s.id and s.id <> 'global' and d.deleted_at is null;

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
--       Congés archivés (récupérables) :
--         select societe, cond_key, debut, fin, motif, deleted_at from public.driver_absences
--          where deleted_at is not null order by deleted_at desc;
--       Pour en RÉTABLIR un : passer par l'application (le ressaisir) — la table et les réglages
--       restent ainsi d'accord.

-- ============================================================================
--  RETOUR ARRIÈRE : inutile côté données (les réglages, intacts, restent la copie de
--  référence ; les congés présents seulement dans la table sont archivés, pas effacés).
--  En cas de besoin, relancer l'étape 2 recopie à nouveau les réglages.
-- ============================================================================
