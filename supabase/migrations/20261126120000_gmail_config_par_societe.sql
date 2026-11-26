-- ============================================================================
--  GMAIL — Configuration self-service PAR SOCIÉTÉ (libellé surveillé + activation)
-- ============================================================================
--  But : permettre à chaque administrateur client de régler SON intégration Gmail
--  depuis « Paramètres → Intégrations → Gmail » (choisir un libellé à surveiller,
--  tester, activer/mettre en pause) SANS intervention du CEO ni du développeur.
--
--  On AJOUTE seulement des colonnes à la table privée existante gmail_connexions :
--   • watch_label_id   : identifiant Gmail du libellé surveillé (ex. « Label_12 ») —
--                        stable même si le client renomme le libellé dans Gmail.
--   • watch_label_name : nom affichable du libellé (ex. « 09. Voiture ») pour l'UI
--                        et pour reconstruire la requête Gmail (label:"<nom>").
--   • suivi_actif      : état d'activation PAR SOCIÉTÉ. NULL = héritage (boîtes déjà
--                        connectées avant cette migration → restent ACTIVES comme
--                        aujourd'hui, pilotées par le secret global GMAIL_ACTIONS_ENABLED) ;
--                        TRUE = activé explicitement par l'admin ; FALSE = en pause.
--                        Le cron traite les lignes « suivi_actif IS DISTINCT FROM FALSE ».
--                        Une boîte NOUVELLEMENT connectée est posée à FALSE par la
--                        fonction gmail-oauth → l'admin teste puis clique « Activer ».
--   • derniere_sync    : horodatage de la dernière synchro réussie (affiché dans l'UI).
--   • sync_erreur      : dernier message d'erreur (ex. jeton révoqué) → message clair
--                        « boîte à reconnecter » côté client.
--
--  ⚠️ AUCUNE donnée existante supprimée ni modifiée. La table reste 100 % PRIVÉE
--  (service_role uniquement, aucune policy client) : la config se lit/écrit via les
--  Edge Functions (droits CEO/Admin + cloisonnement par société vérifiés côté serveur).
--  Idempotent (ADD COLUMN IF NOT EXISTS) → rejouable à chaque mise à jour de la PR,
--  appliqué d'abord sur le STAGING par la CI, en PRODUCTION seulement AVEC ACCORD.
--
--  RETOUR ARRIÈRE :
--    alter table public.gmail_connexions
--      drop column if exists watch_label_id,
--      drop column if exists watch_label_name,
--      drop column if exists suivi_actif,
--      drop column if exists derniere_sync,
--      drop column if exists sync_erreur;
-- ============================================================================

begin;

alter table public.gmail_connexions
  add column if not exists watch_label_id   text,
  add column if not exists watch_label_name text,
  add column if not exists suivi_actif      boolean,
  add column if not exists derniere_sync    timestamptz,
  add column if not exists sync_erreur      text;

commit;
