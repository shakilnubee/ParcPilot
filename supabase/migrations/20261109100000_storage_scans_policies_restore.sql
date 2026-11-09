-- ============================================================================
--  STOCKAGE « scans » — restauration de l'état d'accès correct (bucket + RLS +
--  fonctions de cloisonnement + policies par société)
-- ----------------------------------------------------------------------------
--  Contexte : les dépôts de documents (courriers de sinistre, etc.) échouaient
--  (fichier jamais stocké → « Object not found » à l'ouverture) et l'ajout restait
--  bloqué. Cette migration RÉ-AFFIRME, de façon IDEMPOTENTE, tout ce dont dépend
--  l'upload/lecture d'un fichier du bucket privé « scans », pour réparer un
--  éventuel « drift » en production (policy supprimée, RLS désactivée, restriction
--  de type MIME bloquant les PDF, bucket repassé en public, etc.) SANS affaiblir
--  l'isolation multi-sociétés déjà en place (cf. 20261017090000).
--
--  Ce qui est (ré)assuré, rien de plus :
--   1) le bucket « scans » EXISTE et reste PRIVÉ (public = false) ; il accepte les
--      PDF et images (allowed_mime_types = NULL → l'app valide déjà les types) et
--      une taille de fichier généreuse (≥ 50 Mo ; on ne RABAISSE jamais une limite
--      déjà plus haute) ;
--   2) RLS ACTIVÉE sur storage.objects ;
--   3) fonctions de cloisonnement public.fp_slug / public.fp_storage_acces
--      (définitions IDENTIQUES à la migration du 17/10 — rejouées) ;
--   4) les 4 policies « scans_societe_* » (SELECT/INSERT/UPDATE/DELETE), réservées
--      au rôle {authenticated} et cloisonnées par société.
--
--  N'OUVRE RIEN à l'anonyme (accès anon fermé le 16/10, inchangé). Ne réécrit AUCUNE
--  donnée (aucune ligne vehicules/factures/documents touchée). 100 % idempotente.
--  Testée d'abord sur le STAGING (migration-staging.yml + tests/securite/
--  isolation-societes.mjs). Appliquée en PROD uniquement sur accord + sauvegarde
--  vérifiée, puis notée dans supabase/migrations/JOURNAL.md.
-- ============================================================================

begin;

-- 1) Bucket « scans » : présent + PRIVÉ + accepte PDF/images + taille généreuse.
--    (on conflict : on garde privé, on n'impose pas de restriction MIME, on ne
--     rabaisse jamais une limite de taille déjà supérieure.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scans', 'scans', false, 52428800, null)
on conflict (id) do update set
  public             = false,
  allowed_mime_types = null,
  file_size_limit    = greatest(coalesce(storage.buckets.file_size_limit, 0), 52428800);

-- 2) RLS active sur storage.objects (sinon les policies ne s'appliquent pas).
--    ⚠️ storage.objects appartient à « supabase_storage_admin » (PAS au rôle de
--    connexion des migrations) : un « alter table storage.objects … » lève
--    « must be owner of table objects » (42501). Or, sur Supabase, la RLS est
--    DÉJÀ activée par défaut sur storage.objects. On ne tente donc l'activation
--    QUE si elle est réellement désactivée (drift), et on tolère l'absence de
--    droit (NOTICE) pour rester rejouable par le runner de staging comme par
--    l'éditeur SQL du dashboard (rôle propriétaire) en production.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    begin
      execute 'alter table storage.objects enable row level security';
    exception when insufficient_privilege then
      raise notice 'RLS storage.objects désactivée mais rôle non-propriétaire — à réactiver via le dashboard (supabase_storage_admin).';
    end;
  end if;
end $$;

-- 3) Fonctions de cloisonnement (IDENTIQUES à 20261017090000 — re-affirmées).
--    Nom de dossier d'une société : minuscules, [^a-z0-9] → « - ». DOIT rester
--    identique à FP.storageSlug (app.js) et fpSlug (Edge Functions).
create or replace function public.fp_slug(s text)
  returns text
  language sql
  immutable
  set search_path = public
as $$
  select coalesce(nullif(trim(both '-' from regexp_replace(lower(trim(coalesce(s, ''))), '[^a-z0-9]+', '-', 'g')), ''), 'societe')
$$;

-- Droit d'accès d'un compte connecté à un objet du bucket « scans » :
--   CEO (profiles.is_admin) → tout ; OU fichier dans societes/<SA société>/… ;
--   OU ancien fichier (hors « societes/ ») ET compte PXP (historique < 17/10).
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

-- 4) Policies « scans_societe_* » (SELECT/INSERT/UPDATE/DELETE), authenticated,
--    cloisonnées par société. On repart propre (drop if exists + recreate).
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

-- Contrôles (après application) :
--   a) le bucket est privé et sans restriction MIME :
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'scans';
--   b) les 4 policies « scans_societe_* » existent, toutes {authenticated} :
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'scans\_societe\_%'
order by policyname;

-- ============================================================================
--  RETOUR ARRIÈRE : cette migration ne fait que RESTAURER l'état attendu ; il n'y
--  a normalement rien à annuler. Si besoin de revenir à l'état d'isolation
--  antérieur, se référer au bloc « RETOUR ARRIÈRE » de 20261017090000. Ne JAMAIS
--  remettre une policy ouverte à {anon} ni repasser le bucket en public (cela
--  rouvrirait des failles corrigées les 16 et 17/10).
-- ============================================================================
