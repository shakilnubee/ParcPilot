-- ============================================================================
--  DONNÉES — Sinistres : recopie UNIQUE des réglages vers la table `settings_items`,
--  juste avant que la table devienne la source
-- ============================================================================
--  ⚠️ ÉCRIT DANS LA BASE : en production, uniquement avec accord, après une
--  sauvegarde vérifiée, juste avant la mise en ligne du code qui lit la table.
--  Le bloc JSON des réglages n'est PAS modifié.
--    1) COMPARAISON (lecture seule)  2) RECOPIE (transaction)  3) CONTRÔLE (= 1, 0 écart attendu)
--  Collections : sinistreStatut, sinistreStage, sinistreGroupes, sinistreAssurance, sinistreSous,
--  sinistreDocSub, sinistreDossiers, sinistreDossiersSupprimes.
--  Aucun effacement : un élément présent SEULEMENT dans la table est ARCHIVÉ (deleted_at).
--  Listes de plaques : doublons ignorés, ordre d'affichage conservé.
--  Pas de table temporaire. La ligne « global » (archive gelée) est ignorée. Idempotent.
--  ⚠️ L'éditeur SQL affiche le résultat de la PREMIÈRE requête (comparaison d'AVANT) : pour le
--     contrôle, relancer la requête 1 seule.
-- ============================================================================

-- ── 1) COMPARAISON (lecture seule) ──────────────────────────────────────────
with src as (
  select s.id as societe, s.data::jsonb as d from public.app_settings s where s.id <> 'global'
),
reglages as (
  -- tables « clé → valeur »
  (select src.societe, c.coll as collection, e.key as cle, e.value as valeur, 0 as ordre
     from src cross join (values ('sinistreStatut'), ('sinistreStage'), ('sinistreGroupes'), ('sinistreAssurance'),
                                 ('sinistreSous'), ('sinistreDocSub')) c(coll)
     cross join lateral jsonb_each(case when jsonb_typeof(src.d -> c.coll) = 'object' then src.d -> c.coll else '{}'::jsonb end) e
    where e.key <> '' and jsonb_typeof(e.value) <> 'null')
  union all
  -- listes de plaques : sans doublon, ORDRE conservé (position parmi les plaques distinctes, 1re occurrence)
  (select x.societe, x.coll, x.cle, 'true'::jsonb, (row_number() over (partition by x.societe, x.coll order by x.premier) - 1)::int
     from (select src.societe, c.coll, i.v #>> '{}' as cle, min(i.ord) as premier
             from src cross join (values ('sinistreDossiers'), ('sinistreDossiersSupprimes')) c(coll)
             cross join lateral jsonb_array_elements(case when jsonb_typeof(src.d -> c.coll) = 'array' then src.d -> c.coll else '[]'::jsonb end) with ordinality i(v, ord)
            where jsonb_typeof(i.v) in ('string', 'number') and coalesce(i.v #>> '{}', '') <> ''
            group by 1, 2, 3) x)
),
tableau as (
  select societe, collection, cle, valeur, ordre from public.settings_items
   where deleted_at is null and societe <> 'global' and collection in ('sinistreStatut', 'sinistreStage', 'sinistreGroupes', 'sinistreAssurance', 'sinistreSous', 'sinistreDocSub', 'sinistreDossiers', 'sinistreDossiersSupprimes')
)
select coalesce(r.societe, t.societe) as societe, coalesce(r.collection, t.collection) as collection,
       count(*) filter (where r.societe is not null) as dans_reglages,
       count(*) filter (where t.societe is not null) as dans_table,
       count(*) filter (where r.societe is null)     as seulement_table,
       count(*) filter (where t.societe is null)     as seulement_reglages
  from reglages r
  full join tableau t
    on t.societe = r.societe and t.collection = r.collection and t.cle = r.cle and t.valeur = r.valeur and t.ordre = r.ordre
 group by 1, 2 order by 1, 2;

-- ── 2) RECOPIE (écrit dans la base) ────────────────────────────────────────
begin;

