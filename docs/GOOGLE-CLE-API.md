# Activer Google Maps dans Parc Pilot — créer la clé (guide pas-à-pas)

But : obtenir **une clé API Google restreinte** et la ranger dans les **secrets Supabase**, pour activer
la saisie d'adresse assistée + le geocoding **sans jamais exposer la clé** et **sous le compteur de quota**
(alerte 80 %, coupure 90 % de la limite gratuite). Tant que cette clé n'est pas posée, tout reste **désactivé**
(aucun appel, aucun coût).

> ⚠️ Ne colle JAMAIS la clé dans le code, un fichier du dépôt, une PR, un e-mail ou un message de chat.
> Elle ne vit que dans **Supabase → Edge Functions → Secrets**. Le dépôt est public.

## 1. Créer un projet Google Cloud
1. Va sur https://console.cloud.google.com/ (connecte-toi avec le compte Google de la société).
2. En haut, sélecteur de projet → **Nouveau projet** → nom : `Parc Pilot` → **Créer**.
3. Sélectionne ce projet (sélecteur en haut).

## 2. Activer la facturation (obligatoire, mais tu restes dans le gratuit)
Google exige une carte pour activer les API Maps, **même pour l'usage gratuit**.
1. Menu ☰ → **Facturation** → **Associer un compte de facturation** (ajoute une carte).
2. ⚠️ C'est Parc Pilot qui te protège du dépassement (coupure à 90 % de la limite gratuite). Pour une
   double sécurité, tu peux plus tard poser un **plafond de quota** côté Google (voir §5).

## 3. Activer les 2 API nécessaires
Menu ☰ → **APIs et services** → **Bibliothèque**, puis active :
- **Geocoding API** (adresse → GPS)
- **Places API (New)** (autocomplétion d'adresse)

*(La carte interactive viendra plus tard ; on commence par l'adresse, moins coûteuse.)*

## 4. Créer la clé API **restreinte**
1. **APIs et services → Identifiants → Créer des identifiants → Clé API**.
2. Copie la clé affichée (tu la colleras à l'étape 6). Puis clique **Modifier la clé API** :
   - **Restrictions relatives aux applications** → **Sites web** → ajoute les référents :
     `https://parc-pilot.fr/*` et `https://www.parc-pilot.fr/*`.
     *(La clé sert surtout côté serveur, mais on la restreint par principe.)*
   - **Restrictions relatives aux API** → **Restreindre la clé** → coche **Geocoding API** + **Places API (New)**.
   - **Enregistrer**.

## 5. (Recommandé) Poser un plafond côté Google — double filet
**APIs et services → chaque API → Quotas** : fixe un quota mensuel **sous** la limite gratuite
(ex. Geocoding ≤ 9 000/mois, Places ≤ 4 500/mois). Ainsi, même si Parc Pilot avait un bug, Google
bloquerait de lui-même avant le payant.

## 6. Ranger la clé dans Supabase (secret serveur)
1. https://supabase.com/dashboard → projet **production** `tzjuptlzoywjeigmyfuj`.
2. **Edge Functions → Secrets → Add new secret** :
   - **Name** : `GOOGLE_MAPS_API_KEY`
   - **Value** : *(colle la clé de l'étape 4)* → **Save**.
3. C'est tout côté Google. Préviens-moi (« clé posée ») : je fais les 2 dernières étapes techniques.

## 7. Ce que JE fais ensuite (côté Parc Pilot)
1. **Appliquer la migration en production** (table de quota) — **avec ton accord explicite + sauvegarde
   vérifiée**, noté dans `supabase/migrations/JOURNAL.md`. *(Aujourd'hui elle n'est appliquée que sur le staging.)*
2. **Brancher et TESTER en vrai** la saisie d'adresse assistée sur les champs (garages, conducteurs,
   société), vérifier que chaque appel est bien **compté** et que la **coupure 90 %** fonctionne.
3. Te montrer l'écran **Paramètres → Intégrations Google** passer en **« actif »** avec la conso réelle.

## Déjà en place (ne nécessite AUCUNE clé)
- Les **liens « Itinéraire »** (Google Maps s'ouvre dans un nouvel onglet) sur garages, conducteurs,
  rendez-vous garage et restitution — **gratuits, sans clé, sans quota**.
- Le **compteur de quota** (table + fonction + écran) et la **passerelle serveur** `google-maps`
  (dormante tant que la clé n'est pas posée).
