-- ============================================================================
--  DONNÉES — Geler l'ancienne ligne de réglages « global » (correctif « deux tiroirs »)
-- ============================================================================
--  Constat (16/10/2026) : les réglages de PXP existaient en DEUX lignes app_settings,
--  'PXP' (référence, rev 5651) et 'global' (ancienne ligne historique, rev 153),
--  ÉCRITES TOUTES LES DEUX le même jour. Cause côté code : si la 1re lecture de 'PXP'
--  échouait (coupure réseau), l'appli se rabattait sur 'global' et toute la session
--  y écrivait → deux copies divergentes, des données qui « reviennent ».
--
--  Analyse des écarts (clé par clé, 97 clés) : 79 identiques ; PXP plus complet ou
--  plus récent partout ailleurs (affectations : km réels vs km 0 dans global ; suivi
--  flotte, RDV garage, préférences : PXP ⊇ global). Les seuls éléments propres à
--  'global' sont : 4 états des lieux d'entrée VIDES (km 0, 0 élément) générés
--  automatiquement, 1 tâche automatique de révision (recréée automatiquement), et
--  7 alertes masquées (décision métier laissée au responsable). → 'PXP' reste la
--  référence ; 'global' est conservée INTACTE comme archive.
--
--  PRÉREQUIS : le correctif de code (supabase-client.js sans repli sur 'global',
--  PR « tiroir global/PXP ») doit être DÉPLOYÉ et les utilisateurs avoir rechargé
--  l'appli. Sinon un onglet resté sur l'ancienne version verrait ses écritures
--  refusées (pastille rouge « modification non enregistrée »).
--
--  Ce que fait cette migration : un déclencheur refuse toute création, modification
--  ou suppression de la ligne id = 'global'. AUCUNE donnée n'est modifiée ni supprimée.
--  La ligne reste lisible (restauration manuelle possible : Paramètres → « Récupérer
--  les infos manquantes », réservé au CEO).
--
--  Idempotente. Retour arrière : voir en bas.
-- ============================================================================

begin;

create or replace function public.fp_geler_ligne_global()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if (tg_op = 'DELETE' and old.id = 'global')
     or (tg_op in ('INSERT', 'UPDATE') and new.id = 'global')
     or (tg_op = 'UPDATE' and old.id = 'global') then
    raise exception 'La ligne de réglages « global » est une archive gelée (16/10/2026) : les réglages PXP sont dans la ligne « PXP ». Recharge la page (Ctrl+Maj+R).'
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

-- Nom en « trg_00_… » : les déclencheurs BEFORE s'exécutent par ordre alphabétique →
-- celui-ci passe AVANT l'instantané d'historique et la mise à jour de rev/updated_at.
drop trigger if exists trg_00_geler_ligne_global on public.app_settings;
create trigger trg_00_geler_ligne_global
  before insert or update or delete on public.app_settings
  for each row execute function public.fp_geler_ligne_global();

commit;

-- Contrôle : la ligne existe toujours, intacte, et le déclencheur est en place.
select s.id, s.rev, s.updated_at,
       (select count(*) from jsonb_object_keys(s.data::jsonb)) as nb_cles,
       exists (select 1 from pg_trigger t where t.tgname = 'trg_00_geler_ligne_global') as gel_actif
from public.app_settings s
where s.id in ('global', 'PXP')
order by s.id;

-- ============================================================================
--  RETOUR ARRIÈRE :
--    drop trigger if exists trg_00_geler_ligne_global on public.app_settings;
--    drop function if exists public.fp_geler_ligne_global();
-- ============================================================================
