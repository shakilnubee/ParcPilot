-- ============================================================
-- Auto-flotte — Ajoute la date de contrôle anti-pollution
-- (visite complémentaire pollution, obligatoire pour les utilitaires)
-- À coller UNE FOIS dans Supabase → SQL Editor → Run.
-- Sans danger : "IF NOT EXISTS".
-- ============================================================

ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS anti_pollution date;
