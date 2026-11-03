# 08 — Automatisations détaillées

> Instantané 03/11/2026, lecture seule. Secrets = **noms de variables** uniquement. Légende `[VÉRIFIÉ]`/`[DOC]`/`[À VÉRIFIER EN BASE]`.

## 1. Edge Functions (`supabase/functions/*/index.ts`)
Convention : CORS `*`, JSON ; sauf portails publics, **JWT validé serveur** (fail-closed). `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY` injectés par Supabase. Déploiement **auto à la fusion `main`** (`deploy-edge-functions.yml`, `--yes`). État : **actives** (déployées) sauf mention.

### `scan-doc` — relais IA (cœur du scan)
- **Déclencheur** : HTTP POST, **connecté requis**. **Conditions** : lit le JWT.
- **Entrées** `{fileBase64, mediaType, docType, prompt, maxTokens}` → **Sorties** `{ok, fields, model, lecteur, controle, aVerifier}`. **Tables** : aucune.
- **Secrets** : `ANTHROPIC_API_KEY` (requis), `OPENAI_API_KEY` (optionnel → OpenAI lecteur principal + Claude validation), `ANTHROPIC_MODEL`/`OPENAI_MODEL`.
- **Erreurs** : timeouts 55 s + `AbortController` ; repli modèle sur 404 ; champ en **divergence → null** ; JSON illisible → `{ok:false, raw}`. **Anti-doublon** : n/a. **Log** : n/a. **Test** : scan réel depuis l'app (pas de test auto).

### `send-email` — e-mails (Resend)
- **Déclencheur** : HTTP POST (connecté) ; GET = version. **Destinataires** : `to/cc` du payload + copies société (`mailCopie`). **Tables** : lecture `profiles`, `app_settings` (scoping `from`).
- **Secrets** : `RESEND_API_KEY`, `EMAIL_FROM`. **Sécurité** : **anti-usurpation** (from/cc calculés serveur par société ; seul CEO a `from` libre). **Erreurs** : renvoie l'erreur Resend. **Log** : via `email-log`. **Test** : testeur in-app (`FP.sendMailTest`).

### `email-log` — journal des envois (lecture seule)
- **Déclencheur** : HTTP, **CEO**. **Sorties** : derniers e-mails Resend (to/cc/subject/status/created_at). **Secret** : `RESEND_API_KEY`.

### `manage-users` — comptes CEO/Admin/Gestionnaire
- **Déclencheur** : HTTP POST, **CEO/Admin**. **Actions** : list/create/invite/updateRole/resetPassword/delete. **Tables** : `profiles`, `auth` (admin API), `app_settings` (modèle invitation).
- **Secrets** : `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `INVITE_FROM`/`EMAIL_FROM`. **Conditions** : garde de portée (Admin = sa société, pas de CEO). **Erreurs** : fail-closed (profil absent = refus). **Log** : audit via l'app.

### `km-collect` — portail conducteur + km (PUBLIC)
- **Déclencheur** : HTTP GET/POST, `verify_jwt=false`, **sécurité = token/QR**. **Conditions** : QR désactivé si véhicule hors flotte. **Tables** : `km_requests`, `km_qr`, `vehicules` (update km si supérieur), `declarations_conducteur`, `documents`, `qr_scans`, `app_settings`, `push_subscriptions`.
- **Destinataires push** : gestionnaires de la société. **Secrets** : `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`. **Anti-doublon** : scan QR anti-spam 20 min. **Erreurs** : km inférieur refusé. **Test** : parcours portail réel.

### `km-relance` — demande + relance km (CRON `0 8 * * *`)
- **Déclencheur** : **CRON quotidien** (pg_cron → `net.http_post`, header `x-cron-secret`) ; ou JWT CEO pour test (`dryRun`). **Conditions** : véhicule en retard de relevé ; anti-spam (1 envoi/X jours, plafond `KM_RELANCE_MAX`) ; **anti-homonyme** sur l'e-mail. **Bonus** : rappel CT « la veille » (`prochain_ct=demain`).
- **Destinataires** : conducteur (e-mail). **Données lues** : `app_settings` (réglages), `conducteurs`, `vehicules`, `km_requests`. **Données écrites** : `km_requests` (token). **Secrets** : `KM_RELANCE_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `KM_FORM_BASE`. **Anti-doublon** : plafond + délai. **Log** : e-mail d'erreur. **Test** : `dryRun` (CEO).

### `task-reminders` — rappels push des tâches (CRON `*/30 * * * *`)
- **Déclencheur** : **CRON toutes les 30 min**. **Conditions** : fuseau Europe/Paris (rappel anticipé RDV, résumé du jour, veille). **Tables** : `app_settings` (`data.taches`), `push_subscriptions`, `push_log`.
- **Secrets** : `TASK_REMINDERS_SECRET` **ou** `KM_RELANCE_SECRET`, `VAPID_*`, `RESEND_API_KEY`. **Anti-doublon** : `push_log` (clé unique). **Log** : `push_log`. **Test** : `dryRun`.

### `ulys-daily` — import Ulys quotidien (CRON `30 6 * * *`)
- **Déclencheur** : **CRON quotidien** ; GET = check config ; JWT CEO + `dryRun`. **Conditions** : factures Ulys du jour. **Tables** : `factures` (insert **en-têtes** HT/TVA/TTC, anti-doublon n° facture), `app_settings` (destinataires alerte).
- **Secrets** : `ULYS_BEARER`/`ULYS_INITIATOR`, `ULYS_BASE`, `ULYS_SOCIETE`, `ULYS_DAILY_SECRET` ou `KM_RELANCE_SECRET`, `ULYS_ALERT_TO`, `RESEND_API_KEY`. **Anti-doublon** : n° facture. **Note** : seul l'**en-tête** entre auto ; le détail conducteur reste rempli par l'app.

