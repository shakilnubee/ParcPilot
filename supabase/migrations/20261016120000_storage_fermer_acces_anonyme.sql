-- ============================================================================
--  SÉCURITÉ — Fermer l'accès ANONYME au bucket de stockage « scans »
--  (audit Phase 0, constat C1 — critique)
-- ============================================================================
--  Problème constaté le 16/10/2026 (test REST en lecture seule) :
--    sans être connecté, avec la seule clé PUBLIQUE (sb_publishable_…, visible
--    dans le code), on peut LISTER et TÉLÉCHARGER les fichiers du bucket
--    « scans » : permis de conduire, cartes grises, avis d'amende, contrats…
--
--  Cause probable : une ancienne policy de lecture créée SANS « to authenticated »
--  (donc valable aussi pour le rôle anonyme), jamais supprimée :
--    • "scans lecture publique"  (supabase-storage.sql)
--    • "scans_read"              (supabase/storage-scans-bucket.sql)
--  Le script supabase/storage-scans-prive.sql a bien passé le bucket en privé,
--  mais une policy de lecture ouverte au rôle « public » laisse quand même passer
--  les appels anonymes (liste + création de liens signés).
--
--  Ce que fait cette migration :
--    1) S'ASSURE que les utilisateurs CONNECTÉS gardent leurs droits (lecture,
--       ajout, modification, suppression) — on crée les policies « authenticated »
--       si elles n'existent pas encore → l'application continue de fonctionner.
--    2) SUPPRIME toute policy du bucket « scans » qui s'applique aux rôles
--       « public » ou « anon » (= accès sans connexion).
--    3) Affiche la liste des policies supprimées (onglet « Messages » / NOTICE)
--       et l'état final, pour vérification.
--
--  Ce qui N'EST PAS touché :
--    • les fichiers eux-mêmes (aucun fichier supprimé ni déplacé) ;
--    • les liens SIGNÉS déjà envoyés (e-mails d'amende, EDL…) : ils reposent sur
--      un jeton, pas sur ces policies → ils continuent de marcher ;
--    • les Edge Functions (elles utilisent la clé serveur, non concernée par la RLS) ;
--    • le cloisonnement ENTRE SOCIÉTÉS des utilisateurs connectés (constat E1) :
--      traité dans une migration séparée, car il faut d'abord préfixer les chemins.
--
--  Effet visible attendu : les très anciens liens « parc-pilot.fr/avis.html?… »
--  (e-mails d'amende envoyés AVANT le 03/08/2026) affichent « Impossible d'ouvrir
--  l'avis — lien invalide ou expiré ». Depuis le 03/08, les e-mails joignent l'avis
--  en pièce jointe + un lien signé, non concernés.
--
--  Idempotente : peut être relancée sans risque.
--  Vérification après application : node tests/securite/acces-anonyme.mjs
-- ============================================================================

begin;

-- 1) Droits des utilisateurs connectés (créés seulement s'ils manquent) ---------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'scans_auth_read') then
    create policy "scans_auth_read" on storage.objects
      for select to authenticated using (bucket_id = 'scans');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'scans_auth_insert') then
    create policy "scans_auth_insert" on storage.objects
      for insert to authenticated with check (bucket_id = 'scans');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'scans_auth_update') then
    create policy "scans_auth_update" on storage.objects
      for update to authenticated using (bucket_id = 'scans') with check (bucket_id = 'scans');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'scans_auth_delete') then
    create policy "scans_auth_delete" on storage.objects
      for delete to authenticated using (bucket_id = 'scans');
  end if;
end $$;

-- 2) Suppression de tout accès « public » / « anon » au bucket scans ------------
do $$
declare
  p record;
begin
  for p in
    select policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and roles && array['public', 'anon']::name[]
      and (coalesce(qual, '') ilike '%scans%' or coalesce(with_check, '') ilike '%scans%')
  loop
    raise notice 'Policy supprimée : "%" (%, rôles %) using=% check=%',
      p.policyname, p.cmd, p.roles, p.qual, p.with_check;
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

-- Le bucket doit rester privé (pas d'URL « /object/public/… »).
update storage.buckets set public = false where id = 'scans' and public is distinct from false;

commit;

-- 3) État final, pour contrôle visuel -------------------------------------------
--    Attendu : uniquement des policies « {authenticated} » pour le bucket scans.
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (coalesce(qual, '') ilike '%scans%' or coalesce(with_check, '') ilike '%scans%')
order by policyname;

-- ============================================================================
--  RETOUR ARRIÈRE (à n'utiliser qu'en cas de problème bloquant, et en sachant
--  que cela ROUVRE la fuite) : recréer la policy supprimée telle qu'affichée
--  dans les NOTICE ci-dessus. Pour l'ancienne policy la plus probable :
--
--    create policy "scans lecture publique" on storage.objects
--      for select using (bucket_id = 'scans');
-- ============================================================================
