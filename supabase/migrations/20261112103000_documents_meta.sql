-- ============================================================================
-- documents.meta (jsonb) — métadonnées des PIÈCES COMPLÉMENTAIRES d'un état des lieux
-- ============================================================================
-- Contexte : on peut désormais ajouter des photos à un état des lieux DÉJÀ SIGNÉ
-- sans toucher au PDF signé ni aux photos initiales. Chaque photo ajoutée reste une
-- ligne `documents` (type 'etat-des-lieux') comme aujourd'hui ; cette colonne `meta`
-- porte uniquement sa TRAÇABILITÉ :
--   { source:'ajout-photo', apresSignature:bool, priseDeVue:'YYYY-MM-DD'|null,
--     auteur:'<email>', commentaire:'...', ajouteLe:'<ISO>', periode:{conducteurKey,debut,fin} }
--
-- 100 % ADDITIF, NULLABLE, IDEMPOTENT. Aucune ligne existante n'est modifiée :
--   - les PDF signés et les photos INITIALES gardent meta = NULL (⇒ traités comme avant) ;
--   - seules les nouvelles pièces complémentaires portent un objet `meta`.
-- RLS inchangée : la colonne hérite des policies tenant_* existantes de `documents`
-- (isolation par société). Aucune policy ajoutée/modifiée.
--
-- Rejouable sans risque (ADD COLUMN IF NOT EXISTS) → compatible staging (migration-staging.yml).

alter table if exists public.documents
  add column if not exists meta jsonb;

-- ----------------------------------------------------------------------------
-- RETOUR ARRIÈRE (NE PAS exécuter en temps normal — supprime les métadonnées
-- des pièces complémentaires ; les photos elles-mêmes restent, seules leurs infos
-- de traçabilité sont perdues) :
--   alter table public.documents drop column if exists meta;
-- ----------------------------------------------------------------------------
