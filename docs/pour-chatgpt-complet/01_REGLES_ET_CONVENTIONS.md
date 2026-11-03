# 01 — Règles & conventions de développement

> Source principale : **`CLAUDE.md`** (racine du dépôt, très détaillé — sert de spécification de fait) + `README.md`, `SUIVI-PROJET.md`. `[DOC]` sauf mention. Ces règles **priment** : toute évolution proposée par ChatGPT doit les respecter.

## 1. Les 16 règles transversales (contrat permanent)
1. **Ne rien casser** : jamais supprimer une feature / changer une logique métier non demandée / contourner un bug en désactivant une fonctionnalité → corriger la **cause racine**.
2. **Lecture IA à chaque dépôt** : réutiliser **`FP.scanIA`** (moteur unique), jamais un 2ᵉ moteur.
3. **Lire, jamais deviner** : s'ancrer sur les libellés, couche texte d'abord, contrôler `HT+TVA=TTC`, montant **minoré** pour les amendes, ne rien inventer (`null` si absent).
4. **Source unique de vérité** : une règle/un calcul = **un seul** helper `FP.*`, réutilisé partout.
5. **Styles & composants cohérents** : réutiliser cartes/champs/boutons/modales existants.
6. **« Voir tout / Voir moins » réversible** : jamais un déploiement à sens unique, jamais `<details>` natif pour ça.
7. **Propagation globale** : desktop + mobile, fiches, tableaux, dashboard, stats, filtres, PDF, e-mails, portail conducteur, exports.
8. **Persistance Supabase** : source de vérité = Supabase ; `localStorage` = cache d'affichage seulement ; zéro perte.
9. **Multi-sociétés** : code commun à toutes les sociétés ; données/config propres à chaque société (filtrage par `societe` + RLS).
10. **Sécurité & permissions** : `FP.esc` sur toute donnée injectée ; aucun secret dans le code ; respect des rôles.
11. **Ergonomie** : sélecteurs recherchables au clavier, bouton « Réinitialiser », filtres de période, « prévenir un conducteur » = **SMS + WhatsApp + e-mail**, téléchargement PDF en 1 clic.
12. **Anti-doublons** : réutiliser **`FP.dupe`** à chaque nouvel ajout.
13. **Feedback & anti double-clic** : succès/erreur visibles, protection pendant l'async.
14. **Manuel utilisateur à jour** : `pages/manuel.html` mis à jour **dans le même lot** que la feature.
15. **Déploiement** : branche + PR, jamais de push direct sur `main` ; régénérer les `.min.js` + bumper `?v=` si `app.js`/`fleet-views.js`/`css`/`data.js` changent ; CI verte.
16. **En cas de doute** : expliquer les risques, proposer, **demander validation** avant d'agir.

## 2. Intégrité des données — pièges vécus à ne jamais refaire (règle « 0-perte », priorité n°1)
- **① « Deux tiroirs »** : l'écriture doit viser la **même ligne/clé** que la lecture (`FP.settings._effectiveId`). Jamais écrire dans une ligne différente de celle lue.
- **② Toute map de données keyée** (`s.X[cond]`, `s.X[immat]`…) doit être dans **`COLLECTION_KEYS`** (sinon écrasée en bloc par un cache en retard).
- **③ Échec d'écriture silencieux interdit** : tout passe par `FP.persist` (file + retente), erreur visible (`#fp-sync-badge`, `FP.notifyError`). Jamais de `.catch()` vide.
- **④ Ne jamais réécrire un cache périmé par-dessus le serveur** : fusion « delta » (`applyDelta`/`_serverSnap`), une clé absente du cache est préservée.
- **⑤ Migrations au chargement = danger** : après chargement serveur, drapeau « fait » persistant, jamais réduire une liste utilisateur.
- **⑥ Écriture « en vol »** : la file `FP.persist` enfile **avant** l'`await` (pas seulement dans le `catch`) + flush sur `pagehide`.
- **⑦ Données de travail → tables dédiées** (congés, affectations, contrats LLD, forfaits leasing, assurances/tâches/sinistres) via `FP.projections` (cf. `06`).
- **Réflexe** : « si l'utilisateur saisit ça puis recharge sur un autre appareil, le retrouve-t-il exactement ? ». Sinon, ne pas livrer.

## 3. Source unique — ne jamais recalculer un concept à la main
Lire/calculer **toujours** via le helper canonique (cf. `03`/`08`) : plaque (`FP.normImmat`/`immatEq`/`vehByImmat`), prénom/clé conducteur (`FP.normPrenom`/`prenomDeCle`/`condKeyParNom`/`migrateCondKey`), « vendu » (`FP.estVendu`), montant dû amende (`FP.montantDu`/`estAPayer`), leasing (`FP.leasingContrat`/`leasingInfo`), loueur (`FP.loueurOf`), TVS (`FP.tvsDetail`), échéances (`FP.buildEcheances`/`joursRestants`/`echeanceStatut`), coût mois (`FP.coutMois`/`dedupeFactures`/`coutFactureExploit`), QR (`renderQrCard`).

