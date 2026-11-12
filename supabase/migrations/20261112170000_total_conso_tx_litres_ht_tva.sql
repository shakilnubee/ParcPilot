-- ============================================================================
-- total_conso_tx : litres / montant_ht / montant_tva (détail PAR TRANSACTION)
-- ============================================================================
-- Contexte : la page d'un prestataire (DKV, Shell…) reprend le tableau de Total
-- Fleet (Carburant · Litres · … · HT · TVA · Total TTC) et sa section Analyse
-- (prix moyen/L, CO₂). Jusqu'ici `total_conso_tx` ne stockait que `montant_ttc`
-- par transaction → les colonnes Litres / HT / TVA et le CO₂ restaient à « — ».
-- Ces 3 colonnes permettent de capturer, QUAND le relevé les fournit, le volume
-- et la ventilation HT/TVA de CHAQUE transaction (déjà lus par les lecteurs, ex.
-- les litres du relevé DKV).
--
-- 100 % ADDITIF, NULLABLE, IDEMPOTENT. Aucune ligne existante n'est modifiée :
--   - les transactions déjà importées gardent litres/montant_ht/montant_tva = NULL
--     (affichées « — », exactement comme aujourd'hui) ;
--   - seules les NOUVELLES transactions importées porteront ces valeurs quand le
--     relevé les donne.
-- RLS inchangée : les colonnes héritent des policies tenant_* existantes de
-- `total_conso_tx` (isolation par société). Aucune policy ajoutée/modifiée.
-- Aucun recalcul financier : `montant_ttc` reste la source du total (jamais
-- additionné à HT/TVA ; HT/TVA sont une ventilation du même TTC).
--
-- Rejouable sans risque (ADD COLUMN IF NOT EXISTS) → compatible staging (migration-staging.yml).

alter table if exists public.total_conso_tx
  add column if not exists litres      numeric,
  add column if not exists montant_ht  numeric,
  add column if not exists montant_tva numeric;

-- ----------------------------------------------------------------------------
-- RETOUR ARRIÈRE (NE PAS exécuter en temps normal — supprime le volume et la
-- ventilation HT/TVA des transactions ; les montants TTC et le reste sont intacts) :
--   alter table public.total_conso_tx
--     drop column if exists litres,
--     drop column if exists montant_ht,
--     drop column if exists montant_tva;
-- ----------------------------------------------------------------------------
