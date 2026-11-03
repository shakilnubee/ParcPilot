# 02 — Architecture technique

> Instantané 03/11/2026, lecture seule. Légende : `[VÉRIFIÉ]` / `[DOC]` / `[HYPOTHÈSE]`.

## 1. Vue d'ensemble

Parc Pilot est une **application web statique** (aucun serveur applicatif propre) adossée à **Supabase** `[VÉRIFIÉ]` :

```
Navigateur (pages HTML + JS + objet FP.*)
        │  Supabase JS (clé publishable)
        ▼
Supabase : PostgreSQL (RLS par société) · Auth · Storage (bucket scans privé) · Edge Functions (Deno)
        ▲
        │  déclencheurs cron / HTTP
GitHub : Pages (publie main → parc-pilot.fr) · Actions (CI, déploiement Edge Functions, sauvegardes)
```

- Pas de build front SPA : chaque page HTML charge les mêmes scripts partagés et s'auto-initialise. `[VÉRIFIÉ]`
- Tailwind est **précompilé** en local dans `assets/css/tailwind.css` (rebuild via `npx tailwindcss`). `[DOC: CLAUDE.md]`
- Le client Supabase utilise la **clé publishable** (exposable côté client) ; la clé `service_role` ne vit **que** côté Edge Functions. `[DOC: CLAUDE.md]`

## 2. Structure des dossiers et fichiers `[VÉRIFIÉ: arborescence]`

```
/ (racine)
├── index.html, login.html, dashboard.html, onboarding.html        # entrée + accueil
├── v.html, reserver.html, km.html, signer.html, carte.html, avis.html   # portail conducteur & public
├── brochure.html, prix.html, demo.html, kit-commercial.html, …    # commercial / présentation
├── manifest.json, sw.js, version.json, CNAME, 404.html            # PWA / hébergement
├── assets/
│   ├── css/  (tailwind.css précompilé, styles.css)
│   └── js/
│       ├── app.js            (~21 000 lignes)  → objet global FP.* (cœur applicatif)
│       ├── app.min.js        (minifié servi en prod ; NE PAS éditer)
│       ├── supabase-client.js (~756 l.) → client Supabase, FP.db, FP.auth, chargement initial
│       ├── fleet-views.js (~1960 l.) / fleet-views.min.js → rendus de vues partagées
│       ├── fleet-docs.js      → gestion documents (helper FP.docsFolder, cf. 03/06)
│       ├── bareme.js          → barème (app_settings id `bareme`, pull/push)
│       ├── data.js            → instantané hors-ligne ANONYMISÉ (RGPD, dépôt public)
│       ├── scanner2.js        → scan (cf. 06)
│       └── vendor/  (jspdf.umd.min.js, autotable, lucide…)
├── pages/        # 24 pages de gestion (vehicules, conducteurs, amendes, factures, …)
├── supabase/
│   ├── migrations/   (26 migrations versionnées AAAAMMJJ…_*.sql + JOURNAL.md)
│   ├── functions/    (13 Edge Functions Deno : voir 05)
│   ├── *.sql         (scripts historiques — NE PAS rejouer, cf. LISEZ-MOI.md)
│   ├── staging/      (projet de test)
│   └── *.md          (docs : rôles, isolation, migrations en attente…)
├── scripts/      (check-bugs.mjs, build-min.mjs, test-calculs.mjs, audit-*.mjs, min-common.mjs)
├── tests/        (unit/, securite/, e2e Playwright)
├── .github/workflows/  (ci, deploy-edge-functions, isolation, migration-staging, sauvegarde, securite)
└── docs/         (SAUVEGARDES.md, FONCTIONNALITES.md, AUDITS.md, pour-chatgpt/ = cette série)
```

**Tailles notables** `[VÉRIFIÉ: wc -l]` : `app.js` 21074 · `vehicules.html` 8225 · `contrats.html` 5686 · `amendes.html` 3471 · `conducteurs.html` 3457 · `parametres.html` 3190 · `factures.html` 3048 · `sinistres.html` 2908 · `v.html` 2492 · `notifications.html` 2173 · `fleet-views.js` 1960.

## 3. Front : l'objet global `FP.*`

Toute la logique partagée est regroupée dans un **objet global `FP`** défini dans `assets/js/app.js` (et complété par `supabase-client.js`, `fleet-views.js`). Les pages appellent `FP.<helper>()`. `[VÉRIFIÉ]`

> Le **catalogue détaillé des helpers `FP.*`** (par catégorie, avec `fichier:ligne`) est en **§ Catalogue FP.*** ci-dessous et recoupé dans `08_CALCULS_REGLES_METIER.md`.

