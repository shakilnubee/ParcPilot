-- Auto-flotte — Gestion des MAJORATIONS d'amendes
-- À exécuter UNE FOIS dans Supabase → SQL Editor (Ctrl+A puis Suppr pour vider, coller, RUN).
-- Ajoute les colonnes nécessaires pour rattacher une majoration à l'amende d'origine.

alter table amendes
  add column if not exists majoree            boolean default false,
  add column if not exists montant_majore     numeric,
  add column if not exists date_majoration    date,
  add column if not exists numero_avis_majore text;

-- Vérification (optionnel) :
-- select id, prenom, montant, majoree, montant_majore, date_majoration from amendes where majoree;
