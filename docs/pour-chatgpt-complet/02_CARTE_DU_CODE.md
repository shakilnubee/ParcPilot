# 02 — Carte du code

> Instantané 03/11/2026, lecture seule. `[VÉRIFIÉ]` sauf mention.

## 1. Arborescence (résumé)
```
/ (racine)
├── index.html login.html dashboard.html onboarding.html 404.html   # entrée / accueil
├── v.html reserver.html km.html signer.html carte.html avis.html    # portail conducteur & public
├── brochure.html prix.html devis.html contrat.html bareme.html demo.html
│   kit-commercial.html argumentaire.html promo.html carte-visite.html
│   liens.html offre-achat.html prospects.html script-demo.html logos.html   # commercial
├── manifest.json sw.js version.json CNAME vercel.json              # PWA / hébergement
├── assets/
│   ├── css/  styles.css  tailwind.css (précompilé)  _tw-input.css
│   └── js/
│       ├── app.js (~21074 l)        → objet global FP.* (cœur)
│       ├── app.min.js               (servi en prod ; NE PAS éditer)
│       ├── supabase-client.js (~756 l) → FP.db, FP.auth, chargement initial
│       ├── fleet-views.js (~1960 l) / fleet-views.min.js → vues Total/Ulys
│       ├── fleet-docs.js (9 l)      → FP_DOCS (vidé RGPD)
│       ├── bareme.js (146 l)        → barème commercial (indépendant de FP)
│       ├── data.js                  → instantané hors-ligne ANONYMISÉ
│       ├── scanner2.js (514 l)      → scanner IA v2 (module FP2)
│       ├── lucide*.min.js           → icônes
│       └── vendor/  jspdf.umd.min.js, jspdf.plugin.autotable.min.js, …
├── pages/   (24 pages applicatives)
├── supabase/  migrations/ (25) · functions/ (13) · *.sql (47 archives/setups) · staging/ · *.md
├── scripts/  check-bugs.mjs build-min.mjs test-calculs.mjs audit-*.mjs min-common.mjs
├── tests/    unit/ securite/ + e2e Playwright (16 fichiers)
├── .github/workflows/  ci deploy-edge-functions isolation migration-staging sauvegarde securite
└── docs/     SAUVEGARDES.md FONCTIONNALITES.md AUDITS.md pour-chatgpt/ pour-chatgpt-complet/
```

## 2. Ordre de chargement (page applicative)
1. **Garde d'auth synchrone** dans `<head>` (token `sb-tzjuptlzoywjeigmyfuj-auth-token`, redirige `login.html` si absent, tolérante hors-ligne).
2. Reconstruction **sidebar** depuis `localStorage` (`navOrder`/`navHidden`/`sidebarLabels`).
3. SDK Supabase (`vendor/supabase.js`) → **`supabase-client.js`** (pose `window.FP` + `FP.supabase`/`db`/`auth`/`dbReady`) → **`app.js`** (`const FP={…}` puis `Object.assign(FP, window.FP)`, `app.js:2423`).
4. `fleet-views.js`, `bareme.js`, `fleet-docs.js`. `scanner2.js` **uniquement** sur `pages/scanner.html`.
5. `FP_DATA` peuplé depuis le cache `fp_data_cache_v4_<societe>` (repli `data.js`) **avant** le 1er rendu ; re-render sur l'événement **`fp:data-ready`** (émis seulement si données/réglages ont changé).

Les **pages publiques** (`v.html`, `reserver.html`, `km.html`, `signer.html`, `carte.html`, `avis.html`) **ne chargent pas `app.js`** : elles parlent aux Edge Functions via `postJSON` avec la clé publishable.

## 3. Graphe de dépendances (qui dépend de quoi)
```
                    ┌───────────────── app.js (FP.*) ─────────────────┐
pages/*.html  ───►  │ persistance (persist/settings/projections/db)   │ ───► Supabase (tables, RLS, RPC)
dashboard.html      │ calculs métier (coûts/TCO/TVS/km/échéances)      │
                    │ UI (searchSelect/conducteurPicker/msg/galerie…)  │
                    │ IA (scanIA) ──────────────────────────► Edge Fn scan-doc ──► Anthropic / OpenAI
                    │ e-mail (sendEmail) ───────────────────► Edge Fn send-email ─► Resend
                    └──────────────────────────────────────────────────┘
fleet-views.js  ──► réutilise FP.* (estUlys/estTotalFleet/txCat…) ──► Factures + Contrôle
bareme.js       ──► indépendant de FP (client propre) ──► app_settings id=bareme ──► bareme/devis/contrat/prix.html
scanner2.js(FP2)──► réutilise FP.scanIA/persist/dupe ──► pages/scanner.html
v/reserver/km/signer/carte/avis.html ──► Edge Fn (km-collect/reservation/edl-sign/…) ──► Supabase
CRON (pg_cron) ──► km-relance / task-reminders / ulys-daily (Edge Fn) ──► Supabase + Resend + Push
```

## 4. Conventions de nommage & repères
- Helpers partagés : préfixe **`FP.`** (global). Modules de projection : `FP.projections`, `FP.<x>Table`. Scanner v2 : objet **`FP2`** (scanner2.js, non exposé globalement).
- Attributs DOM : `data-*` pour les handlers délégués (ex. `data-sin-pdf`, `data-decl-sin`, `data-go`, `data-nav`, `data-widget`, `data-ctab`).
- Clés localStorage : `fp_data_cache_v4_<soc>`, `fp_cond_cache_<soc>`, `fp_emprunts_<soc>`, `fp_pending_writes_<soc>`, `auto_flotte_settings_<soc>`, `fp_profile`/`fp_societe`/`fp_email`, `fp_bak_*`.
- Événements : `fp:data-ready` (données prêtes/à re-render), `pp:bareme-ready` (barème).
- Tables Supabase : voir `06`. Edge Functions : voir `08`.

## 5. Où chercher selon le besoin (aiguillage rapide)
| Besoin | Fichier(s) |
|---|---|
| Un calcul métier / une règle | `assets/js/app.js` (helper `FP.*`, cf. `03`/`08`) |
| Persistance / synchro / cache | `assets/js/app.js` (`FP.persist`/`FP.settings`/`FP.projections`) + `supabase-client.js` (`FP.db`) |
| Une page précise (UI + logique locale) | `pages/<nom>.html` (cf. `05` + fonctions locales `04`) |
| Schéma base / RLS / RPC | `supabase/migrations/*.sql` + `06` |
| Une automatisation / un e-mail / un cron | `supabase/functions/*` + `supabase/*-setup.sql` + `08` |
| Le scan IA | `app.js` (`FP.scanIA`) + `supabase/functions/scan-doc` + `scanner2.js` + `06` (doc pour-chatgpt) |
| Les règles de dev | `CLAUDE.md` + `01` |
