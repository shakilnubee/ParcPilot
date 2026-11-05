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
--     change (ex. après avoir relié un badge, « charles » → « charles-lennon »), le slug
--     change → le total du MÊME mois existe sous deux id.
-- Côté AFFICHAGE, c'est déjà neutralisé en lecture par FP.dedupeConsoTx (les totaux sont
-- justes). Cette migration NETTOIE physiquement les lignes en double pour garder la base
-- propre. La clé de dédoublonnage est IDENTIQUE à celle de FP.dedupeConsoTx.
--
-- SÛRETÉ :
--   • CONSERVATRICE — ne supprime QUE des doublons STRICTS (toutes les colonnes de la clé
--     identiques), en gardant 1 ligne par groupe (le plus petit id, déterministe). Les
--     lignes SANS carte/badge ne sont JAMAIS fusionnées (comme FP.dedupeConsoTx).
--   • IDEMPOTENTE — rejouable : une fois la base propre, elle ne supprime plus rien.
--   • Testée d'abord sur le STAGING (migration-staging.yml, données fictives) à l'ouverture
--     de la PR, avec les tests d'isolation/sécurité.
--   • ⚠️ DESTRUCTIVE (DELETE) : l'application en PRODUCTION se fait UNIQUEMENT avec accord
--     explicite ET APRÈS une sauvegarde vérifiée (il n'existe pas de rollback automatique
--     d'un DELETE — voir note en bas). À consigner ensuite dans supabase/migrations/JOURNAL.md.
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- 0) PHOTO AVANT : combien de lignes en trop vont être retirées (visible dans le log).
-- ------------------------------------------------------------------------------------
select 'total_conso_tx' as table, count(*) as lignes_en_double_a_retirer from (
  select id, row_number() over (
    partition by coalesce(societe,'PXP'), date_tx, carte, montant_ttc,
                 coalesce(lower(btrim(produit)),''), coalesce(facnum,'')
    order by id
  ) as rn
  from public.total_conso_tx
  where carte is not null and btrim(carte) <> ''
) q where rn > 1
union all
select 'ulys_conso', count(*) from (
  select id, row_number() over (
    partition by coalesce(societe,'PXP'), mois, badge, coalesce(numero_facture,'')
    order by id
  ) as rn
  from public.ulys_conso
  where badge is not null and btrim(badge) <> ''
) q where rn > 1;

-- ------------------------------------------------------------------------------------
-- 1) total_conso_tx — garde 1 ligne par (société, date, carte, montant, produit, facture),
--    retire les autres. Même clé que FP.dedupeConsoTx (plaque EXCLUE ; sans carte = jamais fusionné).
-- ------------------------------------------------------------------------------------
with d as (
  select id, row_number() over (
    partition by coalesce(societe,'PXP'), date_tx, carte, montant_ttc,
                 coalesce(lower(btrim(produit)),''), coalesce(facnum,'')
    order by id
  ) as rn
  from public.total_conso_tx
  where carte is not null and btrim(carte) <> ''
)
delete from public.total_conso_tx t
using d
where t.id = d.id and d.rn > 1;

-- ------------------------------------------------------------------------------------
-- 2) ulys_conso — garde 1 ligne par (société, mois, badge, n° de facture), retire les
--    autres (même personne/mois sous deux slugs = même agrégat → aucune donnée perdue).
--    Ne dédoublonne QUE les lignes avec un badge renseigné (cas ambigu « badge vide » laissé
--    volontairement pour revue manuelle — jamais de suppression incertaine).
-- ------------------------------------------------------------------------------------
with d as (
  select id, row_number() over (
    partition by coalesce(societe,'PXP'), mois, badge, coalesce(numero_facture,'')
    order by id
  ) as rn
  from public.ulys_conso
  where badge is not null and btrim(badge) <> ''
)
delete from public.ulys_conso u
using d
where u.id = d.id and d.rn > 1;

-- ------------------------------------------------------------------------------------
-- 3) VÉRIFICATION APRÈS : doit renvoyer 0 pour les deux tables (plus aucun doublon strict).
-- ------------------------------------------------------------------------------------
select 'total_conso_tx' as table, count(*) as doublons_restants from (
  select row_number() over (
    partition by coalesce(societe,'PXP'), date_tx, carte, montant_ttc,
                 coalesce(lower(btrim(produit)),''), coalesce(facnum,'')
    order by id
  ) as rn
  from public.total_conso_tx
  where carte is not null and btrim(carte) <> ''
) q where rn > 1
union all
select 'ulys_conso', count(*) from (
  select row_number() over (
    partition by coalesce(societe,'PXP'), mois, badge, coalesce(numero_facture,'')
    order by id
  ) as rn
  from public.ulys_conso
  where badge is not null and btrim(badge) <> ''
) q where rn > 1;

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
