-- ============================================================
-- Auto-flotte - Télépaiement des amendes (paiement en ligne)
-- A coller UNE FOIS dans Supabase -> SQL Editor (editeur VIDE) -> Run.
-- Sans danger : "IF NOT EXISTS".
-- ============================================================

ALTER TABLE amendes ADD COLUMN IF NOT EXISTS numero_telepaiement text;
ALTER TABLE amendes ADD COLUMN IF NOT EXISTS cle                 text;
