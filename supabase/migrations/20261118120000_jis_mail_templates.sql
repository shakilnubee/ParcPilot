-- ============================================================
--  jis_mail_templates — MODÈLES D'E-MAILS PERSONNELS DU CEO (JIS / Parc Pilot)
--
--  Stocke les modèles d'e-mails que le propriétaire (CEO) crée lui-même, et ses
--  VERSIONS MODIFIÉES ("override") des 12 modèles intégrés de l'onglet
--  « E-mails & modèles » (onboarding.html). Les 12 modèles d'usine restent dans le
--  code : cette table ne garde QUE les perso + les surcharges → synchronisés sur
--  tous les appareils du CEO.
--
--  ⚠️ RÉSERVÉ AU CEO : RLS = owner = auth.uid() ET fp_role() = 'ceo'. Scopé par
--  utilisateur (pas par société) : ce sont les modèles commerciaux du propriétaire,
--  pas des données client. Aucune table existante n'est touchée.
--
--  À lancer UNE FOIS par environnement : Supabase → SQL Editor → coller → Run. Idempotent.
--  STAGING d'abord (CI migration-staging.yml), PRODUCTION seulement avec accord + sauvegarde vérifiée.
--
--  RETOUR ARRIÈRE (rollback) — à exécuter manuellement si besoin :
--    drop policy if exists ceo_jis_mail_templates on public.jis_mail_templates;
--    drop table  if exists public.jis_mail_templates;
-- ============================================================

create table if not exists public.jis_mail_templates (
  id          text primary key,                  -- 'JMT-<rand>' (perso) OU l'id du modèle intégré (surcharge)
  owner       uuid not null default auth.uid(),  -- le CEO propriétaire
  kind        text not null default 'custom',    -- 'custom' | 'override'
  builtin_id  text,                              -- si override : l'id du modèle d'usine ('prospect-1'…)
  name        text not null default '',
  categorie   text not null default 'comm',      -- prospection|proposition|onboarding|relation|comm
  objet       text not null default '',
  corps       text not null default '',
  pieces      jsonb default '[]'::jsonb,          -- pièces jointes associées (gestion des docs perso, plus tard)
  position    int  default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  deleted_at  timestamptz                        -- soft-delete (archivage — jamais de perte)
);

create index if not exists jis_mail_templates_owner_idx on public.jis_mail_templates (owner);

grant all on public.jis_mail_templates to authenticated;
alter table public.jis_mail_templates enable row level security;

drop policy if exists ceo_jis_mail_templates on public.jis_mail_templates;
create policy ceo_jis_mail_templates on public.jis_mail_templates
  for all to authenticated
  using      (owner = auth.uid() and fp_role() = 'ceo')
  with check (owner = auth.uid() and fp_role() = 'ceo');

-- Vérif : doit lister la policy
select tablename, policyname, cmd from pg_policies where tablename = 'jis_mail_templates';
