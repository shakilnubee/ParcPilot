-- =====================================================================================
-- 20261103140000_gestionnaire_config_guard.sql
-- Audit F6 — GARDE SERVEUR : empêcher un GESTIONNAIRE de modifier la CONFIG société via
-- l'API, SANS bloquer ses DONNÉES DE TRAVAIL. Version VERSIONNÉE + ÉTENDUE du socle
-- `supabase/gestionnaire-config-guard.sql`. Remplace proprement le durcissement de
-- 2026-07-30 (`durcissement-config-gestionnaire.sql`) qui, lui, bloquait TOUTE écriture
-- app_settings et cassait la prod.
--
-- POURQUOI UN TRIGGER (et pas une policy) :
--   app_settings.data mêle la CONFIG société (profil/e-mails, nom, groupes, seuils d'alerte,
--   champs perso, documents obligatoires, automatisations…) ET des DONNÉES DE TRAVAIL qu'un
--   gestionnaire DOIT pouvoir écrire (congés, affectations, immobilisations, km, montants
--   payés d'amendes, checklists, garages, cartes carburant…). Une policy RLS ne compare pas
--   l'ANCIENNE et la NOUVELLE valeur ; un trigger BEFORE UPDATE le peut.
--
-- POURQUOI C'EST SÛR (fail-open — ne casse pas le travail du gestionnaire) :
--   • Le client écrit TOUJOURS par FUSION « delta » sur la version FRAÎCHE du serveur
--     (FP.settings._pushSettings / applyDelta) : une clé de config qu'il n'a pas délibérément
--     changée reste IDENTIQUE à la valeur serveur (OLD) → le trigger NE bloque PAS.
--   • Le trigger ne bloque QUE si une clé de config CHANGE réellement — ce qui n'arrive, pour
--     un gestionnaire, que via un appel FORGÉ (l'UI lui masque déjà les boutons « Enregistrer »
--     de la config : gateParamForGestionnaire, contrats.html loueurs, savers de seuils gardés
--     par FP.canManageSociete()).
--   • Toute clé NON listée (affichage/couleurs/libellés de menu, données de travail, nouvelles
--     clés…) passe toujours → aucune opération cassée, aucune régression « silencieuse ».
--
-- CAS PARTICULIER `profil` → on IGNORE la sous-clé `logoUrl` : c'est un CACHE (URL signée du
--   logo hébergé pour les e-mails) régénéré par FP.hostSocieteLogo() lors de l'envoi d'un e-mail
--   brandé — un gestionnaire PEUT envoyer des e-mails, donc cette écriture doit passer. Le logo
--   lui-même (`logoDataUrl`, posé par l'admin dans Paramètres) reste protégé.
--
-- CEO / Admin : NON concernés (accès complet à la config — le trigger les ignore via fp_role()).
--
-- ⚠️ IDEMPOTENT (create or replace + drop/create trigger) : rejoué à chaque mise à jour de la PR
--    sur le STAGING (migration-staging.yml). PRODUCTION = application manuelle, avec accord +
--    sauvegarde + TEST avec un compte gestionnaire réel (voir plus bas), puis JOURNAL.md.
--
-- Ordre des triggers BEFORE UPDATE (par nom) : trg_00_geler_ligne_global →
--   trg_01_anti_vidage_reglages → trg_app_settings_touch → trg_guard_app_settings_config.
--   La garde s'exécute EN DERNIER (sur le NEW.data final) ; si elle lève, tout l'UPDATE est annulé.
--   Les triggers précédents ne touchent que des clés de DONNÉES (anti-vidage) ou rev/updated_at
--   (touch) → aucun effet sur la comparaison des clés de CONFIG.
-- =====================================================================================

create or replace function public.fp_guard_app_settings_config()
returns trigger
language plpgsql
as $$
declare
  k text;
  -- Clés de CONFIG société réservées à l'admin, protégées EN BLOC. Chacune vérifiée : AUCUN
  -- chemin d'écriture « de travail » pour un gestionnaire (sinon elle n'est PAS ici).
  --   • societe            : identité juridique de la société (Société).
  --   • groupes            : libellés/couleurs des groupes de véhicules (bouton save masqué au gestionnaire).
  --   • notif              : seuils d'alerte (tous les savers gardés par FP.canManageSociete()).
  --   • pleinSeuilAnormal  : seuil « plein anormal » (même écran que notif, admin).
  --   • customFields       : DÉFINITIONS des champs perso (les VALEURS vivent dans vehCustom/condCustom).
  --   • docRequis          : DÉFINITIONS des documents obligatoires (l'override vit dans docRequisNA).
  --   • automations        : RÈGLES d'automatisation (l'exécution n'écrit que automationLog/automationDone/taches).
  protected text[] := array[
    'societe', 'groupes', 'notif', 'pleinSeuilAnormal',
    'customFields', 'docRequis', 'automations'
  ];
begin
  -- N'agit que pour un GESTIONNAIRE (le rôle qui fait autorité = profiles, via public.fp_role()).
  -- CEO / Admin / autres rôles : écriture inchangée.
  if public.fp_role() is distinct from 'gestionnaire' then
    return NEW;
  end if;

  -- Clés de config protégées EN BLOC.
  foreach k in array protected loop
    if (OLD.data -> k) is distinct from (NEW.data -> k) then
      raise exception 'Configuration societe (%) reservee a l''administrateur.', k
        using errcode = '42501';   -- insufficient_privilege
    end if;
  end loop;

  -- `profil` : protégé SAUF la sous-clé `logoUrl` (cache d'URL du logo hébergé, régénéré par
  -- l'envoi d'e-mails brandés — opération autorisée au gestionnaire). On compare donc le profil
  -- PRIVÉ de logoUrl. coalesce(...,'{}') évite un faux positif si `profil` est absent d'un côté.
  if (coalesce(OLD.data -> 'profil', '{}'::jsonb) - 'logoUrl')
       is distinct from (coalesce(NEW.data -> 'profil', '{}'::jsonb) - 'logoUrl') then
    raise exception 'Configuration societe (profil) reservee a l''administrateur.'
      using errcode = '42501';
  end if;

  return NEW;
end;
$$;

-- BEFORE UPDATE uniquement : la ligne app_settings d'une société existe déjà (sa création
-- initiale est une opération d'admin/onboarding, pas une écriture courante de gestionnaire).
drop trigger if exists trg_guard_app_settings_config on public.app_settings;
create trigger trg_guard_app_settings_config
  before update on public.app_settings
  for each row
  execute function public.fp_guard_app_settings_config();

-- ------------------------------------------------------------------------------------
-- RETOUR ARRIÈRE (rollback) — retire la garde, rien d'autre n'est touché :
--   drop trigger if exists trg_guard_app_settings_config on public.app_settings;
--   drop function if exists public.fp_guard_app_settings_config();
-- ------------------------------------------------------------------------------------
-- TEST OBLIGATOIRE avant de considérer ça livré en prod (compte GESTIONNAIRE réel, sur staging) :
--   1) opérations de TRAVAIL (affecter un conducteur, immobiliser un véhicule, saisir un km,
--      cocher une checklist, marquer une amende payée, AJOUTER UN GARAGE, ENVOYER un e-mail
--      brandé à un conducteur) → doivent TOUTES réussir.
--   2) tenter de modifier la config (e-mail d'envoi, nom société, groupes, seuils d'alerte,
--      champs perso, documents obligatoires, automatisations) via un appel direct → REFUSÉE (42501).
-- ------------------------------------------------------------------------------------
