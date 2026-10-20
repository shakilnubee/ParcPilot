-- ============================================================
-- Auto-flotte — Fiche collaborateur partagée (Supabase)
-- À coller UNE FOIS dans Supabase → SQL Editor → Run.
-- Ajoute les colonnes de la fiche collaborateur (nom, prénom, adresse,
-- date de naissance) pour qu'elles soient partagées entre tous les postes.
-- Sans danger : "IF NOT EXISTS" ne touche pas aux colonnes déjà présentes.
-- ============================================================

ALTER TABLE conducteurs ADD COLUMN IF NOT EXISTS nom            text;
ALTER TABLE conducteurs ADD COLUMN IF NOT EXISTS prenom         text;
ALTER TABLE conducteurs ADD COLUMN IF NOT EXISTS adresse        text;
ALTER TABLE conducteurs ADD COLUMN IF NOT EXISTS date_naissance date;

-- (Au cas où elles n'existeraient pas encore sur ta base)
ALTER TABLE conducteurs ADD COLUMN IF NOT EXISTS tel            text;
ALTER TABLE conducteurs ADD COLUMN IF NOT EXISTS email          text;
ALTER TABLE conducteurs ADD COLUMN IF NOT EXISTS note           text;
