# Dossier `supabase/` — ce qu'il contient et ce qu'il ne faut PAS faire

> ⚠️ **Règle n° 1 : ne jamais ré-exécuter un ancien script SQL de ce dossier dans Supabase.**
> Depuis le 16/10/2026, toute modification de la base passe par une **migration versionnée**
> (`migrations/`), testée sur le **staging**, puis appliquée en production avec accord.
> Règles complètes : `CLAUDE.md` (section « 🔐 RÈGLES DE SÉCURITÉ ») et `SUIVI-PROJET.md`.

## Ce qui fait foi aujourd'hui

| Dossier / fichier | Rôle |
|---|---|
| `migrations/` | **Seule voie** pour modifier la base (schéma, règles d'accès, stockage, fonctions, déclencheurs). Un fichier par changement : `AAAAMMJJHHMMSS_description.sql`, idempotent, retour arrière en commentaire. |
| `migrations/JOURNAL.md` | Trace de chaque intervention sur la production (date, accord, sauvegarde, vérification). |
| `staging/` | Projet de test (données fictives) : copie du schéma de production, jeu de données, mode d'emploi. |
| `functions/` | Fonctions serveur (Edge Functions), déployées automatiquement à la fusion dans `main`. |
| `config.toml` | Configuration de la CLI Supabase. |

## Les archives (à lire, jamais à rejouer)

Tous les autres fichiers `.sql` sont des **manipulations faites à la main** dans l'éditeur SQL de
Supabase avant octobre 2026. Ils racontent comment la base a été construite, mais **ne décrivent plus
son état actuel** : plusieurs ont été remplacés, annulés ou corrigés depuis.

- `historique/` : les anciens scripts qui étaient à la racine du dépôt (`supabase-*.sql`), rangés ici le 20/10/2026.
- `*.sql` directement dans `supabase/` : laissés en place pour l'instant, car du code ou de la
  documentation y fait référence. Ils seront rangés au fur et à mesure.

### Exemples de scripts qui rouvriraient des failles corrigées

| Script | Ce qu'il referait |
|---|---|
| `historique/supabase-storage.sql`, `storage-scans-bucket.sql` | rendre le stockage des documents **public** |
| `historique/supabase-app-settings.sql`, `enable-rls.sql` | ouvrir les tables ou les réglages **à tous les comptes, toutes sociétés confondues** |
| `multi-societe-rls.sql`, `reglages-par-societe.sql` | remplacer les règles d'accès actuelles par d'anciennes versions |
| `durcissement-config-gestionnaire.sql` | bloquer le travail courant des gestionnaires (annulé le 25/08/2026) |
| `dedupe-*.sql` | supprimer des lignes en masse |

La liste n'est pas exhaustive : **dans le doute, considérer qu'aucun de ces scripts n'est sûr.**

## Les scripts de vérification

Les fichiers `verif-*.sql` et `test-isolation-2-clients.sql` portent un nom de vérification, mais
**la plupart contiennent aussi des écritures** (création de fonctions, modification de règles d'accès…) :
seul `verif-comptes-isolation.sql` est en lecture seule. Ils sont remplacés par les tests automatiques
de `tests/securite/` (accès anonyme, isolation entre sociétés), à privilégier.
