-- ============================================================
-- ⛔⛔ OBSOLÈTE — NE PLUS EXÉCUTER ⛔⛔  (neutralisé le 2026-08-07)
-- Ce script DÉSACTIVE la Row Level Security (RLS). Or la RLS + les policies
-- multi-sociétés « tenant_* » sont ACTIVES depuis le 2026-06-15 et assurent
-- l'ISOLATION des données entre sociétés. Lancer ce script rouvrirait TOUTES
-- les données à tous les comptes = fuite inter-sociétés grave.
-- ➜ Ne rien coller de ce fichier. Pour (ré)activer la sécurité : supabase/enable-rls.sql
-- Les lignes ci-dessous sont conservées pour mémoire uniquement.
-- ============================================================
/* --- CONTENU HISTORIQUE DÉSACTIVÉ (ne pas exécuter) ---
-- ============================================================
-- Auto-flotte - Garantir la sauvegarde sur TOUTES les tables
-- A coller UNE FOIS dans Supabase -> SQL Editor (editeur VIDE) -> Run.
-- Autorise ajout / modification / suppression depuis l'app sur toutes les
-- tables, pour que CHAQUE action soit enregistree et partagee entre PC.
-- Sans danger : ne touche AUCUNE donnee (juste un reglage de securite).
-- ============================================================

ALTER TABLE vehicules    DISABLE ROW LEVEL SECURITY;
ALTER TABLE amendes      DISABLE ROW LEVEL SECURITY;
ALTER TABLE factures     DISABLE ROW LEVEL SECURITY;
ALTER TABLE emprunts     DISABLE ROW LEVEL SECURITY;
ALTER TABLE conducteurs  DISABLE ROW LEVEL SECURITY;
ALTER TABLE documents    DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings DISABLE ROW LEVEL SECURITY;
*/
