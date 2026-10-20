-- Auto-flotte — Autonomie du véhicule (partie Technique)
-- À exécuter UNE FOIS dans Supabase → SQL Editor (Ctrl+A puis Suppr, coller, RUN).
alter table vehicules add column if not exists autonomie text;
