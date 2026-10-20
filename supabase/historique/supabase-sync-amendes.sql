-- ============================================================
-- Auto-flotte — Synchronisation des amendes (Supabase)
-- À coller UNE FOIS dans Supabase → SQL Editor → Run.
-- 1) Ajoute la colonne "points" (nombre de points retirés) manquante.
-- 2) Re-remplit les points des amendes existantes depuis data.js.
-- Sans danger : "IF NOT EXISTS" + UPDATE ciblés par id.
-- ============================================================

ALTER TABLE amendes ADD COLUMN IF NOT EXISTS points numeric;

UPDATE amendes SET points = 1 WHERE id = 'AM-0009';
UPDATE amendes SET points = 3 WHERE id = 'AM-0011';
UPDATE amendes SET points = 1 WHERE id = 'AM-0013';
UPDATE amendes SET points = 3 WHERE id = 'AM-0018';
UPDATE amendes SET points = 1 WHERE id = 'AM-0033';
UPDATE amendes SET points = 2 WHERE id = 'AM-0038';
UPDATE amendes SET points = 1 WHERE id = 'AM-0045';
UPDATE amendes SET points = 4 WHERE id = 'AM-0060';
