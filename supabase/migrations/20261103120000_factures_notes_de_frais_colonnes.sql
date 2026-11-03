-- =====================================================================================
-- 20261103120000_factures_notes_de_frais_colonnes.sql
-- Version VERSIONNÉE (migration) du script `supabase/factures-notes-de-frais-columns.sql`.
-- Ajoute 3 colonnes OPTIONNELLES à `factures` pour les « Notes de frais » et l'import
-- Sanef (péages flux libre) :
--   • source      : origine ('note-frais', 'sanef', …) — pour filtrer/regrouper.
--   • categorie   : catégorie de la dépense ('carburant','peage','lavage','parking','repas','autre').
--   • conducteur  : nom du collaborateur qui a réglé la dépense (rattachement).
--
-- 100 % ADDITIF, IDEMPOTENT et SANS DANGER : n'ajoute que des colonnes nullables, ne
-- supprime/ne renomme RIEN, rejouable à volonté (`if not exists`). L'appli fonctionne
-- AVANT comme APRÈS (tolérante : sans ces colonnes, la facture est enregistrée quand
-- même via FP.persistFacture, mais source/categorie/conducteur ne persistent pas — ce
-- que ce correctif résout). Testée automatiquement sur le STAGING à l'ouverture de la PR
-- (.github/workflows/migration-staging.yml). Application en PRODUCTION = manuelle, avec
-- accord + sauvegarde, puis à consigner dans supabase/migrations/JOURNAL.md.
-- =====================================================================================

alter table public.factures add column if not exists source     text;
alter table public.factures add column if not exists categorie  text;
alter table public.factures add column if not exists conducteur text;

-- Index léger pour retrouver vite les notes de frais / relevés Sanef par société.
create index if not exists idx_factures_source on public.factures (societe, source);

-- ------------------------------------------------------------------------------------
-- RETOUR ARRIÈRE (rollback) — à n'exécuter QUE si l'on veut revenir en arrière :
--   drop index if exists idx_factures_source;
--   alter table public.factures drop column if exists source;
--   alter table public.factures drop column if exists categorie;
--   alter table public.factures drop column if exists conducteur;
-- ------------------------------------------------------------------------------------
