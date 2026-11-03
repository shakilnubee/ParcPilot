# 05 — Automatisations & notifications

> Instantané 03/11/2026, lecture seule. Légende `[VÉRIFIÉ]` / `[DOC]` / `[HYPOTHÈSE]`.
> **Secrets** : seuls les **noms de variables d'environnement** sont cités, jamais leurs valeurs.

## 1. Edge Functions Supabase (`supabase/functions/*/index.ts`)

Convention commune : CORS `*`, réponses JSON ; sauf portails publics, **validation serveur du JWT** (`GET /auth/v1/user`) en **fail-closed**. `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY` injectés par Supabase. Déploiement **auto à la fusion `main`** (`deploy-edge-functions.yml`). `[VÉRIFIÉ]`

| Fonction | Déclencheur | Rôle | Tables | Secrets (noms) |
|---|---|---|---|---|
| **`scan-doc`** | HTTP, **connecté** | Relais IA d'analyse de documents (cœur IA, cf. `06`). Lecture croisée OpenAI+Claude si `OPENAI_API_KEY` présent ; champ en divergence → **null**. | aucune | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_MODEL` |
| **`send-email`** | HTTP, connecté | Envoi e-mail via Resend. **Anti-usurpation** : un non-CEO ne peut envoyer que depuis l'adresse de SA société (calculée serveur) ; en-têtes de fil transmis (relances dans le même thread). | `profiles`, `app_settings` | `RESEND_API_KEY`, `EMAIL_FROM` |
| **`email-log`** | HTTP, **CEO** | Liste des derniers e-mails Resend (vérification). | `profiles` | `RESEND_API_KEY` |
| **`manage-users`** | HTTP, **CEO/Admin** | CRUD comptes (list/create/invite/updateRole/resetPassword/delete) sans Supabase. Garde de portée (Admin = sa société, pas de CEO). Invitation = mot de passe aléatoire jamais communiqué + lien recovery + e-mail brandé. | `profiles`, `auth`, `app_settings` | `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `INVITE_FROM`/`EMAIL_FROM` |
| **`km-collect`** | HTTP **PUBLIC** (`verify_jwt=false`, token/QR) | Portail conducteur : relevé km, déclarations (sinistre/problème/question/EDL), docs. QR désactivé si véhicule hors flotte. Données non-PII. Envoie des **push** aux gestionnaires. | `km_requests`, `km_qr`, `vehicules`, `declarations_conducteur`, `documents`, `qr_scans`, `app_settings`, `push_subscriptions` | `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` |
| **`km-relance`** | **CRON `0 8 * * *`** | 1re demande de relevé km aux véhicules en retard + relances (plafond) ; bonus rappel CT « la veille ». Anti-homonyme sur l'e-mail. | `app_settings`, `conducteurs`, `vehicules`, `km_requests` | `KM_RELANCE_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `KM_RELANCE_MAX`, `KM_FORM_BASE` |
| **`task-reminders`** | **CRON `*/30 * * * *`** | Rappels push/e-mail des tâches (anticipé, résumé du jour, veille). Fuseau Europe/Paris. Anti-doublon `push_log`. | `app_settings` (`data.taches`), `push_subscriptions`, `push_log` | `TASK_REMINDERS_SECRET` **ou** `KM_RELANCE_SECRET`, `VAPID_*`, `RESEND_API_KEY` |
| **`ulys-daily`** | **CRON `30 6 * * *`** | Import quotidien des **en-têtes** de factures Ulys (péage) + alerte e-mail (anti-doublon n° facture). Le détail par conducteur reste rempli par l'app. | `factures`, `app_settings` | `ULYS_BEARER`/`ULYS_INITIATOR`, `ULYS_BASE`, `ULYS_SOCIETE`, `ULYS_DAILY_SECRET` ou `KM_RELANCE_SECRET`, `ULYS_ALERT_TO`, `RESEND_API_KEY` |
| **`ulys-sync`** | HTTP, connecté non-chauffeur | Passerelle **lecture seule** API Ulys (account/contracts/badges/ping). | `profiles` | `ULYS_BEARER`, `ULYS_INITIATOR`, `ULYS_BASE` |
| **`yousign`** | HTTP, connecté non-chauffeur | Envoi d'un PDF à **Yousign** (signature externe, API v3). | `profiles` | `YOUSIGN_API_KEY`, `YOUSIGN_ENV` |
| **`edl-sign`** | HTTP **PUBLIC** (token) | Signature manuscrite **intégrée** multi-parties (dataURL PNG) ; reconstruit le PDF signé (pdf-lib) et le range dans les Documents. | `edl_signatures`, `documents`, storage `scans` | `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_*` |
| **`offre-achat`** | HTTP **PUBLIC** (token) | L'acheteur d'un véhicule remplit ses infos (champs en liste blanche) ; prévient les gestionnaires (push + e-mail). | `offres_achat`, `vehicules`, `push_subscriptions`, `app_settings` | `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_*`, `RESEND_API_KEY` |
| **`reservation`** | HTTP **PUBLIC** (token) | Réservation véhicule sans compte ; **re-vérifie la dispo serveur** (anti double-résa) ; photos servies en URLs signées images-only. | `reservations`, `vehicules`, `emprunts`, `push_subscriptions`, `app_settings` | `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_*`, `RESEND_API_KEY` |

## 2. CI/CD & workflows GitHub (`.github/workflows/`)

