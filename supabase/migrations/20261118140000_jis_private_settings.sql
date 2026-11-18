-- ============================================================
--  jis_private_settings — RÉGLAGES PRIVÉS DU PROPRIÉTAIRE (JIS / CEO)
--
--  Stocke des données STRICTEMENT propres au propriétaire de la plateforme et
--  qui n'appartiennent à AUCUNE société cliente — à commencer par la
--  FACTURATION DES CLIENTS (forfaits, actif, paiements), aujourd'hui logée dans
--  `app_settings` id='jis_billing'.
--
--  ⚠️ POURQUOI CETTE TABLE (faille corrigée) : `app_settings` est protégée par
--  la policy `tenant_app_settings` = `fp_is_admin() OR id = fp_societe()`. Comme
--  `fp_is_admin()` est vrai pour un **admin de n'importe quelle société cliente**,
--  la ligne `jis_billing` (qui n'est pas une société) était lisible ET modifiable
--  par TOUT admin client → fuite des prix/paiements de tous les clients. Ici la
--  RLS est **réservée au CEO** : `owner = auth.uid() AND fp_role() = 'ceo'`.
--
--  Modèle clé/valeur : 1 ligne par clé (ex. id='billing'), valeur jsonb.
--  Scopée par propriétaire (pas par société) : ce sont les données du CEO.
--  Aucune table existante n'est touchée ; la ligne `app_settings` jis_billing est
--  conservée (repli + source de la recopie initiale), JAMAIS supprimée ici.
--
--  À lancer UNE FOIS par environnement : Supabase → SQL Editor → coller → Run. Idempotent.
--  STAGING d'abord (CI migration-staging.yml), PRODUCTION seulement avec accord + sauvegarde vérifiée.
--
--  RETOUR ARRIÈRE (rollback) — à exécuter manuellement si besoin :
--    drop policy if exists ceo_jis_private_settings on public.jis_private_settings;
--    drop table  if exists public.jis_private_settings;
-- ============================================================

create table if not exists public.jis_private_settings (
  id          text primary key,                  -- clé logique (ex. 'billing')
  owner       uuid not null default auth.uid(),  -- le CEO propriétaire
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz default now()
);

create index if not exists jis_private_settings_owner_idx on public.jis_private_settings (owner);

grant all on public.jis_private_settings to authenticated;
alter table public.jis_private_settings enable row level security;

drop policy if exists ceo_jis_private_settings on public.jis_private_settings;
create policy ceo_jis_private_settings on public.jis_private_settings
  for all to authenticated
  using      (owner = auth.uid() and fp_role() = 'ceo')
  with check (owner = auth.uid() and fp_role() = 'ceo');

-- Vérif : doit lister la policy
select tablename, policyname, cmd from pg_policies where tablename = 'jis_private_settings';
