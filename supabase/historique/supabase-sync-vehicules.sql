-- ============================================================
-- Auto-flotte — Synchronisation complète des véhicules (Supabase)
-- À coller UNE FOIS dans Supabase → SQL Editor → Run.
-- Ajoute les colonnes manquantes pour que TOUTES les modifs
-- (faites sur n'importe quel poste) soient enregistrées et
-- partagées entre tous les utilisateurs.
-- Sans danger : "IF NOT EXISTS" => ne touche pas aux colonnes déjà présentes.
-- ============================================================

ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS carburant         text;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS assurance         text;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS proprietaire      text;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS crit_air          text;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS date_dernier_ct   date;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS derniere_revision date;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS valeur_achat      numeric;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS commentaire       text;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS photo_url         text;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS sanef             boolean;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS etat_des_lieux    boolean;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS cle_siege         boolean;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS cle_salarie       boolean;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS cg_orig_siege     boolean;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS cg_orig_salarie   boolean;
-- Émissions de CO2 (g/km, code V.7) et puissance fiscale (CV, code P.6) — pour la TVS
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS co2               numeric;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS puissance_fiscale numeric;
