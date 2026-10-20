-- Ajoute les infos de permis de conduire aux fiches conducteurs.
-- À exécuter UNE fois dans Supabase → SQL Editor (puis recharger le site).
ALTER TABLE conducteurs ADD COLUMN IF NOT EXISTS permis_type text;
ALTER TABLE conducteurs ADD COLUMN IF NOT EXISTS permis_numero text;
ALTER TABLE conducteurs ADD COLUMN IF NOT EXISTS permis_obtention date;
ALTER TABLE conducteurs ADD COLUMN IF NOT EXISTS permis_expiration date;
