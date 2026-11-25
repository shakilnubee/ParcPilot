-- ============================================================================
--  GMAIL — Connexions OAuth par société (socle « Option B », Lot 1)
-- ============================================================================
--  But : stocker, PAR SOCIÉTÉ, la connexion à une boîte Gmail (le JETON DE
--  RAFRAÎCHISSEMENT OAuth), pour que Parc Pilot puisse plus tard lire les e-mails
--  libellés et récupérer les pièces jointes (factures…) AU NOM de la société.
--
--  ⚠️ Le jeton de rafraîchissement est un SECRET PUISSANT → table TOTALEMENT
--  PRIVÉE : AUCUN accès client (ni lecture ni écriture). Seule la clé service_role
--  (Edge Function « gmail-oauth ») y accède, en contournant la RLS. Le client ne
--  connaît l'état de connexion que via la fonction (action 'status'), JAMAIS par
--  lecture directe de la table.
--
--  Ce fichier crée la table gmail_connexions (1 ligne = 1 société) + un trigger
--  updated_at. Aucune donnée existante touchée. Idempotent (rejouable à chaque
--  mise à jour de la PR). À TESTER d'abord sur le STAGING (appliqué
--  automatiquement par la CI sur toute PR), appliqué en PRODUCTION seulement
--  AVEC ACCORD EXPLICITE, après sauvegarde vérifiée (cf. JOURNAL.md).
--
--  RETOUR ARRIÈRE :
--    drop trigger if exists trg_gmail_connexions_touch on public.gmail_connexions;
--    drop function if exists public.gmail_connexions_touch();
--    drop table if exists public.gmail_connexions;
-- ============================================================================

begin;

create table if not exists public.gmail_connexions (
  societe        text primary key,          -- = app_settings.id (la société)
  email          text,                      -- adresse de la boîte connectée (pour l'affichage)
  refresh_token  text not null,             -- JETON OAuth (secret) — jamais exposé au client
  scope          text,                      -- scopes accordés (ex. '.../auth/gmail.readonly')
  connected_by   uuid,                      -- auth.users.id de qui a connecté (traçabilité)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Table 100 % privée : aucun accès client. Seul le service_role (Edge Function) y accède.
revoke all on public.gmail_connexions from anon;
revoke all on public.gmail_connexions from authenticated;
alter table public.gmail_connexions enable row level security;
-- Aucune policy permissive n'est créée → anon/authenticated ne peuvent RIEN ;
-- le service_role (Edge Function gmail-oauth) contourne la RLS.

-- updated_at automatique à chaque mise à jour.
create or replace function public.gmail_connexions_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_gmail_connexions_touch on public.gmail_connexions;
create trigger trg_gmail_connexions_touch
  before update on public.gmail_connexions
  for each row execute function public.gmail_connexions_touch();

commit;
