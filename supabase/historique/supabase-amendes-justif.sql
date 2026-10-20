-- ============================================================
-- Auto-flotte - Justificatif de paiement + archivage des amendes
-- A coller UNE FOIS dans Supabase -> SQL Editor (editeur VIDE) -> Run.
-- Sans danger : "IF NOT EXISTS" n'ecrase rien.
-- ============================================================

ALTER TABLE amendes ADD COLUMN IF NOT EXISTS justif_url text;
ALTER TABLE amendes ADD COLUMN IF NOT EXISTS archived   boolean;
