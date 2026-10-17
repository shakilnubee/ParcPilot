-- ============================================================================
--  SÉCURITÉ — Cloisonnement des FICHIERS entre sociétés (bucket « scans »)
--  (audit, constat E1 — bloquant pour le multi-sociétés)
-- ============================================================================
--  Avant : tout compte CONNECTÉ, quelle que soit sa société, pouvait lire,
--  remplacer et supprimer TOUS les fichiers du bucket (permis, cartes grises,
--  avis, contrats, EDL…). Policies : bucket_id = 'scans', sans autre condition.
--
--  Nouveau rangement (code : FP.uploadScan, km-collect, edl-sign) :
--      societes/<dossier-société>/<dossier>/<fichier>
--  où <dossier-société> = public.fp_slug(<nom de la société>)
--      ex. « PXP » → pxp ; « Essaie B » → essaie-b.
--
--  Règle d'accès (fonction public.fp_storage_acces) — un compte connecté peut
--  agir sur un fichier si :
--    1) il est CEO (profiles.is_admin = true) → tout ; OU
--    2) le fichier est rangé dans societes/<SA société>/… ; OU
--    3) le fichier est un ANCIEN fichier (hors du dossier « societes/ ») ET le
--       compte appartient à PXP : les 945 fichiers déposés avant le 17/10/2026
--       appartiennent tous à PXP (seule société ayant des données). Ils restent
--       à leur place → AUCUNE adresse à réécrire en base, aucun lien cassé.
--
--  Ce qui ne change pas : les liens SIGNÉS déjà émis (e-mails, EDL, logos) ;
--  les Edge Functions (clé serveur) ; l'accès anonyme (déjà fermé le 16/10).
--
--  Prérequis : aucun. Si le code n'est pas encore déployé, PXP continue de
--  déposer dans les anciens dossiers (autorisé par la règle 3).
--  Idempotente. Testée d'abord sur le staging (tests/securite/isolation-societes.mjs).
-- ============================================================================

begin;

-- Nom de dossier d'une société : minuscules, tout caractère hors [a-z0-9] → « - ».
-- ⚠️ Doit rester IDENTIQUE à FP.storageSlug (app.js) et à fpSlug (Edge Functions).
create or replace function public.fp_slug(s text)
  returns text
  language sql
  immutable
  set search_path = public
as $$
  select coalesce(nullif(trim(both '-' from regexp_replace(lower(trim(coalesce(s, ''))), '[^a-z0-9]+', '-', 'g')), ''), 'societe')
$$;

-- Droit d'accès d'un compte connecté à un objet du bucket « scans ».
create or replace function public.fp_storage_acces(objet text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select public.fp_is_admin()
      or ((storage.foldername(objet))[1] = 'societes'
          and public.fp_societe() is not null
          and (storage.foldername(objet))[2] = public.fp_slug(public.fp_societe()))
      or (coalesce((storage.foldername(objet))[1], '') <> 'societes'
          and public.fp_societe() = 'PXP')
$$;

revoke all on function public.fp_storage_acces(text) from public, anon;
grant execute on function public.fp_storage_acces(text) to authenticated;

-- Anciennes policies (accès à tout le bucket pour tout compte connecté)
drop policy if exists "scans_auth_read"             on storage.objects;
drop policy if exists "scans_auth_insert"           on storage.objects;
drop policy if exists "scans_auth_update"           on storage.objects;
drop policy if exists "scans_auth_delete"           on storage.objects;
drop policy if exists "scans upload connectes"      on storage.objects;
drop policy if exists "scans maj connectes"         on storage.objects;
drop policy if exists "scans suppression connectes" on storage.objects;

-- Nouvelles policies, cloisonnées par société
drop policy if exists "scans_societe_lecture"      on storage.objects;
drop policy if exists "scans_societe_ajout"        on storage.objects;
drop policy if exists "scans_societe_modification" on storage.objects;
drop policy if exists "scans_societe_suppression"  on storage.objects;

create policy "scans_societe_lecture" on storage.objects
  for select to authenticated
  using (bucket_id = 'scans' and public.fp_storage_acces(name));

create policy "scans_societe_ajout" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'scans' and public.fp_storage_acces(name));

create policy "scans_societe_modification" on storage.objects
  for update to authenticated
  using (bucket_id = 'scans' and public.fp_storage_acces(name))
  with check (bucket_id = 'scans' and public.fp_storage_acces(name));

create policy "scans_societe_suppression" on storage.objects
  for delete to authenticated
  using (bucket_id = 'scans' and public.fp_storage_acces(name));

commit;

-- Contrôle : 4 policies « scans_societe_* », toutes {authenticated} ; plus aucune ancienne.
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- ============================================================================
--  RETOUR ARRIÈRE (rouvre l'accès inter-sociétés) :
--    drop policy if exists "scans_societe_lecture" on storage.objects;
--    drop policy if exists "scans_societe_ajout" on storage.objects;
--    drop policy if exists "scans_societe_modification" on storage.objects;
--    drop policy if exists "scans_societe_suppression" on storage.objects;
--    create policy "scans_auth_read"   on storage.objects for select to authenticated using (bucket_id = 'scans');
--    create policy "scans_auth_insert" on storage.objects for insert to authenticated with check (bucket_id = 'scans');
--    create policy "scans_auth_update" on storage.objects for update to authenticated using (bucket_id = 'scans') with check (bucket_id = 'scans');
--    create policy "scans_auth_delete" on storage.objects for delete to authenticated using (bucket_id = 'scans');
-- ============================================================================
