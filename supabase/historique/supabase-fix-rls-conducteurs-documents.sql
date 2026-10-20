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
-- Auto-flotte - Autoriser les ecritures sur conducteurs & documents
-- A coller UNE FOIS dans Supabase -> SQL Editor (editeur VIDE) -> Run.
-- Sans danger : ne touche AUCUNE donnee, change juste un reglage de securite
-- (aligne ces 2 tables sur les autres pour que les ajouts se partagent entre PC).
-- ============================================================

ALTER TABLE conducteurs DISABLE ROW LEVEL SECURITY;
ALTER TABLE documents   DISABLE ROW LEVEL SECURITY;
*/
