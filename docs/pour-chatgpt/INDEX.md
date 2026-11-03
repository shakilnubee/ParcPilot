# Parc Pilot — Documentation pour une seconde IA (ChatGPT)

> **But** : permettre à ChatGPT de comprendre l'**état réel** de Parc Pilot (code + Supabase) au **03/11/2026**, afin de proposer des évolutions sans casser l'existant.
> **Produit en lecture seule** — aucune modification du code, de la base, ni déclenchement d'automatisation.
> **Sans secret ni donnée personnelle** (dépôt public).

## Légende de fiabilité (utilisée partout)

- `[VÉRIFIÉ]` — constaté directement dans le code / SQL du dépôt (référence `fichier:ligne` ou nom de table/fonction donnée).
- `[DOC]` — affirmé par la documentation projet (`CLAUDE.md`, `README.md`, `SUIVI-PROJET.md`, `supabase/*.md`).
- `[HYPOTHÈSE]` — déduction plausible **non prouvée** ; à confirmer.

## Table des matières

| # | Document | Contenu |
|---|---|---|
| 00 | **INDEX.md** | Ce sommaire + légende + conventions |
| 01 | **01_VUE_GENERALE.md** | Qu'est-ce que Parc Pilot, pile, environnements, modules, principes |
| 02 | **02_ARCHITECTURE_TECHNIQUE.md** | Dossiers/fichiers, front/back, objet `FP.*`, Supabase client, cache & synchro, déploiement |
| 03 | **03_INVENTAIRE_FONCTIONNEL.md** | Chaque page/module : rôle, actions, données, tables, connexions, état |
| 04 | **04_SUPABASE_DONNEES.md** | Tables, colonnes, relations, RLS, isolation sociétés, storage, RPC, tables dédiées |
| 05 | **05_AUTOMATISATIONS_NOTIFICATIONS.md** | Edge Functions, CI/CD, crons, e-mails, alertes, push |
| 06 | **06_INTELLIGENCE_ARTIFICIELLE.md** | `FP.scanIA`, Edge `scan-doc`, documents analysés, contrôles, modèles |
| 07 | **07_WORKFLOWS_COMPLETS.md** | Parcours bout-en-bout (véhicule, conducteur, QR, sinistre, entretien, amende, facture, réservation, carburant, alertes, exports) |
| 08 | **08_CALCULS_REGLES_METIER.md** | TCO, carburant, coûts, fiscalité (TVS), km/échéances, agrégations, fonctions sources |
| 09 | **09_SECURITE_PERMISSIONS.md** | Rôles, autorisations par module, accès public/QR, auth, RLS, isolation inter-sociétés |
| 10 | **10_ETAT_REEL_ET_AMELIORATIONS.md** | Maturité par fonctionnalité + analyse des manques (faits vs recommandations) |

## Comment lire cette documentation

1. Commencer par **01** (vue générale) puis **02** (architecture) pour le modèle mental.
2. **03** et **04** sont les références détaillées (fonctionnalités / données).
3. **05–08** décrivent les mécanismes (automatisations, IA, parcours, calculs).
4. **09** = sécurité. **10** = état de maturité + pistes d'évolution (les recommandations y sont **clairement séparées** des faits).

## Sources primaires du dépôt (pour vérifier/approfondir)

- `CLAUDE.md` — règles de dev + conventions (très détaillé ; sert de spécification de fait).
- `README.md`, `SUIVI-PROJET.md`, `TESTS-A-FAIRE.md`, `docs/FONCTIONNALITES.md`, `docs/AUDITS.md`, `docs/SAUVEGARDES.md`.
- `supabase/LISEZ-MOI.md`, `supabase/migrations/JOURNAL.md`, `supabase/*.md`.
- Code : `assets/js/app.js` (FP.*), `assets/js/supabase-client.js`, `pages/*.html`, `supabase/functions/*`, `supabase/migrations/*`, `.github/workflows/*`.
