-- =====================================================================================
-- 20261105140000_conso_dedoublonnage.sql
-- Lot 3 de l'audit dépenses — DÉDOUBLONNAGE des lignes de consommation déjà en base.
--
-- POURQUOI : deux chemins d'alimentation ont pu créer des lignes EN DOUBLE pour une même
-- opération réelle :
--   • total_conso_tx : l'id est « <facnum>-<seq> ». Un même relevé lu par deux chemins
--     (CSV vs reconstruction PDF) peut numéroter la séquence différemment → la MÊME
--     transaction se retrouve sous deux id distincts.
--   • ulys_conso : l'id est « ULYSC-<mois>-<slug conducteur> ». Quand le nom d'affichage
--     change (ex. après avoir relié un badge, « charles » → « charles-lennon »), le total
--     du MÊME mois existe sous deux id.
-- Côté AFFICHAGE, c'est déjà neutralisé en lecture par FP.dedupeConsoTx (les totaux sont
-- justes). Cette migration NETTOIE physiquement les lignes en double. La clé de
-- dédoublonnage est IDENTIQUE à celle de FP.dedupeConsoTx.
--
-- SÛRETÉ :
--   • CONSERVATRICE — ne supprime QUE des doublons STRICTS (toutes les colonnes de la clé
--     identiques), en gardant 1 ligne par groupe (le plus petit id, déterministe). Les
--     lignes SANS carte/badge ne sont JAMAIS fusionnées (comme FP.dedupeConsoTx).
--   • ROBUSTE AU SCHÉMA — chaque table est traitée dans un bloc DO gardé : si la table ou
--     une colonne de la clé n'existe pas (ex. staging avec un schéma plus ancien sans
--     « badge »), ce bloc est IGNORÉ proprement (RAISE NOTICE) au lieu de faire échouer la
--     migration. Elle passe donc sur staging comme en prod, quel que soit leur schéma.
--   • IDEMPOTENTE — rejouable : une fois la base propre, elle ne supprime plus rien.
--   • Testée d'abord sur le STAGING (migration-staging.yml) + localement sur PostgreSQL 16.
--   • ⚠️ DESTRUCTIVE (DELETE) : l'application en PRODUCTION se fait UNIQUEMENT avec accord
--     explicite ET APRÈS une sauvegarde vérifiée (pas de rollback automatique d'un DELETE —
--     voir note en bas). À consigner ensuite dans supabase/migrations/JOURNAL.md.
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- Helper local : la colonne existe-t-elle ? (pour garder la migration robuste au schéma)
-- ------------------------------------------------------------------------------------
create or replace function pg_temp._col_ok(p_table text, p_col text) returns boolean
language sql stable as $$
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = p_col
  );
$$;

-- ------------------------------------------------------------------------------------
-- 1) total_conso_tx — garde 1 ligne par (société, date, carte, montant, produit, facture),
--    retire les autres. Même clé que FP.dedupeConsoTx (plaque EXCLUE ; sans carte = jamais fusionné).
-- ------------------------------------------------------------------------------------
do $$
declare v_avant bigint; v_apres bigint; v_suppr bigint;
begin
  if to_regclass('public.total_conso_tx') is null
     or not pg_temp._col_ok('total_conso_tx','carte')
     or not pg_temp._col_ok('total_conso_tx','date_tx')
     or not pg_temp._col_ok('total_conso_tx','montant_ttc')
     or not pg_temp._col_ok('total_conso_tx','facnum') then
    raise notice 'total_conso_tx : table/colonnes absentes → ignoré.';
  else
    select count(*) into v_avant from public.total_conso_tx;
    with d as (
      select id, row_number() over (
        partition by coalesce(societe,'PXP'), date_tx, carte, montant_ttc,
                     coalesce(lower(btrim(produit)),''), coalesce(facnum,'')
        order by id
      ) as rn
      from public.total_conso_tx
      where carte is not null and btrim(carte) <> ''
    )
    delete from public.total_conso_tx t using d where t.id = d.id and d.rn > 1;
    get diagnostics v_suppr = row_count;
    select count(*) into v_apres from public.total_conso_tx;
    raise notice 'total_conso_tx : % doublon(s) retiré(s) (% -> %).', v_suppr, v_avant, v_apres;
  end if;
end $$;

-- ------------------------------------------------------------------------------------
-- 2) ulys_conso — garde 1 ligne par (société, mois, badge, n° de facture), retire les
--    autres (même personne/mois sous deux slugs = même agrégat → aucune donnée perdue).
--    Ne dédoublonne QUE les lignes avec un badge renseigné (cas « badge vide » laissé
--    volontairement pour revue manuelle — jamais de suppression incertaine).
-- ------------------------------------------------------------------------------------
do $$
declare v_avant bigint; v_apres bigint; v_suppr bigint;
begin
  if to_regclass('public.ulys_conso') is null
     or not pg_temp._col_ok('ulys_conso','badge')
     or not pg_temp._col_ok('ulys_conso','mois')
     or not pg_temp._col_ok('ulys_conso','numero_facture') then
    raise notice 'ulys_conso : table/colonnes absentes (ex. staging sans « badge ») → ignoré.';
  else
    select count(*) into v_avant from public.ulys_conso;
    with d as (
      select id, row_number() over (
        partition by coalesce(societe,'PXP'), mois, badge, coalesce(numero_facture,'')
        order by id
      ) as rn
      from public.ulys_conso
      where badge is not null and btrim(badge) <> ''
    )
    delete from public.ulys_conso u using d where u.id = d.id and d.rn > 1;
    get diagnostics v_suppr = row_count;
    select count(*) into v_apres from public.ulys_conso;
    raise notice 'ulys_conso : % doublon(s) retiré(s) (% -> %).', v_suppr, v_avant, v_apres;
  end if;
end $$;

-- ------------------------------------------------------------------------------------
-- RETOUR ARRIÈRE (rollback) :
--   ⚠️ Un DELETE n'a PAS de rollback automatique (les lignes supprimées ne se recréent pas
--   par SQL). Le filet de sécurité est la SAUVEGARDE vérifiée faite AVANT l'application en
--   production (restauration de la table depuis la sauvegarde si besoin). De toute façon,
--   le détail daté se RECONSTRUIT tout seul depuis les PDF/relevés (total_conso_tx via la
--   reconstruction automatique à l'ouverture de Contrôle ; ulys_conso via l'import), donc
--   une suppression de doublons est récupérable par réimport. Aucune donnée UNIQUE n'est
--   retirée : seules des COPIES strictes le sont.
-- ------------------------------------------------------------------------------------
