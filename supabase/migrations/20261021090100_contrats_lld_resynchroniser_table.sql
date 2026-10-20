-- ============================================================================
--  DONNÉES — Contrats LLD : recopie UNIQUE des réglages vers la table
--  `lease_contracts`, juste avant que la table devienne la source
-- ============================================================================
--  ⚠️ ÉCRIT DANS LA BASE : en production, uniquement avec accord, après une
--  sauvegarde vérifiée, juste avant la mise en ligne du code qui lit la table.
--  Le bloc JSON des réglages n'est PAS modifié.
--    1) COMPARAISON (lecture seule)  2) RECOPIE (transaction)  3) CONTRÔLE (= 1, 0 écart attendu)
--  Aucun effacement : un contrat présent SEULEMENT dans la table est ARCHIVÉ (deleted_at).
--  Les contrats sans identifiant sont ignorés (l'app leur en donne un à l'ouverture de la page
--  Contrats ; aucun en production au 20/10/2026). La ligne « global » (archive gelée) est ignorée.
--  Idempotent.
-- ============================================================================

-- ── 1) COMPARAISON (lecture seule) ──────────────────────────────────────────
with reglages as (
  select s.id as societe, e.c ->> 'id' as contrat_id, (e.ord - 1)::int as ordre, e.c as contrat
    from public.app_settings s
    cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data::jsonb -> 'localeaseContrats') = 'array'
                                                 then s.data::jsonb -> 'localeaseContrats' else '[]'::jsonb end) with ordinality as e(c, ord)
   where s.id <> 'global' and jsonb_typeof(e.c) = 'object' and coalesce(e.c ->> 'id', '') <> ''
),
tableau as (
  select societe, contrat_id, ordre, contrat from public.lease_contracts where deleted_at is null and societe <> 'global'
)
select coalesce(r.societe, t.societe) as societe,
       count(*) filter (where r.societe is not null) as dans_reglages,
       count(*) filter (where t.societe is not null) as dans_table,
       count(*) filter (where r.societe is null)     as seulement_table,
       count(*) filter (where t.societe is null)     as seulement_reglages
  from reglages r
  full join tableau t
    on t.societe = r.societe and t.contrat_id = r.contrat_id and t.ordre = r.ordre and t.contrat = r.contrat
 group by 1 order by 1;

-- ── 2) RECOPIE (écrit dans la base) ────────────────────────────────────────
begin;

create temporary table _lld_reglages on commit drop as
  select distinct on (s.id, e.c ->> 'id') s.id as societe, e.c ->> 'id' as contrat_id, (e.ord - 1)::int as ordre, e.c as contrat
    from public.app_settings s
    cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data::jsonb -> 'localeaseContrats') = 'array'
                                                 then s.data::jsonb -> 'localeaseContrats' else '[]'::jsonb end) with ordinality as e(c, ord)
   where s.id <> 'global' and jsonb_typeof(e.c) = 'object' and coalesce(e.c ->> 'id', '') <> ''
   order by s.id, e.c ->> 'id', e.ord desc;   -- identifiant en double : la DERNIÈRE occurrence l'emporte (comme l'écran)

-- a) Archiver ce qui n'existe que dans la table (aucun effacement définitif).
update public.lease_contracts d set deleted_at = now(), updated_at = now()
 where d.deleted_at is null
   and d.societe in (select id from public.app_settings where id <> 'global')
   and not exists (select 1 from _lld_reglages r where r.societe = d.societe and r.contrat_id = d.contrat_id);

-- b) Mettre à jour les contrats déjà présents.
update public.lease_contracts d set contrat = r.contrat, ordre = r.ordre, updated_at = now()
  from _lld_reglages r
 where d.deleted_at is null and d.societe = r.societe and d.contrat_id = r.contrat_id
   and (d.contrat is distinct from r.contrat or d.ordre is distinct from r.ordre);

-- c) Ajouter les autres.
insert into public.lease_contracts (societe, contrat_id, ordre, contrat)
select r.societe, r.contrat_id, r.ordre, r.contrat
  from _lld_reglages r
 where not exists (select 1 from public.lease_contracts d
                    where d.deleted_at is null and d.societe = r.societe and d.contrat_id = r.contrat_id);

commit;

-- ── 3) CONTRÔLE : relancer la requête de l'étape 1 → seulement_table = seulement_reglages = 0.
--       Archives (requête à part) :
--       select societe, count(*) from public.lease_contracts where deleted_at is not null group by 1;

-- ============================================================================
--  RETOUR ARRIÈRE : inutile côté données (les réglages restent intacts et complets).
-- ============================================================================