-- a) Archiver ce qui n'existe que dans la table (aucun effacement définitif).
with src as (
  select s.id as societe, s.data::jsonb as d from public.app_settings s where s.id <> 'global'
),
reglages as (
  -- tables « clé → valeur »
  (select src.societe, c.coll as collection, e.key as cle, e.value as valeur, 0 as ordre
     from src cross join (values ('sinistreStatut'), ('sinistreStage'), ('sinistreGroupes'), ('sinistreAssurance'),
                                 ('sinistreSous'), ('sinistreDocSub')) c(coll)
     cross join lateral jsonb_each(case when jsonb_typeof(src.d -> c.coll) = 'object' then src.d -> c.coll else '{}'::jsonb end) e
    where e.key <> '' and jsonb_typeof(e.value) <> 'null')
  union all
  -- listes de plaques : sans doublon, ORDRE conservé (position parmi les plaques distinctes, 1re occurrence)
  (select x.societe, x.coll, x.cle, 'true'::jsonb, (row_number() over (partition by x.societe, x.coll order by x.premier) - 1)::int
     from (select src.societe, c.coll, i.v #>> '{}' as cle, min(i.ord) as premier
             from src cross join (values ('sinistreDossiers'), ('sinistreDossiersSupprimes')) c(coll)
             cross join lateral jsonb_array_elements(case when jsonb_typeof(src.d -> c.coll) = 'array' then src.d -> c.coll else '[]'::jsonb end) with ordinality i(v, ord)
            where jsonb_typeof(i.v) in ('string', 'number') and coalesce(i.v #>> '{}', '') <> ''
            group by 1, 2, 3) x)
)
update public.settings_items d set deleted_at = now(), updated_at = now()
 where d.deleted_at is null and d.collection in ('sinistreStatut', 'sinistreStage', 'sinistreGroupes', 'sinistreAssurance', 'sinistreSous', 'sinistreDocSub', 'sinistreDossiers', 'sinistreDossiersSupprimes')
   and d.societe in (select id from public.app_settings where id <> 'global')
   and not exists (select 1 from reglages r where r.societe = d.societe and r.collection = d.collection and r.cle = d.cle);

-- b) Mettre à jour les éléments déjà présents.
with src as (
  select s.id as societe, s.data::jsonb as d from public.app_settings s where s.id <> 'global'
),
reglages as (
  -- tables « clé → valeur »
  (select src.societe, c.coll as collection, e.key as cle, e.value as valeur, 0 as ordre
     from src cross join (values ('sinistreStatut'), ('sinistreStage'), ('sinistreGroupes'), ('sinistreAssurance'),
                                 ('sinistreSous'), ('sinistreDocSub')) c(coll)
     cross join lateral jsonb_each(case when jsonb_typeof(src.d -> c.coll) = 'object' then src.d -> c.coll else '{}'::jsonb end) e
    where e.key <> '' and jsonb_typeof(e.value) <> 'null')
  union all
  -- listes de plaques : sans doublon, ORDRE conservé (position parmi les plaques distinctes, 1re occurrence)
  (select x.societe, x.coll, x.cle, 'true'::jsonb, (row_number() over (partition by x.societe, x.coll order by x.premier) - 1)::int
     from (select src.societe, c.coll, i.v #>> '{}' as cle, min(i.ord) as premier
             from src cross join (values ('sinistreDossiers'), ('sinistreDossiersSupprimes')) c(coll)
             cross join lateral jsonb_array_elements(case when jsonb_typeof(src.d -> c.coll) = 'array' then src.d -> c.coll else '[]'::jsonb end) with ordinality i(v, ord)
            where jsonb_typeof(i.v) in ('string', 'number') and coalesce(i.v #>> '{}', '') <> ''
            group by 1, 2, 3) x)
)
update public.settings_items d set valeur = r.valeur, ordre = r.ordre, updated_at = now()
  from reglages r
 where d.deleted_at is null and d.societe = r.societe and d.collection = r.collection and d.cle = r.cle
   and (d.valeur is distinct from r.valeur or d.ordre is distinct from r.ordre);

-- c) Ajouter les autres.
with src as (
  select s.id as societe, s.data::jsonb as d from public.app_settings s where s.id <> 'global'
),
reglages as (
  -- tables « clé → valeur »
  (select src.societe, c.coll as collection, e.key as cle, e.value as valeur, 0 as ordre
     from src cross join (values ('sinistreStatut'), ('sinistreStage'), ('sinistreGroupes'), ('sinistreAssurance'),
                                 ('sinistreSous'), ('sinistreDocSub')) c(coll)
     cross join lateral jsonb_each(case when jsonb_typeof(src.d -> c.coll) = 'object' then src.d -> c.coll else '{}'::jsonb end) e
    where e.key <> '' and jsonb_typeof(e.value) <> 'null')
  union all
  -- listes de plaques : sans doublon, ORDRE conservé (position parmi les plaques distinctes, 1re occurrence)
  (select x.societe, x.coll, x.cle, 'true'::jsonb, (row_number() over (partition by x.societe, x.coll order by x.premier) - 1)::int
     from (select src.societe, c.coll, i.v #>> '{}' as cle, min(i.ord) as premier
             from src cross join (values ('sinistreDossiers'), ('sinistreDossiersSupprimes')) c(coll)
             cross join lateral jsonb_array_elements(case when jsonb_typeof(src.d -> c.coll) = 'array' then src.d -> c.coll else '[]'::jsonb end) with ordinality i(v, ord)
            where jsonb_typeof(i.v) in ('string', 'number') and coalesce(i.v #>> '{}', '') <> ''
            group by 1, 2, 3) x)
)
insert into public.settings_items (societe, collection, cle, valeur, ordre)
select r.societe, r.collection, r.cle, r.valeur, r.ordre
  from reglages r
 where not exists (select 1 from public.settings_items d
                    where d.deleted_at is null and d.societe = r.societe and d.collection = r.collection and d.cle = r.cle);

commit;

-- ── 3) CONTRÔLE : relancer la requête de l'étape 1 SEULE → seulement_table = seulement_reglages = 0.
--       Archives (requête à part) :
--       select societe, collection, count(*) from public.settings_items where deleted_at is not null group by 1, 2;

-- ============================================================================
--  RETOUR ARRIÈRE : inutile côté données (les réglages restent intacts et complets).
-- ============================================================================
