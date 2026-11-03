# 00 — Manifeste

## Génération
- **Date de génération** : 2026-11-03
- **Version du projet (assets)** : `?v=20261102f` (`version.json` → build `20261102f`)
- **Commit Git analysé** : `92a8404` (`92a8404e8eeeddf1ddd698740df9c20eb42606b8`) sur la branche `claude/nouvelle-session-codage-lgd4s1`
- **Nature** : documentation technique **exhaustive**, produite en **lecture seule** (aucune modification du code applicatif ni de Supabase). Succède à `docs/pour-chatgpt/` (vue d'ensemble) sans l'écraser.

## Périmètre analysé (inventaire des fichiers)
| Catégorie | Nombre | Emplacement |
|---|---|---|
| Pages HTML racine (public, portail, commercial) | 27 | `/*.html` |
| Pages HTML applicatives | 24 | `pages/*.html` |
| JS sources (hors `.min.js`) | 7 | `assets/js/*.js` |
| CSS | 3 | `assets/css/*.css` (`tailwind.css` précompilé, `styles.css`, `_tw-input.css`) |
| Edge Functions (Deno/TS) | 13 | `supabase/functions/*` |
| Migrations versionnées | 25 | `supabase/migrations/*.sql` |
| Scripts SQL racine (archives + setups) | 47 | `supabase/*.sql` |
| Workflows GitHub | 6 | `.github/workflows/*.yml` |
| Scripts Node | 6 | `scripts/*.mjs` |
| Fichiers de test | 16 | `tests/**` |

## Sections couvertes (ce dossier)
`00_MANIFESTE` · `01_REGLES_ET_CONVENTIONS` · `02_CARTE_DU_CODE` · `03_FONCTIONS_FP` · `04_FONCTIONS_LOCALES_PAGES` · `05_PAGES_DETAIL` · `06_SUPABASE_DICTIONNAIRE` · `07_WORKFLOWS_DETAIL` · `08_AUTOMATISATIONS_DETAIL` · `09_PROBLEMES_ET_LIMITES` · `10_MISE_A_JOUR` · `INDEX` (sommaire + guide de navigation).

## Légende de fiabilité (utilisée partout)
- `[VÉRIFIÉ]` — constaté directement dans le code/SQL du dépôt (référence donnée).
- `[DOC]` — affirmé par la documentation projet (`CLAUDE.md`, `README.md`, `SUIVI-PROJET.md`, `supabase/*.md`).
- `[HYPOTHÈSE]` — déduction plausible non prouvée.
- `[À VÉRIFIER EN BASE]` — ne peut être confirmé que par un accès direct à Supabase (voir ci-dessous).

## Informations non vérifiées / nécessitant un accès Supabase
Le dépôt ne prouve pas tout. À confirmer via un accès **lecture seule** à la base (SQL `information_schema` / éditeur Supabase), **sans exposer de secret ni de donnée personnelle** :
1. **Colonnes/types exacts** des tables créées **avant** le dépôt : `documents`, `emprunts`, `total_conso` (schéma non versionné). → `select column_name, data_type from information_schema.columns where table_name = '…'`.
2. **État réellement appliqué en prod** vs archives : certaines policies/colonnes existent en plusieurs versions dans `supabase/*.sql` et `historique/`. La source de vérité = migrations versionnées + `supabase/migrations/JOURNAL.md`. → comparer avec `pg_policies`, `information_schema`.
3. **Modèle IA réellement actif** : dépend des secrets `ANTHROPIC_MODEL`/`OPENAI_MODEL` (non visibles). → vérifier les secrets de la fonction `scan-doc` dans Supabase.
4. **Index/contraintes effectifs** : confirmés pour les tables créées par migration ; `[À VÉRIFIER EN BASE]` pour les tables héritées.
5. **CRON réellement planifiés** : les `supabase/*-setup.sql` définissent les `cron.schedule`, mais l'état actif se vérifie via `select * from cron.job`.

## Évolutions depuis la documentation précédente (`docs/pour-chatgpt/`)
- Ce dossier **approfondit** : carte des fonctions (signatures/appelants/effets de bord), dictionnaire de données typé, fonctions locales des pages, workflows avec chemins d'erreur, automatisations détaillées, problèmes/limites consolidés.
- **Correctif documentaire** repris : clé de cache réelle = `fp_data_cache_v4_<societe>` (et non `v3` comme écrit dans `CLAUDE.md`).
- **Nouveauté produit du 03/11/2026** intégrée : rapport PDF sinistre refondu (format « Déclaration », pièces jointes scopées à l'incident, préfixe de catégorie retiré à l'affichage).

## Règles de sécurité de cette documentation
Aucun secret, token, clé API, URL signée privée, identifiant de session ni donnée personnelle réelle n'est inclus. Le dépôt est **public** : cette documentation est sûre à partager. Les noms de variables d'environnement sont cités, jamais leurs valeurs.