## 4. Plaques & conducteurs (classes de bugs récurrentes)
- **Plaque** : formats mixtes en base (`HL-724-CD`, `HL724CD`, minuscules…). Toujours `FP.normImmat`/`immatEq`/`vehByImmat`, jamais comparer en brut. Exception : **clés de réglages déjà keyées par `v.immat`** → ne pas changer la clé (lire de façon tolérante).
- **Clé conducteur** (`c.key`) : aucun format garanti. Jamais déduire le prénom en découpant la clé → `FP.prenomDeCle`. Rapprocher une conso d'un congé via `FP.congeKeysPourPrenom`/`condKeyDeConso`. Renommage/suppression/fusion → `FP.migrateCondKey`/`purgeCondKey`.

## 5. Documents / IA — « lire, jamais deviner » (prioritaire sur tout scan)
Couche texte d'abord (lecture **par position** pour les PDF à couche texte) ; s'ancrer sur le **libellé**, jamais `Math.max`/`Math.min` aveugle ; contrôles de cohérence (HT≤TTC, `HT+TVA≈TTC`) ; ne jamais inventer (nombre absent = `null`, nom inconnu = signalé) ; vérifier sur un vrai fichier. **Amendes** : 3 montants séparés, `montantTTC` = minoré sinon forfaitaire, jamais le majoré ; majoration détectée seulement sur le titre « avis de majoration » ; anti-doublon via `FP.dupe`. **Nouveau prestataire carburant/péage** : même niveau de parseur que Total/Ulys (lignes par position, montant exact, catégorie `FP.txCat`, alerte diesel, écriture dans `total_conso_tx`, rattachement par n° de carte/badge).

## 6. Multi-sociétés & rôles
- Toute modif du **logiciel** (UI/feature) est **globale** (toutes sociétés, présentes et futures). Jamais de feature/libellé spécifique à une société. Les **données** restent propres à chaque société.
- 3 niveaux via `profiles` (jamais `user_metadata`) : **ceo** (toutes sociétés) / **admin** (sa société : tout + config + comptes) / **gestionnaire** (sa société : données, pas config/comptes) + **chauffeur** (portail, dormant). Helpers `FP.role`/`isCEO`/`isAdmin`/`isGestionnaire`/`canManageSociete`/`canManageUsers`.
- Config société gardée par `FP.canManageSociete()`, comptes par `FP.canManageUsers()` (+ portée serveur `manage-users`).
- Adresses d'envoi d'e-mails **par société** : celles de PXP ne doivent pas être réutilisées pour un autre client (demander à la création).

## 7. Tout en self-service dans l'app
Toute la gestion courante (comptes, sociétés, config, saisie/suppression) se fait **dans l'UI**. Ne jamais affirmer qu'une action d'exploitation « passe par Supabase/SQL » sans l'avoir vérifié dans le code (erreur récurrente). Seules les tâches d'**infra one-shot** (déploiement Edge Functions, policies RLS, durcissement SQL) restent côté backend.

## 8. Proactivité (signaler les manques, recalculer)
À chaque ajout : signaler les éléments « qui vont avec » (ex. nouvelle prime → total annuel des primes ; nouveau coût → TCO/coût annuel), recalculer les totaux impactés (coût Contrats, TCO Stats, TVS, dashboard), et faire un mini-audit des trous du même genre ailleurs.

## 9. Supabase — prudence maximale
Avant de toucher tables/colonnes/index/migrations/RLS/policies/storage/auth/fonctions/triggers : expliquer, demander en cas de doute. Migration **versionnée idempotente** (avec retour arrière en commentaire) dans `supabase/migrations/AAAAMMJJHHMMSS_*.sql`, **testée sur staging** d'abord (`migration-staging.yml`), appliquée en prod **avec accord** + sauvegarde, puis notée dans `JOURNAL.md`. **Ne jamais rejouer** `supabase/historique/` ni `supabase/*.sql` (archives, rouvriraient des failles). Garde-fous à préserver : `scans` privé par société, `vehicules_public` lecture seule, ligne `app_settings` id=`global` gelée, anti-vidage.

## 10. Déploiement, build, cache-busting
Branche `sujet/...` → PR → CI (`check-bugs`, `test-calculs`, Playwright, sécurité) verte → fusion `main` → GitHub Pages (~1-2 min). Après modif `app.js`/`fleet-views.js` : `node scripts/build-min.mjs` (empreinte vérifiée par `check-bugs`) **puis** bumper `?v=` partout (+ `sw.js`, `version.json`). Cache d'un **résultat calculé** → inclure `FP.ASSET_VERSION`. RGPD : `data.js` = 0 donnée perso (dépôt public, contrôlé en CI).

## 11. Checklist avant de coder une nouvelle fonctionnalité (10 questions)
(1) composant similaire existant ? (2) helper `FP.*` réutilisable ? (3) règles permanentes applicables ? (4) modules partageant ces données ? (5) risques Supabase (schéma/RLS/Storage → accord) ? (6) tests de non-régression ? (7) mobile (toutes tailles, portrait/paysage, clair/sombre, zéro overflow) ? (8) isolation multi-sociétés ? (9) automatisations préservées ? (10) manuel à mettre à jour ?

> **Compte rendu obligatoire** en fin d'intervention : modifs (fichiers/fonctions) · centralisation (helpers) · données (tables/clés/persistance) · propagation (écrans/mobile/PDF/e-mails/portail) · sécurité/permissions · tests + points à vérifier · manuel · déploiement (minif/bump ou non).
