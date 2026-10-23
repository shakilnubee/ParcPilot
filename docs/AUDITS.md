# Parc Pilot — Batterie d'audits (à relancer de temps en temps)

> ## 🧭 SYSTÈME v2 — 25 auditeurs, 4 niveaux de contrôle, audit CIBLÉ (2026-10-12)
>
> Principe (validé par l'utilisateur) : **des contrôles systématiques et ciblés, pas 25 agents qui
> relisent tout à chaque fois.** On choisit les auditeurs selon ce qui est modifié, et un déploiement
> n'est autorisé que si les **contrôles bloquants** passent.
>
> ### Les 4 niveaux
> | Niveau | Quand | Quoi | Outil |
> |---|---|---|---|
> | **1. Avant chaque commit** | automatique (hook pré-push) | syntaxe, cache `?v=`, liens, RGPD, `.min` à jour **+ tests unitaires des calculs** | `node scripts/check-bugs.mjs .` · `node scripts/test-calculs.mjs` |
> | **2. Avant déploiement** | GitHub Actions (`.github/workflows/ci.yml`) | les mêmes contrôles sur chaque PR → **bloque une fusion cassée** | CI |
> | **3. Audit profond** | manuel (« fais l'audit ») | les 25 auditeurs en parallèle (findings vérifiés, NE PAS modifier) | agents |
> | **4. Audit ciblé** | manuel | seulement les auditeurs liés aux fichiers modifiés | `node scripts/audit-router.mjs` |
>
> ### Routeur (fichier modifié → auditeurs) — `scripts/audit-router.mjs`
> OCR/scan → **8, 9, 17, 21** · TCO/calculs → **3, 4, 19, 20** · Supabase/données → **1, 2, 5, 13, 16** ·
> Interface → **6, 10, 15, 24**. (Le routeur ajoute toujours #10 régression.)
>
> ### Les 25 auditeurs (périmètre · critère de réussite)
> 1. **Sécurité & accès** — secrets/XSS/rôles/auth · aucune donnée non échappée, restriction tenue serveur.
> 2. **Isolation sociétés & RGPD** — caches/filtres par société, PII `data.js` · 0 fuite, grep PII = 0.
> 3. **Calculs financiers** — un coût remonte dans TOUS les totaux · pas de double-compte, pas de /0.
> 4. **Cohérence inter-pages** — même concept = même helper `FP.*` · aucun écran qui diverge.
> 5. **Synchro / perte de données** — mapping base, écriture non avalée · une saisie se retrouve après rechargement.
> 6. **Rafraîchissement d'état** — compteurs/caches à jour, pas de « revenant » · tout se met à jour sans F5.
> 7. **Échecs silencieux** — uploads/écritures avalées · tout échec a un retour visible.
> 8. **Lecture OCR/IA & doublons** — jamais `Math.max`, HT+TVA=TTC, `FP.dupe` · montants exacts, pas de doublon.
> 9. **Remplissage auto & rapprochements** — auto-fill, ne jamais inventer un nom · bons champs, bon conducteur.
> 10. **Régression / perte après merge** — feature présente en historique mais disparue · rien ne « re-disparaît ».
> 11. **Performance** — O(n²), rechargements redondants · pas de lag, index `Map` réutilisés.
> 12. **Suppression/édition répercutée** — orphelins, KPI figés · une action se répercute partout.
> 13. **Concurrence & modifs simultanées** — 2 utilisateurs en même temps · aucune écriture perdue.
> 14. **Sessions & permissions** — expiration, déconnexion, changement de rôle · jamais d'accès après logout.
> 15. **PWA / service worker / cache** — `sw.js`, MAJ, hors-ligne · pas d'ancienne version servie après déploiement.
> 16. **Intégrité des données & relations** — dépendances (véhicule↔factures/amendes…) · pas d'orphelin (= #12 élargi).
> 17. **Connecteurs & API externes** — Edge Functions (IA/Resend/Drive) · échec géré + visible, jamais de perte.
> 18. **Automatisations & notifications** — fonctions planifiées, alertes, push · se déclenchent, idempotentes.
> 19. **Précision financière & arrondis** — centimes, arrondis cumulés · HT+TVA=TTC au centime partout.
> 20. **Dates / échéances / fuseaux** — fuseau, UTC, changement d'heure · `FP.joursRestants` jamais décalé d'un jour.
> 21. **Robustesse imports & fichiers** — CSV/PDF/HEIC malformés, gros fichiers · jamais de crash ni de perte muette.
> 22. **Charge & volumétrie** — test ×10 données FICTIVES isolées · pages < 2 s, pas d'O(n²).
> 23. **Sauvegarde / restauration** — export de secours, reprise · une restauration redonne l'état exact.
> 24. **Parcours réels & accessibilité** — bout-en-bout + WCAG (skill `accessibility`) · parcours critiques OK.
> 25. **Fiabilité des tests** — méta : les tests sont-ils bons ? que reste-t-il NON testé ? · liste honnête des trous.
>
> ### Tests destructifs / charge / simulation d'erreurs
> UNIQUEMENT en **environnement isolé avec données FICTIVES** (jamais la prod, jamais les RLS/fonctions métier).
>
> ### Format du rapport centralisé
> Critiques / Majeurs / Mineurs · tests réussis/échoués · éléments NON testés · risques de régression ·
> recommandations par priorité. Chaque problème : `fichier:ligne` + preuve + conséquence + (bug confirmé /
> risque potentiel / non vérifié).
>
> ---


**Comment lancer :** ouvre Claude sur ce projet et dis simplement **« fais l'audit »**
(ou « lance les audits »). Claude lance les auditeurs ci-dessous **en parallèle**
(un par domaine), vérifie chaque trouvaille dans le code réel, puis corrige les
vraies et te fait un rapport priorisé. On peut aussi n'en lancer qu'un : « fais
l'audit sécurité », « audit des calculs », etc.

**⚠️ MODE PROFOND — le défaut désormais (leçon du 2026-08-08).** Les auditeurs « par
domaine » (sections ci-dessous) survolent un thème sur toute la plateforme ; ils laissent
passer des bugs de **flux** très localisés (off-by-one d'un décompte, clé de dédup trop
grossière, homonyme de prénom qui envoie un mail au mauvais conducteur, export orphelin
après un refactor…). Donc « fais l'audit » lance MAINTENANT **en plus** un **agent par PAGE
et par flux** — pas seulement par thème :
- **1 agent par page applicative** (dashboard, véhicules, amendes, factures, contrôle,
  conducteurs, emprunts, sinistres, entretiens, contrats, à-vendre, statistiques, budget,
  calendrier, notifications, renouvellements, tâches, paramètres, scanner, facturation,
  prospects, espace-salarié) **+ 1 agent « helpers/`app.js`+`bareme.js` »** et **1 agent
  « Edge Functions » (`scan-doc`, `manage-users`, `send-email`)**.
- Chaque agent **trace de bout en bout** chaque **ajout / modification / suppression /
  import / export / scan / calcul** de sa page, en se mettant « dans la peau d'un client » :
  quels handlers, quel mapping `FP.db` (camel↔snake), la donnée est-elle bien persistée en
  base (pas juste en mémoire/localStorage), l'état se rafraîchit-il, `FP.dupe` est-il branché,
  `FP.esc` sur toute donnée saisie/OCR, et surtout : **la valeur testée/affichée lit-elle le
  même helper canonique que partout ailleurs** (`FP.estVendu`/`horsFlotte`, `FP.montantDu`,
  `FP.leasingContrat`, `FP.dedupeFactures`, `FP.joursRestants`…) ?
- Sortie identique : findings **vérifiés** `fichier:ligne` + gravité + **scénario concret**
  (entrées → résultat faux), **sans modifier de fichier** ; Claude corrige ensuite les vraies,
  vérifie la syntaxe, bumpe le `?v=`, et déploie.
- ⚠️ Un audit ne prouve JAMAIS l'absence de bug, et il ne voit pas le code écrit APRÈS lui :
  relancer le mode profond après tout gros lot de modifs.
- ⚠️ **Edge Functions** = seule partie qui ne se déploie pas via GitHub Pages : elle part via
  le workflow `.github/workflows/deploy-edge-functions.yml` (secret `SUPABASE_ACCESS_TOKEN`).

> Règle de sortie commune à TOUS les auditeurs : ne remonter que des failles
> **réelles et vérifiées** (lire les deux côtés du code avant d'affirmer), avec
> `fichier:ligne` + gravité, **sans modifier de fichier** — Claude corrige ensuite.

---

## ✅ Base de référence — failles déjà corrigées (audit sécurité François, 10/2026)

> **À lire AVANT de relancer l'audit sécurité (#1) et isolation (#4).** Ces points ont été audités
> puis corrigés par **François** (conseil technique du projet) en octobre 2026. Un auditeur qui les
> « re-trouve » fait un **faux positif** : vérifier d'abord qu'ils sont toujours fermés plutôt que
> de les signaler comme neufs. Le suivi détaillé, maintenu et partageable est dans **`SUIVI-PROJET.md`**
> (racine du dépôt) ; détail technique appliqué en prod dans `supabase/migrations/JOURNAL.md`.
> Ce bloc est un **mémo de l'audit**, pas la source — en cas d'écart, `SUIVI-PROJET.md` fait foi.

**Phase 0 — audit complet en lecture seule (16/10/2026).** Dépôt GitHub, code, historique Git
(887 commits) et base Supabase audités. **Aucun secret** trouvé dans le code ni l'historique. Constats
classés par gravité, plan priorisé remis.

### Corrigé et EN PRODUCTION ✅

- **① Accès anonyme aux fichiers — FERMÉ (16/10).** Une règle de storage laissait lister/télécharger
  des documents **sans connexion**. Supprimée, accès anonyme revérifié = rien n'est visible. Copie des
  règles faite avant intervention, retour arrière documenté. **Test automatique quotidien** de l'accès
  anonyme (GitHub Actions). → *Auditeur #1 : ne pas re-signaler l'accès public storage comme ouvert.*
- **② Vue des QR codes — passée en LECTURE SEULE (16/10).** Elle était modifiable sans connexion.
  Désormais lecture seule. **La lecture publique est CONSERVÉE volontairement** (décision du responsable :
  les infos QR n'ont pas vocation à être privées — cf. `carte.html`). → *Auditeur #1 : la lecture publique
  du QR est un CHOIX, pas une faille ; ne pas re-proposer de la fermer.*
- **③ Cloisonnement des fichiers entre sociétés — APPLIQUÉ EN PROD (17/10).** Les nouveaux fichiers sont
  rangés dans un **dossier par société** ; chaque compte n'accède qu'aux fichiers de sa société, le CEO
  voit tout. Les fichiers existants restent en place et réservés à PXP (aucun lien cassé). Prouvé sur le
  staging : **14 fuites avant → 0 après**. Vérifié dans l'app avec un compte Gestionnaire PXP : les **639
  fichiers** référencés s'ouvrent tous. PR #985/#987/#988 fusionnées, règle appliquée après copie des
  règles précédentes. → *Auditeur #4 : le cloisonnement fichiers est en place côté serveur.*
- **④ Isolation multi-sociétés — TEST QUOTIDIEN 58/58 ✅.** Test automatique : connecté comme une société
  de test, il vérifie qu'on ne peut ni lire, ni modifier, ni créer, ni supprimer chez l'autre société, ni
  changer de société, ni s'octroyer des droits CEO. Tourne chaque jour + à chaque migration de base.
  **58/58 vérifications réussies.** → *Auditeur #4 : l'isolation RLS est testée en continu.*
- **⑤ « Deux tiroirs » app_settings — RÉSOLU + GELÉ (16/10).** Cause d'une partie des données qui
  « reviennent » : les réglages PXP existaient en **deux exemplaires** (`global` historique + `PXP`), et
  certains appareils écrivaient dans l'ancien après une coupure réseau → divergence. Analyse clé par clé :
  la ligne de référence était la plus complète. L'app n'utilise plus qu'un exemplaire ; **l'ancien est gelé
  par un trigger base** (écriture refusée, conservé en archive). → *Auditeurs #5/#9 : la ligne `global`
  est volontairement en lecture seule — une écriture refusée dessus est le comportement ATTENDU.*
- **⑥ Vidage des réglages à la connexion — CAUSE CORRIGÉE + GARDE-FOU (17/10).** Observé en direct : cache
  navigateur vide → l'app pouvait renvoyer en base une copie **quasi vide** des réglages (28 clés au lieu
  de 97) en remplacement complet si on changeait de page juste après (effaçait congés/affectations/
  contrats/assurances pour un admin). Deux correctifs : **(a) garde-fou en base** (refuse toute écriture
  qui supprimerait d'un coup une part importante des réglages / viderait une liste ou le profil société),
  **(b) correction de la cause dans le code** — une écriture en attente ne pousse plus que ce que
  l'utilisateur a réellement changé, la version serveur l'emporte (règle anti-perte ④/⑥ du `CLAUDE.md`).
  **11 tests automatiques** reproduisent l'incident + cas multi-appareils, lancés à chaque PR. PR #992.
  → *Auditeurs #5/#9/#13e : ne pas re-signaler ce scénario, il est testé.*

### Corrections à l'audit initial (faux constats levés)

- L'organisation Supabase est bien sur le **plan Pro**, avec **sauvegardes quotidiennes**. Un filet
  **indépendant** de Supabase tourne en plus chaque nuit (`.github/workflows/sauvegarde.yml`) : il dépose
  la **base ET les fichiers du stockage** (`aws s3 sync s3://scans …`), chiffrés, avec **restauration
  d'essai** automatique → la lacune « sauvegarde hors fichiers » signalée au départ est **comblée**.
- Le déploiement automatique des Edge Functions **fonctionnait** ; sa condition a été rendue robuste au
  nom du dépôt (renommage `autoflotte`→`ParcPilot`).

### Encore OUVERT — à NE PAS considérer comme réglé (l'audit doit continuer à les suivre)

> ✅ **Clos depuis** : « Sauvegarde hors fichiers » — le workflow `sauvegarde.yml` synchronise désormais
> **base + fichiers du stockage** chaque nuit, avec restauration d'essai (cf. correction ci-dessus).
> Ne PLUS re-signaler cette lacune.

- 🟠 **GitHub** : **branche `main` pas encore protégée** (PR + tests obligatoires à activer — à faire
  côté réglages GitHub par le propriétaire du dépôt ; le code ne peut pas l'imposer seul).
- 🟠 **QR public liste TOUS les véhicules** : acceptable aujourd'hui, à **restreindre au véhicule scanné**
  avant l'arrivée de plusieurs clients (→ auditeur #1/#4, gravité moyenne). ⚠️ La lecture publique du QR
  est un **choix** (cf. `carte.html`) ; c'est le fait que la vue `vehicules_public` renvoie **toute** la
  flotte à une requête API anonyme qu'il faut restreindre (migration à tester d'abord sur le staging).
- 🟠 **`app_settings` = données métier mêlées à la config dans un gros blob JSON** : une fonction serveur
  réécrit encore le bloc entier (risque de perte en écritures simultanées). À traiter avec la **migration
  des données** vers de vraies tables (congés, affectations, contrats, assurances…) puis suppression du
  système de fusion « maison » (→ auditeurs #9/#13). ⚠️ `CLAUDE.md` interdit de re-durcir `app_settings`
  côté base tant que config et données de travail ne sont pas séparées en lignes distinctes.
- 🟡 **États des lieux vides (0 km)** parfois créés automatiquement : à investiguer (hors sécurité).

---

## 1. Sécurité & contrôle d'accès
Secrets exposés (clé `service_role`), gating de rôles CEO/Admin/Gestionnaire/
Chauffeur cohérent et non contournable, **XSS** (données saisies/OCR en `innerHTML`
sans `FP.esc`), auth guard présent, liens signés (documents privés), et surtout :
une protection qui n'est QUE côté client alors que seule la RLS protège vraiment.

## 2. Cohérence des calculs financiers
Un coût ajouté quelque part remonte-t-il dans TOUS les totaux (coût annuel Contrats,
TCO/€km/TVS Statistiques, dashboard, écran, rapport direction) ? Doubles comptages,
montant d'amende **dû** (majoré) via `FP.montantDu`, unités/périodes, /0, NaN.

## 3. Lecture de documents (OCR/IA) & anti-doublons
Jamais `Math.max` sur un montant d'amende ; majoration = seul titre « avis de
majoration » ; `montantTTC` = minoré ; contrôle HT+TVA=TTC ; `FP.dupe` branché à
tous les points d'ajout ; factures Ulys reconstruites par position.

## 4. Isolation multi-sociétés & RGPD
Clés de cache suffixées par société ; migrations/seeds réservés à PXP ; grep PII sur
`assets/js/data.js` (doit être **0**, repo public) ; aucun filtre `societe` oublié.

## 5. Bugs front / robustesse
Cache-busting `?v=` cohérent partout + `sw.js` ; liens internes ; classes Tailwind
manquantes ; null deref / TDZ ; `FP.searchSelect`/`conducteurPicker` ; code mort.
Lance aussi `node scripts/check-bugs.mjs .`.

## 6. Checklist « À compléter » vs sources réelles
Pour chaque champ de `notifications.html` (VEH_FIELDS/COND_FIELDS/AMENDE_FIELDS) :
le test « manquant » lit-il la MÊME source/helper que l'endroit qui AFFICHE la
donnée (fiche véhicule/conducteur) ? (Classe du bug « forfait leasing réclamé à tort ».)

## 7. Helpers dupliqués / divergents
Un même concept réimplémenté à la main au lieu du helper canonique : `FP.estVendu`
(pas `statut === 'vendu'`), `FP.montantDu`, `FP.leasingContrat`, `FP.normPrenom`,
`FP.coutMois`, `FP.anneeAmende`, filtre société. Signale toute divergence observable.

## 8. Valeurs incohérentes entre pages
Une même valeur affichée à 2 endroits calculée différemment (compteurs dashboard vs
pages, échéances Alertes vs Renouvellements, coût du mois dashboard/écran/rapport,
TVS/assurance/TCO, montant d'amende initial vs dû). Donne un scénario chiffré.

## 9. Perte de données / mapping base
Une saisie qui semble enregistrée mais est perdue : champ absent du mapping `toDb`
ou de la table, patch vide (« update qui réussit sans rien écrire »), erreur
d'écriture non remontée (échec silencieux), nom de colonne divergent, ou blob
`app_settings` écrasé entre postes (dernier qui écrit gagne).

## 10. Rafraîchissement d'état
Après un ajout/modif/suppression ou un changement de société : compteurs, listes,
graphes, caches se mettent-ils tous à jour, ou restent-ils périmés jusqu'à un
rechargement ? Signature `fp:data-ready` assez large ? Un élément supprimé peut-il
« revenir » (flash depuis un cache) ?

## 11. Contenu périmé / codé en dur PXP-TJMAX
Nom/valeur spécifique PXP/TJMAX/personne figé dans l'UI partagée ou une page
publique (index/brochure/prix), donc visible à tort par une autre société ou un
prospect. Distinguer les valeurs légitimes (bases PXP gardées par `soc === 'PXP'`,
contact public `jis.nubee@gmail.com`, démos fictives).

## 12. Éparpillement / regroupement (doublons de saisie & de stockage)
Une MÊME notion saisie ou stockée à plusieurs endroits, qui perd l'utilisateur ou
fait diverger les données. Chercher par domaine : **contacts/tiers** (deux annuaires
de garages `settings.prestataires` (Entretiens) vs `settings.garages` (Sinistres) ;
loueur en `settings.profil.loueurNom` vs `settings.loueurs[]` ; assureur éditable
dans Contrats ET Paramètres ; fournisseurs = texte libre re-saisi au lieu d'un
référentiel) ; **config société** éditable hors Paramètres (loueurs & primes
d'assurance dans Contrats alors que l'assureur+police sont dans Paramètres) ;
**documents/fichiers** (plusieurs portes d'entrée : scanner dashboard, « Importer un
document/facture », fiche véhicule, état des lieux — vérifier qu'elles atterrissent
dans la même table) ; **notes libres** réparties entre `settings.*` (vehNotes,
zoneNotes, inspections[].note, taches[].note) et colonnes DB (amendes.commentaire,
conducteurs.note…). Reco type : UNE source par clé, UN écran d'édition (dupliquer
l'UI en gardant la même fonction de save), référentiel commun pour les garages.
⚠️ NE PAS sortir les champs MÉTIER de leur logique (n° de police d'assurance,
`prop` du loueur qui sert à détecter le leasing) sous prétexte de regrouper.

## 13. Parcours client — actions qui ne se répercutent pas + concepts dispersés
Simuler un utilisateur qui **dépose / édite / SUPPRIME / ajoute**, domaine par domaine,
et traquer 2 classes de bug : **(1)** un même concept calculé/lu à PLUSIEURS endroits
sans helper `FP.*` commun (écrans qui divergent) ; **(2)** une action (surtout la
**suppression** et l'**édition**) qui ne se répercute pas partout (KPI, totaux, cache,
entité liée). Cinq sous-auditeurs, en parallèle :
- **13a. Factures & coûts** — coût mois/TCO/dashboard via `FP.coutMois`/`dedupeFactures` ;
  suppression/édition d'une facture qui laisse une révision/km/pneus fantôme sur le
  véhicule (symétrie `FP.applyFactureToVehicule` ↔ `FP.recomputeVehiculeFromFactures`) ;
  `FP.estEntretien` employé partout (carnet, Entretiens, Budget) ; dédup homogène.
- **13b. Amendes** — montant affiché = total via `FP.montantDu` ; statut « à payer »/
  « payée » via `FP.estAPayer`/`FP.estPayee` (jamais `statut === '…'` en dur) ; podiums
  et filtres d'année via `FP.normPrenom`/`FP.anneeAmende` ; suppression → KPI + podium.
- **13c. Véhicules** — statut via `FP.estVendu`/`FP.horsFlotte` (jamais `=== 'actif'`/
  `'vendu'` en dur) ; km affiché via `FP.kmActuel` ; leasing/TVS via les helpers ;
  **suppression → factures/amendes/emprunts orphelins** (choix : conserver l'historique
  des coûts + purger le cache société + avertir).
- **13d. Conducteurs & emprunts** — tout sélecteur de conducteur via `FP.conducteurPicker`
  (aucun `<select>`/texte libre) ; rapprochement via `FP.normPrenom`/`FP.normNomComplet` ;
  statut emprunt via `FP.empEnCours`/`empEnRetard` ; offboarding/suppression → libère les
  véhicules + purge PII ; homonymes de prénom qui fusionnent (identité prénom seul).
- **13e. Config / multi-sociétés / cache / rôles** — `FP.settings` toujours en delta-merge ;
  clés de cache suffixées par société (aucune fuite) ; tombstone société ; gardes de rôle
  **fail-closed** quand `FP.profile` non résolu ; pas de bleed PXP à la 1re peinture.

## 14. Source unique par CONCEPT (6 sous-auditeurs en parallèle)
Pour CHAQUE concept ci-dessous : le lit-on / calcule-t-on PARTOUT via le même helper
`FP.*` ? Une réimplémentation à la main (même « équivalente ») est un futur bug.
Sortie = `fichier:ligne` + snippet + helper attendu, **vérifié dans le code réel**.
- **14a. Statut véhicule** — `FP.estVendu` / `FP.horsFlotte` (jamais `statut === 'vendu'`,
  jamais un regex `/vendu/i` qui matche « **in**vendu », jamais une liste locale de statuts
  inactifs qui oublie « hors-service »).
- **14b. Amendes** — montant = `FP.montantDu` (jamais `a.montant` brut dans un total, jamais
  `Math.max`) ; statut via `FP.estAPayer`/`FP.estPayee` (jamais `=== 'payée'`/`'à payer'`) ;
  prénom via `FP.normPrenom`.
- **14c. Plaques & factures/coûts** — `FP.normImmat` (⚠️ piège : une normalisation « espaces
  seulement » `replace(/\s/g,'')` NE retire PAS les tirets → une plaque `AB-123-CD` ne
  retrouve pas sa prime/ses factures) ; dédup via `FP.dedupeFactures` ; coût via
  `FP.coutMois`/`FP.coutFactureExploit` (graphe ET KPI dédoublonnés à l'identique).
- **14d. Leasing / loueur / TVS / assurance** — `FP.leasingContrat`/`FP.leasingInfo` (jamais
  `FP.LEASING_CONTRATS[immat]` brut → fuite multi-sociétés) ; `FP.loueurOf` (pas de comparaison
  brute du champ propriétaire) ; `FP.tvsDetail` ; prime d'un véhicule **vendu** exclue partout
  (Contrats, Budget, Statistiques/TCO — même règle).
- **14e. Échéances / jours / société / checklist** — `FP.joursRestants` (minuit→minuit ; jamais
  `(new Date(x) - new Date())/86400000` qui prend l'heure courante → décalage d'un jour) ;
  couleur/urgence = `niveau` de `FP.buildEcheances` (même barème `<30`/`<60` sur toutes les pages :
  Alertes, Renouvellements, calendrier, écran) ; `FP.ctIgnored`/`FP.concerneAntiPollution`
  respectés partout (pas de « CT dépassé » sur un véhicule étranger exempté) ; checklist
  « À compléter » qui teste la MÊME source que l'écran qui affiche la donnée.
- **14f. Sinistres / conducteurs / emprunts** — statut sinistre via `FP.sinistreStatutOf`
  (résout la clé de groupe PUIS l'id de facture — sinon le statut d'un incident **regroupé** est
  invisible aux alertes) ; « reste à charge » via `FP.coutSinistre`/`FP.resteChargeSinistre`
  (0 si Remboursé/PEC, jamais le brut) ; emprunt « en retard » via `FP.empEnRetard` (règle
  > 2 jours, jamais réimplémentée) ; identité conducteur via `FP.normPrenom`.

## 15. Échecs SILENCIEUX à l'exécution & pertes invisibles (famille « le bug photo »)
Classe de bugs que les auditeurs « par domaine/page » NE voient PAS : le code **a l'air correct**
(il compile, il tourne, rien ne casse en lecture), mais **à l'exécution il perd une donnée sans
RIEN dire à l'utilisateur** — sur une entrée précise (HEIC iPhone, réseau coupé, fichier lourd).
Lancer un **agent dédié** qui traque, sur TOUT le projet (pages + `app.js` + `v.html`/`km.html` +
Edge Functions), ces 4 motifs — et EXIGE un **feedback utilisateur visible** partout où une action
peut échouer :
- **15a. Photos / fichiers / uploads perdus en silence** : `Image.onerror`/`FileReader.onerror`
  qui renvoient `null` et **droppent** le fichier (HEIC non décodable → il faut un **repli fichier
  brut**, jamais un drop) ; `accept="image/*"` qui **rejette un type vide** (HEIC) ; `FP.uploadScan`
  dont l'échec est **avalé** (`.catch(()=>null)`, `if(url)` sans `else`) → l'enregistrement se fait
  **sans le document** en affichant « ✓ ».
- **15b. Écritures/envois avalés** : `catch{}` / `.catch(()=>{})` autour d'un `insert/upsert/update/
  delete`, d'un `send-email`, d'un `functions.invoke` (qui **ne LÈVE PAS** sur erreur → il FAUT lire
  `res.error`/`res.data.error`) → l'utilisateur croit que c'est enregistré/envoyé.
- **15c. Limites cachées / troncatures** : `slice(0,N)`, `arr.length<N`, `files[0]` alors que
  `multiple`, `Math.min(pdf.numPages,N)` (pages OCR ignorées) → des données coupées **sans message**.
  ⚠️ **Cap client ET serveur doivent être ALIGNÉS** (bug vécu : cap client 20, cap serveur `km-collect`
  resté à 8 → photos 9+ jetées côté serveur).
- **15d. Compteurs menteurs** : un lot qui affiche « N enregistrés » sans compter les **échecs**
  (« 3 photos rattachées » alors que 2 ont échoué). Toujours comparer réussis **vs** total et
  **DIRE** ce qui a échoué.
Règle de sortie : pour chaque cas, prouver le scénario concret (entrée → ce que l'utilisateur PERD →
pourquoi il ne le voit pas), `fichier:ligne`. Réf. CLAUDE.md 0-perte ③ (« échec d'écriture silencieux
= INTERDIT ») et ⑥. **Le correctif d'un cas doit ajouter un vrai retour visible**, jamais juste logger.

---

*Historique : batterie constituée les 2026-07-30 après plusieurs incohérences
« même concept lu/calculé différemment selon l'écran ». Section 13 (parcours client)
ajoutée le 2026-08-01 après l'audit qui a créé les helpers `FP.applyFactureToVehicule`,
`FP.recomputeVehiculeFromFactures`, `FP.estEntretien`, `FP.estPayee`, `FP.kmActuel`,
`FP.empEnCours`, `FP.normNomComplet`. Voir la règle « une seule source de vérité » dans `CLAUDE.md`.
Section 14 (source unique par concept, 6 sous-auditeurs) ajoutée le 2026-08-04 après l'audit
qui a créé `FP.sinistreStatutOf`, `FP.empJoursDepuis` (et réécrit `FP.empEnRetard` sur la règle
« > 2 jours ») et corrigé : normalisations plaque « espaces seulement » (tirets ignorés),
graphe de coûts non dédoublonné vs KPI, prime d'assurance d'un véhicule vendu comptée dans le TCO,
statut sinistre invisible aux alertes sur un incident regroupé, fuite leasing multi-sociétés.*