### `ulys-sync` — passerelle API Ulys (lecture seule)
- **Déclencheur** : HTTP POST, connecté non-chauffeur. **Actions** : account/contracts/badges/ping. **Secrets** : `ULYS_BEARER`/`ULYS_INITIATOR`/`ULYS_BASE`. **État** : **partiel** (aucune écriture vers Ulys — paliers suivants).

### `yousign` — signature externe (Yousign API v3)
- **Déclencheur** : HTTP POST, connecté non-chauffeur. **Secrets** : `YOUSIGN_API_KEY`, `YOUSIGN_ENV` (**défaut `sandbox`**). **État** : disponible **en plus** de `edl-sign`.

### `edl-sign` — signature EDL intégrée (PUBLIC)
- **Déclencheur** : HTTP GET/POST, `verify_jwt=false` (token). **Tables** : `edl_signatures`, `documents`, bucket `scans`. **Secrets** : `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_*`. **Dépendance** : `pdf-lib@1.17.1`. **Erreurs** : refus avec motif obligatoire.

### `offre-achat` — formulaire acheteur (PUBLIC)
- **Déclencheur** : HTTP GET/POST, `verify_jwt=false` (token). **Tables** : `offres_achat` (insert `recu`), `vehicules`, `push_subscriptions`, `app_settings`/`profiles`. **Secrets** : `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_*`, `RESEND_API_KEY`. **Sécurité** : champs acheteur en liste blanche.

### `reservation` — réservation (PUBLIC)
- **Déclencheur** : HTTP GET/POST, `verify_jwt=false` (token). **Conditions** : **re-vérifie la dispo serveur** (anti double-résa). **Tables** : `reservations` (insert `en_attente`), `vehicules`, `emprunts`, `push_subscriptions`, `app_settings`. **Secrets** : `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_*`, `RESEND_API_KEY`. **Sécurité** : photos en URLs signées images-only.

## 2. Workflows CI/CD (`.github/workflows/`)
| Workflow | Déclencheur | Rôle | Secrets |
|---|---|---|---|
| **ci.yml** | PR→`main`, push branches | **Bloquant** : `check-bugs.mjs` + `test-calculs.mjs` + tests unitaires (fusion, projections, persist) ; job `e2e` (smoke Playwright) | — |
| **deploy-edge-functions.yml** | push `main` sur `supabase/functions/**` | Déploie chaque fonction | `SUPABASE_ACCESS_TOKEN` |
| **isolation.yml** | CRON `30 5 * * *`, PR sécu | Staging : accès anonyme + isolation A/B + congés-table | `TEST_A_*`/`TEST_B_*` |
| **migration-staging.yml** | PR ajoutant `supabase/migrations/**` | Applique+teste les migrations sur staging ; refuse une URL prod | `STAGING_DB_URL` |
| **securite.yml** | CRON `0 5 * * *`, PR | Accès anonyme nul (`acces-anonyme.mjs`) | — |
| **sauvegarde.yml** | CRON `15 1 * * *` | Sauvegarde chiffrée (age) + restauration d'essai + comparaison ; artefact 30/90 j | `PROD_DB_URL`/`PROD_S3_*` |

## 3. Tâches planifiées (pg_cron, base) **[à vérifier en base]**
`cron.schedule(...)` → `net.http_post('.../functions/v1/<fn>', …, 'x-cron-secret', '<<SECRET>>')` (secret non commité). Jobs : `task-reminders` (`*/30 * * * *`) · `km-relance-quotidienne` (`0 8 * * *`) · `ulys-import-quotidien` (`30 6 * * *`). Vérifier `select * from cron.job` (actif + secrets).

## 4. Notifications internes & push
- **Alertes in-app** : `FP.buildAlertes(data)` (app.js:10670) → `notifications.html`. Catégories par jours restants : CT, assurance, anti-pollution, contrats/leasing (fin/forfait/prime), amendes, entretien/santé, à vendre, carburant/anomalies, relevé km, EDL à signer. Multi-éléments = 1 alerte dépliable.
- **Échéances** : `FP.buildEcheances(data)` (source unique) → calendrier/renouvellements/notifications + tâches auto.
- **Push Web (VAPID)** : table `push_subscriptions` (par société), clé privée serveur seulement. Émetteurs : `km-collect`, `task-reminders`, `offre-achat`, `reservation`, `edl-sign`. Anti-doublon `push_log`.

## 5. Automatisations **configurables** (règles « quand → alors »)
Paramètres → onglet **Automatisations** (`settings.automations`, moteur `FP.automations` app.js:7542) : règles définies par l'admin (ex. créer une tâche quand une échéance approche). Marqueur « fait » dans `automationDone`. **État** : actif, piloté par la config société.

## 6. Classement actives / inactives / en attente
- **Actives** : scan-doc, send-email, email-log, manage-users, km-collect, km-relance (cron), task-reminders (cron), ulys-daily (cron), edl-sign, offre-achat, reservation ; CI (6 workflows) ; alertes/push in-app.
- **Partielles / optionnelles** : `ulys-sync` (lecture seule, pas d'écriture Ulys), `yousign` (dispo en plus de `edl-sign`, env sandbox par défaut).
- **En attente** : « Solution 2 » e-mails (envoi au nom société depuis domaine plateforme) — modif `send-email` en attente de go `[DOC]`. Vérification de l'état réel des **jobs pg_cron** `[à vérifier en base]`.
