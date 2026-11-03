# Migrations SQL préparées (à exécuter par Shakil, si tu veux)

Ces 2 scripts sont **prêts mais NON appliqués**. Ils sont **sans danger** : purement
additifs (ils ajoutent des colonnes, ne suppriment/renomment rien), et **l'appli
continue de fonctionner exactement pareil** tant que le code ne les exploite pas.
Chaque script contient aussi son **ROLLBACK** (pour revenir en arrière).

> Comment lancer : Supabase → **SQL Editor** → coller le contenu du fichier → **Run**.
> À faire **une seule fois** par script. Non urgent.

---

## 1) `app_settings-concurrence.sql` — éviter d'écraser la config à deux

**Le problème.** Toute la configuration d'une société tient dans **une seule ligne**
(un gros bloc de réglages). Quand on enregistre, l'appli réécrit **tout le bloc**. Si
**deux personnes** (ex. toi + un admin) modifient la config de la **même société** à
**quelques secondes d'intervalle**, le second efface sans le savoir les changements du
premier. Aujourd'hui = risque faible (tu es le plus souvent seul à configurer).

**Ce que fait le script (phase 1).** Ajoute 2 colonnes techniques (`rev`, `updated_at`)
+ un déclencheur qui les met à jour tout seul. **Effet immédiat : aucun** — c'est le
socle.

**Phase 2 (côté code, à faire ensuite, coordonné).** À l'enregistrement, l'appli lira
le numéro de révision `rev`, écrira « seulement si personne n'a écrit entre-temps » ;
sinon elle relit, refusionne et réessaie. Résultat : **plus aucune perte** de config à
deux. C'est une modif du **cœur de l'enregistrement des réglages** → à faire quand tu
peux tester juste après (je ne l'ai pas faite en autonomie pour ne rien casser).

**Reco :** utile surtout le jour où **plusieurs admins** configurent en même temps.
Peux lancer la phase 1 dès maintenant (inoffensif), la phase 2 quand tu veux qu'on la
fasse ensemble.

> ✅ **03/11/2026 (audit F1, Étape 0)** : la phase 1 existe aussi en **migration versionnée**
> `supabase/migrations/20261103130000_app_settings_concurrence_rev.sql` (même SQL, idempotent),
> **testée automatiquement sur le STAGING**. **PRODUCTION = manuelle** (SQL Editor → coller → Run).
> La **phase 2 (verrou CAS côté code)** sera faite **après** l'application en prod, par étapes testées.

---

## 2) `conducteurs-id-stable.sql` — un identifiant qui ne bouge jamais

**Le problème.** Un conducteur est identifié par une clé dérivée de son **prénom**
(ou « prénom-nom » si homonyme). L'appli gère **déjà** les homonymes correctement.
Le petit risque restant : cette clé est liée au **nom** → renommer quelqu'un peut, à la
longue, désynchroniser des liens qui pointaient sur l'ancien nom.

**Ce que fait le script (phase 1).** Ajoute un identifiant technique `id` (un code
unique qui **ne change jamais**, même si le nom change) à chaque conducteur. **Effet
immédiat : aucun** — la clé actuelle reste utilisée partout.

**Phase 2 (côté code, à faire ensuite, lourde).** Faire pointer progressivement tous
les liens (conso par carte/badge, réglages par conducteur, historique d'affectation)
sur ce `id` au lieu du nom. C'est une migration **importante et coordonnée** (beaucoup
d'endroits) → à planifier, pas à improviser.

**Reco :** **faible priorité.** Le garde-fou homonyme actuel suffit au quotidien. À
envisager seulement si tu prévois beaucoup de renommages ou de gros volumes de
conducteurs. Lancer la phase 1 ne coûte rien mais ne sert que si on fait la phase 2.

---

---

## 3) `factures-notes-de-frais-columns.sql` — Notes de frais + import Sanef ⭐ RECOMMANDÉ

**À quoi ça sert.** Les nouvelles fonctions **« Notes de frais »** (onglet Factures) et
**import Sanef** (Contrôle → Sanef) rangent chaque dépense comme une facture, avec 3
infos en plus : **d'où elle vient** (`source` = note-frais / sanef), **sa catégorie**
(`categorie` = carburant / péage / lavage / parking / repas / autre) et **qui l'a payée**
(`conducteur`). Ce script ajoute ces 3 **colonnes** à la table `factures`.

**Sans danger.** 100 % additif (colonnes nullables + un index), ne supprime/ne renomme
**rien**. Contient son ROLLBACK.

**Faut-il vraiment le lancer ?** **Oui, recommandé.** L'appli est **tolérante** : même
sans ce script, une note de frais est enregistrée et **compte dans le TCO** (le
discriminateur vit dans la colonne `type` qui existe déjà). MAIS **la catégorie et le
conducteur ne seront pas mémorisés** tant que les colonnes n'existent pas (ils
réapparaîtront « Autre » / vides au rechargement). Après le script : **tout est stocké
et synchronisé** sur tous tes appareils. → **À lancer une fois avant d'utiliser
sérieusement les notes de frais / Sanef.**

> ✅ **Depuis le 03/11/2026 (audit)** : ce script existe aussi en **migration versionnée**
> `supabase/migrations/20261103120000_factures_notes_de_frais_colonnes.sql` (contenu
> identique, idempotent). Elle est **testée automatiquement sur le STAGING** à chaque PR
> (workflow `migration-staging.yml`). **La PRODUCTION reste manuelle** : quand tu veux,
> Supabase → SQL Editor → coller le fichier → Run (une fois), puis noter dans
> `supabase/migrations/JOURNAL.md`. (Tu peux aussi lancer l'ancien script racine, c'est
> le même SQL.)

---

### En résumé
| Script | Danger | Effet immédiat | Vraie valeur | Priorité |
|--------|--------|----------------|--------------|----------|
| `app_settings-concurrence.sql` | Aucun (additif) | Aucun (socle) | Après phase 2 code | Moyenne (si multi-admin) |
| `conducteurs-id-stable.sql` | Aucun (additif) | Aucun (socle) | Après phase 2 code | Faible |
| `factures-notes-de-frais-columns.sql` | Aucun (additif) | **Oui** (métadonnées notes de frais/Sanef) | Dès le lancement | **Recommandée** |

Dis-moi si tu veux qu'on enchaîne une **phase 2** (je la ferai par petites étapes,
testables, sans casser l'existant).
