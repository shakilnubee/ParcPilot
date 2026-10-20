-- ============================================================
-- Auto-flotte — Stockage des scans (avis, cartes grises)
-- À coller UNE FOIS dans Supabase → SQL Editor → Run.
--
-- 1) Ajoute les colonnes qui gardent le lien vers le scan
--    (avis_url sur les amendes, cg_url sur les véhicules).
-- 2) Crée le "bucket" de stockage "scans" (public en lecture).
-- 3) Autorise : lecture par tous, envoi par les utilisateurs connectés.
--
-- Sans danger : tout est en "IF NOT EXISTS" / "DROP ... IF EXISTS"
-- => peut être relancé plusieurs fois sans casser l'existant.
-- ============================================================

-- 1) Colonnes pour mémoriser le lien du scan
ALTER TABLE amendes   ADD COLUMN IF NOT EXISTS avis_url text;
ALTER TABLE vehicules ADD COLUMN IF NOT EXISTS cg_url   text;

-- 2) Bucket de stockage "scans" (public en lecture : les liens sont aléatoires)
INSERT INTO storage.buckets (id, name, public)
VALUES ('scans', 'scans', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3) Politiques d'accès au bucket "scans"
-- Lecture : tout le monde (pour pouvoir rouvrir le document via son lien)
DROP POLICY IF EXISTS "scans lecture publique" ON storage.objects;
CREATE POLICY "scans lecture publique" ON storage.objects
  FOR SELECT USING (bucket_id = 'scans');

-- Envoi : uniquement les utilisateurs connectés à l'application
DROP POLICY IF EXISTS "scans upload connectes" ON storage.objects;
CREATE POLICY "scans upload connectes" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'scans');

-- (Optionnel) Remplacement / suppression par les utilisateurs connectés
DROP POLICY IF EXISTS "scans maj connectes" ON storage.objects;
CREATE POLICY "scans maj connectes" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'scans');

DROP POLICY IF EXISTS "scans suppression connectes" ON storage.objects;
CREATE POLICY "scans suppression connectes" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'scans');
