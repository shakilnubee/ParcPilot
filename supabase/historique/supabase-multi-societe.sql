-- Multi-sociétés : étiquette "societe" sur chaque table (données existantes = PXP).
-- À exécuter UNE fois dans Supabase → SQL Editor.
ALTER TABLE vehicules   ADD COLUMN IF NOT EXISTS societe text DEFAULT 'PXP';
ALTER TABLE amendes     ADD COLUMN IF NOT EXISTS societe text DEFAULT 'PXP';
ALTER TABLE factures    ADD COLUMN IF NOT EXISTS societe text DEFAULT 'PXP';
ALTER TABLE conducteurs ADD COLUMN IF NOT EXISTS societe text DEFAULT 'PXP';
ALTER TABLE emprunts    ADD COLUMN IF NOT EXISTS societe text DEFAULT 'PXP';
ALTER TABLE documents   ADD COLUMN IF NOT EXISTS societe text DEFAULT 'PXP';
-- (sécurité : force PXP sur les lignes déjà présentes)
UPDATE vehicules   SET societe='PXP' WHERE societe IS NULL;
UPDATE amendes     SET societe='PXP' WHERE societe IS NULL;
UPDATE factures    SET societe='PXP' WHERE societe IS NULL;
UPDATE conducteurs SET societe='PXP' WHERE societe IS NULL;
