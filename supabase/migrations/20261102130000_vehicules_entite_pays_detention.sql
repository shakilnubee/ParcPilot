-- ============================================================
--  vehicules — 3 colonnes METIER pour la gestion multi-entités (flotte internationale)
--
--  Contexte : un véhicule peut avoir un PROPRIÉTAIRE JURIDIQUE (ex. TEMSYS, BPCE) DIFFÉRENT de
--  son ENTITÉ DE RATTACHEMENT de gestion (TJMAX, PXPR FR/GE/IT/NL). Aujourd'hui une seule colonne
--  `proprietaire` portait les deux → impossible de filtrer « ma flotte TJMAX » tout en gardant
--  TEMSYS comme propriétaire réel. On AJOUTE (sans rien réécrire) :
--    • entite_rattachement : société du groupe à laquelle le véhicule est affecté (= FILTRE principal)
--    • pays_immat          : pays d'immatriculation réel
--    • mode_detention      : 'achat' | 'lld' | 'loa' | 'autre' (pré-rempli côté app depuis le contrat)
--  `proprietaire` reste le PROPRIÉTAIRE JURIDIQUE (rôle inchangé + dépendance FP.loueurOf préservée).
--
--  ⚠️ C'est une dimension MÉTIER *dans* un compte PP — à NE PAS confondre avec la colonne `societe`
--  (locataire SaaS / isolation RLS), qui n'est pas touchée ici.
--
--  ADDITIF, IDEMPOTENT, SANS PERTE (aucune donnée existante modifiée ; aucune valeur par défaut imposée
--  → les véhicules non renseignés restent « non renseigné », à compléter par le gestionnaire).
--
--  À lancer UNE FOIS par environnement : Supabase → SQL Editor → coller → Run.
--  STAGING d'abord (CI migration-staging.yml), PRODUCTION seulement avec accord + sauvegarde vérifiée.
--
--  RETOUR ARRIÈRE (rollback) — NE PAS exécuter sauf besoin (perdrait les valeurs saisies depuis) :
--    alter table public.vehicules drop column if exists entite_rattachement;
--    alter table public.vehicules drop column if exists pays_immat;
--    alter table public.vehicules drop column if exists mode_detention;
-- ============================================================

alter table public.vehicules add column if not exists entite_rattachement text;
alter table public.vehicules add column if not exists pays_immat          text;
alter table public.vehicules add column if not exists mode_detention      text;

-- Index léger pour le filtre principal (entité) — facultatif mais utile si la flotte grossit.
create index if not exists vehicules_entite_idx on public.vehicules (entite_rattachement);

-- Vérif (lecture seule) : doit lister les 3 colonnes après exécution.
select column_name, data_type
from information_schema.columns
where table_name = 'vehicules'
  and column_name in ('entite_rattachement', 'pays_immat', 'mode_detention')
order by column_name;
