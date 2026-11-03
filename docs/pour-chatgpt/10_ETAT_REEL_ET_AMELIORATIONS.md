# 10 — État réel & pistes d'amélioration

> Instantané 03/11/2026, lecture seule. Ce document **sépare strictement** les **faits vérifiés** (partie A/B) des **recommandations** (partie C, non prouvées, à valider). Légende `[VÉRIFIÉ]` / `[DOC]` / `[HYPOTHÈSE]` / `[RECO]`.
> ⚠️ Un « état opérationnel » ici signifie : code présent et cohérent, sans marqueur d'incomplétude. Il **ne vaut pas** test fonctionnel exhaustif en production (seuls les tests CI — calculs, sécurité, smoke Playwright — sont automatisés).

## A. Maturité par fonctionnalité (fait vérifié dans le code)

### Opérationnel & couvert par des tests/garde-fous
- Isolation multi-sociétés (RLS `tenant_*` + tests `isolation.yml` quotidiens sur staging). `[VÉRIFIÉ]`
- Accès anonyme fermé (test `securite.yml` quotidien). `[VÉRIFIÉ]`
- Intégrité réglages : fusion delta, `COLLECTION_KEYS`, projections → tables dédiées (tests `tests/unit/*`). `[VÉRIFIÉ]`
- Calculs métier (coûts/TCO/TVS/leasing/échéances) → `test-calculs.mjs`. `[VÉRIFIÉ]`
- Sauvegarde chiffrée + restauration d'essai nocturne. `[VÉRIFIÉ]`

