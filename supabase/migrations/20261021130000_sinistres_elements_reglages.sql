-- ============================================================================
--  DONNÉES — Sinistres : nouvelles collections acceptées par la table générique
--  `settings_items` (étape 7 de la migration des réglages vers de vraies tables)
-- ============================================================================
--  Avant : le suivi des sinistres vivait dans le bloc JSON app_settings.data :
--    • sinistreStatut      = { idFacture: statut }               • sinistreStage  = { idFacture: étape }
--    • sinistreGroupes     = { idFacture: idGroupe }              • sinistreAssurance = { clé: {franchise, clôture…} }
--    • sinistreSous        = { plaque: [sous-dossiers] }          • sinistreDocSub = { idDocument: sous-dossier }
--    • sinistreDossiers    = [ plaque, … ] (ordre d'affichage)    • sinistreDossiersSupprimes = [ plaque, … ]
--  Ce fichier n'ajoute RIEN au schéma : il élargit seulement la liste fermée des collections acceptées par
--  fp_element_enregistrer / fp_element_archiver (table settings_items, créée par 20261021110000).
--  Aucune donnée modifiée. Recopie : 20261021130100_sinistres_resynchroniser_table.sql.
--  Idempotent. Testé sur le staging avant la production.
-- ============================================================================

create or replace function public.fp_element_collection_ok(p_collection text)
  returns boolean
  language sql
  immutable
as $$
  select p_collection = any (array[
    'assureurs', 'assureurVeh', 'assuranceEcheance', 'assurancePrimes', 'assuranceIgnore',          -- 20261021110000
    'taches', 'rappelsPerso', 'tachesAutoFaites', 'rappelsFaits', 'automationDone',                  -- 20261021120000
    'sinistreStatut', 'sinistreStage', 'sinistreGroupes', 'sinistreAssurance',                       -- 20261021130000
    'sinistreSous', 'sinistreDocSub', 'sinistreDossiers', 'sinistreDossiersSupprimes'
  ]);
$$;

-- Vérification
select c as collection, public.fp_element_collection_ok(c) as acceptee
  from unnest(array['assurancePrimes', 'taches', 'sinistreStatut', 'sinistreStage', 'sinistreGroupes', 'sinistreAssurance',
                    'sinistreSous', 'sinistreDocSub', 'sinistreDossiers', 'sinistreDossiersSupprimes', 'collectionInconnue']) c;

-- ============================================================================
--  RETOUR ARRIÈRE : recréer la fonction avec la liste de 20261021120000 (assurances + tâches).
-- ============================================================================
