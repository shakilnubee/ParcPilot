-- ============================================================
--  reservations — RÉSERVATION DE VÉHICULES (demande publique par lien sécurisé OU interne)
--
--  Phase 3 de la roadmap. 1 réservation = 1 ligne. Isolation par société via RLS (patron
--  driver_absences / dossiers_achat). La société est portée par la LIGNE (colonne societe),
--  résolue côté serveur depuis le token du lien public (jamais exposée dans l'URL).
--
--  ⚠️ Anti double-réservation : la DISPONIBILITÉ est vérifiée CÔTÉ SERVEUR au moment de la
--  confirmation (edge function), pas seulement dans le navigateur. Les créneaux se comparent par
--  CHEVAUCHEMENT (debut < autre.fin ET fin > autre.debut) sur les réservations CONFIRMÉES.
--
--  Statuts : en_attente (demande reçue) / confirmee / refusee / annulee / terminee / bloc (créneau
--  bloqué manuellement par le gestionnaire, sans demandeur).
--
--  À lancer UNE FOIS par environnement : Supabase → SQL Editor → coller → Run. Idempotent.
--  STAGING d'abord (CI migration-staging.yml), PRODUCTION seulement avec accord + sauvegarde vérifiée.
--
--  RETOUR ARRIÈRE (rollback) — à exécuter manuellement si besoin :
--    drop policy if exists tenant_reservations on public.reservations;
--    drop policy if exists reservations_insert_anon on public.reservations;
--    drop index if exists reservations_soc_veh_idx;
--    drop table if exists public.reservations;
-- ============================================================

create table if not exists public.reservations (
  id              text primary key,             -- id généré (ex. 'RES-<rand>')
  societe         text not null,                -- isolation par société (= app_settings.id)
  vehicule_id     text,                         -- véhicule réservé (id flotte)
  immat           text default '',              -- plaque (repli d'affichage / rapprochement)
  demandeur_nom   text default '',
  demandeur_email text default '',
  demandeur_tel   text default '',
  motif           text default '',
  debut           timestamptz not null,         -- début du créneau (date + heure combinées)
  fin             timestamptz not null,         -- fin du créneau
  statut          text not null default 'en_attente',
  verifie         boolean default false,        -- e-mail du demandeur confirmé par code
  source          text default 'public',        -- 'public' (lien) | 'interne' (gestionnaire) | 'bloc'
  notes           text default '',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  deleted_at      timestamptz                   -- soft-delete
);

create index if not exists reservations_soc_veh_idx on public.reservations (societe, vehicule_id);
create index if not exists reservations_soc_deb_idx on public.reservations (societe, debut);

grant all on public.reservations to authenticated;
alter table public.reservations enable row level security;

-- Lecture/gestion : réservée aux membres de la société (gestionnaires connectés). Patron tenant habituel.
drop policy if exists tenant_reservations on public.reservations;
create policy tenant_reservations on public.reservations
  for all to authenticated
  using      (fp_is_admin() or coalesce(societe, 'PXP') = fp_societe())
  with check  (fp_is_admin() or coalesce(societe, 'PXP') = fp_societe());

-- ⚠️ PAS de policy anon ici : les demandes publiques passent par l'EDGE FUNCTION (service_role), qui
--    valide le token, borne les champs et vérifie la disponibilité AVANT d'insérer. L'anonyme n'écrit
--    JAMAIS en direct dans cette table (contrairement à prospects) → pas de fuite ni d'abus possible.

-- Vérif : doit lister la policy
select tablename, policyname, cmd from pg_policies where tablename = 'reservations';