Grandes familles (détail plus bas) : **persistance/synchro** (`FP.persist`, `FP.settings`, `FP.projections`, `FP.db`), **rôles** (`FP.role`, `FP.isCEO/isAdmin/isGestionnaire`), **calculs métier** (coûts, TCO, TVS, km, échéances), **plaques/prénoms** (`FP.normImmat`, `FP.normPrenom`…), **UI** (`FP.searchSelect`, `FP.conducteurPicker`, `FP.filterResetButton`, `FP.msg`, `FP.galerie3d`, `FP.docsFolder`), **IA** (`FP.scanIA`, `FP.SCAN_PROMPT`), **e-mail** (`FP.mailBrand`, `FP.buildMail`, `FP.sendEmail`), **PDF** (`FP.ensureJsPDF`, `FP.fiche`).

## 4. Back : Supabase

- **Client** : `assets/js/supabase-client.js` initialise le client (URL projet + clé publishable), expose **`FP.db`** (CRUD avec mapping **snake_case ↔ camelCase**), **`FP.auth`**, et le **chargement initial** (`loadAll`) qui lit les tables de données + les tables dédiées « données de travail ». `[VÉRIFIÉ: supabase-client.js]`
- **Tables / RLS / Storage / RPC** : détaillés dans `04_SUPABASE_DONNEES.md`.
- **Edge Functions** (Deno/TypeScript, `supabase/functions/*`) : détaillées dans `05_AUTOMATISATIONS_NOTIFICATIONS.md`.

## 5. Cache & synchronisation `[DOC: CLAUDE.md — section perf/anti-perte]`

- **Supabase = source de vérité**. `localStorage` = **cache d'affichage** uniquement.
- **Cache local complet** par société : clé versionnée `fp_data_cache_v3_<societe>` (véhicules + amendes + factures), + `fp_cond_cache_<societe>`, `fp_emprunts_<societe>`. Relu par `seedFromCache` **avant** le rendu → 1er affichage immédiat, puis rafraîchissement sur l'événement `fp:data-ready` (uniquement si les données ont changé — signature légère). `[DOC]`
- **`data.js`** = instantané hors-ligne anonymisé (RGPD), filtré par société par l'IIFE `filterStaticCacheBySociete`. `[DOC]`
- **Écritures durables** : `FP.persist` enfile l'écriture **avant** l'appel réseau (file optimiste), retente, et signale les échecs (pastille `#fp-sync-badge`, `FP.notifyError`) → **pas d'échec silencieux**. `[DOC]`
- **Réglages** : `FP.settings` écrit dans `app_settings` sur la **même ligne** que la lecture (`_effectiveId`) ; toute map keyée doit figurer dans **`COLLECTION_KEYS`** pour ne pas être écrasée en bloc. `[DOC]`
- **Données de travail migrées** vers des tables dédiées via `FP.projections` (congés, affectations, contrats LLD, forfaits leasing, éléments de réglages) — cf. `04`. `[DOC]`
- **Invalidation des caches de calculs** : une valeur **calculée** mise en cache doit dépendre de `FP.ASSET_VERSION` (bumpé à chaque `?v=`). `[DOC]`

## 6. Déploiement, build, tests `[DOC: README.md, CLAUDE.md]`

- **Workflow** : branche `sujet/...` → PR → CI verte → fusion `main` → GitHub Pages (~1-2 min). Jamais de push direct sur `main` (branche protégée).
- **Minification** : après modif de `app.js`/`fleet-views.js`, `node scripts/build-min.mjs` (terser) régénère les `.min.js` ; un garde-fou dans `check-bugs.mjs` (empreinte `/*src=…*/`) **fait échouer la CI** si un `.min.js` est périmé. `[DOC]`
- **Cache-busting** : `?v=AAAAMMJJx` sur `app.js`/`supabase-client.js`/`data.js` dans toutes les pages (+ `sw.js`, `version.json`) — à bumper à chaque changement de ces fichiers. Build courant `20261102f`. `[VÉRIFIÉ: version.json]`
- **CI (`.github/workflows`)** : `ci.yml` (check-bugs + calculs + Playwright), `securite.yml` (accès anonyme, quotidien), `isolation.yml` (isolation sociétés, staging), `migration-staging.yml` (applique+teste les migrations de la PR sur le staging), `deploy-edge-functions.yml` (déploie `supabase/functions/**` à la fusion), `sauvegarde.yml` (sauvegarde chiffrée nocturne + restauration d'essai). `[VÉRIFIÉ: ls + 05]`

## 7. Catalogue des helpers `FP.*`

> _Section complétée à partir de l'exploration du code (`assets/js/app.js`, `supabase-client.js`, `fleet-views.js`)._ Voir aussi `08_CALCULS_REGLES_METIER.md` pour les helpers de calcul.

_(À compléter — voir le détail recoupé dans 03/04/06/08.)_
