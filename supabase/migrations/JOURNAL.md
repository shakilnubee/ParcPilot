# Journal des migrations appliquées en production

Chaque migration de ce dossier est appliquée **à la main**, avec un accord explicite, sur le projet
Supabase `tzjuptlzoywjeigmyfuj`. Ce journal garde la trace de **quand**, **par qui** et **avec quel résultat**.
Tant que la Supabase CLI n'est pas en place (Phase 3), c'est la seule source fiable de « ce qui est appliqué ».

| Date (UTC) | Migration | Appliquée par | Sauvegarde préalable | Résultat vérifié |
|---|---|---|---|---|
| 2026-10-16 ~14:50 | `20261016120000_storage_fermer_acces_anonyme.sql` | Claude (accord de François et du responsable) | Sauvegarde quotidienne Supabase du 16/10 06:12 UTC + copie des 8 policies storage (`sauvegarde-policies-storage-2026-10-16.json`, transmise à François) | Policy supprimée : `"scans lecture publique"` (SELECT, rôle `public`). Restent 7 policies `{authenticated}`. `tests/securite/acces-anonyme.mjs` : ✅ aucune donnée accessible sans connexion. |
| 2026-10-16 ~14:55 | `20261016120100_vue_vehicules_public_lecture_seule.sql` | Claude (même accord) | idem (droits avant : anon et authenticated avaient SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER sur la vue) | anon et authenticated : lecture = true, ajout / modification / suppression = false. Lecture QR (`carte.html` → `vehicules_public`) : HTTP 200. |
| 2026-10-16 ~15:33 | `20261016130000_geler_ligne_global.sql` | Claude (accord de François), **après** déploiement de la PR #986 (site en `?v=20261016e`, vérifié en ligne) | Sauvegarde quotidienne du 16/10 06:12 UTC ; aucune donnée modifiée (déclencheur seul) | Déclencheur `trg_00_geler_ligne_global` actif. Ligne `global` conservée intacte (rev 154, dernière écriture 15:17 UTC, 97 clés). Comparaison finale : 96 clés identiques à `PXP`, la seule différence (inspections V-011) est contenue dans `PXP` → rien à récupérer de `global`. Les 7 alertes masquées propres à l'ancienne `global` restent **visibles** dans `PXP` (choix du responsable). |

| 2026-10-17 | `20261017090000_storage_cloisonnement_societes.sql` | Claude (accord de François), après déploiement des PR #985/#987/#988 (site `?v=20261017a`, fonctions serveur redéployées) | Sauvegarde quotidienne Supabase du 17/10 + copie des 7 policies storage (`sauvegarde-policies-storage-2026-10-17.json`, transmise à François) | 4 policies `scans_societe_*` `{authenticated}`. Vérifié avec un compte Gestionnaire PXP : **639/639 fichiers s'ouvrent**. Accès anonyme : toujours fermé. Testé au préalable sur le staging (0 fuite entre sociétés, PXP et CEO conservent leurs accès). |
| 2026-10-17 | `20261017120000_app_settings_anti_vidage.sql` | Claude (accord de François) | Sauvegarde quotidienne Supabase du 17/10 ; déclencheur seul, aucune donnée modifiée | Déclencheur `trg_01_anti_vidage_reglages` actif ; ligne PXP intacte (97 clés). Testé au préalable sur le staging (7/7 cas). |

## Retours arrière
Chaque fichier de migration contient sa procédure de retour arrière en commentaire, en bas du fichier.
