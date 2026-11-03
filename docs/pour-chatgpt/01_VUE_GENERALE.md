# 01 — Vue générale de Parc Pilot

> **Nature de ce document** : instantané de l'état **réel** du projet au **03/11/2026**, destiné à une seconde IA (ChatGPT).
> Produit en **lecture seule** (aucune modification du code ni de Supabase).
> **Légende de fiabilité** utilisée dans toute la série : `[VÉRIFIÉ]` = constaté dans le code/SQL du dépôt · `[DOC]` = affirmé par la doc projet (`CLAUDE.md`, `README.md`, `SUIVI-PROJET.md`) · `[HYPOTHÈSE]` = déduction non prouvée.
> **Confidentialité** : aucun secret, identifiant, ni donnée personnelle réelle n'est reproduit ici (le dépôt est public).

---

## 1. Qu'est-ce que Parc Pilot ?

**Parc Pilot** est un **SaaS de gestion de flotte automobile multi-sociétés** `[DOC: README.md, CLAUDE.md]`.
Il gère : véhicules, conducteurs, amendes/contraventions, factures, contrats (leasing/LLD), sinistres, états des lieux (EDL), entretiens, emprunts/réservations, carburant & péages, documents, alertes d'échéance, statistiques et budget.

| | |
|---|---|
| Produit | Parc Pilot — « Gestion de flotte » `[VÉRIFIÉ: manifest.json]` |
| Propriétaire / 1er client | Shakil Nubeebaccus — société **PXP** (Project X Paris) `[DOC: CLAUDE.md]` |
| Clients/flottes gérées | TJMAX, BPCE (leasing), PROJECT X PARIS RETAIL `[DOC: CLAUDE.md]` |
| Site de production | **https://parc-pilot.fr** (GoDaddy, HTTPS forcé ; `www`→apex) `[DOC]` |
| Ancienne URL | `shakilnubee.github.io/Autoflotte` → redirige vers parc-pilot.fr `[DOC]` |
| Langue de l'UI | Français (portail conducteur multilingue : FR/EN/ES/IT/DE/ZH) `[VÉRIFIÉ: v.html i18n]` |
| Version d'assets courante | `?v=20261102f` (`version.json` build `20261102f`) `[VÉRIFIÉ]` |

## 2. Pile technique (résumé — détail dans `02_ARCHITECTURE_TECHNIQUE.md`)

- **Front** : pages **HTML/CSS/JavaScript statiques** (pas de framework SPA), **Tailwind précompilé** (`assets/css/tailwind.css`). `[VÉRIFIÉ]`
- **Back** : **Supabase** = PostgreSQL + Auth + Storage + **Edge Functions** (Deno/TypeScript). `[VÉRIFIÉ: supabase/functions/*]`
- **Hébergement** : **GitHub Pages**, publication automatique de la branche `main`. `[DOC: README.md]`
- **Logique partagée** : un gros objet global **`FP.*`** (`assets/js/app.js`, ~21 000 lignes) + `supabase-client.js` + `fleet-views.js`. `[VÉRIFIÉ: wc -l]`
- **IA** : scan/OCR de documents via `FP.scanIA` + Edge Function `scan-doc`. `[VÉRIFIÉ]`

## 3. Environnements `[DOC: README.md]`

| | Production | Staging |
|---|---|---|
| Rôle | données clients réelles | essais, données fictives |
| Projet Supabase | `tzjuptlzoywjeigmyfuj` | `csvjmzwexszsbowibxut` |
| Modifications | PR fusionnée + (base) migration testée sur staging + accord | libres |

## 4. Modules fonctionnels (survol — détail dans `03_INVENTAIRE_FONCTIONNEL.md`)

**Pages de gestion** (`pages/`) : `vehicules`, `conducteurs`, `amendes`, `factures`, `entretiens`, `sinistres`, `contrats`, `statistiques`, `budget`, `notifications` (alertes + « À compléter »), `taches`, `controle` (anomalies conso/congés), `emprunts`, `a-vendre`, `calendrier`, `renouvellements`, `scanner`, `facturation`, `espace-salarie`, `parametres`, `manuel`, `guide`, `aide`. `[VÉRIFIÉ: ls pages/]`
**Tableau de bord** : `dashboard.html`.
**Portail conducteur & public** : `v.html` (portail QR conducteur : sinistre/EDL/km/question), `reserver.html` (réservation), `km.html` (relevé km), `signer.html` (signature), `carte.html` (QR véhicule public), `avis.html` (amende publique). `[VÉRIFIÉ]`
**Commercial / onboarding** : `index.html`, `login.html`, `onboarding.html`, `prospects.html`, `brochure.html`, `prix.html`, `demo.html`, `kit-commercial.html`, etc. `[VÉRIFIÉ: ls]`

## 5. Ordres de grandeur des données `[DOC: CLAUDE.md]`

- ~**52 véhicules**, ~**60 amendes 2026**, ~**384 factures**, groupes de véhicules (Siège, Commerciaux, Gov, International, À vendre, Retail, Dépôt, Non classé).
- `assets/js/data.js` = instantané d'affichage hors-ligne **anonymisé** (RGPD : zéro donnée personnelle, dépôt public). Les données réelles vivent **uniquement** dans Supabase (après login, protégées par RLS). `[DOC: CLAUDE.md]`

## 6. Principes de conception structurants `[DOC: CLAUDE.md]`

1. **Source unique de vérité** : un concept (vendu, montant dû, plaque, prénom, coût mois, forfait leasing…) = **un seul** helper `FP.*`, jamais réimplémenté par page.
2. **Intégrité des données = priorité n°1** : écriture = même ligne/clé que la lecture ; via `FP.persist` (file durable) ; jamais d'échec silencieux ; toute map keyée dans `COLLECTION_KEYS`.
3. **Tout synchronisé (Supabase)** : `localStorage` = cache d'affichage seulement.
4. **Multi-sociétés** : code commun à toutes les sociétés ; isolation **côté données** (colonne `societe` + RLS). Rôles via table `profiles`.
5. **Ne rien casser** : correction à la cause racine, pas de suppression de fonctionnalité en douce.
6. **Mobile + desktop**, zéro overflow, thème clair/sombre.
7. **Manuel** (`pages/manuel.html`) tenu à jour avec chaque fonctionnalité.

## 7. Déploiement (résumé) `[DOC: CLAUDE.md, README.md]`

Branche dédiée → PR → tests CI verts (`check-bugs`, calculs, Playwright, sécurité) → fusion dans `main` → GitHub Pages publie en ~1-2 min.
Si `app.js`/`fleet-views.js`/`css`/`data.js` changent : régénérer les `.min.js` (`node scripts/build-min.mjs`) **et** bumper `?v=` partout (+ `sw.js`, `version.json`). HTML seul = pas de bump.

## 8. Où lire la suite

Voir **`INDEX.md`** pour la table des matières des 10 documents.
