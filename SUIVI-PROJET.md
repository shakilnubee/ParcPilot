# Parc Pilot — Suivi du projet de fiabilisation

> Document de suivi partageable. **Tenu à jour à chaque étape** (voir « Comment ce document est tenu à jour » en bas).
> Dernière mise à jour : **20/10/2026** (migration des données : congés et affectations en production)
>
> ⚠️ Ce dépôt est **public** : ce document ne contient aucun secret ni donnée personnelle. Les failles **pas encore corrigées en production** n'y sont décrites qu'en termes généraux.

---

## 1. Le projet en bref

**Parc Pilot** (https://parc-pilot.fr) est une application de **gestion de flotte automobile multi-sociétés**. On y gère les véhicules, conducteurs, amendes, factures, contrats, sinistres, états des lieux et alertes d'échéance. Chaque société cliente ne doit voir que ses propres données.

| | |
|---|---|
| Porteur du projet | Shakil (Project X Paris — « PXP »), premier utilisateur de l'application |
| Conseil et pilotage technique | François |
| Réalisation | Claude (assistant de développement), sous validation de François |
| Technique | Site statique (HTML/JS) publié par GitHub Pages ; base de données, comptes et fichiers sur Supabase |

## 2. Le besoin

L'application a été construite rapidement. Elle fonctionne, mais plusieurs problèmes freinent sa fiabilité et l'arrivée de nouveaux clients :

1. **Données qui « reviennent »** : d'anciennes valeurs réapparaissent après modification ou suppression. C'est la priorité n°1 de Shakil.
2. **Sauvegardes** insuffisantes et jamais testées.
3. **Sécurité** : il faut vérifier que chaque société n'accède qu'à ses données, y compris en contournant l'interface.
4. **Organisation** du code et des mises en production à rendre plus sûre.
5. **Automatisations** à mettre en place : alertes d'échéance, rapports, sauvegardes, tests.

**Objectif final :** une application fiable, sécurisée et facile à faire évoluer, avec une seule source de vérité (la base de données), une table par type de donnée, des tests automatiques et des sauvegardes vérifiées.

## 3. Règles de travail

- **Lecture seule d'abord**, puis intervention **étape par étape, validée** par François (et par le responsable pour les décisions métier).
- **Aucune modification de la production sans accord explicite**, pour chaque action. Une sauvegarde est faite avant toute modification.
- **Toute modification de la base passe d'abord par le staging** (copie de test), puis par une migration versionnée dans Git.
- **Une branche et une pull request par sujet**, pas de modification directe de `main`.
- **Aucun secret** dans le code, les fichiers ou les échanges. Les mots de passe sont saisis par un humain, jamais par Claude.
- Chaque intervention en production est tracée dans `supabase/migrations/JOURNAL.md`.

## 4. Les environnements

| | Production | Staging (test) |
|---|---|---|
| Site | https://parc-pilot.fr | — |
| Base Supabase | projet « Parc Pilot » (organisation Pro) | projet `parc-pilot-staging` (organisation gratuite « Parc Pilot Staging ») |
| Données | réelles | **100 % fictives** : deux sociétés de test, TEST-A et TEST-B |
| Sauvegardes | quotidiennes, automatiques (plan Pro) | aucune (inutile) |

Le mode d'emploi du staging est dans `supabase/staging/README.md`.

---

## 5. Journal des réalisations

### 20/10/2026 — Fiche véhicule : photo du modèle (libre de droits)
- La fiche véhicule affiche désormais une **photo du modèle** (ex. une vraie Dacia Spring pour une Dacia Spring), en repli automatique de la photo choisie manuellement (champ `photoUrl`, inchangé). **Source unique** via le helper `FP.vehPhoto(v)` (`assets/js/vehicule-photos.js`).
- **28 photos libres de droits** (Wikimedia Commons, CC / CC0) hébergées dans le dépôt (`assets/vehicules/`) → servies depuis parc-pilot.fr, chargées **en différé** par fiche (aucun impact perf sur les autres pages). Crédit affiché sur la photo (obligatoire pour les CC).
- Bouton **« Changer la photo »** sur la fiche : rechercher sur Wikimedia (côté navigateur), coller une URL, revenir à l'illustration du modèle, ou retirer.
- Aucune modification Supabase (schéma/RLS). HTML + nouvel asset JS uniquement (pas de changement `app.js` → pas de rebuild min). Manuel mis à jour.

### 16/10/2026 — Phase 0 : audit complet (lecture seule)
- Dépôt GitHub, code, historique Git (887 commits) et base Supabase audités. **Aucun secret** n'a été trouvé dans le code ni dans l'historique.
- Rapport d'audit remis : constats classés par gravité et plan priorisé.
- Principaux constats :
  - un accès anonyme aux fichiers stockés ;
  - une vue de la base modifiable sans connexion ;
  - pas de cloisonnement des fichiers entre sociétés ;
  - des données métier mélangées à la configuration dans un gros bloc JSON ;
  - un système de fusion « maison » à l'origine des données qui reviennent ;
  - GitHub sans protection de la branche principale.

### 16/10/2026 — Sécurité : fermeture de deux failles critiques ✅ (en production)
- **Accès anonyme aux fichiers fermé.** Une ancienne règle permettait de lister et télécharger des documents sans être connecté. Elle a été supprimée et l'accès anonyme vérifié : plus rien n'est visible.
- **Vue des QR codes passée en lecture seule.** La lecture publique est conservée, comme le souhaite le responsable : les informations affichées par QR n'ont pas vocation à être privées. Toute modification sans connexion est désormais impossible.
- Copie de sauvegarde des règles faite avant l'intervention. Retour arrière documenté.
- **Test automatique quotidien** de l'accès anonyme (GitHub Actions).

### 16/10/2026 — Données : fin des « deux tiroirs » ✅ (en production)
- **Cause trouvée** d'une partie des données qui reviennent : les réglages PXP existaient en **deux exemplaires** dans la base, et certains appareils écrivaient dans l'ancien après une petite coupure réseau. Les deux copies avaient divergé.
- **Analyse clé par clé** des deux exemplaires. La version de référence était la plus complète, rien n'était à récupérer. 7 alertes masquées sur un appareil redeviennent visibles, choix validé par le responsable.
- **Correctif déployé** : l'application n'utilise plus qu'un exemplaire. L'ancien est **gelé**, conservé intact comme archive, et plus aucune écriture n'y est possible.

### 16/10/2026 — Staging et tests d'isolation ✅
- **Projet de staging créé** (gratuit), avec la **même structure que la production**, vérifiée par empreintes, et des données fictives.
- **Test automatique d'isolation entre sociétés.** Connecté comme une société de test, il vérifie qu'on ne peut ni lire, ni modifier, ni créer, ni supprimer chez l'autre société, ni changer de société, ni se donner des droits CEO. Il tourne **chaque jour** et à chaque modification de la base. **Résultat : 58/58 vérifications réussies.**

### 16/10/2026 — Cloisonnement des fichiers entre sociétés 🟡 (prêt, testé sur le staging, pas encore en production)
- Les nouveaux fichiers sont rangés dans un **dossier par société**. Chaque compte n'accède qu'aux fichiers de sa société, le CEO voit tout.
- Les fichiers existants restent à leur place et restent réservés à PXP : **aucun lien cassé**.
- **Prouvé sur le staging** : 14 fuites avant correction, 0 après. PXP conserve l'accès à ses documents.
- **En attente** : vérification visuelle dans l'application (accès en cours pour François), puis mise en production avec accord.

### 17/10/2026 — Vérification dans l'application + cloisonnement des fichiers ✅ (en production)
- **Vérification dans l'application** avec un compte Gestionnaire PXP : les **639 fichiers** référencés (cartes grises, documents, états des lieux, avis, factures) s'ouvrent tous.
- **PR #985, #987 et #988 fusionnées.** Site et fonctions serveur redéployés. Les nouveaux fichiers sont rangés dans un dossier par société.
- **Règle de cloisonnement appliquée en production**, après copie des règles précédentes. Les 639 fichiers s'ouvrent toujours, et l'accès anonyme reste fermé.

### 17/10/2026 — Cause de vidage des réglages trouvée et corrigée ✅ (en production)
- **Observé en direct** : à la connexion, quand le cache du navigateur est vide, l'application pouvait renvoyer à la base une copie **quasi vide** des réglages (28 clés au lieu de 97), en remplacement complet, si l'on changeait de page juste après. Bloqué ce jour-là seulement par le rôle Gestionnaire. Pour un administrateur, cela effaçait d'un coup congés, affectations, contrats, assurances…
- **Garde-fou dans la base**, testé sur le staging (7 cas sur 7) : la base refuse toute écriture qui supprimerait d'un coup une part importante des réglages, viderait une liste importante ou viderait le profil de la société.
- **Correction de la cause dans le code** : une écriture en attente ne modifie plus que ce que l'utilisateur a réellement changé, et la version du serveur l'emporte sur tout le reste. Le même correctif empêche un élément supprimé ou modifié sur un autre appareil de « revenir » (scénario B de l'audit).
- **11 tests automatiques** reproduisent l'incident et les cas multi-appareils. Ils tournent désormais à chaque PR.
- **Mis en production le 17/10/2026** : d'abord le garde-fou en base, actif immédiatement pour tous les navigateurs, puis le correctif du code (PR #992).

### 16 → 20/10/2026 — Sauvegardes automatiques ✅ (actives chaque nuit sur la production)
- **Chaque nuit**, copie complète de la base (rôles, structure, données, comptes) **et de tous les fichiers**, ainsi que des règles d'accès du stockage. Ces dernières ne figurent pas dans la copie standard de Supabase.
- **Restauration d'essai automatique** à chaque sauvegarde, dans une base vide, avec comparaison du nombre de lignes de chaque table. Si un seul chiffre diffère, ou s'il manque plus de 5 % des fichiers, la sauvegarde échoue et GitHub envoie un e-mail.
- **Chiffrement** de chaque archive : seuls François et Shakil, détenteurs d'une clé privée, peuvent la lire.
- **Conservation** dans les artefacts GitHub : 30 jours, et 90 jours pour la sauvegarde du 1er du mois. C'est le maximum de GitHub : un historique sur un an demandera un stockage externe.
- **Mode d'emploi complet**, restauration pas à pas comprise : `docs/SAUVEGARDES.md`.
- **Essai réussi sur le staging** le 16/10, avec **déchiffrement vérifié par François**.
- **Essai réussi sur la production le 20/10/2026** (lecture seule) : 30 tables copiées et restaurées avec **exactement le même nombre de lignes** ; **961 fichiers sur 961** copiés ; 4 règles du stockage sauvegardées et restaurées ; archive chiffrée d'environ 840 Mo.
- Deux réglages techniques corrigés en route : version de l'outil Supabase figée (un blocage de GitHub empêchait son installation), et compatibilité de l'outil de copie avec le stockage de la production (les téléchargements de fichiers étaient refusés).
- Clés de chiffrement en place pour François et Shakil (celle de Shakil est provisoire et sera remplacée).
- **Activées le 20/10/2026** (fusion de la PR #991) : une sauvegarde de la production chaque nuit vers 3 h 15.
- **Reste à faire** : un test de restauration complet par un humain.
- **20/10/2026, après-midi** : une sauvegarde manuelle de la production a restauré la base à l'identique (31 tables), mais n'a copié **aucun fichier** sur 961. Cause : GitHub a mis à jour l'outil AWS de ses serveurs (2.37.13 → 2.38.1), et la nouvelle version échoue avec le stockage Supabase. La version qui fonctionne est désormais figée dans la sauvegarde.

### 20/10/2026 — Organisation de GitHub 🟡 (préparée, en attente de validation)
- **Règles de travail inscrites dans `CLAUDE.md`**, lu par chaque session Claude, sur tous les PC : jamais de modification directe de la branche publiée, une PR par sujet, migrations testées sur le staging, aucun secret, ne pas affaiblir les protections en place. Les anciennes consignes contraires (publication directe, Netlify) sont corrigées.
- **`README.md`** : présentation du projet, environnements, façon de contribuer, tests, documentation.
- **Anciens scripts SQL rangés** : les 18 scripts de la racine sont déplacés dans `supabase/historique/`, et un guide `supabase/LISEZ-MOI.md` explique qu'ils ne doivent **plus être exécutés**. Plusieurs rouvriraient des failles corrigées.
- **Reste à faire par Shakil**, seul administrateur du dépôt : activer la **protection de la branche `main`**. Les modifications passeront alors obligatoirement par une PR, avec des tests verts.

### 20/10/2026 — Migration des données, étape 1 : les congés ✅ (en production)
- **Avant** : les congés vivaient dans le gros bloc de réglages. Une seule mauvaise écriture pouvait tous les effacer. Une table dédiée existait déjà, mais n'était qu'une copie « au mieux », qui pouvait différer. C'était le cas sur le staging.
- **Après** : la table des congés devient **la référence**, avec un congé par ligne, isolée par société. Chaque modification ne touche que les congés **d'un seul conducteur**, en une seule opération côté serveur : jamais de doublon, même si deux appareils écrivent en même temps. Les écritures passent par la file d'attente durable : rien n'est perdu en cas de coupure ou de changement de page, et une erreur est toujours visible.
- **Aucun changement visible** pour les utilisateurs : les écrans lisent les congés exactement comme avant.
- **Filet de sécurité** : pendant la transition, les congés restent aussi copiés dans les réglages, ce qui permet un retour arrière immédiat.
- **Staging d'abord, automatisé** : toute nouvelle migration d'une PR est désormais appliquée automatiquement sur le staging, puis testée.
- **Tests** : 10 tests automatiques de la logique, et 10 contrôles sur le staging (remplacement, rejeu sans doublon, renommage, refus d'accès entre sociétés et sans connexion). Tous verts.
- **Mis en production le 20/10/2026** :
  - fonctions installées, puis comparaison : 34 congés dans les réglages et 35 dans la table, avec 3 écarts ;
  - recopie unique lancée par François. Les **2 congés présents seulement dans la table ont été archivés, pas effacés** : ils dataient de septembre et n'étaient plus affichés dans l'app ;
  - résultat : 0 écart ;
  - vérification dans l'application : lecture, ajout, suppression et rechargement conformes.
- **Reste à faire** :
  - Shakil confirme si les 2 congés archivés étaient réels ; s'ils l'étaient, il les ressaisit ;
  - dans quelques semaines, retirer la copie de transition dans les réglages.

### 20/10/2026 — Migration des données, étape 2 : les affectations ✅ (en production)
- **Quoi** : l'historique « qui conduit quel véhicule, depuis quand, avec quels km ». En production, il compte 53 véhicules, soit 53 périodes, avec des données propres.
- **Même principe que les congés**, avec une nouvelle table dédiée :
  - chaque modification ne touche que les périodes **d'un seul véhicule**, en une seule opération ;
  - l'ordre des périodes est conservé ;
  - tout champ imprévu est gardé ;
  - une date ou un km illisible est **refusé** (erreur visible), au lieu d'être perdu.
- **Traitements automatiques sécurisés** : la création ou le complément automatique d'une période au chargement n'écrit plus rien tant que la table n'a pas été lue. Jamais d'écriture depuis une copie locale périmée.
- **Mécanisme rendu commun** aux données migrées : chaque nouvelle donnée se branche en quelques lignes.
- **Aucun changement visible** pour les utilisateurs. La copie de sécurité dans les réglages est conservée ; le portail conducteur la lit encore.
- **Tests** : 10 tests automatiques de la logique, et un test sur le staging (ordre, km, refus des données invalides, isolation entre sociétés, refus sans connexion).
- **Mis en production le 20/10/2026** :
  - table créée, puis recopie lancée par François : 53 périodes, 0 écart ;
  - vérification dans l'application : lecture conforme, et une modification de km faite puis annulée s'est bien enregistrée dans la table et la copie.
- **Défaut trouvé pendant la vérification, puis corrigé** : sur certaines pages, l'application lisait la copie de sécurité au lieu des tables, parce que l'ordre de chargement des fichiers ne le permettait pas. C'était sans conséquence : la copie est identique, et le garde-fou a empêché toute écriture automatique. Le défaut touchait aussi les congés.

### 20/10/2026 — Correctif de la file d'attente des écritures ✅
- **Défaut ancien, trouvé pendant la migration** : quand l'application renvoyait des modifications restées en attente, elle réenregistrait à la fin la liste telle qu'elle était **au début** de l'envoi. Une modification faite pendant ce court instant pouvait donc disparaître de la file sans avoir été envoyée. Autre cas : une ancienne version d'une donnée, remplacée entre-temps, pouvait être renvoyée **par-dessus** la nouvelle.
- **Correction** : avant chaque envoi, l'application vérifie que l'élément est toujours en attente ; à la fin, elle ne retire de la file **que** ce qui a bien été envoyé. Tout ce qui a été ajouté entre-temps est conservé.
- **Tests** : 6 tests automatiques, dont 2 échouaient sur l'ancien code. Aucun changement visible pour les utilisateurs.

### 20/10/2026 — Migration des données, étape 3 : les contrats LLD ✅ (en production)
- **Quoi** : les contrats de location longue durée de la page Contrats (loyer, durée, forfait km, documents, avenants). En production : 1 contrat (PXP).
- **Même principe** : une table dédiée, avec un contrat par ligne. Chaque modification n'envoie **que le contrat modifié**, et deux appareils qui modifient deux contrats différents ne s'écrasent plus. Un contrat supprimé est **archivé**, jamais effacé. Le contrat est gardé en entier : rien n'est perdu.
- **Aucun changement visible** pour les utilisateurs. La copie de sécurité dans les réglages est conservée.
- **Tests** : 13 tests automatiques de la logique, et un test sur le staging (enregistrement, rejeu sans doublon, refus d'un contrat incohérent, isolation entre sociétés, refus sans connexion, archivage).
- **Mis en production le 20/10/2026** : table créée, puis recopie lancée par François : 1 contrat, 0 écart.
- **Reste ensuite** : les 18 forfaits de leasing par plaque, qui sont l'autre moitié des contrats.

### 20/10/2026 — Restauration des versions de réglages, branchée sur les tables ✅ (en ligne)
- **Problème** : depuis la migration, restaurer une version des réglages (Paramètres → Données), importer un fichier de paramètres ou récupérer d'anciens réglages ne changeait plus rien aux congés, aux affectations ni aux contrats LLD. La version allait dans les réglages, mais l'écran relisait les tables, qui restaient inchangées.
- **Correction** : les quatre points d'entrée passent par une seule fonction. Pour ces trois données, la restauration se fait **élément par élément** : chaque conducteur, véhicule ou contrat présent dans la version reprend sa valeur, **dans la table aussi** ; ce qui a été créé depuis est conservé ; rien n'est supprimé. Le message indique combien d'éléments ont été remis en base.
- **Tests** : 14 tests automatiques. Le manuel est à jour. Aucune modification de la base n'est nécessaire.
- **Vérifié en ligne, sans rien écrire** : une simulation sur les versions serveur réelles a montré qu'une même donnée écrite autrement (ordre des champs, indicateur à « faux ») passait pour une modification. C'est corrigé : les versions récentes donnent maintenant 0 changement, et celle du matin 1 véhicule, une vraie modification de la journée.

### 20/10/2026 — Migration des données, étape 4 : les forfaits de leasing ✅ (en production)
- **Quoi** : les forfaits de leasing saisis par plaque (forfait km, durée, date de début, prix du km supplémentaire, loyer…), visibles dans la page Contrats et la fiche véhicule. En production : 18 plaques (PXP).
- **Même principe** : une table dédiée, avec une plaque par ligne. La plaque est gardée **telle qu'elle a été saisie**, avec ou sans tirets, pour ne rien rendre orphelin. Un forfait retiré, ou un doublon de format fusionné, est **archivé**, jamais effacé. La restauration des versions de réglages couvre aussi ces forfaits.
- **Aucun changement visible** pour les utilisateurs. La copie de sécurité dans les réglages est conservée.
- **Tests** : 8 tests automatiques de la logique, 1 de plus pour la restauration, et un test sur le staging (enregistrement, rejeu sans doublon, refus d'un forfait illisible, isolation entre sociétés, refus sans connexion, archivage).
- **Mis en production le 20/10/2026** : table créée, puis recopie lancée par François : 18 forfaits, 0 écart.

### 20/10/2026 — Migration des données, étape 5 : les assurances ✅ (en production)
- **Quoi** : les assureurs (avec leurs contrats et documents), l'assureur de chaque véhicule, les échéances, les primes et les plaques « ignorées » du suivi d'assurance. En production : 5 assureurs, 58 rattachements, 58 primes, 2 échéances.
- **Une table générique**, plutôt qu'une table par donnée : un élément de réglage = une ligne (société, nom de la donnée, clé, valeur). Les fonctions serveur n'acceptent qu'une **liste fermée** de données. Les tâches et les sinistres pourront s'y brancher sans nouvelle table.
- **Écriture branchée au cœur de l'enregistrement des réglages** : chaque enregistrement compare la valeur avec celle qui était affichée et n'envoie à la table **que les éléments modifiés**. Une écriture oubliée ne peut donc pas manquer la table. Un élément retiré est **archivé**, jamais effacé. La restauration des versions couvre aussi les assurances.
- **Aucun changement visible**. La copie de sécurité dans les réglages est conservée (la fonction serveur `km-collect` lit encore les assureurs depuis cette copie).
- **Tests** : 15 tests automatiques de la logique, 1 de plus pour la restauration, et un test sur le staging (les 3 formes de données, rejeu sans doublon, refus d'une donnée hors liste ou vide, isolation entre sociétés, refus sans connexion, archivage).
- **Mis en production le 20/10/2026** : table créée, puis recopie lancée par François : 5 assureurs, 58 rattachements, 58 primes, 2 échéances, 0 écart.

### 20/10/2026 — Migration des données, étape 6 : les tâches ✅ (en production)
- **Quoi** : les tâches, les rappels personnels, les rappels cochés, la liste des tâches automatiques déjà créées et le mémo anti-doublon des automatisations. En production : 5 tâches, 2 rappels, 2 rappels cochés, 23 tâches automatiques déjà créées.
- **Sur la table générique** créée pour les assurances : aucune nouvelle table. Seule la liste des données acceptées par le serveur s'allonge. Toutes les écritures (page Tâches, tâches automatiques d'entretien, automatisations, tableau de bord) passent déjà par l'enregistrement des réglages : elles sont couvertes **sans modifier ces pages**.
- **Inchangé** : la configuration des automatisations et leur historique restent dans les réglages. La fonction serveur des rappels (`task-reminders`) lit toujours la copie de sécurité, qui reste à jour.
- **Tests** : 3 tests automatiques de plus (18 au total) et le test du staging élargi aux tâches et aux rappels cochés.
- **Mis en production le 20/10/2026** : liste des données acceptées élargie, puis recopie lancée par François : 5 tâches, 2 rappels, 2 rappels cochés, 23 tâches automatiques, 0 écart.

### Corrections apportées à l'audit initial
- L'organisation Supabase est bien sur le **plan Pro**, avec des sauvegardes quotidiennes. Elles n'incluent cependant **pas les fichiers**.
- Le déploiement automatique des fonctions serveur **fonctionnait**. Sa condition a tout de même été rendue robuste au nom du dépôt.

---

## 6. État des pull requests

| PR | Sujet | État |
|---|---|---|
| #985 | Accès anonyme fermé + vue QR en lecture seule | ✅ Fusionnée |
| #986 | Fin des « deux tiroirs » | ✅ Fusionnée et déployée |
| #987 | Staging + test d'isolation | ✅ Fusionnée |
| #988 | Cloisonnement des fichiers | ✅ Fusionnée, règle appliquée en production |
| #992 | Anti-vidage des réglages (base + code) | ✅ Fusionnée, garde-fou actif en production |
| #991 | Sauvegardes automatiques | ✅ Fusionnée, active chaque nuit |
| #1012 | Organisation de GitHub (règles, README, scripts SQL rangés) | ✅ Fusionnée |
| #1014 | Migration des données, étape 1 : les congés | ✅ Fusionnée, en production |
| #1018 | Journal et suivi : congés en production | ✅ Fusionnée |
| #1019 | Migration des données, étape 2 : les affectations | ✅ Fusionnée, en production |
| #1020 | Correctif : lecture des tables sur toutes les pages + journal | ✅ Fusionnée |
| #1024 | Correctif de la file d'attente des écritures | ✅ Fusionnée |
| #1026 | Sauvegardes : version de l'outil AWS figée | ✅ Fusionnée, essai production réussi |
| #1025 | Migration des données, étape 3 : les contrats LLD | ✅ Fusionnée, en production |
| #1032 | Restauration des versions de réglages branchée sur les tables | ✅ Fusionnée |
| #1033 | Restauration : comparaison sur le contenu | ✅ Fusionnée |
| #1034 | Migration des données, étape 4 : les forfaits de leasing | ✅ Fusionnée, en production |
| #1037 | Migration des données, étape 5 : les assurances (table générique) | ✅ Fusionnée, en production |
| #1038 | Migration des données, étape 6 : les tâches | ✅ Fusionnée, en production |

## 7. Prochaines étapes

1. ✅ ~~Mise en production de l'anti-vidage des réglages~~ : fait le 17/10/2026.
2. ✅ ~~Vérification visuelle et cloisonnement des fichiers~~ : fait le 17/10/2026.
3. ✅ ~~Sauvegardes~~ : actives chaque nuit depuis le 20/10/2026. Restent : remplacer la clé provisoire de Shakil, puis un test de restauration complet par un humain.
4. **GitHub** : préparé le 20/10/2026 (voir le journal). Reste la protection de la branche principale, à activer par Shakil.
5. **Migration des données**, une à une, du gros bloc de réglages vers de vraies tables. **Étape 1, les congés** : ✅ en production depuis le 20/10/2026 (PR #1014). **Étape 2, les affectations** : ✅ en production depuis le 20/10/2026 (PR #1019). **Étape 3, les contrats LLD** : ✅ en production depuis le 20/10/2026 (PR #1025). **Étape 4, les forfaits de leasing** : ✅ en production depuis le 20/10/2026 (PR #1034). **Étape 5, les assurances** : ✅ en production depuis le 20/10/2026 (PR #1037). **Étape 6, les tâches** : ✅ en production depuis le 20/10/2026 (PR #1038). Ensuite : assurances, tâches, sinistres… Suppression enfin du système de fusion maison.
6. **Automatisations** : alertes d'échéance côté serveur (contrôle technique, assurance, entretien, permis), rapports.

## 8. Décisions prises

| Date | Décision | Par |
|---|---|---|
| 16/10/2026 | Les informations affichées par QR code restent publiques (lecture seule) | Responsable |
| 16/10/2026 | La ligne de réglages de référence PXP est conservée ; l'ancienne est gelée comme archive | François |
| 16/10/2026 | Les 7 alertes masquées sur l'ancien exemplaire redeviennent visibles | Responsable / François |
| 16/10/2026 | Staging dans une organisation Supabase **gratuite**, données **fictives** | François |
| 16/10/2026 | Les anciens fichiers restent en place (pas de migration de fichiers) | Proposition validée sur le staging |
| 16/10/2026 | Sauvegardes : artefacts GitHub chiffrés ; clés détenues par François et Shakil ; 30 jours, plus le 1er du mois gardé 90 jours | François |

## 9. Points ouverts / à surveiller

- La sauvegarde quotidienne Supabase **n'inclut pas les fichiers** : couvert par nos sauvegardes nocturnes depuis le 20/10/2026.
- Une archive pèse environ 840 Mo, soit près de 30 Go conservés en permanence (30 jours) : vérifier que cela reste dans les limites de stockage GitHub du dépôt.
- Des états des lieux vides (0 km) sont parfois créés automatiquement : à investiguer.
- Deux dates d'affectation de véhicule à faire vérifier par Shakil.
- Une fonction serveur réécrit les réglages d'un bloc, avec un risque de perte en cas d'écritures simultanées : à traiter avec la migration des données (étape 5).
- La vue publique des QR codes permet de lister tous les véhicules : acceptable aujourd'hui, à restreindre au véhicule scanné avant l'arrivée de plusieurs clients.
- Le staging gratuit se met en pause après 7 jours sans activité. Le test quotidien devrait le garder actif.

---

## Comment ce document est tenu à jour

- Claude met ce fichier à jour **à la fin de chaque étape**, dans la même PR que les changements concernés quand c'est possible.
- Chaque entrée du journal indique : **date**, **ce qui a été fait**, **état** (✅ en production, 🟡 prêt / testé, ⏳ en cours), et ce qui reste à faire.
- Les détails techniques sont ailleurs : `supabase/migrations/JOURNAL.md` pour ce qui a été appliqué en production, et les descriptions des pull requests sur GitHub pour le détail du code.
