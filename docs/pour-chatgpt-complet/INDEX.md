# Parc Pilot — Dossier technique exhaustif pour ChatGPT

> Documentation **détaillée** de l'état réel de Parc Pilot au **03/11/2026** (commit `92a8404`), produite en **lecture seule**. Objectif : permettre à ChatGPT de concevoir, auditer et améliorer Parc Pilot **sans casser l'existant** et sans devoir redemander des précisions.
> Sans secret ni donnée personnelle (dépôt public).

## Légende de fiabilité
- `[VÉRIFIÉ]` — constaté dans le code/SQL (référence donnée) · `[DOC]` — doc projet (`CLAUDE.md`…) · `[HYPOTHÈSE]` — déduction non prouvée · `[À VÉRIFIER EN BASE]` — nécessite un accès Supabase.

## Sommaire
| # | Fichier | Contenu |
|---|---|---|
| 00 | `00_MANIFESTE.md` | Date, version, commit, inventaire des fichiers, infos non vérifiées, évolutions |
| 01 | `01_REGLES_ET_CONVENTIONS.md` | 16 règles transversales + intégrité des données + source unique + plaques/conducteurs + IA + multi-sociétés + déploiement |
| 02 | `02_CARTE_DU_CODE.md` | Arborescence, ordre de chargement, graphe de dépendances, aiguillage |
| 03 | `03_FONCTIONS_FP.md` | Carte des helpers `FP.*` (signature, rôle, lit/écrit, risque régression) |
| 04 | `04_FONCTIONS_LOCALES_PAGES.md` | Fonctions locales notables par page (parseurs, rendus, handlers) |
| 05 | `05_PAGES_DETAIL.md` | Chaque page en grille 15 points |
| 06 | `06_SUPABASE_DICTIONNAIRE.md` | Tables, colonnes/types, PK/FK, index, triggers, RPC, RLS, Storage |
| 07 | `07_WORKFLOWS_DETAIL.md` | Parcours bout-en-bout + validations + anti-doublon + chemins d'erreur |
| 08 | `08_AUTOMATISATIONS_DETAIL.md` | Edge Functions, CI, crons, push — déclencheur/données/erreurs/test |
| 09 | `09_PROBLEMES_ET_LIMITES.md` | Faits vérifiés · hypothèses · recommandations (strictement séparés) |
| 10 | `10_MISE_A_JOUR.md` | Processus de régénération + modèle de delta |

## Guide de navigation — « quelle section lire selon ma demande ? »
| Je veux… | Lire d'abord | Puis |
|---|---|---|
| Comprendre le projet vite | `00`, `02` | `05` |
| Modifier **une page** | `05` (la page) | `04` (ses fonctions), `03` (helpers utilisés), `01` (règles) |
| Ajouter/changer **un calcul ou une règle** | `03` §4 (calculs) | `08_CALCULS` de `docs/pour-chatgpt/` + `01` (source unique) |
| Toucher à **la base** (table/colonne/RLS/RPC) | `06` | `01` §9 (prudence Supabase), `09` (migrations en attente) |
| Ajouter/modifier **une automatisation / un e-mail / un cron** | `08` | `06` (tables touchées) |
| Comprendre **un parcours utilisateur** (de l'UI à la base) | `07` | `05` + `08` |
| Diagnostiquer un **risque de perte de données** | `01` §2, `03` §1 | `09` |
| Savoir **ce qui est fragile / à finir** | `09` | `00` (à vérifier en base) |

## Comment identifier rapidement la/les fonction(s) concernée(s) par une demande
1. **Nommer la fonctionnalité** (pas le mot exact tapé) — ex. « QR », « montant dû », « congés », « leasing ».
2. Chercher le **helper canonique** dans `03` (source unique) — ex. QR → `FP.qr`/`renderQrCard` ; montant dû → `FP.montantDu` ; congés → `FP.congesTable` ; leasing → `FP.leasingContrat`.
3. Trouver la **page** qui l'utilise dans `05`, et ses **fonctions locales** dans `04`.
4. Vérifier les **tables** impliquées dans `06`, les **automatisations** dans `08`, les **dépendances** dans `02` §3.
5. Vérifier les **règles** applicables dans `01` (ne rien casser, propagation globale, persistance, anti-doublon…).
6. Consulter `09` pour ne pas réintroduire un bug corrigé ni ignorer une limitation connue.

## Sources primaires du dépôt (pour approfondir)
`CLAUDE.md` (règles), `README.md`, `SUIVI-PROJET.md`, `supabase/LISEZ-MOI.md`, `supabase/migrations/JOURNAL.md`, `supabase/*.md` · code : `assets/js/app.js`, `assets/js/supabase-client.js`, `pages/*.html`, `supabase/functions/*`, `supabase/migrations/*`, `.github/workflows/*`.
Voir aussi la **vue d'ensemble** plus accessible : `docs/pour-chatgpt/` (11 fichiers).

## Archive
Une archive `Parc-Pilot-doc-complete.zip` regroupe tout ce dossier (à donner à ChatGPT en un seul envoi). Pour la régénérer : voir `10_MISE_A_JOUR.md`.
