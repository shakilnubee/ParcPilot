-- Ajoute le champ "Poste de travail" aux fiches conducteurs.
-- À exécuter UNE fois dans Supabase → SQL Editor (puis recharger le site).
ALTER TABLE conducteurs ADD COLUMN IF NOT EXISTS poste text;
