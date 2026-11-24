# 11 — Nouveautés récentes & aide au prompt (pour ChatGPT)

> **Nature de ce document** : liste des **changements récents** de Parc Pilot + les **conventions** à connaître pour rédiger des demandes de développement justes (destiné à une seconde IA, ChatGPT).
> Produit en **lecture seule** (aucune modification du code ni de Supabase).
> **Légende de fiabilité** : `[VÉRIFIÉ]` = constaté dans le code du dépôt · `[DOC]` = affirmé par la doc projet (`SUIVI-PROJET.md`, `CLAUDE.md`) · `[HYPOTHÈSE]` = déduction non prouvée.
> **Confidentialité** : aucun secret ni donnée personnelle (dépôt public).
> **Mise à jour : 24/11/2026.**

---

## Règle d'or (à rappeler dans chaque prompt)

Un même concept = **UN SEUL helper `FP.*`** (source unique), consommé par **tous** les écrans (tableau de bord, pages, exports). Ne jamais recalculer un concept à la main s'il existe déjà un helper. `[DOC]`

**Déploiement** : chaque modif = **branche + pull request**, fusionnée quand la CI est verte (`controles`, `e2e`). « **HTML seul** » (pages `.html`) → pas de rebuild, pas de bump `?v=`. Si **`assets/js/app.js`** ou **`assets/js/fleet-views.js`** changent → **`node scripts/build-min.mjs`** + **bump `?v=` partout**. `[DOC]`

---

## Nouveautés récentes

### 1. Filtre Énergie — page Véhicules `[VÉRIFIÉ pages/vehicules.html]`
- Menu **« Toutes énergies »** à côté de « Toutes catégories », **section indépendante et combinable** (ex. `SUV` + `Électrique` + propriétaire juridique + statut + recherche).
- Source = champ **`carburant`** normalisé via **`FP.normCarburant`** (regroupe « EL » → Électrique, codes P.3). Options = énergies **réellement présentes** (ordre `FP.CARBURANTS`) + **« Non renseignée »** si des fiches n'ont pas l'info.
- S'applique aux **3 vues** (Tableau / Cartes / Galerie, via `filtered()`) **ET aux exports** (`getRows: () => filtered()`), au résumé des filtres et au bouton « ↺ Réinitialiser ».
- ⚠️ **Hybride rechargeable (PHEV) et non rechargeable (HEV) NE sont PAS distingués** : le champ unique `carburant` ne le permet pas. Pour les séparer il faudrait **un nouveau champ** (CO₂ ou indicateur) = **modification Supabase à valider** — ne pas le demander autrement.

### 2. Scanner — lecteur PDF natif `[VÉRIFIÉ pages/scanner.html]`
- Sur l'écran de validation « Facture / devis entretien », le document s'affiche dans le **lecteur PDF intégré du navigateur** (iframe), plus la visionneuse canvas. **`FP.scanIA`**, l'extraction des champs et le contrôle **HT + TVA = TTC** sont **inchangés**.

### 3. KPI « Sinistres à rembourser » — cohérence tableau de bord ↔ page `[VÉRIFIÉ dashboard.html, pages/sinistres.html]`
- Même **périmètre** que l'onglet Sinistres → « Remb. en attente » : un dossier dont l'**étape Remboursements est « sans objet »** (`sinistreEtapeIgnore[key].reglements`) **ne compte plus** (reste à charge définitif).
- La **carte** du dashboard ouvre directement l'onglet via **`pages/sinistres.html?remb=attente`**.
- **Formule inchangée** : coût réel du sinistre (hors devis, `FP.coutSinistre`) − remboursements saisis, plancher 0.

### 4. Périmètre « flotte active » unifié = `!FP.horsFlotte` `[VÉRIFIÉ dashboard.html, ecran.html, statistiques.html]`
- Le tableau de bord, l'écran mural et Statistiques (CO₂ + conformité) comptent désormais le **« parc possédé »** via **`!FP.horsFlotte`** (exclut vendu / cédé / restitué / hors service / archivé), **comme** Budget et Contrats.
- **Ne plus utiliser `!FP.estVendu`** pour un compteur de flotte (il n'exclut que « vendu »).

### 5. (EN COURS) `FP.estAssure(v)` — source unique « véhicule assuré »
- Objectif : **une seule** définition de « assuré », consommée par Statistiques **et** `FP.suivi`. Définition **LARGE** validée : assuré dès qu'il y a un indice — champ assurance renseigné, **ou** assureur rattaché (`FP.assureurOf`), **ou** prime (`assurancePrimes`), **ou** document d'assurance, **ou** marqué « ignoré » (`assuranceIgnore`). `[DOC — lot en cours]`

### 6. (Hors code) Deck « Parc Pilot – Guide des conducteurs »
- Support de formation conducteurs (artefact de présentation, couleurs orange/noir Parc Pilot). N'affecte pas l'application.

---

## Helpers canoniques à citer dans les prompts `[VÉRIFIÉ assets/js/app.js]`

| Concept | Helper `FP.*` |
|---|---|
| Montant dû / à payer (amendes) | `FP.montantDu`, `FP.estAPayer` |
| Coût réel / reste à charge (sinistre) | `FP.coutSinistre`, `FP.resteChargeSinistre`, `FP.sinistreStatutOf` |
| Coûts (mois, exploitation, dédoublonnage) | `FP.coutMois`, `FP.coutFactureExploit`, `FP.dedupeFactures`, `FP.coutExploitAnnee` (TCO) |
| TVS | `FP.tvsDetail`, `FP.tvsAnnuelleFlotte` |
| Périmètre flotte | **`FP.horsFlotte`** (parc possédé) · `FP.estVendu` (vendu seul) |
| Kilométrage | `FP.kmActuel` |
| Énergie / carburant | `FP.normCarburant`, `FP.CARBURANTS` |
| Plaques | `FP.normImmat`, `FP.immatEq`, `FP.vehByImmat` |
| Formatage montant | `FP.euro` |

---

## Comment bien demander une évolution (modèle de prompt)

1. **Besoin métier** : qui / quoi / où (écran, bouton, données).
2. **Nommer** le helper `FP.*` ou l'écran concerné, et **réutiliser l'existant** plutôt que recréer.
3. Préciser la **portée** : « **HTML seul** » (pas de bump) ou « **touche `app.js`** → build-min + bump ».
4. Rappeler les garde-fous : **ne rien casser**, **cloisonnement multi-sociétés**, **aucune modification Supabase sans accord explicite**, **`FP.scanIA` et contrôle HT+TVA=TTC préservés**, **manuel (`pages/manuel.html`) + `SUIVI-PROJET.md` à jour**, **tests** (`node scripts/check-bugs.mjs .` + parcours concerné).
5. Si une règle métier est **ambiguë** : demander l'arbitrage plutôt que supposer.
