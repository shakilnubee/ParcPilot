-- ============================================================================
--  DONNÉES — Garde-fou serveur ANTI-VIDAGE des réglages (app_settings)
-- ============================================================================
--  Constat (17/10/2026, observé en direct) : à la connexion, quand le cache du
--  navigateur est vide, l'application part de réglages PAR DÉFAUT (≈ 28 clés,
--  profil vide). Un enregistrement automatique dépose alors en file d'attente une
--  COPIE COMPLÈTE de ces réglages ; si l'utilisateur change de page avant la fin
--  de l'envoi, la copie est renvoyée telle quelle et REMPLACE toute la ligne de la
--  société (97 clés → 28) : congés, affectations, contrats, assurances… effacés.
--  Bloqué ce jour uniquement parce que le compte était « gestionnaire » (garde
--  sur le profil) ; pour un admin / le CEO, rien ne l'arrêtait.
--
--  Ce déclencheur protège CÔTÉ SERVEUR, quel que soit le navigateur ou la version
--  de l'application. Il REFUSE une mise à jour de app_settings qui :
--    1) supprime d'un coup plus de 10 % des clés (au moins 4) d'une ligne qui en
--       compte au moins 10 ;
--    2) vide (ou retire) une collection « précieuse » qui contenait au moins
--       2 éléments (même règle que FP.settings._PRECIOUS côté navigateur :
--       supprimer le DERNIER élément reste possible) ;
--    3) vide le profil de la société (≥ 3 champs → 0).
--  L'écriture refusée reste dans la file du navigateur (pastille rouge) : rien
--  n'est perdu, et le correctif côté code (même lot) supprime la cause.
--
--  Soupape de MAINTENANCE (volontaire, dans une transaction) :
--    begin; set local fp.autoriser_vidage = 'on'; update …; commit;
--
--  Idempotente. Testée sur le staging avant la production.
-- ============================================================================

begin;

create or replace function public.fp_taille_json(v jsonb)
  returns integer
  language sql
  immutable
  set search_path = public
as $$
  select case jsonb_typeof(v)
           when 'object' then (select count(*)::int from jsonb_object_keys(v))
           when 'array'  then jsonb_array_length(v)
           when 'null'   then 0
           when 'string' then case when v #>> '{}' = '' then 0 else 1 end
           else case when v is null then 0 else 1 end
         end
$$;

create or replace function public.fp_anti_vidage_reglages()
  returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  ancien jsonb := case when jsonb_typeof(OLD.data::jsonb) = 'object' then OLD.data::jsonb else '{}'::jsonb end;
  nouveau jsonb := case when jsonb_typeof(NEW.data::jsonb) = 'object' then NEW.data::jsonb else '{}'::jsonb end;
  n_ancien int;
  perdues text[];
  k text;
  precieuses text[] := array[
    'condConges', 'condSortie', 'condArrivee', 'condCarteTotal', 'condBadgeUlys', 'condDocs',
    'affectations', 'assureurs', 'assureurVeh', 'assuranceEcheance', 'assurancePrimes',
    'leasingContrats', 'localeaseContrats', 'loueurs', 'prestatairesPerso', 'prestataires',
    'vehMasse', 'vehNotes', 'vehRestit', 'vehEntree', 'vehCession', 'kmMajDates', 'antiPollDates',
    'controleStatuts', 'amendeMontantPaye', 'amendeMontants', 'docStatus', 'docTypes', 'docExpire',
    'docTrash', 'permisMasque', 'inspections', 'reservations', 'budget', 'budgets', 'objectifs',
    'pointsManuel', 'vehCarteCarb', 'vehBadge', 'vehCarteCarbExp', 'vehBadgeExp', 'vehFournCarb',
    'rapprIgnore', 'tfAnomOk', 'ignores', 'sinistreStage', 'sinistreStatut', 'sinistreGroupes',
    'sinistreAssurance', 'sinistreDossiers', 'zoneNotes', 'corbeille',
    'taches', 'contratsCadre', 'archiveDocs', 'checklistDone', 'checklistModeles'];
begin
  if coalesce(current_setting('fp.autoriser_vidage', true), '') = 'on' then
    return NEW;   -- maintenance volontaire
  end if;

  -- 1) Disparition massive de clés
  select count(*)::int into n_ancien from jsonb_object_keys(ancien);
  select array_agg(c order by c) into perdues
    from jsonb_object_keys(ancien) c where not (nouveau ? c);
  if n_ancien >= 10 and coalesce(array_length(perdues, 1), 0) > greatest(3, n_ancien / 10) then
    raise exception 'Enregistrement refusé : il aurait supprimé % réglages sur % (%…). Recharge la page (Ctrl+Maj+R) puis réessaie.',
      array_length(perdues, 1), n_ancien, array_to_string(perdues[1:5], ', ')
      using errcode = 'P0001', hint = 'Garde-fou anti-vidage (app_settings).';
  end if;

  -- 2) Vidage d'une collection précieuse
  foreach k in array precieuses loop
    if public.fp_taille_json(ancien -> k) >= 2 and public.fp_taille_json(nouveau -> k) = 0 then
      raise exception 'Enregistrement refusé : la liste « % » (% éléments) aurait été vidée d''un coup. Recharge la page (Ctrl+Maj+R) puis réessaie.',
        k, public.fp_taille_json(ancien -> k)
        using errcode = 'P0001', hint = 'Garde-fou anti-vidage (app_settings).';
    end if;
  end loop;

  -- 3) Vidage du profil de la société
  if public.fp_taille_json(ancien -> 'profil') >= 3 and public.fp_taille_json(nouveau -> 'profil') = 0 then
    raise exception 'Enregistrement refusé : le profil de la société aurait été vidé. Recharge la page (Ctrl+Maj+R) puis réessaie.'
      using errcode = 'P0001', hint = 'Garde-fou anti-vidage (app_settings).';
  end if;

  return NEW;
end $$;

-- « trg_01_… » : passe après le gel de la ligne « global » (trg_00_…) et AVANT l'instantané
-- d'historique et la mise à jour de rev/updated_at (déclencheurs BEFORE exécutés par ordre alphabétique).
drop trigger if exists trg_01_anti_vidage_reglages on public.app_settings;
create trigger trg_01_anti_vidage_reglages
  before update on public.app_settings
  for each row execute function public.fp_anti_vidage_reglages();

commit;

select tgname from pg_trigger
where tgrelid = 'public.app_settings'::regclass and not tgisinternal
order by tgname;

-- ============================================================================
--  RETOUR ARRIÈRE :
--    drop trigger if exists trg_01_anti_vidage_reglages on public.app_settings;
--    drop function if exists public.fp_anti_vidage_reglages();
--    drop function if exists public.fp_taille_json(jsonb);
-- ============================================================================
