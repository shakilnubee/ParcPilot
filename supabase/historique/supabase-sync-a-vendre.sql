-- ============================================================
-- Auto-flotte — Page "À vendre" partagée (Supabase)
-- À coller UNE FOIS dans Supabase → SQL Editor → Run.
-- Ajoute les 2 colonnes propres au pipeline de vente (prix de vente et étape)
-- pour qu'elles soient enregistrées et partagées entre tous les postes.
-- Sans danger : "IF NOT EXISTS".
-- ============================================================

ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS prix_vente       numeric;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS pipeline_statut  text;
