-- ============================================================
-- Auto-flotte — Autoriser la synchro des réglages (app_settings)
-- À coller UNE FOIS dans Supabase → SQL Editor → Run.
--
-- Symptôme corrigé : "new row violates row-level security policy
-- for table app_settings" quand on clique « Envoyer mes réglages ».
--
-- Sans danger : idempotent (CREATE IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ============================================================

-- 1) La table existe (au cas où)
CREATE TABLE IF NOT EXISTS app_settings (
  id         text PRIMARY KEY,
  data       jsonb,
  updated_at timestamptz DEFAULT now()
);

-- 2) Active la sécurité au niveau des lignes
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- 3) Lecture : autorisée pour tout le monde (réglages appliqués au chargement)
DROP POLICY IF EXISTS "app_settings lecture" ON app_settings;
CREATE POLICY "app_settings lecture" ON app_settings
  FOR SELECT USING (true);

-- 4) Écriture (ajout + modification) : utilisateurs connectés à l'application
DROP POLICY IF EXISTS "app_settings ecriture" ON app_settings;
CREATE POLICY "app_settings ecriture" ON app_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
