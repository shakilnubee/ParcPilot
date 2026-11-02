-- ============================================================
--  vehicules.type_pneus — colonne manquante (réutilisée pour la VERSION/finition du véhicule)
--
--  Contexte : l'app stocke la « version/finition » d'un véhicule dans la colonne historique
--  `type_pneus` (mapping type_pneus↔version dans assets/js/supabase-client.js, comme
--  note_pneus↔autonomie). Cette colonne était ABSENTE de la table `vehicules` en production
--  → à l'enregistrement d'une fiche, l'écriture de la version échouait et l'app affichait
--  « Un champ (« type_pneus ») n'a pas pu être enregistré : la base n'est pas à jour. »
--  (le reste de la fiche était bien sauvé, mais la version était perdue).
--
--  Correctif : ajouter la colonne. ADDITIF, IDEMPOTENT, SANS PERTE (aucune donnée touchée).
--
--  À lancer UNE FOIS par environnement : Supabase → SQL Editor → coller → Run.
--  STAGING d'abord (CI migration-staging.yml), PRODUCTION seulement avec accord + sauvegarde vérifiée.
--
--  RETOUR ARRIÈRE (rollback) — NE PAS exécuter sauf besoin (perdrait les versions saisies depuis) :
--    alter table public.vehicules drop column if exists type_pneus;
-- ============================================================

alter table public.vehicules add column if not exists type_pneus text;

-- Vérif (lecture seule) : doit lister la colonne après exécution.
select column_name, data_type
from information_schema.columns
where table_name = 'vehicules' and column_name = 'type_pneus';
