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
- **Cache local complet** par société : clé versionnée **`fp_data_cache_v4_<societe>`** (véhicules + amendes + factures + conducteurs), + `fp_cond_cache_<societe>`, `fp_emprunts_<societe>`, `fp_docs_cache`, `fp_ctrl_*`. Relu par `seedFromCache` **avant** le rendu → 1er affichage immédiat, puis rafraîchissement sur l'événement `fp:data-ready` (uniquement si les données/réglages ont changé — signature légère `_fpDataSig`). `[VÉRIFIÉ: app.js:26, supabase-client.js:428,493]`
  > ⚠️ **Écart avec `CLAUDE.md`** : la doc mentionne `fp_data_cache_v3` ; le code utilise bien **`v4`**. (Fait vérifié, à corriger un jour dans CLAUDE.md — hors périmètre de cette mission lecture seule.)
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

## 7. Catalogue des helpers `FP.*` `[VÉRIFIÉ: assets/js/app.js, supabase-client.js, fleet-views.js]`

**Ordre de chargement** : SDK Supabase → `supabase-client.js` (pose `window.FP` + `FP.supabase/db/auth/dbReady`) → `app.js` (définit `const FP={...}` puis `Object.assign(FP, window.FP)`, `app.js:2423`) → `fleet-views.js`, `bareme.js`, `fleet-docs.js`. `scanner2.js` seulement sur `pages/scanner.html`.

**Noyau / formatage** : `FP.euro`/`euroPrecis` (215/219), `FP.date`/`dateNum` (224/231), `FP.num` (239), `FP.joursRestants` (338, source unique), `FP.esc` (7216, anti-XSS source unique), `FP.norm`/`normLoose`/`searchMatch` (7203+), `FP.donutHTML`/`sparklineHTML`/`countUp` (305/321/262), `FP.initiales`/`avatarHTML` (12809/12814).

**Persistance & synchro** (détail §5 + `04`) : `FP.persist` (13250, file durable optimiste : insert/upsert/update/delete/rpc/flush/applyTo), `FP.settings` (6381, app_settings par société, `_effectiveId`, `_pushSettings` fusion delta, `COLLECTION_KEYS` 6700), `FP._fusion` (6304, testé), `FP.projections` (3519 : `elementsReglages`→`settings_items`, `congesTable`→`driver_absences`, `affectationsTable`→`vehicle_assignments`, `contratsLLDTable`→`lease_contracts`, `forfaitsLeasingTable`→`lease_overrides`), `FP.db` (supabase-client:325, mapping snake↔camel), `FP.trash` (13137), `FP.restaurerReglages` (9563).

**Rôles** (détail `09`) : `FP.profile` (2538), `FP.role` (2539), `FP.isCEO`/`isGestionnaire`/`isChauffeur` (2554-2556), `FP.isAdmin` (2558, =ceo||admin), `FP.isSuperAdmin` (2587), `FP.canManageSociete` (2589), `FP.canManageUsers` (2593), `FP.chauffeurImmats` (2561), `FP.activeSociete`/`setActiveSociete` (4795/4796), `FP.getSocietes`/`addSociete`/`removeSociete` (4822+).

**Calculs métier** (détail `08`) : coûts (`coutMois` 1772, `dedupeFactures` 1752, `coutFactureExploit` 628, `coutExploitAnnee` 2155), amendes (`montantDu` 486, `estAPayer` 1983), véhicule (`estVendu` 419, `kmActuel` 2183, `echeanceStatut` 2248), leasing (`leasingContrat` 9236, `leasingInfo` 9295), fiscalité (`tvsDetail` 401, `aenDetail` 1407), assurance (`primeVeh` 1244, `assuranceAnnuelle` 1259), plaques (`normImmat` 1214, `immatEq` 1232, `vehByImmat` 1236), conducteurs (`normPrenom` 7721, `prenomDeCle` 3838, `condKeyDeConso` 3876, `conducteurNomUnifie` 3910, `migrateCondKey` 3782), carburant/péage (`txCat` 8541, `consoPendantConge` 4118, `estUlys`/`estTotalFleet` 1204/1205).

**IA / scan** (détail `06`) : `FP.scanIA` (13832), `FP.SCAN_PROMPT` (13633), `FP.CG_SCAN_PROMPT` (13684), `FP.scanZone` (13962), `FP.constatPrompt` (13772), `FP.ocr` (14813), `FP.uploadScan` (14320), `FP.storageDossierSociete` (13597).

**Anti-doublons** : `FP.dupe` (16584 : `confirmAdd`/`find`).

**E-mail** : `FP.sendEmail` (supabase-client:52), `FP.buildMail`/`registerMail` (19914/19908), `FP.mailBrand`/`mailShell`/`mailDocument` (19756/19820/19635), `FP.mailModeleAmende`/`renderMailAmende` (19863/19876), `FP.fillTags` (5017).

**Messagerie 3 canaux** : `FP.msg.open` (19038, SMS+WhatsApp+E-mail, source unique « prévenir un conducteur »), `FP.conducteurContact` (18979), `FP.share` (19277).

**PDF / exports** : `FP.ensureJsPDF` (5498, chargement paresseux), `FP.fiche`/`openPreview` (18597/18647), `FP.makeExportMenu` (18261), `FP.csv` (18009), `FP.xlsx`/`ensureXLSX` (18086/658), `FP.facturesZip` (1785), `FP.injectDataIO` (18692).

**Conducteurs / UI** : `FP.conducteurs` (3027, CRUD/create/find/displayName), `FP.newConducteurModal` (4696), `FP.conducteurPicker` (4742), `FP.searchSelect` (2624), `FP.filterResetButton` (2849), `FP.bulkSelect` (2953), `FP.galerie3d`, `FP.docsFolder` (16173), `FP.dialog`/`confirm`/`toast`/`notifyError` (12030/12144/11991/11981), `FP.lightbox`/`openScan`/`openPdf` (14482/14471/14533), `FP.history` (17360, undo/redo), `FP.makeColumnEditor` (17493), `FP.qr` (677).

**Alertes / échéances / rapports** : `FP.buildAlertes` (10670), `FP.buildEcheances` (11647), `FP.santeVehicule`/`santeConducteur` (10198/10238), `FP.recommandations` (10385), `FP.rapportDirection`/`rapportRSE` (11750/11908), `FP.automations` (7542), `FP.docsRequis` (7419), `FP.customFields` (7304).

> ⚠️ On édite **toujours** les sources (`app.js`/`fleet-views.js`), jamais les `.min.js` (empreinte vérifiée par `check-bugs`). Lignes approximatives (état 03/11/2026).
