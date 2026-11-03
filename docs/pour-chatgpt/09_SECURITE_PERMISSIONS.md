# 09 — Sécurité & permissions

> Instantané 03/11/2026, lecture seule. Légende `[VÉRIFIÉ]` / `[DOC]` / `[HYPOTHÈSE]`. Aucun secret/donnée perso ici.

## 1. Rôles & source de vérité
Le rôle et la société qui **font autorité** vivent dans la table **`profiles`** (`is_admin`, `role`, `societe`) — **jamais** dans `user_metadata` (falsifiable). `[DOC: CLAUDE.md]` `[VÉRIFIÉ: roles-ceo-admin-gestionnaire.sql]`

| Rôle (`fp_role()`) | Portée | Helpers côté app |
|---|---|---|
| **ceo** (`is_admin=true`) | **Toutes** sociétés, tout | `FP.isCEO`, `FP.isSuperAdmin` (2587/2554) |
| **admin** (`role='admin'`, sa société) | Sa société : tout + config + comptes | `FP.isAdmin` (=ceo||admin, 2558) |
| **gestionnaire** (`role='gestionnaire'`) | Sa société : données (ajoute/modifie/**supprime**) ; **pas** config société ni comptes | `FP.isGestionnaire` (2555) |
| **chauffeur** | Portail salarié (dormant) | `FP.isChauffeur`, `FP.chauffeurImmats` (2556/2561) |

Gardes d'interface : `FP.canManageSociete()` (config, 2589), `FP.canManageUsers()` (comptes, 2593), `gateParamForGestionnaire` (masque la config aux gestionnaires dans `parametres.html`). `[VÉRIFIÉ]`

## 2. Authentification
- Supabase Auth email/mot de passe (`login.html` : `signInWithPassword`, « Se souvenir de moi » = `fp_remember_me`, mot de passe oublié, reprise liens `recovery`/`invite`). `[VÉRIFIÉ]`
- **Garde d'auth synchrone** dans le `<head>` de chaque page protégée (token `sb-tzjuptlzoywjeigmyfuj-auth-token`, redirection `login.html`, tolérante hors-ligne). `FP.auth.requireAuth`. `[VÉRIFIÉ]`
- Purge du profil en cache au changement d'utilisateur (`fp_profile`/`fp_societe`/`fp_email`/caches données), **fail-closed**. `[VÉRIFIÉ: supabase-client.js]`
- ⚠️ **Jamais** de mot de passe stocké côté client (même base64 = réversible) ; la persistance = session Supabase. `[DOC]`

## 3. RLS & isolation multi-sociétés (défense en profondeur)
- RLS activée sur les tables de données ; patron `tenant_<table>` : `using/with check ( fp_is_admin() OR coalesce(societe,'PXP') = fp_societe() )` → **filtrage en base**, pas seulement à l'affichage. `[VÉRIFIÉ: multi-societe-rls.sql]`
- Fonctions SECURITY DEFINER `fp_is_admin()`/`fp_societe()`/`fp_role()` lisent `profiles` sans boucler sur la RLS. `[VÉRIFIÉ]`
- Côté client, filtrage complémentaire `filterSociete()`/`stampSociete()` (localStorage `fp_societe`) + caches **suffixés par société** (`fp_data_cache_v4_<societe>`…). `[VÉRIFIÉ]`
- `profiles` : seule policy `profiles_self_read` ; **aucune écriture** → seule la fonction serveur `manage-users` (service_role) écrit rôle/société (anti-escalade de privilèges). `[VÉRIFIÉ]`

## 4. Accès publics (surface d'attaque maîtrisée)
| Surface | Protection |
|---|---|
| QR véhicule (`carte.html`) | RPC `vehicule_public_par_plaque` (1 ligne/plaque) ; SELECT direct retiré à anon → impossible de lister tout le parc. `[VÉRIFIÉ]` |
| Portail conducteur (`v.html`, `km.html`) | Edge Function `km-collect` `verify_jwt=false` mais **token/QR secret** ; QR désactivé si véhicule hors flotte ; données non-PII ; `Cache-Control: no-store`. `[VÉRIFIÉ]` |
| Réservation (`reserver.html`) | Edge Function `reservation` (token société), dispo re-vérifiée serveur, photos en URLs **signées** images-only. `[VÉRIFIÉ]` |
| Signature EDL (`signer.html`) | Edge Function `edl-sign` (token du lien), refus avec motif. `[VÉRIFIÉ]` |
| Offre d'achat (`offre-achat.html`) | Edge Function `offre-achat` (token), champs acheteur en **liste blanche** (anti-injection). `[VÉRIFIÉ]` |
| Avis d'amende (`avis.html`) | lien **signé** 1 h, sous-dossier `avis/` uniquement, garde-fou chemin (pas de `..`). `[VÉRIFIÉ]` |
| Prospect (`login.html`) | policy `prospects_insert_anon` (anon **INSERT seul**, aucun SELECT). `[VÉRIFIÉ]` |

## 5. Storage
- Bucket **`scans` privé** ; tout servi via **liens signés temporaires** (`FP.signedScanUrl`). Accès anonyme fermé. `[VÉRIFIÉ]`
- **Cloisonnement par société** : `societes/<slug>/…` + `fp_storage_acces()` (policies `scans_societe_*`). `[VÉRIFIÉ: 20261017090000]`

## 6. Anti-XSS & validation
- Toute donnée saisie/scannée/Supabase injectée en HTML → **`FP.esc()`** (app.js:7216, source unique). Helpers `FP.lienVehicule`/`lienConducteur`/`escAmende` échappent déjà. `[DOC: CLAUDE.md]` `[VÉRIFIÉ]`
- Contrôle statique `check-bugs.mjs` (CI bloquante) : syntaxe JS + scripts inline, RGPD `data.js` (0 donnée perso), champ « nom complet » interdit, `<details>` « Voir tout » interdit, `.min.js` à jour. `[VÉRIFIÉ: scripts/check-bugs.mjs, ci.yml]`
- E-mails : `send-email` empêche un non-CEO d'usurper l'adresse d'une autre société (`from` calculé serveur). `[VÉRIFIÉ]`

## 7. Secrets
- Clé Supabase **publishable** côté client (safe) ; **`service_role`** uniquement dans les Edge Functions. Clés IA (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`), Resend (`RESEND_API_KEY`), VAPID privé (`VAPID_PRIVATE_KEY`), Ulys/Yousign, secrets CRON (`KM_RELANCE_SECRET`…) : **jamais dans le dépôt** (GitHub Secrets / secrets Supabase). `[DOC: CLAUDE.md]` `[VÉRIFIÉ: placeholders dans les .sql]`
- Dépôt **public** → `data.js` anonymisé (0 PII), contrôle RGPD en CI. `[VÉRIFIÉ]`

## 8. Journalisation & sauvegardes
- `audit_log` (par société, insert ouvert, delete CEO, **pas d'UPDATE** = inviolable). `[VÉRIFIÉ: audit-log.sql]`
- `app_settings_history` (snapshots). Sauvegarde nocturne **chiffrée (age)** + restauration d'essai (`sauvegarde.yml`, `docs/SAUVEGARDES.md`). `[VÉRIFIÉ]`

## 9. Points de vigilance connus (faits)
- **Espace salarié (chauffeur)** : rôle/plaques encore dans `user_metadata` (falsifiable) ; RLS isole seulement par société → un compte chauffeur verrait **toute** sa société (dont PII). **Dormant** : ne pas créer de compte chauffeur avant de porter `role='chauffeur'`+plaques dans `profiles` + policies RLS lecture seule scopées plaque. `[DOC: CLAUDE.md]` `[VÉRIFIÉ: page espace-salarie dormante]`
- **`app_settings`** mêle config et données de travail → la config n'est protégée **qu'au niveau interface** pour les gestionnaires (RLS permissive). Reprotéger côté base nécessite d'abord de séparer config/données en lignes distinctes. `[VÉRIFIÉ: gestionnaire-app-settings-fix.sql]`
- **Concurrence `app_settings`** : garde-fous (anti-vidage, snapshot, `rev`) en place, mais le **CAS optimiste côté code** (phase 2) n'est pas encore branché. `[VÉRIFIÉ: MIGRATIONS-EN-ATTENTE.md]`
