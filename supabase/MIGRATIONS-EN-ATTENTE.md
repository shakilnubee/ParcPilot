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

**Phase 2 (côté code).** À l'enregistrement, l'appli lit le numéro de révision `rev`,
écrit « seulement si personne n'a écrit entre-temps » ; sinon elle relit, refusionne et
réessaie. Résultat : **plus aucune perte** de config à deux.

**Reco :** utile surtout le jour où **plusieurs admins** configurent en même temps.

> ✅✅ **03/11/2026 — TERMINÉ (audit F1).** Les DEUX phases sont en place :
> - **Phase 1 (socle)** : migration versionnée `supabase/migrations/20261103130000_app_settings_concurrence_rev.sql`
>   (colonnes `rev`+`updated_at` + trigger `trg_app_settings_touch`), **testée sur STAGING** (PR #1196)
>   puis **appliquée en PRODUCTION** le 03/11.
> - **Phase 2 (verrou CAS côté code)** : **déjà présente** dans `FP.settings._pushSettings`
>   (`assets/js/app.js`, boucle `select('data, rev')` → `update … .eq('rev', rev)` → relire/refusionner/retenter),
>   **feature-detecting** (repli par fusion sûre si `rev` absent). Elle était **dormante** faute de colonne `rev`
>   en prod ; **depuis l'application de la phase 1, le CAS est actif tout seul**. Rien de plus à déployer.

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

## 4) `gestionnaire-config-guard.sql` — verrou serveur de la config (audit F6) ✅ APPLIQUÉ EN PROD (03/11)

> ✅ **03/11/2026 — APPLIQUÉ EN PRODUCTION** (Shakil, accord explicite ; voir `migrations/JOURNAL.md`).
> Verrou `trg_guard_app_settings_config` actif. Faille d'autorisation intra-société fermée (F6 clos).

**Le problème.** Un compte **gestionnaire** peut, via l'API, écrire la ligne `app_settings` de **sa**
société (la policy RLS ne distingue pas son rôle). La config réservée à l'admin (e-mails d'amende,
nom société, groupes, seuils d'alerte, champs perso, documents obligatoires, automatisations) n'est
protégée **qu'à l'écran**. Un gestionnaire averti pourrait l'altérer par un appel forgé (jamais une
AUTRE société — l'isolation tient).

**Ce que fait le script.** Ajoute un **déclencheur** `trg_guard_app_settings_config` qui, **pour un
gestionnaire uniquement**, REFUSE une écriture si elle **change réellement** une clé de config
(`societe`, `groupes`, `notif`, `pleinSeuilAnormal`, `customFields`, `docRequis`, `automations`, et
`profil` **sauf** `logoUrl`). Tout le reste passe (données de travail, affichage, cache logo e-mail,
clés inconnues) → **fail-open**, aucune opération du gestionnaire cassée. CEO/Admin : non concernés.

**Pourquoi c'est sûr.** Le client écrit toujours par **fusion delta** : une clé de config non changée
reste identique au serveur → jamais bloquée. Seul un vrai changement de config par un gestionnaire est
refusé. **Testé sur un vrai PostgreSQL 16** (données de travail/affichage/logo = passent ; 6 types de
config = bloqués ; admin = tout passe ; idempotent) **et** sur le STAGING (migration-staging.yml).

> ⚠️ **Avant la PROD** : rejouer le **test avec un compte GESTIONNAIRE réel sur le staging** (opérations
> de travail + envoi d'e-mail brandé = OK ; modif de config via l'app = masquée, via API = refusée).
> Puis appliquer en prod avec accord + sauvegarde, et noter dans `JOURNAL.md`. Rollback dans le fichier.
> Migration versionnée : `supabase/migrations/20261103140000_gestionnaire_config_guard.sql`.

---

## 5) `20261104100000_cron_runs_table.sql` — supervision des tâches planifiées (audit F22/F23) ✅ APPLIQUÉ EN PROD (04/11)

> ✅ **04/11/2026 — APPLIQUÉ EN PRODUCTION** (Shakil, accord explicite ; voir `migrations/JOURNAL.md`).
> Écran « Tâches automatiques — dernière exécution » actif (Paramètres → Notifications).

**À quoi ça sert.** Une petite table `cron_runs` qui garde l'**historique des exécutions** des tâches
automatiques du serveur (relances km + rappels RDV, rappels de tâches, import péages Ulys). Un écran
**lecture seule** « Tâches automatiques — dernière exécution » (Paramètres → **Notifications**, visible
aussi par un gestionnaire) affiche, pour chaque tâche, **quand** elle a tourné et **combien** d'envois.

**Sans danger.** 100 % additif (table neuve + 1 index + 1 policy de **lecture** pour les comptes
connectés ; **écriture réservée au serveur**). Contenu non sensible : nom de la tâche, statut,
horodatages, **compteurs globaux** (aucun nom de société, aucune donnée perso). Rollback = `drop table`.

**Déjà branché (best-effort).** Les 3 Edge Functions écrivent une ligne à chaque exécution, dans un
`try/catch` qui **ne peut jamais bloquer la tâche** : tant que la table n'existe pas en prod, le POST est
ignoré et l'écran reste simplement **vide**. → **À lancer une fois** pour activer la supervision (sinon
tout fonctionne comme avant, juste sans historique). Testée staging (migration-staging.yml).

> 🔎 **Vérifier en même temps que les tâches cron sont bien ACTIVES** (audit F20, à faire en base — moi je
> n'y ai pas accès). Dans Supabase → SQL Editor :
> ```sql
> select jobname, schedule, active from cron.job order by jobname;
> ```
> On doit voir les planifications de `km-relance`, `task-reminders`, `ulys-daily` avec `active = true`.
> Si une ligne manque ou `active = false`, la tâche ne tourne pas → relancer le `*-setup.sql` concerné.
> (L'écran de supervision le montrera aussi : une tâche active écrit une ligne chaque jour ; si rien
> n'apparaît après 24-48 h, c'est le signe que la planification ou un secret `x-cron-secret` manque.)

---

### En résumé
| Script | Danger | Effet immédiat | Vraie valeur | Priorité |
|--------|--------|----------------|--------------|----------|
| `app_settings-concurrence.sql` | Aucun (additif) | ✅ **FAIT (03/11)** — CAS `rev` actif en prod | — (terminé) | — |
| `conducteurs-id-stable.sql` | Aucun (additif) | Aucun (socle) | Après phase 2 code | Faible |
| `factures-notes-de-frais-columns.sql` | Aucun (additif) | **Oui** (métadonnées notes de frais/Sanef) | Dès le lancement | **Recommandée** |
| `gestionnaire-config-guard.sql` (F6) | Aucun (fail-open) | ✅ **FAIT (03/11)** — faille config gestionnaire fermée | — (terminé) | — |
| `cron_runs_table.sql` (F22/F23) | Aucun (additif) | ✅ **FAIT (04/11)** — supervision des tâches auto active | — (terminé) | — |

Dis-moi si tu veux qu'on enchaîne une **phase 2** (je la ferai par petites étapes,
testables, sans casser l'existant).
