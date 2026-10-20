# Parc Pilot — Suivi du projet de fiabilisation

> Document de suivi partageable. **Tenu à jour à chaque étape** (voir « Comment ce document est tenu à jour » en bas).
> Dernière mise à jour : **20/10/2026** (sauvegardes : essai réussi sur la production)
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

### 16 → 20/10/2026 — Sauvegardes automatiques 🟡 (essai réussi sur la production, activation nocturne à valider)
- **Chaque nuit**, copie complète de la base (rôles, structure, données, comptes) **et de tous les fichiers**, ainsi que des règles d'accès du stockage. Ces dernières ne figurent pas dans la copie standard de Supabase.
- **Restauration d'essai automatique** à chaque sauvegarde, dans une base vide, avec comparaison du nombre de lignes de chaque table. Si un seul chiffre diffère, ou s'il manque plus de 5 % des fichiers, la sauvegarde échoue et GitHub envoie un e-mail.
- **Chiffrement** de chaque archive : seuls François et Shakil, détenteurs d'une clé privée, peuvent la lire.
- **Conservation** dans les artefacts GitHub : 30 jours, et 90 jours pour la sauvegarde du 1er du mois. C'est le maximum de GitHub : un historique sur un an demandera un stockage externe.
- **Mode d'emploi complet**, restauration pas à pas comprise : `docs/SAUVEGARDES.md`.
- **Essai réussi sur le staging** le 16/10, avec **déchiffrement vérifié par François**.
- **Essai réussi sur la production le 20/10/2026** (lecture seule) : 30 tables copiées et restaurées avec **exactement le même nombre de lignes** ; **961 fichiers sur 961** copiés ; 4 règles du stockage sauvegardées et restaurées ; archive chiffrée d'environ 840 Mo.
- Deux réglages techniques corrigés en route : version de l'outil Supabase figée (un blocage de GitHub empêchait son installation), et compatibilité de l'outil de copie avec le stockage de la production (les téléchargements de fichiers étaient refusés).
- Clés de chiffrement en place pour François et Shakil (celle de Shakil est provisoire et sera remplacée).
- **Reste à faire** : fusionner la PR #991 pour activer la sauvegarde **chaque nuit**, puis réaliser un test de restauration complet par un humain.

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
| #991 | Sauvegardes automatiques | Essai réussi sur la production ; à fusionner pour activer la sauvegarde nocturne |

## 7. Prochaines étapes

1. ✅ ~~Mise en production de l'anti-vidage des réglages~~ : fait le 17/10/2026.
2. ✅ ~~Vérification visuelle et cloisonnement des fichiers~~ : fait le 17/10/2026.
3. **Sauvegardes** : essai réussi sur la production le 20/10/2026. Restent : l'activation nocturne (fusion de la #991), le remplacement de la clé provisoire de Shakil, puis un test de restauration complet par un humain.
4. **GitHub** : protéger la branche principale (PR et tests obligatoires), ranger les anciens scripts SQL, réécrire le `README.md` et le `CLAUDE.md`.
5. **Migration des données**, une à une, du gros bloc de réglages vers de vraies tables : congés, affectations, contrats, assurances, tâches, sinistres… Suppression ensuite du système de fusion maison.
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

- La sauvegarde quotidienne Supabase **n'inclut pas les fichiers** : couvert par nos sauvegardes dès l'activation nocturne (étape 3).
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
