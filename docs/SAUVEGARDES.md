# Sauvegardes de Parc Pilot

## En résumé

| | |
|---|---|
| **Quoi** | La base complète (rôles, structure, données, comptes) **et tous les fichiers** du stockage, plus les règles d'accès du stockage |
| **Quand** | Chaque nuit vers 3 h 15 (heure de Paris), automatiquement |
| **Où** | Artefacts GitHub du dépôt (onglet **Actions** → workflow « Sauvegarde ») |
| **Durée de conservation** | 30 jours ; **90 jours** pour la sauvegarde du 1er de chaque mois (maximum autorisé par GitHub) |
| **Protection** | Chiffrée avec `age` : seuls les détenteurs d'une **clé privée** peuvent la lire |
| **Vérification** | À chaque sauvegarde, une **restauration d'essai** est faite dans une base vide, et le nombre de lignes de chaque table est comparé à l'original. Si quelque chose ne concorde pas, la sauvegarde échoue et GitHub envoie un e-mail |

Cette sauvegarde **s'ajoute** aux sauvegardes quotidiennes internes de Supabase (plan Pro). Elle protège contre trois risques que celles-ci ne couvrent pas : la perte des **fichiers** (non inclus chez Supabase), un problème du compte Supabase lui-même, et le besoin de restaurer ailleurs.

> ⚠️ Le dépôt est **public** : n'importe quel utilisateur GitHub connecté peut télécharger les artefacts. C'est sans danger **tant que les clés privées restent secrètes**, car le contenu est chiffré. Ne jamais déposer une clé privée dans le dépôt, un ticket ou un e-mail.

> ⚠️ Pour conserver un historique **au-delà de 90 jours** (par exemple une sauvegarde par mois sur un an), il faudra ajouter un stockage externe (Cloudflare R2, Backblaze B2…). Le script s'y prête : il suffira d'ajouter une étape d'envoi.

---

## 1. Créer sa clé (une fois par personne)

