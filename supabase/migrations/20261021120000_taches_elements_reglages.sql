-- ============================================================================
--  DONNÉES — Tâches : nouvelles collections acceptées par la table générique
--  `settings_items` (étape 6 de la migration des réglages vers de vraies tables)
-- ============================================================================
--  Avant : les tâches vivaient dans le bloc JSON app_settings.data :
--    • taches            = [ {id, titre, échéance, véhicule…} ]   (liste à identifiant)
--    • rappelsPerso      = [ {id, titre, période…} ]              (liste à identifiant)
--    • tachesAutoFaites  = { clé: date }                          (tâches automatiques déjà créées)
--    • rappelsFaits      = { idRappel: { période: date } }        (rappels cochés)
--    • automationDone    = { clé: 1 }                             (mémo anti-doublon des automatisations)
--  Ce fichier n'ajoute RIEN au schéma : il élargit seulement la liste fermée des collections acceptées par
--  fp_element_enregistrer / fp_element_archiver (table settings_items, créée par 20261021110000).
--  Aucune donnée modifiée. Recopie : 20261021120100_taches_resynchroniser_table.sql.
--  Idempotent. Testé sur le staging avant la production.
-- ============================================================================

create or replace function public.fp_element_collection_ok(p_collection text)
  returns boolean
  language sql
  immutable
as $$
  select p_collection = any (array[
    'assureurs', 'assureurVeh', 'assuranceEcheance', 'assurancePrimes', 'assuranceIgnore',          -- 20261021110000
    'taches', 'rappelsPerso', 'tachesAutoFaites', 'rappelsFaits', 'automationDone'                   -- 20261021120000
  ]);
$$;

-- Vérification
select c as collection, public.fp_element_collection_ok(c) as acceptee
  from unnest(array['assurancePrimes', 'taches', 'rappelsPerso', 'tachesAutoFaites', 'rappelsFaits', 'automationDone', 'collectionInconnue']) c;

-- ============================================================================
--  RETOUR ARRIÈRE : recréer la fonction avec la seule liste des assurances (20261021110000).
-- ============================================================================