| Workflow | Déclencheur | Rôle |
|---|---|---|
| **ci.yml** | PR → `main`, push branches, manuel | **Garde-fou bloquant**. Job `controles` : `check-bugs.mjs` (syntaxe JS, `?v=`, liens, RGPD `data.js`, `.min.js` à jour) + `test-calculs.mjs` + tests unitaires (fusion-réglages, projections, persist-file). Job `e2e` : smoke Playwright. |
| **deploy-edge-functions.yml** | push `main` touchant `supabase/functions/**` | Déploie chaque fonction (`supabase functions deploy <fn> --project-ref … --yes`). Secret `SUPABASE_ACCESS_TOKEN`. |
| **isolation.yml** | CRON `30 5 * * *`, PR sécu | Sur **staging** : accès anonyme + isolation société A/B + congés-table. Secrets `TEST_A_*`/`TEST_B_*`. |
| **migration-staging.yml** | PR ajoutant `supabase/migrations/**` | « Staging d'abord » : applique+teste les migrations de la PR sur le staging. **Refuse toute URL de prod**. Secret `STAGING_DB_URL`. |
| **securite.yml** | CRON `0 5 * * *`, PR | Vérifie qu'un visiteur non connecté ne lit aucune donnée (`acces-anonyme.mjs`). |
| **sauvegarde.yml** | CRON `15 1 * * *` | **Sauvegarde nocturne chiffrée** (dump base + fichiers Storage), **restauration d'essai** + comparaison, chiffrement **age**, artefact GitHub (30 j / 90 j le 1er du mois). Secrets `PROD_DB_URL`/`PROD_S3_*`. |

`[VÉRIFIÉ]` — Note : `isolation.yml`/`migration-staging.yml` contiennent en clair l'URL staging et une clé *publishable* staging (non secrète par nature).

## 3. Tâches planifiées (pg_cron → pg_net)

Toutes via `cron.schedule(...)` → `net.http_post('.../functions/v1/<fn>', …, 'x-cron-secret', '<<SECRET>>')` (secret jamais commité, placeholders). `[VÉRIFIÉ]`

| Fichier setup | Tâche | Fréquence | Edge Function |
|---|---|---|---|
| `km-relance-setup.sql` | `km-relance-quotidienne` | `0 8 * * *` | **km-relance** |
| `ulys-daily-setup.sql` | import Ulys | `30 6 * * *` | **ulys-daily** |
| `task-reminders-setup.sql` | `task-reminders` | `*/30 * * * *` | **task-reminders** |
| `km-collecte-setup.sql` | *aucun cron* — crée `km_requests` + RLS | — | déclenché par token/manuel |
| `push-notifications.sql` | *aucun cron* — crée `push_subscriptions` + RLS | — | alimente les push |

## 4. Notifications internes, alertes & push

- **Alertes in-app** centralisées dans **`FP.buildAlertes(data)`** (`app.js:10670`+), rendues par `pages/notifications.html` (onglets Alertes / Renouvellements / À compléter). Catégories par jours restants : **CT** (`:10704`), **Assurance** (`:10723`), **Anti-pollution** (`:10777`), **Contrats/Leasing** (fin, forfait km, prime, `:10439`), **Amendes** (minoré, `:10419`), **Entretien/santé** (`:10464`), **À vendre** (`:10482`), **Carburant/anomalies** (`:10495`), **Relevé km** (`:10820`), **EDL à signer** (`:10867`). Multi-éléments regroupés en une alerte dépliable (règle 0bis). `[VÉRIFIÉ]`
- **Échéances** calculées par **`FP.buildEcheances(data)`** (source unique partagée par calendrier / renouvellements / notifications). `[VÉRIFIÉ]`
- **Push Web (VAPID)** : table `push_subscriptions` (par société) ; clé privée `VAPID_PRIVATE_KEY` **uniquement serveur**. Émetteurs : `km-collect` (déclarations chauffeur), `task-reminders`, `offre-achat`, `reservation`, `edl-sign`. `[VÉRIFIÉ: push-notifications.sql]`
- **E-mails transactionnels** : tous via `send-email` (Resend), expéditeur/copies **par société** (`FP.sendEmail` → `mailExpediteur`/`mailCopie`). Modèles brandés (`FP.mailBrand`/`buildMail`). Types : amendes, invitations comptes, relances km, alertes Ulys, accusés portail. `[VÉRIFIÉ]`
- **Journal des envois** : onglet Paramètres → « Envois e-mails » via `email-log`. `[VÉRIFIÉ]`

## 5. Parcours type d'une automatisation (exemple km-relance)

1. CRON `0 8 * * *` (pg_cron) → `net.http_post` vers `km-relance` avec `x-cron-secret: <KM_RELANCE_SECRET>`.
2. La fonction lit `app_settings` (réglages de relance par société), `vehicules` (km en retard), `conducteurs` (résolution e-mail anti-homonyme).
3. Pour chaque véhicule éligible et non déjà relancé récemment (anti-spam, plafond `KM_RELANCE_MAX`) : crée/renouvelle un `km_requests` (token) et envoie l'e-mail (Resend) avec le lien `km.html?t=<token>`.
4. Le conducteur ouvre `km.html` → `km-collect` enregistre le km (update `vehicules.km` si supérieur) et marque la demande `used_at`.
5. Bonus : si `prochain_ct = demain`, rappel CT « la veille ». `[VÉRIFIÉ]`
