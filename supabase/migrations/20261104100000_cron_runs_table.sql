-- =====================================================================================
-- 20261104100000_cron_runs_table.sql
-- Audit F22/F23 — SUPERVISION des tâches planifiées (lecture seule).
--
-- Petite table d'historique des exécutions des Edge Functions planifiées (km-relance,
-- ulys-daily, task-reminders). Chaque run y écrit UNE ligne (best-effort, jamais bloquant).
-- Un écran « Tâches automatiques — dernière exécution » (Paramètres → Notifications) la lit.
--
-- ⚠️ 100 % ADDITIF. Table neuve uniquement — aucune donnée existante touchée. Tant qu'elle
-- n'existe pas en prod, les Edge Functions continuent EXACTEMENT comme avant (leur écriture
-- de log est enveloppée dans un try/catch → un POST 404 est ignoré).
--
-- Contenu VOLONTAIREMENT non sensible : nom du job, statut, horodatages et des COMPTEURS
-- GLOBAUX (envoyés/ignorés/échecs) — PAS de nom de société, PAS de donnée personnelle →
-- la lecture peut être ouverte à tout utilisateur authentifié (santé plateforme partagée).
--
-- Testée automatiquement sur le STAGING (migration-staging.yml). PRODUCTION = manuelle.
-- =====================================================================================

create table if not exists public.cron_runs (
  id          bigint generated always as identity primary key,
  job         text        not null,                          -- 'km-relance' | 'ulys-daily' | 'task-reminders'
  status      text        not null default 'ok',             -- 'ok' | 'error'
  started_at  timestamptz,                                   -- début du run (si connu)
  finished_at timestamptz not null default now(),            -- fin du run
  detail      jsonb       not null default '{}'::jsonb,      -- compteurs globaux + message d'erreur éventuel
  created_at  timestamptz not null default now()
);

create index if not exists idx_cron_runs_job on public.cron_runs (job, finished_at desc);

alter table public.cron_runs enable row level security;

-- Lecture : tout utilisateur authentifié (gestionnaire inclus) → supervision partagée.
drop policy if exists cron_runs_read on public.cron_runs;
create policy cron_runs_read on public.cron_runs
  for select to authenticated
  using (true);

-- Écriture : réservée au service_role (les Edge Functions l'utilisent → bypass RLS).
-- Donc AUCUNE policy insert/update/delete pour `authenticated` : un compte client ne peut pas
-- écrire ni falsifier l'historique des runs.

-- ------------------------------------------------------------------------------------
-- (Optionnel) Purge de rétention — à lancer plus tard si la table grossit (≈ 3 lignes/jour) :
--   delete from public.cron_runs where finished_at < now() - interval '180 days';
-- ------------------------------------------------------------------------------------
-- RETOUR ARRIÈRE (rollback) :
--   drop table if exists public.cron_runs;
-- ------------------------------------------------------------------------------------
