-- ============================================================
--  dossiers_achat — SUIVI D'ACQUISITION de véhicules (du projet d'achat à l'intégration flotte)
--
--  Phase 2 de la roadmap « Acheter » (module « À vendre »). 1 acquisition = 1 ligne.
--  Isolation par société via RLS (patron identique à driver_absences / offres_achat).
--  Le véhicule n'existe PAS encore dans la flotte au début : ce dossier vit AVANT la création
--  du véhicule, et pointe vers vehicule_id une fois « Ajouté à la flotte ».
--
--  ⚠️ NE PAS confondre avec offres_achat (= offres reçues d'un ACHETEUR pour un véhicule qu'on VEND).
--  Ici c'est l'inverse : NOUS achetons un véhicule.
--
--  ⚠️ FINANCES / ANTI DOUBLE-COMPTE : le coût d'acquisition alimente le TCO via la FACTURE de
--  type « achat » (FP.coutFactureExploit l'exclut déjà de l'exploitation). Les montants stockés ici
--  (prix, acompte) servent au SUIVI du dossier, pas à un second calcul de coût.
--
--  À lancer UNE FOIS par environnement : Supabase → SQL Editor → coller → Run. Idempotent.
--  STAGING d'abord (CI migration-staging.yml), PRODUCTION seulement avec accord + sauvegarde vérifiée.
--
--  RETOUR ARRIÈRE (rollback) — à exécuter manuellement si besoin :
--    drop policy if exists tenant_dossiers_achat on public.dossiers_achat;
--    drop table if exists public.dossiers_achat;
-- ============================================================

create table if not exists public.dossiers_achat (
  id                     text primary key,            -- id généré côté app (ex. 'ACH-<rand>')
  societe                text not null,               -- isolation par société (= app_settings.id)
  statut                 text not null default 'projet',
  -- Véhicule visé (peut être partiellement connu au début)
  marque                 text default '',
  modele                 text default '',
  version                text default '',
  motorisation           text default '',
  immat                  text default '',
  vin                    text default '',
  -- Commande / fournisseur
  fournisseur            text default '',
  mode_financement       text default '',             -- comptant / credit / loa / lld
  date_commande          date,
  date_livraison_prevue  date,
  date_livraison_reelle  date,
  -- Finances (SUIVI du dossier — pas le calcul de coût, cf. en-tête)
  prix_ht                numeric,
  prix_ttc               numeric,
  acompte_prevu          numeric,
  acompte_paye           numeric,
  paiements              jsonb default '[]'::jsonb,    -- [{date, montant, libelle}]
  -- Lien vers le véhicule créé à l'intégration (sinon null)
  vehicule_id            text,
  notes                  text default '',
  created_at             timestamptz default now(),
  updated_at             timestamptz default now(),
  deleted_at             timestamptz                   -- soft-delete (archivage du dossier)
);

create index if not exists dossiers_achat_soc_idx    on public.dossiers_achat (societe);
create index if not exists dossiers_achat_statut_idx on public.dossiers_achat (societe, statut);

grant all on public.dossiers_achat to authenticated;
alter table public.dossiers_achat enable row level security;

drop policy if exists tenant_dossiers_achat on public.dossiers_achat;
create policy tenant_dossiers_achat on public.dossiers_achat
  for all to authenticated
  using      (fp_is_admin() or coalesce(societe, 'PXP') = fp_societe())
  with check  (fp_is_admin() or coalesce(societe, 'PXP') = fp_societe());

-- Vérif : doit lister la policy
select tablename, policyname, cmd from pg_policies where tablename = 'dossiers_achat';
