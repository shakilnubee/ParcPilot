-- ============================================================================
--  Parc Pilot — STAGING : jeu de données 100 % FICTIVES (aucune donnée réelle)
-- ============================================================================
--  À exécuter UNIQUEMENT sur le projet staging (parc-pilot-staging,
--  ref csvjmzwexszsbowibxut). Le garde-fou ci-dessous refuse de tourner s'il
--  trouve des données de production (société PXP ou ligne app_settings PXP).
--
--  Contenu : deux sociétés de test, TEST-A et TEST-B, avec véhicules,
--  conducteurs, amendes, factures, documents, emprunts, congés et réglages ;
--  + une ligne SANS société (societe NULL), que la RLS actuelle traite comme
--  « PXP » (coalesce(societe,'PXP')) : sert à vérifier qu'elle ne fuit pas vers
--  TEST-A / TEST-B.
--
--  Les comptes de test (auth.users) ne sont PAS créés ici : ils se créent dans
--  Authentication → Users (voir supabase/staging/README.md), puis on rattache
--  leur profil avec le bloc « Profils » en bas de ce fichier.
--
--  Idempotent : supprime d'abord ses propres lignes (préfixe d'id « T- »).
-- ============================================================================

begin;

do $$
begin
  if exists (select 1 from public.vehicules where coalesce(societe, 'PXP') = 'PXP' and id not like 'T-%')
     or exists (select 1 from public.app_settings where id in ('PXP', 'global')) then
    raise exception 'Données de production détectées : ce script ne doit tourner QUE sur le staging.';
  end if;
end $$;

-- Nettoyage des lignes de test précédentes
delete from public.driver_absences where cond_key like 't-%';
delete from public.emprunts    where id like 'T-%';
delete from public.documents   where id like 'T-%';
delete from public.factures    where id like 'T-%';
delete from public.amendes     where id like 'T-%';
delete from public.conducteurs where key like 't-%';
delete from public.vehicules   where id like 'T-%';
delete from public.app_settings where id in ('TEST-A', 'TEST-B');

-- Véhicules (plaques inventées)
insert into public.vehicules (id, immat, marque, modele, statut, km, societe) values
  ('T-A-V1', 'TA-001-AA', 'Peugeot', '208',     'actif',    12000, 'TEST-A'),
  ('T-A-V2', 'TA-002-AA', 'Renault', 'Clio',    'actif',    34000, 'TEST-A'),
  ('T-A-V3', 'TA-003-AA', 'Tesla',   'Model 3', 'à vendre', 81000, 'TEST-A'),
  ('T-B-V1', 'TB-001-BB', 'Citroën', 'C3',      'actif',     5000, 'TEST-B'),
  ('T-B-V2', 'TB-002-BB', 'Dacia',   'Sandero', 'actif',    22000, 'TEST-B'),
  ('T-N-V1', 'TN-001-NN', 'Fiat',    '500',     'actif',     1000, null);   -- sans société (= « PXP » pour la RLS)

-- Conducteurs (noms inventés)
insert into public.conducteurs (key, name, prenom, nom, email, tel, societe) values
  ('t-alice-test', 'Alice Test',  'Alice', 'Test',  'alice@exemple.test', '0600000001', 'TEST-A'),
  ('t-bruno-test', 'Bruno Test',  'Bruno', 'Test',  'bruno@exemple.test', '0600000002', 'TEST-A'),
  ('t-chloe-test', 'Chloé Test',  'Chloé', 'Test',  'chloe@exemple.test', '0600000003', 'TEST-B'),
  ('t-david-test', 'David Test',  'David', 'Test',  'david@exemple.test', '0600000004', 'TEST-B');

-- Amendes
insert into public.amendes (id, date, prenom, motif, montant, statut, numero_avis, immatriculation, societe) values
  ('T-A-AM1', current_date - 20, 'Alice', 'Excès de vitesse (test)', 45, 'à payer', 'TEST0000000001', 'TA-001-AA', 'TEST-A'),
  ('T-B-AM1', current_date - 10, 'Chloé', 'Stationnement (test)',    35, 'payée',   'TEST0000000002', 'TB-001-BB', 'TEST-B');

-- Factures
insert into public.factures (id, date, fournisseur, montant_ttc, societe) values
  ('T-A-F1', current_date - 30, 'Garage Fictif A', 240.00, 'TEST-A'),
  ('T-B-F1', current_date - 15, 'Garage Fictif B', 180.00, 'TEST-B');

-- Documents
insert into public.documents (id, vehicule_id, type, label, url, societe) values
  ('T-A-D1', 'T-A-V1', 'controle-technique', 'CT fictif A', 'https://exemple.test/ct-a.pdf', 'TEST-A'),
  ('T-B-D1', 'T-B-V1', 'controle-technique', 'CT fictif B', 'https://exemple.test/ct-b.pdf', 'TEST-B');

-- Emprunts
insert into public.emprunts (id, emprunteur, date_emprunt, date_retour, societe) values
  ('T-A-E1', 'Bruno Test', current_date - 3, current_date - 1, 'TEST-A'),
  ('T-B-E1', 'David Test', current_date - 2, null,             'TEST-B');

-- Congés (table dédiée)
insert into public.driver_absences (societe, cond_key, debut, fin, motif) values
  ('TEST-A', 't-alice-test', current_date + 10, current_date + 17, 'Congé (test)'),
  ('TEST-B', 't-chloe-test', current_date + 5,  current_date + 9,  'Congé (test)');

-- Réglages par société (une ligne par société, comme en prod)
insert into public.app_settings (id, data) values
  ('TEST-A', jsonb_build_object('societe', jsonb_build_object('nom', 'Société Test A'), 'condConges', jsonb_build_object('t-alice-test', jsonb_build_array(jsonb_build_object('debut', (current_date + 10)::text, 'fin', (current_date + 17)::text))))),
  ('TEST-B', jsonb_build_object('societe', jsonb_build_object('nom', 'Société Test B'), 'condConges', jsonb_build_object('t-chloe-test', jsonb_build_array(jsonb_build_object('debut', (current_date + 5)::text, 'fin', (current_date + 9)::text)))));

commit;

-- Contrôle : nombre de lignes par société
select 'vehicules' as table_, coalesce(societe, '(vide)') as societe, count(*) from public.vehicules group by 1, 2
union all select 'conducteurs', coalesce(societe, '(vide)'), count(*) from public.conducteurs group by 1, 2
union all select 'amendes', coalesce(societe, '(vide)'), count(*) from public.amendes group by 1, 2
union all select 'factures', coalesce(societe, '(vide)'), count(*) from public.factures group by 1, 2
union all select 'app_settings', id, 1 from public.app_settings
order by 1, 2;

-- ============================================================================
--  PROFILS des comptes de test — à lancer APRÈS avoir créé les 2 comptes dans
--  Authentication → Users (adresses ci-dessous). Rattache chaque compte à sa
--  société avec le rôle « admin » (client) — jamais is_admin (= CEO).
-- ============================================================================
-- insert into public.profiles (id, email, societe, is_admin, role)
-- select u.id, u.email, case u.email when 'test-a@parc-pilot.test' then 'TEST-A' else 'TEST-B' end, false, 'admin'
-- from auth.users u where u.email in ('test-a@parc-pilot.test', 'test-b@parc-pilot.test')
-- on conflict (id) do update set societe = excluded.societe, is_admin = false, role = 'admin';