Chaque personne autorisée à restaurer (aujourd'hui **François** et **Shakil**) crée sa propre paire de clés.

Sur Mac, dans le Terminal :

```bash
brew install age                         # une seule fois
age-keygen -o ~/Desktop/cle-sauvegarde-parc-pilot.txt
```

La commande affiche une ligne `Public key: age1…`.

1. **La clé publique** (`age1…`) : envoyez-la à Claude ou ajoutez-la dans `sauvegardes/destinataires.txt`. Elle peut être publiée sans risque.
2. **La clé privée** : ouvrez le fichier `cle-sauvegarde-parc-pilot.txt`. Copiez **tout** son contenu (y compris la ligne `AGE-SECRET-KEY-1…`) dans votre **gestionnaire de mots de passe**, sous le titre « Parc Pilot — clé de sauvegarde ».
3. **Supprimez ensuite le fichier** du Bureau (et videz la corbeille).

> Si toutes les clés privées sont perdues, **les sauvegardes deviennent illisibles**. C'est pourquoi il y a deux détenteurs.

## 2. Configurer les accès (une fois par base)

Dans **GitHub → Settings → Secrets and variables → Actions → New repository secret** :

| Secret | Où le trouver |
|---|---|
| `PROD_DB_URL` | Supabase (projet **Parc Pilot**) → bouton **Connect** → onglet « Connection string » → **Session pooler**. Copier l'adresse et remplacer `[YOUR-PASSWORD]` par le mot de passe de la base. ⚠️ Prendre le « Session pooler », pas la « Direct connection » : GitHub ne sait pas joindre cette dernière. |
| `PROD_S3_ACCESS_KEY_ID` / `PROD_S3_SECRET_ACCESS_KEY` | Supabase (projet Parc Pilot) → **Storage** → **Settings** → « S3 Connection » → **New access key**. La clé secrète ne s'affiche qu'une fois. |
| `STAGING_DB_URL`, `STAGING_S3_ACCESS_KEY_ID`, `STAGING_S3_SECRET_ACCESS_KEY` | Les mêmes, dans le projet **parc-pilot-staging** |

Si le mot de passe de la base n'est pas connu, il se réinitialise dans Supabase → **Database** → **Settings** → « Reset database password ». En production, Parc Pilot n'utilise pas ce mot de passe directement : le site et les fonctions passent par des clés d'API. La réinitialisation est donc sans impact.

## 3. Vérifier que les sauvegardes tournent

- GitHub → onglet **Actions** → workflow « **Sauvegarde (base + fichiers…)** ». Chaque nuit doit afficher une coche verte ✅.
- Le résumé de chaque exécution indique que la restauration d'essai a réussi, ainsi que le nom et la durée de conservation de l'archive.
- Pour lancer une sauvegarde à la main : bouton **Run workflow**, puis choisir la cible (`production` ou `staging`).

---

## 4. Restaurer (en cas de besoin)

> À faire **calmement**, de préférence **dans un projet Supabase neuf** et non par-dessus la production. On vérifie le résultat, puis on bascule.

### 4.1 Récupérer et déchiffrer l'archive
1. GitHub → **Actions** → « Sauvegarde » → choisir la date voulue → section **Artifacts** → télécharger `parc-pilot-production-AAAA-MM-JJ_HHMM.tar.gz.age`. GitHub fournit un `.zip` qui contient ce fichier.
2. Dans le Terminal :
   ```bash
   unzip parc-pilot-production-*.zip
   # coller la clé privée (depuis le gestionnaire de mots de passe) dans un fichier temporaire :
   pbpaste > /tmp/cle.txt        # après avoir copié la clé
   age -d -i /tmp/cle.txt parc-pilot-production-*.tar.gz.age | tar xz
   rm /tmp/cle.txt
   ```
   On obtient un dossier `sauvegarde/` qui contient :
   - `base/roles.sql`, `base/schema.sql`, `base/data.sql`, `base/regles-stockage.sql` ;
   - `base/comptes-source.txt` (nombre de lignes de chaque table au moment de la sauvegarde) ;
   - `fichiers/scans/…` (tous les fichiers).

### 4.2 Restaurer la base
1. Créer un **nouveau projet Supabase** (ou utiliser un projet vide).
2. Récupérer son adresse de connexion (**Connect** → Session pooler), puis lancer :
   ```bash
   psql "<ADRESSE_DU_NOUVEAU_PROJET>" \
     --single-transaction --variable ON_ERROR_STOP=1 \
     --file sauvegarde/base/roles.sql \
     --file sauvegarde/base/schema.sql \
     --command 'SET session_replication_role = replica' \
     --file sauvegarde/base/data.sql \
     --command 'SET session_replication_role = origin' \
     --file sauvegarde/base/regles-stockage.sql
   ```
   Si la commande s'arrête sur `permission denied for parameter log_min_messages` : c'est un simple réglage de journalisation. Supprimer la ligne concernée de `roles.sql` (elle contient `log_min_messages`), puis relancer.
3. Vérifier les nombres de lignes :
   ```bash
   psql "<ADRESSE_DU_NOUVEAU_PROJET>" -At -f scripts/sauvegarde/compter.sql | diff - sauvegarde/base/comptes-source.txt && echo "✅ identique"
   ```

### 4.3 Restaurer les fichiers
Créer une clé S3 dans le nouveau projet (Storage → Settings → S3 Connection), puis :
```bash
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… AWS_DEFAULT_REGION=<région du projet>
aws s3 sync sauvegarde/fichiers/scans "s3://scans" \
  --endpoint-url "https://<ref-du-nouveau-projet>.storage.supabase.co/storage/v1/s3"
```

### 4.4 Rebrancher le site
Dans `assets/js/supabase-client.js`, remplacer l'URL et la clé publique par celles du nouveau projet, puis redéployer les fonctions serveur et reconfigurer leurs secrets (Resend, Anthropic…). **À faire avec un développeur.**

---

## 5. Test de restauration complet (chaque trimestre)

La restauration d'essai automatique prouve chaque nuit que **la base** est restaurable. Une fois par trimestre, on fait en plus l'exercice **complet** des étapes 4.1 à 4.3, avec un humain et une vraie clé privée, sur la sauvegarde du **staging**, puis on le note ci-dessous.

| Date | Sauvegarde utilisée | Par | Résultat |
|---|---|---|---|
| 16/10/2026 | `parc-pilot-staging-2026-10-16_1732` | François | ✅ Archive téléchargée et **déchiffrée avec sa clé privée** (étape 4.1) ; contenu complet listé. Restauration de la base vérifiée automatiquement par la tâche (30 tables identiques). Étapes 4.2 et 4.3 à la main : à faire au prochain trimestre. |
