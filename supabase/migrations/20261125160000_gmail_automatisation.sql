-- ============================================================================
--  GMAIL — AUTOMATISATION FLOTTE (mail → actions) : file « À vérifier » + idempotence
-- ============================================================================
--  Deux tables pour l'automatisation « mail Gmail → actions métier » (Option B) :
--
--   1) gmail_traites     — REGISTRE D'IDEMPOTENCE. Un (message[, action]) traité
--                          une seule fois. 100 % PRIVÉE (service_role uniquement,
--                          comme gmail_connexions) : le moteur serveur « claim »
--                          une clé avant de traiter (INSERT ignore-duplicates).
--
--   2) gmail_a_verifier  — FILE « À VÉRIFIER ». Propositions d'action en attente de
--                          validation humaine. INSERT réservé au service_role (le
--                          moteur) ; les gestionnaires autorisés de la société
--                          peuvent LIRE et METTRE À JOUR (confirmer/corriger/ignorer)
--                          via la RLS par société (tenant_*). Pas d'insert/suppression
--                          côté client.
--
--  ⚠️ Rien n'écrit dans un vrai dossier : ces tables ne font que MÉMORISER des
--     propositions et l'état « déjà traité ». Les écritures métier (amendes,
--     réglages, sinistres…) passent par les parcours manuels FP.* à la confirmation.
--
--  100 % ADDITIF, IDEMPOTENT (rejouable à chaque mise à jour de PR). Aucune donnée
--  existante touchée. Testée d'abord sur le STAGING (migration-staging.yml), appliquée
--  en PRODUCTION seulement AVEC ACCORD EXPLICITE après sauvegarde vérifiée (JOURNAL.md).
--
--  RETOUR ARRIÈRE :
--    drop table if exists public.gmail_a_verifier;
--    drop table if exists public.gmail_traites;
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) gmail_traites — registre d'idempotence (service_role uniquement)
-- ---------------------------------------------------------------------------
create table if not exists public.gmail_traites (
  dedup_key   text primary key,          -- ex. 'gmail:<messageId>' ou 'gmail:<messageId>:<action>'
  societe     text not null,
  message_id  text,
  thread_id   text,
  action      text,
  resultat    text,                       -- 'propose' | 'applique' | 'ignore' | 'erreur'
  created_at  timestamptz not null default now()
);
create index if not exists gmail_traites_soc_date_idx on public.gmail_traites (societe, created_at desc);

-- Table 100 % privée : aucun accès client. Seul le service_role (Edge Function) y accède.
revoke all on public.gmail_traites from anon;
revoke all on public.gmail_traites from authenticated;
alter table public.gmail_traites enable row level security;
-- Aucune policy permissive → anon/authenticated ne peuvent RIEN ; le service_role contourne la RLS.

-- ---------------------------------------------------------------------------
-- 2) gmail_a_verifier — file « À vérifier » (lecture/MAJ gestionnaires de la société)
-- ---------------------------------------------------------------------------
create table if not exists public.gmail_a_verifier (
  id            text primary key,         -- déterministe : 'AV-<messageId>[-<n>]' (anti-doublon natif)
  societe       text not null,
  message_id    text,
  thread_id     text,
  from_email    text,
  objet         text,
  recu_le       timestamptz,
  extrait       text,
  domaine       text,                     -- amende | maintenance | sinistre | assurance | relance | inconnu
  action        text,                     -- action envisagée (amende_payee, rdv_update, sinistre_piece, a_verifier…)
  dossier_ref   jsonb,                    -- { type, id/key, plaque, numeroAvis… }
  pieces        jsonb,                    -- [{ filename, attachmentId }]
  motif_blocage text,                     -- raison (ambigu, reçu manquant, montant ≠, proposition…)
  statut        text not null default 'a_verifier',  -- a_verifier | confirme | corrige | ignore | applique
  payload       jsonb,                    -- données proposées (pré-remplissage du parcours manuel)
  cree_le       timestamptz not null default now(),
  traite_le     timestamptz,
  traite_par    uuid
);
create index if not exists gmail_a_verifier_soc_statut_idx on public.gmail_a_verifier (societe, statut);
create index if not exists gmail_a_verifier_soc_date_idx on public.gmail_a_verifier (societe, cree_le desc);

alter table public.gmail_a_verifier enable row level security;

-- Droits de base : le client (authenticated) peut LIRE et METTRE À JOUR, mais PAS insérer/supprimer.
revoke all on public.gmail_a_verifier from anon;
revoke all on public.gmail_a_verifier from authenticated;
grant select, update on public.gmail_a_verifier to authenticated;

-- RLS par société : mêmes helpers que les autres tables (fp_is_admin / fp_societe, SECURITY DEFINER,
-- cf. supabase/multi-societe-rls.sql). CEO (is_admin) voit tout ; sinon, sa société seulement.
drop policy if exists tenant_gmail_a_verifier_read on public.gmail_a_verifier;
create policy tenant_gmail_a_verifier_read on public.gmail_a_verifier
  for select to authenticated
  using (fp_is_admin() or coalesce(societe, 'PXP') = fp_societe());

drop policy if exists tenant_gmail_a_verifier_update on public.gmail_a_verifier;
create policy tenant_gmail_a_verifier_update on public.gmail_a_verifier
  for update to authenticated
  using (fp_is_admin() or coalesce(societe, 'PXP') = fp_societe())
  with check (fp_is_admin() or coalesce(societe, 'PXP') = fp_societe());

-- Pas de policy INSERT/DELETE pour authenticated → seul le service_role (moteur) insère ;
-- un item ne se supprime pas (il passe en statut 'ignore'/'applique', traçabilité conservée).

commit;
