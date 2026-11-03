-- =====================================================================================
-- 20261103130000_app_settings_concurrence_rev.sql
-- Version VERSIONNÉE (migration) du socle `supabase/app_settings-concurrence.sql`.
-- Étape 0 du finding F1 de l'audit (anti « dernier qui écrit gagne » sur la config).
--
-- Ajoute 2 colonnes techniques à `app_settings` + un trigger qui les met à jour tout seul :
--   • updated_at timestamptz  — horodatage de la dernière écriture
--   • rev        bigint        — numéro de révision, +1 à chaque écriture (socle du futur CAS)
--
-- ⚠️ 100 % ADDITIF, IDEMPOTENT, NON BLOQUANT. **RIEN ne change pour l'application** tant que
-- le code n'exploite pas `rev` (il continue d'upserter {id, data} ; rev/updated_at sont gérés
-- par la base). C'est le PRÉREQUIS de l'étape 1 (verrou de version côté code `FP.settings`).
--
-- Ordre des triggers BEFORE UPDATE (par nom) : trg_00_geler_ligne_global → trg_01_anti_vidage_reglages
-- → trg_app_settings_touch. `touch` s'exécute donc EN DERNIER, après les garde-fous (rev n'est
-- incrémenté que si l'écriture est autorisée). Aucune interaction négative.
--
-- Testée automatiquement sur le STAGING à l'ouverture de la PR (migration-staging.yml).
-- PRODUCTION = application manuelle, avec accord + sauvegarde, puis à consigner dans JOURNAL.md.
-- =====================================================================================

-- 1) Colonnes techniques (idempotent).
alter table public.app_settings add column if not exists updated_at timestamptz not null default now();
alter table public.app_settings add column if not exists rev        bigint      not null default 0;

-- 2) Trigger : à chaque UPDATE, incrémente rev et tamponne updated_at.
create or replace function public.app_settings_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.rev := coalesce(old.rev, 0) + 1;
  return new;
end;
$$;

drop trigger if exists trg_app_settings_touch on public.app_settings;
create trigger trg_app_settings_touch
  before update on public.app_settings
  for each row execute function public.app_settings_touch();

-- ------------------------------------------------------------------------------------
-- RETOUR ARRIÈRE (rollback) — à n'exécuter QUE si l'on veut retirer le socle :
--   drop trigger if exists trg_app_settings_touch on public.app_settings;
--   drop function if exists public.app_settings_touch();
--   alter table public.app_settings drop column if exists rev;
--   alter table public.app_settings drop column if exists updated_at;
-- ------------------------------------------------------------------------------------
