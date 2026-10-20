-- ============================================================================
--  DONNÉES — Congés : la table `driver_absences` devient la SOURCE (étape 1 de la
--  migration des réglages vers de vraies tables)
-- ============================================================================
--  Avant : les congés vivaient dans le gros bloc JSON app_settings.data.condConges
--  (un bug d'écriture pouvait effacer TOUS les congés d'un coup). La table
--  driver_absences (migration 20260918) n'en était qu'une copie « au mieux »,
--  remplie par effacement puis réinsertion, sans garantie (écritures perdues
--  possibles, doublons en cas d'écritures simultanées).
--
--  Cette migration ajoute deux fonctions serveur appelées par l'application :
--    • fp_conges_remplacer(société, conducteur, congés) : remplace en UNE
--      transaction tous les congés d'UN conducteur (verrou par conducteur →
--      jamais de doublon ni de mélange entre deux appareils) ;
--    • fp_conges_renommer(société, ancienne clé, nouvelle clé) : suit le
--      renommage d'un conducteur (mêmes règles que FP.migrateCondKey).
--  SECURITY INVOKER : les règles d'accès (RLS) de driver_absences s'appliquent
--  telles quelles → une société ne peut ni lire, ni effacer, ni créer les congés
--  d'une autre.
--
--  Aucune donnée modifiée par ce fichier (fonctions seules). La recopie des congés
--  existants est un fichier séparé : 20261020100100_conges_resynchroniser_table.sql.
--  Idempotent. Testé sur le staging avant la production.
-- ============================================================================

begin;

create or replace function public.fp_conges_remplacer(p_societe text, p_cond_key text, p_conges jsonb)
  returns integer
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  n integer;
begin
  if coalesce(p_societe, '') = '' or coalesce(p_cond_key, '') = '' then
    raise exception 'Congés : société et conducteur obligatoires' using errcode = '22023';
  end if;
  if p_conges is not null and jsonb_typeof(p_conges) <> 'array' then
    raise exception 'Congés : liste attendue' using errcode = '22023';
  end if;
  -- Un seul remplacement à la fois pour un même conducteur (deux appareils en même temps).
  perform pg_advisory_xact_lock(hashtext('fp_conges:' || p_societe || ':' || p_cond_key));

  delete from public.driver_absences where societe = p_societe and cond_key = p_cond_key;

  insert into public.driver_absences (societe, cond_key, debut, fin, motif)
  select p_societe, p_cond_key, (e ->> 'debut')::date, (e ->> 'fin')::date, coalesce(e ->> 'motif', '')
    from jsonb_array_elements(coalesce(p_conges, '[]'::jsonb)) e
   where nullif(e ->> 'debut', '') is not null and nullif(e ->> 'fin', '') is not null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.fp_conges_renommer(p_societe text, p_ancienne text, p_nouvelle text)
  returns integer
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  n integer := 0;
begin
  if coalesce(p_societe, '') = '' or coalesce(p_ancienne, '') = '' or coalesce(p_nouvelle, '') = '' or p_ancienne = p_nouvelle then
    return 0;
  end if;
  -- Verrous dans un ordre fixe (évite un interblocage entre deux renommages croisés).
  perform pg_advisory_xact_lock(hashtext('fp_conges:' || p_societe || ':' || least(p_ancienne, p_nouvelle)));
  perform pg_advisory_xact_lock(hashtext('fp_conges:' || p_societe || ':' || greatest(p_ancienne, p_nouvelle)));

  -- Même règle que FP.migrateCondKey : si la nouvelle clé a déjà des congés, ils sont gardés et ceux
  -- de l'ancienne clé sont abandonnés ; sinon les congés de l'ancienne clé passent sous la nouvelle.
  if exists (select 1 from public.driver_absences where societe = p_societe and cond_key = p_nouvelle) then
    delete from public.driver_absences where societe = p_societe and cond_key = p_ancienne;
  else
    update public.driver_absences set cond_key = p_nouvelle, updated_at = now()
     where societe = p_societe and cond_key = p_ancienne;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.fp_conges_remplacer(text, text, jsonb) from public, anon;
revoke all on function public.fp_conges_renommer(text, text, text) from public, anon;
grant execute on function public.fp_conges_remplacer(text, text, jsonb) to authenticated;
grant execute on function public.fp_conges_renommer(text, text, text) to authenticated;

commit;

-- Vérification : les deux fonctions, exécutables par « authenticated » uniquement.
select p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon_peut,
       has_function_privilege('authenticated', p.oid, 'execute') as connecte_peut
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('fp_conges_remplacer', 'fp_conges_renommer');

-- ============================================================================
--  RETOUR ARRIÈRE (l'ancienne version de l'application n'utilise pas ces fonctions) :
--    drop function if exists public.fp_conges_remplacer(text, text, jsonb);
--    drop function if exists public.fp_conges_renommer(text, text, text);
-- ============================================================================
