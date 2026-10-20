-- ============================================================
-- Auto-flotte - Gestion des pneus (par véhicule)
-- A coller UNE FOIS dans Supabase -> SQL Editor (editeur VIDE) -> Run.
-- Sans danger : "IF NOT EXISTS".
-- ============================================================

ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS dimension_pneus       text;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS type_pneus            text;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS date_changement_pneus date;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS note_pneus            text;
