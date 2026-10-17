# Projet STAGING — parc-pilot-staging

Projet Supabase **séparé de la production**, pour tester les changements de base (migrations, règles d'accès, stockage) **avant** de les appliquer en prod.

| | Production | Staging |
|---|---|---|
| Organisation | Office manager on demand (Pro) | Parc Pilot Staging (**gratuite**) |
| Projet | `tzjuptlzoywjeigmyfuj` | `csvjmzwexszsbowibxut` |
| URL | https://tzjuptlzoywjeigmyfuj.supabase.co | https://csvjmzwexszsbowibxut.supabase.co |
| Données | réelles | **100 % fictives** (sociétés `TEST-A`, `TEST-B`) |
| Clé publique | `sb_publishable_KC3T…` | `sb_publishable_6mV5Zbs1Bl_crlQgo5gOgg_rh-iT6Dr` |

> Les clés `sb_publishable_…` sont publiques par nature : elles ne donnent accès qu'à ce que la RLS autorise. Les clés `sb_secret_…` et le mot de passe de la base ne sont **jamais** écrits ici.
>
> Plan gratuit : le projet se **met en pause après 7 jours sans activité**. Pour le relancer : tableau de bord → projet → « Restore ». Le test d'isolation quotidien suffit normalement à le garder actif.

## Comment il a été construit (16/10/2026)
1. **Structure** copiée de la prod avec `extraire-schema-prod.sql` (lecture seule). Elle a été appliquée en une seule transaction sur le projet vide.
2. **Conformité vérifiée** : les deux bases donnent les mêmes résultats.
   - tables : 26, toutes avec RLS ;
   - colonnes : 325 ;
   - règles d'accès : 33 sur les tables, 7 sur le stockage ;
   - index : 65, fonctions : 7, déclencheurs : 4, vues : 1 ;
   - empreinte des colonnes : `79cb845c…` ; empreinte des règles d'accès : `e4c1e5ca…`.
3. **Données fictives** chargées avec `seed-donnees-fictives.sql`. Ce script refuse de tourner s'il trouve des données de production.

## Comptes de test (à créer une fois, par une personne)
Les comptes ne sont pas créés par script : un mot de passe ne doit apparaître ni dans le dépôt, ni dans un échange avec Claude.

1. Ouvrir le staging : **Authentication → Users → Add user → Create new user**. Créer deux comptes et cocher « Auto Confirm User » :
   - `test-a@parc-pilot.test`
   - `test-b@parc-pilot.test`

   Choisir un mot de passe pour chacun et le ranger dans votre gestionnaire de mots de passe.
2. **SQL Editor du staging** : exécuter le bloc « PROFILS » en bas de `seed-donnees-fictives.sql`, en retirant les `--`. Chaque compte devient « admin » de sa société de test, sans les droits CEO.
3. **GitHub → Settings → Secrets and variables → Actions → New repository secret** : ajouter les 4 secrets ci-dessous. Le workflow « Sécurité — isolation entre sociétés » tournera alors chaque jour.
   - `TEST_A_EMAIL`, `TEST_A_PASSWORD`
   - `TEST_B_EMAIL`, `TEST_B_PASSWORD`

## Lancer les tests à la main
```bash
# Accès anonyme (aucun secret nécessaire)
SUPABASE_URL=https://csvjmzwexszsbowibxut.supabase.co \
SUPABASE_PUBLISHABLE_KEY=sb_publishable_6mV5Zbs1Bl_crlQgo5gOgg_rh-iT6Dr \
node tests/securite/acces-anonyme.mjs

# Isolation entre sociétés (comptes de test)
STAGING_URL=https://csvjmzwexszsbowibxut.supabase.co \
STAGING_PUBLISHABLE_KEY=sb_publishable_6mV5Zbs1Bl_crlQgo5gOgg_rh-iT6Dr \
TEST_A_EMAIL=… TEST_A_PASSWORD=… TEST_B_EMAIL=… TEST_B_PASSWORD=… \
node tests/securite/isolation-societes.mjs
```

## Règle d'usage
Toute migration de `supabase/migrations/` passe **d'abord** sur le staging, avec les tests verts, **puis** en production. Elle est ensuite consignée dans `supabase/migrations/JOURNAL.md`.