### Opérationnel (code mature, pas de marqueur d'incomplétude ; test fonctionnel prod non automatisé)
- **Cœur métier** : véhicules, conducteurs, amendes, factures, entretiens, sinistres, contrats (leasing/assurance/TVS). `[VÉRIFIÉ: 03]`
- **Dashboard, statistiques, budget, notifications/alertes, tâches, contrôle conso, emprunts, a-vendre, calendrier, renouvellements, paramètres.** `[VÉRIFIÉ: 03]`
- **Portail conducteur** (`v.html`), **réservation** (`reserver.html`), **relevé km** (`km.html`), **signature EDL** (`signer.html`), **QR** (`carte.html`), **avis** (`avis.html`). `[VÉRIFIÉ]`
- **Scan IA** (`FP.scanIA` + `scan-doc`, multi-modèles, lecture croisée, couche texte d'abord). `[VÉRIFIÉ: 06]`
- **Comptes self-service** (`manage-users`), **e-mails** (`send-email`), **CRON** (km-relance, task-reminders, ulys-daily). `[VÉRIFIÉ: 05]`
- **Rapport PDF sinistre** refondu (format « Déclaration », pièces jointes scopées à l'incident) — livré ce jour. `[VÉRIFIÉ]`

### Implémenté mais non activé / dormant
- **Espace salarié** (`pages/espace-salarie.html`) : page présente et fonctionnelle, mais rôle `chauffeur` non sécurisé côté serveur → **non activé** (aucun compte chauffeur en prod). `[VÉRIFIÉ + DOC]`
- **Ancien scanner-modale** du dashboard : **code mort volontaire** (secours), activé seulement si `#btn-scan-doc-classic` existe. `[VÉRIFIÉ]`
- **`ulys-sync`** : passerelle API Ulys **lecture seule** (paliers d'écriture non faits). `[VÉRIFIÉ]`
- **`yousign`** : signature externe disponible **en plus** de la signature intégrée `edl-sign` (env par défaut `sandbox`). `[VÉRIFIÉ]`

### Partiellement développé / en attente (migrations)
- **Notes de frais** : colonnes `factures.source/categorie/conducteur` — migration **à lancer** (sinon non persistées). `[VÉRIFIÉ: MIGRATIONS-EN-ATTENTE.md]`
- **Concurrence `app_settings`** : phase 2 (CAS optimiste côté code) **non branchée**. `[VÉRIFIÉ]`
- **`conducteurs.id` stable** : préparé, bascule `key`→`id` **non faite**. `[VÉRIFIÉ]`
- **« Solution 2 » e-mails** (envoi au nom société depuis domaine plateforme) : **en attente de go**. `[DOC]`

### Anomalies connues (faits)
- **Fuite EDL/autre sinistre dans le rapport PDF** : **corrigée ce jour** (pièces jointes scopées à l'incident). `[VÉRIFIÉ]`
- **Préfixe « Autre souci — »** dans le récit : stocké à la source (`v.html`) ; **retiré à l'affichage** (PDF) ce jour, base inchangée. Reste à décider si on passe la catégorie en champ structuré à la source. `[VÉRIFIÉ]`
- **Écart doc** : `CLAUDE.md` cite `fp_data_cache_v3`, le code utilise **`v4`**. `[VÉRIFIÉ]`
- **Colonnes non versionnées** : `documents`, `emprunts`, `total_conso` créées avant le dépôt → schéma exact non prouvé. `[HYPOTHÈSE]`

## B. Analyse des manques — faits vérifiés
1. **`app_settings` surchargé** : mélange config + données de travail → protection config seulement au niveau UI pour les gestionnaires ; migration vers tables dédiées **en cours** (congés, affectations, contrats, forfaits, assurances/tâches/sinistres déjà faits). `[VÉRIFIÉ]`
2. **Copie de transition** : `km-collect` lit encore la copie d'affectations dans `app_settings`, pas la table `vehicle_assignments`. `[VÉRIFIÉ: CLAUDE.md]`
3. **Doublons de logique maîtrisés** : vues Total/Ulys unifiées (`fleet-views.js`, plus d'iframe) ; QR unifié (`renderQrCard`) ; helpers canoniques. Aucun doublon de logique non centralisé prouvé au moment de l'audit. `[VÉRIFIÉ]`
4. **Processus encore manuels** : détail conducteur Ulys/Total rempli par l'app (seuls les en-têtes Ulys sont automatisés) ; scan des cartes grises en lot à finir (tâche ouverte CLAUDE.md). `[DOC]`

## C. Pistes d'amélioration — recommandations `[RECO]` (non prouvées, à valider)
> À considérer **sans remettre en cause l'existant**. Chaque piste est une proposition, pas un constat.

1. **Finir la sortie de `app_settings`** : séparer config / données de travail en lignes distinctes, puis reprotéger la config côté base (RLS) pour les gestionnaires. Débloquerait aussi la phase 2 de concurrence (CAS `rev`). `[RECO]`
2. **Basculer `km-collect`** sur la table `vehicle_assignments` (supprimer la copie de transition). `[RECO]`
3. **Sécuriser l'espace salarié** avant toute activation (role+plaques dans `profiles`, RLS lecture seule scopées plaque) — condition **bloquante** pour un usage chauffeur. `[RECO]`
4. **Catégorie de déclaration en champ structuré** (`v.html`) au lieu du préfixe dans le texte → cohérence « nature » PDF/écran sans traitement d'affichage. `[RECO]`
5. **Lancer la migration notes de frais** (`factures.source/categorie/conducteur`). `[RECO]`
6. **Aligner `CLAUDE.md`** sur le cache `v4` (correctif documentaire). `[RECO]`
7. **Versionner le schéma des tables héritées** (`documents`, `emprunts`, `total_conso`) dans une migration de référence (documentation + staging). `[RECO]`
8. **Observabilité** : exposer un petit tableau de bord interne des CRON (dernier run/erreurs km-relance/ulys-daily/task-reminders) — aujourd'hui visibles surtout via e-mails/logs. `[RECO]`
9. **Scalabilité multi-clients** : pagination systématique (déjà `FP.selectAllPaged` pour conso) ; surveiller la taille de `app_settings.data` par société à mesure que les données de travail en sortent. `[RECO]`

## D. Pour ChatGPT — comment proposer des évolutions sans casser
- **Réutiliser** les helpers `FP.*` existants (ne jamais réimplémenter un calcul/une règle). `[DOC]`
- **Toute donnée réglable** → Supabase (pas `localStorage` seul) ; **toute map keyée** → `COLLECTION_KEYS` + éventuellement table dédiée via `FP.projections`. `[DOC]`
- **Base** : migration versionnée idempotente, testée sur staging, accord avant prod ; jamais rejouer les scripts `supabase/historique/`. `[DOC]`
- **Déploiement** : branche + PR, CI verte ; rebuild `.min.js` + bump `?v=` si `app.js`/`fleet-views.js`/`css`/`data.js` changent. `[DOC]`
- **Manuel** (`pages/manuel.html`) à mettre à jour avec chaque fonctionnalité. `[DOC]`
