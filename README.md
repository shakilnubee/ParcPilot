# Parc Pilot

Logiciel en ligne de **gestion de flotte automobile** (véhicules, conducteurs, amendes, factures,
contrats, sinistres, états des lieux…), multi-sociétés. Site : **https://parc-pilot.fr**

## En bref

| | |
|---|---|
| Interface | pages HTML/CSS/JavaScript statiques (`*.html`, `pages/`, `assets/`), Tailwind précompilé |
| Hébergement | **GitHub Pages** : la branche `main` est publiée automatiquement sur parc-pilot.fr |
| Données | **Supabase** (PostgreSQL, authentification, stockage des documents, fonctions serveur) |
| Isolation | chaque société ne voit que ses données (règles d'accès par société, testées automatiquement) |

## Environnements

| | Production | Staging |
|---|---|---|
| Rôle | données réelles des clients | essais, données **fictives** |
| Projet Supabase | `tzjuptlzoywjeigmyfuj` | `csvjmzwexszsbowibxut` (voir `supabase/staging/README.md`) |
| Modifications | uniquement par PR fusionnée, et pour la base : migration testée sur le staging + accord | libres |
| Sauvegardes | Supabase (quotidienne) **+ sauvegarde chiffrée chaque nuit** avec restauration d'essai (`docs/SAUVEGARDES.md`) | — |

## Comment contribuer

1. **Jamais de modification directe de `main`** (branche protégée) : une branche par sujet, puis une
   **pull request**. Elle est fusionnée quand les tests automatiques sont verts.
2. **Base de données** : toute modification passe par une migration dans `supabase/migrations/`, testée
   sur le staging, puis appliquée en production avec accord. **Ne jamais rejouer** les anciens scripts
   SQL (voir `supabase/LISEZ-MOI.md`).
3. **Aucun secret ni donnée personnelle** dans le dépôt : il est public.
4. Après une modification de `assets/js/app.js` ou `fleet-views.js` : régénérer les fichiers minifiés
   (`node scripts/build-min.mjs`) et monter le numéro de version `?v=` (détails dans `CLAUDE.md`).

Les règles détaillées (sécurité, intégrité des données, conventions du code) sont dans **`CLAUDE.md`**,
lu automatiquement par les sessions Claude Code.

## Tests automatiques

| Test | Quand | Commande locale |
|---|---|---|
| Contrôle du code (`check-bugs`) | chaque PR | `node scripts/check-bugs.mjs .` |
| Calculs métier | chaque PR | `node scripts/test-calculs.mjs` |
| Fusion des réglages (anti-perte) | chaque PR | `node tests/unit/fusion-reglages.mjs` |
| Pages qui s'ouvrent sans erreur (Playwright) | chaque PR | `npm ci && npx playwright test` |
| Aucun accès anonyme aux données | chaque jour + PR | `tests/securite/acces-anonyme.mjs` |
| Isolation entre sociétés | chaque jour sur le staging + PR | `tests/securite/isolation-societes.mjs` |
| Sauvegarde + restauration d'essai | chaque nuit | `.github/workflows/sauvegarde.yml` |

## Documentation

| Fichier | Contenu |
|---|---|
| `SUIVI-PROJET.md` | avancement du projet de fiabilisation, décisions, points ouverts |
| `CLAUDE.md` | règles de travail et conventions du code |
| `docs/SAUVEGARDES.md` | sauvegardes : fonctionnement, clés, restauration pas à pas |
| `docs/FONCTIONNALITES.md` | inventaire des fonctionnalités |
| `supabase/LISEZ-MOI.md` | organisation de la base, migrations, archives à ne pas rejouer |
| `supabase/migrations/JOURNAL.md` | interventions sur la base de production |
| `pages/manuel.html` | manuel utilisateur (dans l'application) |
