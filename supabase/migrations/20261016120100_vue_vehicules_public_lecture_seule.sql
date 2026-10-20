-- ============================================================================
--  SÉCURITÉ — La vue « vehicules_public » (QR codes) devient LECTURE SEULE
--  (audit Phase 1, 16/10/2026 — critique)
-- ============================================================================
--  Contexte : la page publique carte.html (ouverte en scannant le QR code collé
--  dans un véhicule) lit la vue public.vehicules_public avec la clé publique.
--  Le responsable confirme que ces informations (plaque, marque, modèle,
--  catégorie, carburant, km, prochain CT, date de mise en circulation, statut,
--  version) n'ont PAS vocation à être privées → la LECTURE reste publique.
--
--  Problème constaté dans le catalogue :
--    • la vue appartient à « postgres » et n'a pas security_invoker → elle
--      s'exécute avec les droits du propriétaire et CONTOURNE la RLS ;
--    • elle est « auto-modifiable » (simple SELECT sur une table) :
--      is_updatable = YES, is_insertable_into = YES ;
--    • les rôles anon et authenticated ont TOUS les droits dessus
--      (SELECT, INSERT, UPDATE, DELETE, TRUNCATE…) — droits par défaut Supabase.
--  ⇒ n'importe qui, SANS connexion, pouvait en théorie modifier ou supprimer
--    des véhicules (toutes sociétés) au travers de cette vue.
--
--  Correctif : on retire tous les droits sauf la LECTURE. carte.html ne fait
--  que des GET → aucun impact. L'application connectée ne passe jamais par
--  cette vue (elle lit/écrit la table vehicules, protégée par la RLS).
--
--  Idempotente. Retour arrière : voir en bas.
-- ============================================================================

begin;

revoke insert, update, delete, truncate, references, trigger
  on public.vehicules_public from anon, authenticated, public;

grant select on public.vehicules_public to anon, authenticated;

commit;

-- Contrôle : attendu → lecture = true, toutes les écritures = false.
select r.rolname as role,
       has_table_privilege(r.rolname, 'public.vehicules_public', 'SELECT') as lecture,
       has_table_privilege(r.rolname, 'public.vehicules_public', 'INSERT') as ajout,
       has_table_privilege(r.rolname, 'public.vehicules_public', 'UPDATE') as modification,
       has_table_privilege(r.rolname, 'public.vehicules_public', 'DELETE') as suppression
from pg_roles r
where r.rolname in ('anon', 'authenticated')
order by r.rolname;

-- ============================================================================
--  RETOUR ARRIÈRE (rouvre la faille, déconseillé) :
--    grant insert, update, delete, truncate, references, trigger
--      on public.vehicules_public to anon, authenticated;
-- ============================================================================
