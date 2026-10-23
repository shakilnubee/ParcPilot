-- ============================================================================
--  SÉCURITÉ — QR public : ne révéler QUE le véhicule scanné (pas toute la flotte)
--  (audit 2026-10-23, gravité moyenne — accord utilisateur du 2026-10-23)
-- ============================================================================
--  Contexte : la page publique carte.html (QR collé dans un véhicule) lit la vue
--  public.vehicules_public avec la clé publishable, TOUJOURS filtrée sur UNE plaque.
--  Mais la vue accorde SELECT à `anon` SANS filtre → une requête API anonyme
--  « /rest/v1/vehicules_public?select=* » renvoie TOUTE la flotte (toutes sociétés).
--  Les champs exposés ne sont pas sensibles (choix assumé, cf. 20261016120100), mais
--  livrer l'annuaire complet du parc en un seul appel n'est pas souhaitable avant
--  d'onboarder d'autres clients.
--
--  Correctif : on expose une FONCTION (RPC) « vehicule_public_par_plaque(p_immat) »
--  SECURITY DEFINER qui renvoie UNE SEULE ligne — la plaque demandée, normalisée
--  (min/maj, tirets, espaces = pareil, comme FP.normImmat) — et on RETIRE le SELECT
--  direct de anon/authenticated sur la vue. L'anonyme ne peut donc PLUS lister le
--  parc : il doit connaître la plaque exacte. carte.html appelle la RPC (repli sur
--  la vue puis sur le snapshot public data.js tant que la base n'a pas la RPC).
--
--  Pas de fuite inter-sociétés : la RPC ne renvoie que la ligne dont la plaque
--  correspond (les mêmes champs publics que la vue), jamais une liste.
--
--  Idempotente : `create or replace` + revoke/grant rejouables, et le tout est gardé
--  si la vue n'existe pas encore (ex. base de staging sans la vue manuelle).
--  Retour arrière en bas.
-- ============================================================================

do $mig$
begin
  if to_regclass('public.vehicules_public') is null then
    raise notice 'vue public.vehicules_public absente — migration QR ignorée (environnement sans la vue)';
    return;
  end if;

  -- RPC : une seule ligne, par plaque normalisée. SECURITY DEFINER pour lire la vue
  -- (qui, elle, lit la table en tant que propriétaire) sans donner d'accès direct à anon.
  execute $ddl$
    create or replace function public.vehicule_public_par_plaque(p_immat text)
    returns setof public.vehicules_public
    language sql
    stable
    security definer
    set search_path = public
    as $fn$
      select *
      from public.vehicules_public
      where coalesce(p_immat, '') <> ''
        and upper(regexp_replace(coalesce(immat, ''), '[^A-Za-z0-9]', '', 'g'))
          = upper(regexp_replace(p_immat,               '[^A-Za-z0-9]', '', 'g'))
      limit 1;
    $fn$;
  $ddl$;

  -- Seul EXECUTE de la RPC est public ; plus aucun SELECT en masse sur la vue.
  revoke all     on function public.vehicule_public_par_plaque(text) from public;
  grant  execute on function public.vehicule_public_par_plaque(text) to anon, authenticated;

  revoke select on public.vehicules_public from anon, authenticated;
end
$mig$;

-- Contrôle : attendu →
--   • anon/authenticated : lecture directe de la vue = false ;
--   • EXECUTE de la RPC = true ;
--   • la RPC renvoie exactement 0 ou 1 ligne.
select
  has_table_privilege('anon',          'public.vehicules_public', 'SELECT')               as vue_lecture_anon,
  has_function_privilege('anon',        'public.vehicule_public_par_plaque(text)', 'EXECUTE') as rpc_exec_anon;

-- ============================================================================
--  RETOUR ARRIÈRE (ré-ouvre la lecture en masse de la vue, déconseillé) :
--    grant select on public.vehicules_public to anon, authenticated;
--    drop function if exists public.vehicule_public_par_plaque(text);
-- ============================================================================
