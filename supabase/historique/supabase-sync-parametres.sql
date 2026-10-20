-- ============================================================
-- Auto-flotte — Réglages partagés entre tous les postes (Supabase)
-- À coller UNE FOIS dans Supabase → SQL Editor → Run.
-- Crée la table qui stocke les personnalisations partagées :
-- noms & couleurs des groupes, libellés du menu, titres éditables,
-- couleur de l'interface, etc.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
  id          text PRIMARY KEY,
  data        jsonb,
  updated_at  timestamptz DEFAULT now()
);

-- (Optionnel) autoriser l'accès via la clé publique si RLS est activé :
-- ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY app_settings_all ON app_settings FOR ALL USING (true) WITH CHECK (true);
