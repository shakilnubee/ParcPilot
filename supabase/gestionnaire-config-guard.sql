-- ============================================================
--  Parc Pilot — GARDE SERVEUR : empêcher un GESTIONNAIRE de modifier la CONFIG société
--  (sans bloquer ses DONNÉES DE TRAVAIL). Remplace proprement le durcissement de 2026-07-30
--  qui, lui, bloquait TOUTE écriture app_settings et cassait la prod.
--  À exécuter dans Supabase → SQL Editor → coller → Run.
--
--  ⚠️ SOURCE DE VÉRITÉ = la migration versionnée
--     `supabase/migrations/20261103140000_gestionnaire_config_guard.sql` (audit F6),
--     testée automatiquement sur le STAGING. Ce fichier en est la COPIE IDENTIQUE (même SQL,
--     idempotent) pour un lancement manuel. Garder les deux synchronisés.
-- ============================================================
--
--  POURQUOI un TRIGGER et pas une policy :
--  app_settings.data contient À LA FOIS la config société (profil/mailExpediteur, nom, groupes,
--  seuils d'alerte…) ET des DONNÉES DE TRAVAIL qu'un gestionnaire DOIT pouvoir écrire (congés,
--  affectations, immobilisations, montants payés d'amendes, km, checklists, garages…). Une policy
--  RLS ne peut pas comparer l'ANCIENNE et la NOUVELLE valeur ; un trigger BEFORE UPDATE le peut.
--
--  POURQUOI C'EST SÛR (ne casse pas le travail du gestionnaire) :
--  Le client écrit TOUJOURS par FUSION « delta » sur la version FRAÎCHE du serveur (FP.settings
--  _pushSettings / applyDelta) : les clés de config qu'il n'a pas délibérément changées restent
--  IDENTIQUES à la valeur serveur. Le trigger ne bloque donc QUE si une clé de config CHANGE
--  réellement — ce qui n'arrive pour un gestionnaire que via un appel FORGÉ (l'UI lui masque déjà
--  les boutons « Enregistrer » de la config). Une sauvegarde de données de travail passe toujours.
--
--  CEO / Admin : non concernés (accès complet à la config).
-- ============================================================

create or replace function public.fp_guard_app_settings_config()
returns trigger
language plpgsql
as $$
declare
  k text;
  -- Clés de CONFIG société réservées à l'admin, protégées EN BLOC. Chacune vérifiée : AUCUN
  -- chemin d'écriture « de travail » pour un gestionnaire. (Les garages `prestataires` NE sont
  -- PAS ici car un gestionnaire les ajoute depuis Entretiens/Sinistres.)
  --   societe · groupes · notif · pleinSeuilAnormal (seuils, savers gardés par FP.canManageSociete)
  --   customFields/docRequis/automations = DÉFINITIONS admin (valeurs/overrides/logs vivent ailleurs).
  protected text[] := array[
    'societe', 'groupes', 'notif', 'pleinSeuilAnormal',
    'customFields', 'docRequis', 'automations'
  ];
begin
  -- N'agit que pour un GESTIONNAIRE (le rôle fait autorité = profiles via public.fp_role()).
  if public.fp_role() is distinct from 'gestionnaire' then
    return NEW;
  end if;
  foreach k in array protected loop
    if (OLD.data -> k) is distinct from (NEW.data -> k) then
      raise exception 'Configuration societe (%) reservee a l''administrateur.', k
        using errcode = '42501';   -- insufficient_privilege
    end if;
  end loop;
  -- `profil` : protégé SAUF `logoUrl` (cache d'URL du logo hébergé régénéré par l'envoi d'e-mails
  -- brandés — opération autorisée au gestionnaire). Le logo lui-même (logoDataUrl) reste protégé.
  if (coalesce(OLD.data -> 'profil', '{}'::jsonb) - 'logoUrl')
       is distinct from (coalesce(NEW.data -> 'profil', '{}'::jsonb) - 'logoUrl') then
    raise exception 'Configuration societe (profil) reservee a l''administrateur.'
      using errcode = '42501';
  end if;
  return NEW;
end;
$$;

-- BEFORE UPDATE uniquement (la ligne app_settings d'une société existe déjà ; sa création initiale
-- est une opération d'admin/onboarding, pas une écriture courante de gestionnaire).
drop trigger if exists trg_guard_app_settings_config on public.app_settings;
create trigger trg_guard_app_settings_config
  before update on public.app_settings
  for each row
  execute function public.fp_guard_app_settings_config();

-- ── Vérification : le trigger doit apparaître ──────────────────────────────
select tgname, tgenabled from pg_trigger
  where tgrelid = 'public.app_settings'::regclass and not tgisinternal;

-- ============================================================
--  ROLLBACK (si besoin) — retire la garde, rien d'autre n'est touché :
--    drop trigger if exists trg_guard_app_settings_config on public.app_settings;
--    drop function if exists public.fp_guard_app_settings_config();
-- ============================================================
--  TEST OBLIGATOIRE avant de considérer ça livré (avec un compte GESTIONNAIRE réel) :
--   1) opérations de TRAVAIL (affecter un conducteur, immobiliser un véhicule, saisir un km,
--      cocher une checklist, marquer une amende payée, AJOUTER UN GARAGE) → doivent TOUTES réussir.
--   2) tenter de modifier la config (e-mail d'envoi, nom société, groupes, seuils d'alerte) via
--      un appel direct → doit être REFUSÉE (l'UI la masque déjà de toute façon).
-- ============================================================
