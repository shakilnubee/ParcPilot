# Parc Pilot — Contexte projet

## 🔐 RÈGLES DE SÉCURITÉ ET DE TRAVAIL — PRIORITÉ ABSOLUE (depuis le 16/10/2026)

> Ces règles **priment sur tout le reste de ce fichier**, y compris les anciennes consignes qui disaient de
> pousser directement sur `main` ou d'exécuter un script SQL dans Supabase. Elles valent pour **toute
> session** (Claude, Codex ou humain), sur **tous les PC**. Contexte et historique : `SUIVI-PROJET.md`.

1. **Jamais de push direct sur `main`.** `main` est publiée automatiquement sur https://parc-pilot.fr.
   Toute modification passe par **une branche dédiée** (`sujet/description-courte`) **et une pull request**,
   fusionnée seulement quand les **tests automatiques sont verts** (`controles`, `e2e`). `main` est
   protégée côté GitHub : un push direct sera refusé — ce n'est pas un bug, il faut ouvrir une PR.
   Jamais de `git push --force`, jamais de suppression de branche ou d'historique sans accord explicite.
2. **Jamais d'écriture sur la base de PRODUCTION sans accord explicite, pour chaque action.**
   Production = projet Supabase `tzjuptlzoywjeigmyfuj`. Toute modification de **schéma, règles d'accès
   (RLS, stockage), fonctions ou déclencheurs** :
   - s'écrit comme une **migration versionnée** dans `supabase/migrations/AAAAMMJJHHMMSS_description.sql`
     (idempotente, avec son retour arrière en commentaire) ;
   - est **testée d'abord sur le staging** (projet `csvjmzwexszsbowibxut`, données fictives, voir
     `supabase/staging/README.md`) ;
   - n'est appliquée en production qu'**avec accord**, **après une sauvegarde vérifiée**, puis notée dans
     `supabase/migrations/JOURNAL.md`.
   Aucune action destructive (`DROP`, `DELETE` massif, `TRUNCATE`) sans confirmation explicite.
3. **Ne jamais ré-exécuter les anciens scripts SQL** de `supabase/historique/` ni de `supabase/*.sql` :
   ce sont des archives de manipulations faites à la main avant octobre 2026. Plusieurs **rouvriraient des
   failles corrigées** (fichiers publics, accès anonyme, réglages partagés entre sociétés). Voir
   `supabase/LISEZ-MOI.md`.
4. **Ne jamais affaiblir les garde-fous en place** (sauf demande explicite et motivée) :
   - stockage `scans` **privé**, rangé par société (`societes/<slug>/…`, helper `FP.storageDossierSociete`)
     et protégé par les règles `scans_societe_*` ;
   - vue `vehicules_public` (QR) en **lecture seule** ;
   - ligne `app_settings` id=`global` **gelée** (déclencheur `trg_00_geler_ligne_global`) : ne jamais
     lire ni écrire les réglages d'une société dans `global` ;
   - **anti-vidage** des réglages (`trg_01_anti_vidage_reglages`) et fusion `FP._fusion` (rejeu des
     écritures en attente) — couverts par `tests/unit/fusion-reglages.mjs` ;
   - tests de sécurité : `tests/securite/acces-anonyme.mjs` (quotidien) et
     `tests/securite/isolation-societes.mjs` (staging uniquement).
   Si l'un de ces tests échoue après une modification, c'est la modification qu'il faut revoir.
5. **Aucun secret dans le code, les fichiers, les commits, les PR ou les réponses** (mot de passe,
   clé `service_role`/`sb_secret_…`, token, URL de base avec mot de passe, clé privée `AGE-SECRET-KEY-…`).
   Les secrets vivent dans **GitHub → Settings → Secrets** et dans les secrets Supabase. Le dépôt est
   **public** : aucune donnée personnelle non plus (voir la règle RGPD sur `data.js`).
6. **Sauvegardes** : une sauvegarde chiffrée de la production (base + fichiers + règles du stockage) tourne
   **chaque nuit** (`.github/workflows/sauvegarde.yml`), avec restauration d'essai automatique. Mode
   d'emploi et restauration : `docs/SAUVEGARDES.md`. Ne pas modifier ce workflow sans le tester sur le staging.
7. **Dans le doute, demander** plutôt que supposer — surtout pour tout ce qui touche la production.
8. **Tenir `SUIVI-PROJET.md` à jour** à chaque étape notable (même PR que le changement).

## 🏛️ CONTRAT DE DÉVELOPPEMENT — PROMPT MAÎTRE (gravé en dur, s'applique à CHAQUE demande)

> ⚠️ **Consigne explicite et permanente de l'utilisateur** : ce contrat vaut pour **toute** demande sur
> Parc Pilot, **sans qu'il ait à le redonner**. Il s'ajoute (ne remplace pas) aux « ⚖️ RÈGLES PERMANENTES
> DE DÉVELOPPEMENT » plus bas et à tout le reste de ce fichier. L'utilisateur parle en **phrases simples**
> (souvent + une capture d'écran) ; à moi de traduire son intention en une modif **complète et sûre**.

**Les 13 principes non négociables** (détaillés plus bas dans ce fichier) :
1. **NE RIEN CASSER** — jamais supprimer une feature / changer une logique métier / contourner un bug en désactivant une fonctionnalité. Corriger la **cause racine**.
2. **SOURCE UNIQUE** — chercher un helper `FP.*` existant AVANT d'en créer un ; une règle métier = **une seule** implémentation (centralisée dans `FP.*` si réutilisable).
3. **INTÉGRITÉ DES DONNÉES = PRIORITÉ N°1** — écriture = même ligne/clé que la lecture ; via `FP.persist` ; jamais d'échec silencieux ; toute map keyée → `COLLECTION_KEYS`.
4. **TOUT SYNCHRONISÉ (Supabase)** — `localStorage` = cache d'affichage seul, jamais la source.
5. **MULTI-SOCIÉTÉS** — code commun à toutes les sociétés ; jamais de feature spécifique à une société (les différences viennent des données/réglages). Rôles via `profiles`, jamais les métadonnées client.
6. **PROPAGATION GLOBALE** — chercher par **fonctionnalité** (pas par mot) et répercuter partout : desktop/mobile, fiches, tableaux, dashboard, stats, filtres, alertes, PDF, e-mails, exports, portail conducteur, QR, scan IA, Edge Functions, tâches auto, paramètres, **manuel**.
7. **SÉCURITÉ** — toute donnée saisie/scannée/Supabase/portail injectée en HTML → `FP.esc` ; ne jamais faire confiance au navigateur ; contrôles serveur quand nécessaire.
8. **DOCUMENTS/IA — LIRE, JAMAIS DEVINER** — s'ancrer sur le libellé/repère (jamais `Math.max` aveugle), contrôler la cohérence (HT+TVA=TTC), ne rien inventer, anti-doublons centralisé.
9. **PERFORMANCE** — pas d'O(n²) inutile (index/Map), mémoriser, débouncer, éviter re-render et rechargements Supabase inutiles.
10. **INTERFACE FR** — recherche clavier + filtres + bouton « Réinitialiser » sur tout sélecteur ; desktop **et** mobile ; « prévenir un conducteur » = **SMS + WhatsApp + e-mail**.
11. **SYNCHRO vérifiée** — chemin complet `UI → logique → persistance → Supabase → lecture → affichage`, retrouvable après rechargement / autre appareil / autre utilisateur autorisé.
12. **MANUEL** — `pages/manuel.html` mis à jour **dans le même lot** que la feature.
13. **DÉPLOIEMENT** — si `app.js`/`fleet-views.js`/`supabase-client.js`/`data.js` changent : régénérer les `.min.js` + bumper `?v=` partout (+ `sw.js`, `version.json`) ; contrôle `check-bugs` ; RGPD `data.js` (0 donnée perso, dépôt public). HTML seul = pas de bump.

**Méthode pour CHAQUE demande** : (1) comprendre le besoin métier (qui/quoi/où/règles existantes/écrans) → (2) chercher l'existant (helpers `FP.*`, tables, `app_settings`, `COLLECTION_KEYS`, persistance, Edge Functions, affichages/PDF/e-mails, dépendances) → (3) plan (fichiers, helpers à réutiliser/centraliser, données, persistance, permissions, propagation, tests, doc) → (4) implémentation **minimale et ciblée** (pas de gros refactor non demandé) → (5) vérifs (syntaxe, refs, persistance, anti-perte, multi-sociétés, permissions, mobile/desktop, XSS, perf, propagation, PDF/e-mails/portail, manuel) → (6) **compte rendu obligatoire**.

**Compte rendu obligatoire (fin de chaque intervention)** : 1) modifs (fichiers/fonctions/features) · 2) centralisation (helpers réutilisés/créés) · 3) données (tables, `app_settings`, `COLLECTION_KEYS`, persistance) · 4) propagation (écrans, mobile/desktop, PDF, e-mails, portail, Edge Functions) · 5) sécurité/permissions · 6) tests + points restant à vérifier · 7) manuel · 8) déploiement (minif/bump ou non).

**Règle finale** : une feature n'est **terminée** que si sa donnée est **persistée, récupérable après rechargement, synchronisée entre appareils** et **intégrée partout** où elle doit logiquement servir — pas seulement « le bouton marche ». En cas de conflit avec l'architecture : ne pas contourner en silence → l'expliquer, proposer la solution compatible, et ne demander confirmation que si une **décision métier** est réellement nécessaire.

## C'est quoi ce projet ?

**Parc Pilot** est un SaaS de gestion de flotte automobile, développé pour TJMAX (avec aussi des véhicules BPCE en leasing et PROJECT X PARIS RETAIL).

- **Propriétaire** : Shakil Nubeebaccus
- **Stack** : HTML/CSS/JS statique + Tailwind précompilé en local (`assets/css/tailwind.css`, voir Conventions)
- **Backend** : Supabase (PostgreSQL + Auth)
- **Hosting** : ✅ **GitHub Pages** (auto-déploiement depuis la branche `main`) → **domaine principal : https://parc-pilot.fr/** (GoDaddy, HTTPS forcé ; `www` redirige vers l'apex). L'ancienne URL **https://shakilnubee.github.io/Autoflotte/** redirige désormais vers `parc-pilot.fr`. ⚠️ Le fichier **`CNAME`** (racine du repo = `parc-pilot.fr`) NE DOIT PAS être supprimé, sinon le domaine se débranche. Les liens publics en dur (QR véhicules `carte.html`, e-mails d'amende `avis.html`, carte de visite `brochure.html`) pointent sur `parc-pilot.fr`.
  - ⚠️ Netlify (auto-flotte.netlify.app) = EN PAUSE (quota dépassé) — ne plus utiliser. Vercel (autoflotte.vercel.app) = version périmée — ne plus utiliser.
  - **Règle** : chaque modif de code passe par une **branche + pull request** (tests verts), puis est **fusionnée dans `main`** (GitHub Pages publie tout seul en ~1-2 min). Jamais de push direct sur `main` (voir « 🔐 RÈGLES DE SÉCURITÉ » en haut). Toujours VÉRIFIER après fusion que le site live reflète bien le changement.
  - Les **données** (Supabase) sont en temps réel sur tous les postes, sans déploiement.
- **Repo** : https://github.com/shakilnubee/ParcPilot  (public, branche `main` protégée — l'ancienne adresse `…/Autoflotte` redirige ici)
- **Langue UI** : Français

## Fichier source Drive (référence unique)

⚠️ Pour toute synchro flotte/conducteurs/amendes, utiliser **TOUJOURS et UNIQUEMENT** ce
fichier Google Sheets (demande explicite de l'utilisateur) :
- **ID** : `1OytuLYw0T8-0Hebsu0L6N8sgk1pC6SfKp3n7l1i0fkU`
- Onglet véhicules en haut (col `CONDUCTEUR | N° de plaque | Type`), puis sections amendes.
- Ne jamais utiliser les anciennes copies (« pour Claude », « Copie de Voiture + Contravention », etc.).
- ⚠️ **RÈGLE « mettre à jour »** (consigne explicite) : quand l'utilisateur dit « mets à jour »,
  ne prendre QUE **l'onglet `véhicules`** et **l'onglet `2026`** (amendes 2026). Ignorer tous les
  autres onglets/sections (emprunts, anciennes amendes, etc.).
- ⚠️ **Source FACTURES** (consigne explicite) : dossier Drive `111YMFZL-daGrBSIQcdfPmvOouDltbg0v`,
  organisé par pays → sous-dossier par véhicule (plaque) → PDF. Prendre **FRANCE, ITALIE,
  ALLEMAGNE, Pays-Bas** uniquement. **EXCLURE** les sous-dossiers `01. Autres` et `OUT`.
  Lier chaque PDF à la table `factures` par `file_id` ; « nouvelles » = `file_id` absent de la base.
  Les **nouvelles** factures se trouvent en général dans les sous-sous-dossiers **`2026`** de chaque véhicule.
  ⚠️ **Vérifier par le CONTENU, pas par le nom** : il faut LIRE le PDF/scan pour décider (un fichier « Scan… » peut être une vraie facture). N'importer dans `factures` QUE les **vraies factures** (fournisseur + montants), avec OCR du HT / TVA / TTC / n° de facture / KM / fournisseur / description courte.
  ⚠️ **ANTI-DOUBLONS — toute la plateforme** (consigne explicite) : à CHAQUE ajout, détecter les doublons via le helper central **`FP.dupe`** (`assets/js/app.js`). `FP.dupe.confirmAdd(table, rec, list)` = garde AVANT insertion (demande confirmation si doublon) ; `FP.dupe.find(...)` = renvoie l'existant. Règles : **factures** = même n° + même montant TTC (sinon fournisseur+TTC+date) ; **amendes** = n° d'avis + montant (sinon prénom+date+montant) ; **véhicules** = immatriculation ; **emprunts** = véhicule+emprunteur+date ; **conducteurs** = key/nom. Déjà branché : scanner (dashboard), factures, amendes, véhicules (manuel + import lot carte grise), emprunts. ⚠️ **Tout NOUVEAU point d'ajout DOIT passer par `FP.dupe`** — le site doit rester propre.
  ⚠️ **TOUTE facture — contrôle systématique** (consigne explicite) : toujours **vérifier HT / TVA / TTC** et alerter si `HT + TVA ≠ TTC` (tolérance 2 cts) — ne jamais valider des montants incohérents en silence (cf. contrôle dans `applyFactureFields`, factures.html ; le parseur privilégie déjà le triplet auto-vérifiant `deriveTotals`). Et **rapprocher les noms de conducteurs** (quand la facture en contient : flotte, péages Ulys…) de ceux **déjà enregistrés** (table `conducteurs` / mémoire projet) — **ne JAMAIS inventer un nouveau conducteur** : un nom qui ne correspond à personne = le signaler, c'est l'utilisateur qui ajoute les nouveaux.
  ⚠️ **Codes/certificats de cession** et **contrôles techniques** : NE PAS les mettre dans `factures` — les ajouter dans la **fiche véhicule → section « Documents »** (table `documents`, type `code-cession` ou `controle-technique`, `url` = lien Drive `https://drive.google.com/file/d/<id>/view`). Les autres documents (carte grise, attestation assurance, devis, photos…) sont ignorés.
- ⚠️ **Stockage autonomie/version** : côté DB, l'autonomie est dans la colonne `note_pneus`
  (mapping `note_pneus`↔`autonomie`) et la version dans `type_pneus` (↔`version`). Écrire
  l'autonomie dans `note_pneus`, PAS dans la colonne `autonomie` (ignorée par l'app).
- ⚠️⚠️ **STATIONNEMENT GRATUIT PARIS — RÈGLE OFFICIELLE À NE PLUS SE TROMPER** (consigne explicite,
  source = **paris.fr uniquement**, jamais de blog/forum ; cf. `parkingParis()` dans `pages/vehicules.html`) :
  - **Ne JAMAIS conclure sur la seule motorisation** (électrique/hybride/thermique). Toujours croiser
    les critères OFFICIELS de la Ville de Paris et **ne jamais faire d'hypothèse** : si la carte grise
    ne permet pas de trancher, afficher **« À vérifier »** (jamais « Gratuit » ou « Payant » présumé).
  - **Gratuité de surface = véhicules basse émission (VBE) LÉGERS** répondant à TOUS ces critères :
    (1) **catégorie** M1, N1, L4, L6 ou L7 (Code de la route R.311-1) ;
    (2) **énergie + taux de CO₂** figurant dans le **tableau d'éligibilité VBE** de paris.fr
    (électrique/hydrogène OK ; hybride rechargeable sous seuil CO₂) ;
    (3) **masse en service = champ G de la carte grise ≤ 2 000 kg** (PAS le PTAC, PAS G.1) ;
    (4) **PTAC < 3 500 kg**. Au-dessus de 2 t (champ G) → « lourd » = **payant** (ex. BYD Seal U DM-i ≈ 2102 kg → PAYANT).
  - **Immatriculé en FRANCE** : gratuité **automatique via le SIV depuis le 01/10/2024** (aucune démarche).
  - **⚠️ Immatriculé à l'ÉTRANGER (hors SIV)** : gratuité **NON automatique** → **démarche OBLIGATOIRE par
    courrier** à la Ville (certificat d'immat. étranger + COC traduit) ; 2 droits gratuits valables 5 ans.
    Donc un VBE étranger éligible = afficher **« Gratuit sous réserve de démarche »**, JAMAIS « Gratuit » sec.
  - Niveau de confiance à garder en tête : Très élevée / Élevée / Moyenne — et dire ce qui manque si doute.
  - Sources : https://www.paris.fr/pages/les-autres-offres-de-stationnement-2355 (+ service-public.fr si besoin).
- ⚠️⚠️ **AMENDES / AVIS ANTAI — LES 3 MONTANTS, NE JAMAIS PRENDRE LE MAJORÉ PAR DÉFAUT** (consigne
  explicite, régression récurrente) : un avis a **3 montants** — **minoré** (paiement rapide, le +
  petit, ex 45), **forfaitaire** (ex 68), **majoré** (le + gros, ex 180). Le scan (prompt
  `FP.SCAN_PROMPT`, app.js) doit les extraire **séparément** (`montantMinore`, `montantForfaitaire`,
  `montantMajore`) + les **dates limites** (`dateLimiteMinore`, `dateLimiteForfaitaire`), et mettre
  dans `montantTTC` **le minoré (sinon le forfaitaire)** — **JAMAIS le majoré**. Le majoré ne
  s'applique que si la date limite est **dépassée**, et c'est l'**app** (qui connaît la date du jour)
  qui le détermine, pas l'IA. En cas de doute : prendre le **plus petit**, jamais le plus gros.
  Ne jamais confondre le montant avec un n° d'avis / télépaiement / téléphone / année / code postal.
  - ⚠️ **PIÈGE `Math.max` — NE JAMAIS prendre le montant via `Math.max(...)` de tous les nombres**
    (bug réel : un avis normal affichait **1875 €** — une référence parasite ramassée par le max).
    Le montant vient des **3 montants officiels lus par l'IA**, jamais du plus grand nombre trouvé
    sur la page. Le repli OCR prend le **plus petit** des montants de la grille (`Math.min`), pas le max.
  - ⚠️ **PIÈGE « faux avis de majoration »** : NE PAS détecter une majoration sur la mention
    « amende forfaitaire majorée » — elle figure dans la **grille des 3 tarifs de TOUT avis normal**.
    Un **vrai** avis de majoration a un **titre dédié** (« AVIS DE MAJORATION ») : ne matcher que
    `/avis de majoration/i` (cf. `parseAvis`, `pages/amendes.html`). Sinon chaque avis ré-importé est
    pris à tort pour une majoration et le montant devient aberrant.
  - ⚠️ **Ré-import d'un avis déjà enregistré** = **doublon** (bandeau normal via `FP.dupe`/`checkDoublonLive`),
    PAS une majoration. Le champ Montant doit alors afficher le **minoré**, pas un montant inventé.
- ⚠️ **Factures Ulys (péages VINCI) — MÉTHODE DE LECTURE À CONSERVER** (validée par l'utilisateur) :
  ces PDF ont une couche texte, mais la lecture standard (fragments collés par espaces) **mélange
  les colonnes** → montants aberrants et mauvais prénoms. Il faut **reconstruire les lignes en
  triant les fragments pdf.js par POSITION** (y décroissant puis x croissant) — cf.
  `ulysPdfToText()` dans `pages/factures.html`. Ensuite :
  - **Montants facture** : TTC = le montant imprimé avec « € » après `NET A PAYER TTC` ; TVA = 20 %
    d'une base HT présente dans le récap 1re page (couple base/TVA, base max, base+TVA ≤ TTC) ;
    HT = TTC − TVA. (NE PAS sommer tous les nombres après `NET A PAYER` → HT/TVA aberrants.)
  - **Détail par collaborateur** : ancrer sur le **N° DE BADGE** (jamais sur l'ordre des prénoms,
    colonnes inversées). Lire `Badge n° <id> <Nom>` (prénom) et
    `Total Badge <id> <n> consommation(s) <ttc> € TTC <km> km` (trajets + TTC + km), puis relier
    par le n° de badge. Le `Total Contrat` (grand total) est ignoré. Table `ulys_conso`.
- ⚠️⚠️⚠️ **LECTURE DE DOCUMENTS — LIRE, JAMAIS DEVINER** (consigne explicite, permanente, prioritaire sur
  TOUT scan/OCR/IA de la plateforme) : l'IA/le scanner ne doit **JAMAIS « deviner »** un montant/une valeur
  — il doit **LIRE ce qui est réellement écrit** dans le fichier, en **s'ancrant sur les TERMES TECHNIQUES /
  libellés du document** (jamais sur une position au hasard, jamais sur le plus grand nombre). On a **déjà
  tous les termes** pour retrouver la bonne valeur — il faut les utiliser. Règles :
  - **1) Couche texte d'abord.** Si le PDF a une **couche texte** (états de parc, factures, offres LLD,
    relevés Total/Ulys…), lire **déterministiquement par POSITION** (tri y décroissant puis x croissant, cf.
    `ulysPdfToText`, `etatParcPdfText`, `localeasePdfToText`) et **s'ancrer sur les libellés** (« Prime
    annuelle HT / T.T.C », « NET A PAYER TTC », « Badge n° », « Loyer », « Franchise »…). L'IA ne sert que
    de **repli** pour un **vrai scan/photo** (pas de couche texte) et pour des champs annexes (marque, VIN…),
    et **ne doit JAMAIS écraser** un montant lu dans la couche texte.
  - **2) S'ancrer sur le LIBELLÉ, pas sur le hasard.** Le bon montant est celui à côté du **bon libellé** ;
    tout autre nombre du document (franchise, code type VL3, année, n° de police/avis, valeur assurée,
    téléphone, km, code postal, séparateur de milliers…) doit être **exclu par son libellé/format**, pas
    ramassé au petit bonheur. **JAMAIS `Math.max`/`Math.min` aveugle sur tous les nombres** (bugs vécus :
    avis à 1875 €, franchise 1500 prise pour une prime). Contrôles de cohérence obligatoires (HT ≤ TTC,
    `HT+TVA≈TTC`, ratio de taxe plausible, montant dans une fourchette réaliste).
  - **3) Ne JAMAIS inventer.** Un nombre absent = `null` (jamais 0 inventé, jamais une valeur « probable ») ;
    un nom qui ne correspond à personne = **le signaler**, ne pas créer. Ne recopier QUE ce qui est écrit.
  - **4) Vérifier sur un VRAI fichier** avant de livrer une lecture (extraire le texte réel, prouver que
    chaque valeur lue est exacte) — comme validé pour l'état de parc (53 véhicules, HT/TTC exacts, franchise
    ignorée) et Ulys/Total. Réflexe : *« est-ce que je LIS la valeur, ou est-ce que je la DEVINE ? »* → si
    deviner, revoir l'ancrage sur le libellé.
- ⚠️⚠️ **NOUVEAU PRESTATAIRE (carte carburant / badge péage) — MÊME STANDARD DE LECTURE OBLIGATOIRE**
  (consigne explicite, permanente) : le framework multi-prestataires (Contrôle → ➕ Prestataire ;
  `FP.prestataires/addPrestataire/condNum` ; sous-onglet + colonne « Cartes & badges » + zone fiche
  conducteur) est **générique**, mais la **lecture détaillée d'un relevé** est **propre à chaque
  fournisseur** (Total et Ulys ont chacun leur parseur). Donc **dès qu'un nouveau prestataire (Shell,
  DKV, AS24, Eurotoll… — y compris pour un NOUVEAU CLIENT/société) fournit de vrais relevés**, il faut
  lui écrire son parseur **avec EXACTEMENT le même niveau de qualité** que Total/Ulys :
  (1) **reconstruire les lignes par POSITION** si les colonnes se mélangent (cf. `ulysPdfToText`) ;
  (2) **montant EXACT par transaction** (jamais un `Math.max`, jamais une somme parasite) + contrôle
  HT/TVA/TTC ; (3) **libellé produit propre** — retirer les préfixes de **station/lieu** (cf. `TX_STATION`
  dans `parseTx`) et catégoriser via **`FP.txCat`** (carburant/repas/lavage/parking/autre) ;
  (4) **alerte diesel/gazole** (flotte essence) via `RE_DIESEL` ; (5) écrire le détail DATÉ dans
  **`total_conso_tx`** (mêmes champs : `dateTx, montantTtc, categorie, produit, carte/badge, conducteur,
  plaque`) pour que **la détection conso-pendant-congé ET les anomalies marchent AUTOMATIQUEMENT** ;
  (6) rattacher au conducteur **par n° de carte/badge** (`FP.condKeyDeConso`), jamais par nom seul ;
  (7) intégrer au bouton **« Reconstruire le détail »** et à l'**import par lot** (mêmes montants qu'un
  scan unitaire). Bref : un nouveau prestataire ne doit JAMAIS être un simple « listing de factures » —
  il doit alimenter tout le pipeline de contrôle comme Total/Ulys.

## Structure du projet

```
fleet-app/
├── index.html              # Page d'accueil (redirige vers dashboard)
├── dashboard.html          # Tableau de bord principal
├── login.html              # Authentification Supabase
├── assets/
│   ├── css/styles.css      # Styles globaux + variables CSS
│   └── js/
│       ├── app.js          # FP helpers (settings, history, column editor, search, logout)
│       ├── data.js         # FP_DATA = { vehicules, amendes, factures } (~263KB)
│       └── supabase-client.js  # Client Supabase + FP.db + FP.auth
└── pages/
    ├── vehicules.html
    ├── amendes.html
    ├── factures.html
    ├── entretiens.html
    ├── contrats.html
    ├── statistiques.html
    ├── conducteurs.html
    ├── sinistres.html
    ├── a-vendre.html
    └── parametres.html
```

## Données

- **52 véhicules** (TJMAX, BPCE leasing, PROJECT X PARIS RETAIL)
- **60 amendes 2026** (les 2025 ont été supprimées sur demande)
- **384 factures**
- Groupes véhicules : Siège, Commerciaux, Gov, International (clé interne `pool`), À vendre, Retail, Dépôt, Non classé

## Supabase

- **URL** : `https://tzjuptlzoywjeigmyfuj.supabase.co`
- **Clé publique** (safe à exposer côté client) : `sb_publishable_KC3TZ1zda-ja-0wkyjHUlg_aKohD6tq`
- ⚠️ **JAMAIS** mettre la clé `sb_secret_...` dans le code client
- Tables : `vehicules`, `amendes`, `factures` (mapping snake_case ↔ camelCase géré dans `FP.db`)
- Auth : email/password, avec checkbox "Se souvenir de moi" (localStorage flag + sessionStorage marker)
- ⚠️ **3 NIVEAUX D'ACCÈS — CEO / ADMIN / GESTIONNAIRE** (consigne explicite) : le rôle + la société
  qui **font autorité** vivent dans la table `profiles` (`is_admin`, `role`, `societe`) — **jamais**
  dans `user_metadata` (falsifiable). `FP.role()` (app.js) renvoie `ceo` (super-admin, toutes sociétés)
  / `admin` (client, sa société : tout + config + comptes) / `gestionnaire` (sa société : ajoute/modifie/
  **supprime** les données, mais **pas** la config société ni les comptes) / `chauffeur` (portail salarié).
  Helpers : `FP.isCEO/isAdmin(=ceo||admin)/isGestionnaire/isSuperAdmin/canManageSociete/canManageUsers/roleLabel`.
  - **Gestion des comptes** = **Paramètres → Compte → « Utilisateurs & accès »** (CEO/Admin only) → appelle
    la fonction serveur **`manage-users`** (`supabase/functions/manage-users/index.ts`) qui garde la clé
    `service_role` **côté serveur** et applique la portée (CEO=tout ; Admin=sa société, pas de CEO).
    Plus besoin de Supabase pour créer/modifier/supprimer/réinitialiser un compte. Doc :
    `supabase/COMPTES-CEO-ADMIN-GESTIONNAIRE.md` ; SQL : `supabase/roles-ceo-admin-gestionnaire.sql`.
  - ⚠️ **RÈGLE** : tout nouveau bouton/écran qui touche à la **config société** doit être gardé par
    `FP.canManageSociete()`, et toute gestion de **comptes** par `FP.canManageUsers()` (+ portée serveur).
  - ⚠️ **`app_settings` — écriture RÉOUVERTE au gestionnaire (2026-08-25, correctif)** : le durcissement
    du 2026-07-30 (`supabase/durcissement-config-gestionnaire.sql`, écriture réservée CEO/Admin via
    `fp_role() <> 'gestionnaire'`) a été **ANNULÉ** car il cassait les opérations normales d'un
    gestionnaire : `app_settings` ne stocke pas QUE la config société, mais aussi des **données de
    travail** (affectations conducteur↔véhicule + km début/fin, immobilisations `vehImmobilise`,
    checklist de restitution, montants payés d'amendes `amendeMontantPaye`, `kmMajDates`, inspections…).
    Bloquer toute écriture bloquait ces opérations → erreur « new row violates row-level security policy
    for table app_settings » en prod. **État actuel** : policy permissive `tenant_app_settings` par
    société (gestionnaire inclus) — cf. `supabase/gestionnaire-app-settings-fix.sql`. La **config
    société reste réservée à l'admin AU NIVEAU DE L'INTERFACE** (`FP.canManageSociete()` masque les
    écrans + les boutons « Enregistrer » de config pour un gestionnaire — cf. `gateParamForGestionnaire`
    dans `pages/parametres.html`), même modèle de droits que le reste de la plateforme. ⚠️ **Ne PAS
    ré-appliquer le durcissement `app_settings` tel quel** : pour reprotéger la config côté base sans
    casser les opérations, il faudrait d'abord SÉPARER config et données de travail dans des lignes
    `app_settings` distinctes (refactor de `FP.settings`) — à faire seulement sur demande explicite.
  - ⚠️ **ESPACE SALARIÉ (chauffeur) — SÉCURITÉ SERVEUR À CONSTRUIRE AVANT ACTIVATION** (audit sécu, finding
    ÉLEVÉ) : aujourd'hui le rôle `chauffeur` et sa/ses plaque(s) vivent dans `user_metadata` (**falsifiable**)
    et les policies RLS isolent seulement par **société** → un compte chauffeur aurait accès (lecture ET
    écriture) à TOUTES les données de sa société (dont PII : permis, adresses). **DORMANT tant qu'aucun compte
    chauffeur n'existe.** Avant d'activer l'espace salarié : (1) stocker `role='chauffeur'` + plaques dans
    `profiles` (source de confiance, écrite par `manage-users` seulement) + étendre `fp_role()` ; (2) policies
    RLS **lecture seule scopées à la/les plaque(s)** du salarié. **NE PAS créer de compte salarié avant.**

## Conventions importantes

0. ⚠️ **MULTI-SOCIÉTÉS — règle clé** : toute modification du LOGICIEL (UI, boutons, features, mises en page) doit être **GLOBALE** : elle s'applique à **toutes les sociétés déjà créées ET futures**. Le code (HTML/JS/CSS) est partagé par toutes les sociétés (filtrage par `societe` côté données uniquement). Ne JAMAIS coder une fonctionnalité ou un libellé spécifique à une seule société — sinon l'utilisateur se perd entre les sociétés. (Les *données* — véhicules/amendes — restent, elles, propres à chaque société.)
   - ⚠️ **Adresses d'envoi des mails par société** : l'expéditeur + copies des e-mails d'amende (`EXPEDITEUR` / `COPIE_MAIL` dans `pages/amendes.html`) sont aujourd'hui ceux de **PXP** (`shakil.nubee@projectxparis.fr` + `mallaury.herembert@projectxparis.fr`) — **NE PAS les changer** (ils appartiennent à PXP). Chaque structure a ses propres adresses : **à la création d'une nouvelle société, DEMANDER à l'utilisateur les adresses d'expédition/copie** et les stocker par société (ne pas réutiliser celles de PXP). Contact public (brochure) = **Shakil Nubee · jis.nubee@gmail.com** (différent des adresses pro PXP).

0-selfservice. ⚠️ **TOUT SE FAIT DEPUIS LE SITE — JAMAIS DE MANIP SUPABASE / SQL / SERVEUR POUR L'EXPLOITATION** (consigne explicite de l'utilisateur) : la plateforme est conçue pour que **TOUTE la gestion courante** soit **100 % self-service dans l'UI** — comptes & accès, création de sociétés, configuration société (e-mails d'amende, loueurs, assurance, prestataires/garages…), saisie/modification/**suppression** des données. Règles :
   - **Comptes** : Paramètres → Compte → « Utilisateurs & accès » (fonction serveur `manage-users`) crée/modifie/supprime/réinitialise un compte + rôle + société. **NE JAMAIS dire qu'il faut passer par Supabase / SQL / la doc `AJOUTER-UN-CLIENT.md`** pour gérer un compte — c'est faux, tout est dans l'app.
   - ⚠️ **RÈGLE DE COMPORTEMENT (anti-erreur récurrente)** : avant d'affirmer qu'une action « doit se faire à la main / côté serveur / dans Supabase », **VÉRIFIER dans le VRAI code/écran** qu'il n'existe pas déjà un bouton dans l'app — et **partir du principe qu'il en existe un**. Ne JAMAIS sortir une limite ou une manip manuelle **de mémoire ou d'une vieille doc**. Une affirmation **négative** (« l'app ne sait pas faire X ») doit être **prouvée dans le code AVANT de la dire** (c'est le type de phrase où Claude s'est déjà trompé : il avait dit à tort que créer un compte client passait par du SQL, alors que « Utilisateurs & accès » le fait tout seul).
   - **Si une action d'exploitation n'a PAS encore de bouton dans l'app = c'est un MANQUE à combler** (ajouter l'écran, signaler à l'utilisateur), **pas** une manip à déléguer à l'utilisateur. Seules les tâches d'**INFRA one-shot** (déploiement des Edge Functions, policies RLS, durcissement SQL) restent côté backend — ce n'est PAS de l'exploitation quotidienne.

0-audit. ⚠️ **PROACTIVITÉ — SIGNALER LES MANQUES & RECALCULER** (consigne explicite de l'utilisateur, qui n'a pas ce réflexe) : à CHAQUE fois qu'on ajoute une idée/fonctionnalité, Claude DOIT **de lui-même** : (1) signaler les éléments complémentaires « qui vont avec » et qu'il faudrait ajouter en même temps (ex. ajouter une prime d'assurance → penser à l'intégrer au **total annuel des primes** ; ajouter un type de coût → l'intégrer au **TCO** et au **coût annuel de la flotte**) ; (2) **recalculer et dire quels totaux/indicateurs sont impactés** (coût annuel Contrats, TCO Statistiques, TVS, dashboard) et les mettre à jour ; (3) faire un mini-**audit** des trous du même genre ailleurs sur la plateforme. Ne jamais livrer une fonctionnalité « isolée » sans vérifier qu'elle est bien prise en compte partout où elle devrait compter.

0-sync. ⚠️⚠️ **TOUTE MODIF / TOUT RÉGLAGE DOIT ÊTRE SYNCHRONISÉ SUR TOUS LES APPAREILS — JAMAIS localStorage SEUL** (consigne explicite, permanente) : dès qu'on stocke un réglage, un paramètre, un barème, un choix utilisateur, il DOIT persister **côté serveur (Supabase)** pour se retrouver sur **tous les appareils** de l'utilisateur connecté, pas seulement sur le navigateur courant. `localStorage` = **cache d'affichage rapide uniquement**, jamais la source. Modèle de référence : `FP.settings` (app_settings par société) et le **barème** (`assets/js/bareme.js` → app_settings id `bareme`, avec `pull()` au chargement + `push()` à l'enregistrement, événement `pp:bareme-ready` pour re-render). Réflexe par défaut sur TOUTE nouvelle donnée réglable : (1) écrire dans Supabase, (2) lire depuis Supabase au chargement, (3) garder localStorage seulement comme cache. Ne JAMAIS livrer un réglage « par navigateur ».

0-perte. ⚠️⚠️⚠️ **INTÉGRITÉ DES DONNÉES — INTERDICTION ABSOLUE DE PERDRE UNE DONNÉE CLIENT** (consigne explicite, priorité N°1, écrite après des pertes répétées vécues par l'utilisateur — « je n'ai pas le droit à l'erreur, imagine je perds tout pour un client »). Avant CHAQUE modif qui touche une écriture/lecture de données, vérifier les 5 pièges ci-dessous. **Bugs RÉELS déjà vécus (ne JAMAIS refaire) :**
   - **① « DEUX TIROIRS » — l'écriture doit viser la MÊME ligne/clé que la lecture.** Bug vécu : les réglages PXP se **lisent** dans `app_settings` id=`global` (repli historique) mais s'**écrivaient** dans id=`PXP` → chaque sauvegarde (loyers, fichiers, « ✓ Vu », rafale) atterrissait dans une AUTRE ligne → au rechargement tout « repartait ». Correctif = `FP.settings._effectiveId` (posé par supabase-client au chargement = la ligne RÉELLEMENT lue) et `_pushSettings` écrit dans CETTE ligne. **RÈGLE : toute écriture Supabase (app_settings OU table de données) doit cibler EXACTEMENT la même ligne/id/clé que la lecture** (jamais `v.id` d'un côté et `immat` de l'autre ; jamais `_dbId()` en écriture si la lecture est retombée sur un repli).
   - **② TOUTE MAP DE DONNÉES doit être dans `COLLECTION_KEYS`** (`_pushSettings`, app.js). Une map de données (`s.X[condKey]`, `s.X[vehId]`, `s.X[immat]`…) ABSENTE de cette liste est **écrasée EN BLOC** par le cache local d'un poste en retard → perte. Bugs vécus : `condConges` (congés), `loueurs`, `assureurs`. **Audit 2026-09-15** : la liste a été COMPLÉTÉE avec toutes les maps de données qui manquaient (`vehCarteCarb/vehBadge/vehCarteCarbExp/vehBadgeExp/vehFournCarb`, `vehMasse/vehNotes/vehRestit/vehEntree/vehCession/budgets/vehDin`, `budget/objectifs`, `pointsManuel`, `rapprIgnore/tfAnomOk/ignores`, `docExpire/assuranceIgnore/amendesJustifWatch/docTrash/sinistreDossiers`). **RÈGLE : à CHAQUE nouvelle donnée keyée stockée en réglages, l'AJOUTER à `COLLECTION_KEYS`** (les objets de CONFIG qui se remplacent en bloc — profil, societe, groupes, navOrder, `prefs`, `tableConfigs`, `dashHiddenWidgets`… — n'y sont PAS).
   - **③ ÉCHEC D'ÉCRITURE SILENCIEUX = INTERDIT.** Toute écriture passe par `FP.persist` (file + retente) et une erreur DOIT être VISIBLE (pastille `#fp-sync-badge`, `FP.notifyError`). Ne JAMAIS écrire en direct avec un `.catch()` vide qui avale l'erreur. La pastille doit être visible sur mobile (au-dessus de la barre du bas).
   - **⑥ ÉCRITURE « EN VOL » PERDUE À LA NAVIGATION = INTERDIT (file OPTIMISTE).** Bug audité : `FP.persist` n'enfilait la modif QUE dans son `catch` → un Save suivi d'une navigation/fermeture immédiate (fetch avorté, le `catch` ne s'exécute jamais) perdait l'écriture EN SILENCE (le cache local montrait encore la valeur → détectée seulement sur un autre appareil). Correctif : `FP.persist._write` met l'item dans la file locale **AVANT** l'appel réseau (`_enqueue` → `_uid`) et le retire à la réussite (`_removeUid`) ; un `pagehide`/`visibilitychange==hidden` déclenche un dernier `flush()`. La pastille utilise `stuckCount()` (échec / >8 s) et non `pendingCount()` → pas de clignotement à chaque save. **Idem `FP.settings._pushSettings`** (CAS fire-and-forget) : dépose un repli `_settleUid` en file AVANT le SELECT/UPDATE, retiré (`_dropSettle`) dès que le CAS aboutit → un réglage saisi puis quitté ne « revient » plus à l'ancienne valeur. **RÈGLE : toute nouvelle écriture réseau doit être durable AVANT le `await`, jamais seulement dans le `catch`.**
   - **④ NE JAMAIS RÉÉCRIRE UN CACHE PÉRIMÉ PAR-DESSUS LE SERVEUR.** La fusion « delta » (`applyDelta`/`_serverSnap`) ne pousse QUE les clés RÉELLEMENT changées par CE poste ; une clé absente du cache est PRÉSERVÉE (jamais supprimée). Ne pas casser ça.
   - **⑤ MIGRATIONS AU CHARGEMENT = DANGER.** Une migration qui tourne à chaque load (ex. `normaliserLoueursPXP`) doit : (a) tourner APRÈS que les vraies données serveur sont chargées, (b) avoir un drapeau « fait » qui PERSISTE, (c) ne JAMAIS réduire/reset une liste utilisateur.
   - **RÉFLEXE OBLIGATOIRE avant de livrer une écriture** : « si l'utilisateur saisit ça, se déconnecte/recharge sur un autre appareil, le RETROUVE-t-il EXACTEMENT ? ». Si tu n'es pas certain → ne pas livrer, vérifier. **Sauvegardes** : recommander/maintenir un filet (export de secours in-app + sauvegardes Supabase). Voir aussi `0-sync`.

0-source. ⚠️ **UNE SEULE SOURCE DE VÉRITÉ — NE JAMAIS RE-LIRE/RECALCULER UN CONCEPT AUTREMENT QUE LE HELPER CANONIQUE** (classe de bug récurrente) : un même concept (statut « vendu », montant dû d'une amende, forfait/dépassement leasing, normalisation de plaque, de prénom, filtre société, échéance CT/assurance) DOIT être lu/calculé **partout** via le **même helper `FP.*`** — jamais réimplémenté à la main dans une page. Bugs réels vécus : la checklist réclamait le **forfait leasing** via `base[v.immat]` (clé brute) alors que la fiche le trouvait via **`FP.leasingContrat`** (plaque MAJ + overrides) → faux « à compléter » ; un endroit testait `statut !== 'vendu'` (sensible à la casse) au lieu de **`FP.estVendu`** ; des podiums sommaient `a.montant` au lieu du **montant dû** (majoré). **RÈGLE** : avant d'afficher/tester une donnée, chercher s'il existe déjà un helper (`FP.estVendu`, `FP.leasingContrat/leasingInfo`, `FP.loueurOf` (nom du loueur d'un véhicule, multi-loueurs), `FP.normPrenom`, `FP.tvsDetail`, `FP.assuranceLabel`, `FP.montantDu`, `FP.estAPayer` (statut amende « à payer » tolérant accents/espaces/casse), `FP.coutMois`/`FP.dedupeFactures` (coût du mois = factures dédoublonnées par n° + filtre exploit), `FP.coutFactureExploit`, `FP.joursRestants` (décompte en jours calendaires, minuit à minuit)…) et l'utiliser ; si un écran AFFICHE une valeur, tout autre écran/checklist qui la TESTE doit lire la **même source**. Toute checklist « À compléter » (`notifications.html`) doit tester la donnée via la source qui l'affiche réellement.

0-source-2. ⚠️⚠️ **RÈGLE PERMANENTE — COHÉRENCE GLOBALE & SOURCE UNIQUE (avant CHAQUE modif)** (consigne explicite de l'utilisateur, prioritaire — écrite après des régressions à répétition sur le QR qui existait en 3 versions) : quand l'utilisateur demande de modifier une fonctionnalité, **NE JAMAIS regarder UNIQUEMENT** l'écran / le bouton / le fichier cité. Comprendre la **logique métier** derrière la demande, puis **chercher dans TOUT le projet** tous les endroits qui **affichent / aperçoivent / impriment / téléchargent / exportent (PDF, PNG, CSV) / génèrent un document / calculent / transforment** la même information ou la même fonctionnalité — y compris **mobile ET desktop**, modales, fiches détail, formulaires, tableaux, **e-mails**, **portail conducteur** (v.html/km.html + edge functions), et données Supabase.
   - **Chercher par COMPORTEMENT, pas par mot exact** : pour « QR » → aussi `qrcode`, `buildQrCanvas`, `renderQrCard`, `printQr`, `downloadQr`, `toDataURL`, `canvas`… Raisonner par **fonctionnalité + dépendances**, jamais par simple `grep` du mot tapé.
   - **Objectif : une information = UNE seule source de vérité.** Le QR affiché / PNG / imprimé vient du **même générateur** (`renderQrCard`) → on modifie **une fois**, les 3 suivent. Idem toute règle métier via un helper `FP.*` unique : plaque (`FP.normImmat`), prénom (`FP.normPrenom`), km réel (`FP.kmActuel`), vendu (`FP.estVendu`), montant dû (`FP.montantDu`), coût année (`FP.coutExploitAnnee`), couleur/statut, formatage montant (`FP.euro`)… **une règle ≠ redéfinie dans plusieurs pages.**
   - **Si tu trouves de la duplication** (2 générateurs de QR, 3 calculs de la même couleur, plusieurs formats du même montant, un export qui recalcule autrement que l'écran…) : le **SIGNALER** et, si c'est **sans risque**, **centraliser** dans un helper/générateur commun. **PAS de gros refactor risqué** sans prévenir : préserver fonctionnalités, automatisations, flux de données ; ne pas toucher la structure Supabase sans accord ; **changements progressifs et sûrs**. Si la centralisation est lourde/risquée, **expliquer d'abord**.
   - **Une modif n'est FINIE qu'après** avoir vérifié : toutes les occurrences/chemins concernés, les composants réutilisés, la **syntaxe** (scripts inline — `node --check` / `new Function`), le **déploiement**, et l'**absence d'une ancienne version** encore présente ailleurs. Se poser SYSTÉMATIQUEMENT : *« existe-t-il un AUTRE endroit qui utilise cette même info/règle et devrait refléter ce changement ? »* — si oui, le faire **avant** de dire que c'est terminé.
   - **Cible d'architecture (progressive)** : converger vers des générateurs/composants uniques (`renderQrCard` pour le QR ; helpers `FP.*` pour couleurs/statuts/montants/km/TCO/exports) → à terme l'utilisateur **configure dans l'app** sans revenir dire « tu as oublié l'impression / le téléchargement / le mobile / la couleur est différente ici ».

0-conducteurs. ⚠️⚠️ **CLÉ CONDUCTEUR & RÉSOLUTION PRÉNOM ↔ FICHE — RÈGLE PERMANENTE** (consigne explicite, écrite après un bug réel : les péages « Charles » n'étaient jamais reliés au congé de la fiche « Charles LENNON ») : une **clé de conducteur** (`c.key`, et toutes les données keyées par elle : `condConges`, `condSortie`, `condCarteTotal`, `condBadgeUlys`, `condDocs`, `permisMasque`…) n'a **AUCUN format garanti** — ça peut être un **prénom simple** (`charles`), un **prénom-nom** (`charles-lennon`), une forme **sans séparateur** (`charleslennon`) ou un **id**. RÈGLES :
   - ❗ **NE JAMAIS déduire le prénom d'une clé en la découpant** (`key.split(/[-\s]/)[0]`, `key.split('-')[0]`…). Toujours utiliser le helper **canonique `FP.prenomDeCle(key)`** (résout clé → nom de fiche via `FP.conducteurNomUnifie` → prénom via `FP.normPrenom`).
   - Pour rapprocher une conso/un relevé (qui ne porte souvent qu'un **prénom**) d'un congé/d'une donnée keyée : passer par **`FP.congeKeysPourPrenom(np)`** (repli prénom robuste) et/ou **`FP.condKeyDeConso(t)`** (résolution par carte/badge), **jamais** une comparaison maison au 1er segment de la clé. La détection conso-pendant-congé est **centralisée** dans `FP.consoPendantConge` (utilisée par Suivi & alertes ET Contrôle) — ne pas la redupliquer.
   - **Nom → clé** : toujours `FP.condKeyParNom` / `FP.condGroupKey` (jamais un `normPrenom(nom)` refait à la main pour keyer une donnée). **Clé → nom** : `FP.conducteurNomUnifie(name, key)`.
   - **Renommage** (`applyRename`, `pages/conducteurs.html`) : DOIT appeler **`FP.migrateCondKey(ancienneClé, nouvelleClé)`** pour déplacer toutes les données keyées (congés, cartes, badges, docs, sortie) → sinon elles deviennent **orphelines**. Toute suppression/fusion de conducteur passe aussi par `migrateCondKey`/`purgeCondKey`. Ne jamais changer une clé sans migrer son « chemin ».

0-plaques. ⚠️⚠️ **PLAQUE = TOUJOURS COMPARER VIA `FP.normImmat` (min/maj, tirets, espaces = PAREIL)** (consigne explicite, répétée par l'utilisateur) : une plaque peut être écrite **de n'importe quelle façon** — `hl724cd`, `HL-724-CD`, `HL 724 CD`, `Hl724Cd` — et le site DOIT **toujours relier** au bon véhicule. `FP.normImmat(p)` = **source unique** (majuscule + retire tout sauf A-Z0-9). ⚠️ Les plaques STOCKÉES sont en **formats mixtes** (fiches véhicule avec tirets « HL-724-CD » ; factures/imports récents normalisés « HL724CD »), donc **JAMAIS** comparer/joindre/indexer/rechercher une plaque **en brut** (`.toUpperCase()`, `===`, `.includes()`, `map[x.immat]`, `.find(v=>v.immat===...)`). RÈGLES :
   - **Comparer 2 plaques** → **`FP.immatEq(a,b)`**. **Trouver le véhicule d'une plaque** → **`FP.vehByImmat(immat)`** (jamais un `.find` brut). **Indexer/grouper par plaque** → keyer par **`FP.normImmat(...)`** des DEUX côtés (écriture ET lecture). **Map de référence keyée par plaque** (CG_DATA, MASSE_CG…) → lecture via **`FP._mapGetImmat(map, immat)`** (tolérante).
   - **EXCEPTION — clés de RÉGLAGES persistés** keyées par `v.immat` (`settings.kmMajDates`, `antiPollDates`, `assurancePrimes`, `leasingDocs`, `assureurVeh`…) : **NE PAS changer la clé** (ça orphelinerait les données). Les **lire** de façon tolérante (boucle `FP.normImmat(key)===k`) sans réécrire les clés.
   - **Page publique `carte.html`** (pas d'app.js) : normaliser en local avec `.replace(/[^A-Z0-9]/g,'')`.
   - Réflexe : au moindre code qui touche une plaque, se demander « est-ce que ça marche si je l'écris avec/sans tiret, en minuscule ? » → si non, passer par `FP.normImmat`/`immatEq`/`vehByImmat`.

0bis. ⚠️ **Notifications / alertes** : dès qu'une alerte regroupe **plusieurs éléments**, la fondre en **UNE seule alerte** avec une **liste dépliable** (chaque élément cliquable vers sa fiche) — jamais N cartes séparées, jamais une simple redirection vers une page générique. (Champ `vehicules`/`items` sur l'alerte ; rendu dans `notifications.html` : **3 lignes visibles + bouton « Voir tout (N) »** qui déroule le reste sur place — PAS de `<details>` natif, il rend moche.)
   - ⚠️ **RÈGLE GÉNÉRALE « déplier/replier »** (consigne explicite) : **tout** contrôle qui déroule du contenu (« Voir tout », « Voir plus », « Détails »…) DOIT être un **vrai toggle** qui se **replie** aussi (« Voir moins »). Ne JAMAIS livrer un « Voir tout » à sens unique. Réflexe par défaut sur toute la plateforme.

0bis-2. ⚠️ **Checklist « À compléter » — À MAINTENIR** (consigne explicite) : la page Alertes (`notifications.html`) a un onglet **« 📝 À compléter »** qui liste **TOUTES les infos manquantes** de la plateforme (véhicules, conducteurs, amendes, factures, configuration société), chaque ligne cliquable vers sa fiche. **RÈGLE** : chaque fois qu'on ajoute un **nouveau champ à remplir** ou une **nouvelle entité/fonctionnalité** avec des données à saisir, il FAUT l'ajouter à cette checklist (listes `VEH_FIELDS` / `COND_FIELDS` / `AMENDE_FIELDS` / bloc `cfg` de `renderComplet`, ou une nouvelle section). Le but : l'utilisateur voit toujours, à un seul endroit, tout ce qu'il lui reste à renseigner.

0bis-3. ⚠️⚠️ **MANUEL — TOUJOURS LE METTRE À JOUR** (consigne explicite, répétée par l'utilisateur) : **CHAQUE** nouvelle fonctionnalité, nouveau bouton, nouveau champ, ou changement d'UX DOIT être documenté dans **`pages/manuel.html`** (le manuel utilisateur, sections `<details>` par onglet : `s-dashboard`, `s-alertes`, `s-stats`, `s-vehicules`, `s-amendes`, `s-sinistres`, `s-factures`, `s-contrats`, `s-budget`, `s-conducteurs`, `s-divers`, `s-params`, `s-calculs`) — **dans le MÊME lot de modifs** que la feature, jamais « plus tard ». But explicite : **un client doit pouvoir utiliser et COMPRENDRE l'appli tout seul, SANS l'aide de l'utilisateur**. Ajouter un `.man-item` (ou une `.man-zone`) clair, en langage simple (l'utilisateur n'est pas dev). Si un calcul/chiffre change, mettre aussi à jour le **glossaire** (`s-calculs`). Ne JAMAIS livrer une feature sans sa doc manuel. (Le `guide.html` = plus commercial/rapide ; le vrai mode d'emploi détaillé = `manuel.html`.)

0ter. ⚠️ **PERF / « flash » des chiffres & latence — LEÇONS (ne pas refaire les erreurs)** :
  - **Cause du flash des chiffres** : chaque page peint d'abord `data.js` (instantané hors-ligne) puis se rafraîchit avec Supabase (`fp:data-ready`). Si `data.js` est **périmé**, on voit l'ancien chiffre → le nouveau.
  - ✅ **Bonne solution = garder `data.js` À JOUR** (le régénérer depuis Supabase quand les données changent beaucoup). C'est un instantané camelCase de `{vehicules, amendes, factures, conducteurs}` (mapping snake→camel identique à `FP.db`, cf. `SNAKE_TO_CAMEL_OVERRIDES`). La table **`conducteurs` DOIT y figurer** sinon le compteur conducteurs fait « 43 → 46 » (calcul en 2 temps : véhicules d'abord, puis requête live de la table conducteurs).
  - 🔒 **RGPD — `data.js` NE DOIT JAMAIS contenir de données personnelles** (le repo est **PUBLIC**) : à chaque régénération, **STRIPPER intégralement** l'identité des personnes. Concrètement (nettoyage validé) : de `conducteurs` → vider `name`, `nom`, `prenom`, `poste`, `note` et **anonymiser `key`** (`c1`,`c2`…), et **supprimer** `email`, `adresse`, `dateNaissance`, `tel`, `permisNumero`, `permisType`, `permisObtention`, `permisExpiration`, `permisUrl`, `permisFileId` (n° de permis + lien vers le scan = PII sensible) ; de `vehicules` → vider `chauffeur` et supprimer `vin` ; de `amendes` → vider `prenom` ; de `factures` → vider tout champ de nom. On ne garde que `masque`/`manuel`/`societe` côté conducteur. Ces données ne vivent QUE dans Supabase (chargées après login, protégées par RLS). `data.js` = instantané d'affichage hors-ligne (immat, marque, km, montants…), **pas un annuaire**. Vérif avant commit (doit renvoyer **0**) : `grep -oE '"(email|adresse|dateNaissance|tel|nom|prenom|name|poste|permisNumero|permisUrl|permisFileId|chauffeur|vin)":"[^"]+"' assets/js/data.js | grep -vE '":""' | wc -l`. (Script de nettoyage type : cf. historique — itère les 4 tableaux et vide/supprime ces champs.)
  - ❌ **NE PAS masquer le contenu** (opacity:0 jusqu'à `fp:data-ready`) : ça donne une **latence « page qui s'affiche puis se remet »** sur tous les onglets. On a retiré cet « antiFlashCache ». Le 1er affichage doit être direct.
  - ✅ **Cache local = TOUT (véhicules + amendes + factures), à jour à chaque `loadAll`** (`localStorage`, clé **versionnée ET par société** `fp_data_cache_v3_<societe>`, relue par `seedFromCache` AVANT le rendu). Comme `data.js` devient périmé dès qu'on ajoute des données, c'est le **cache** (rafraîchi à chaque visite) qui garantit un 1er affichage = live → flash seulement UNE fois après un changement serveur, puis stable. (On avait tenté un cache « léger » sans factures → les chiffres factures re-clignotaient ; ne PAS refaire ça. La lecture ~10 ms est négligeable ; la vraie lenteur d'avant venait de l'antiFlash, pas du cache.)
  - ⚠️ **Isolation multi-sociétés** : clés de cache **suffixées par la société** (`fp_data_cache_v3_<soc>`, `fp_cond_cache_<soc>`, `fp_emprunts_<soc>`) ; l'IIFE `filterStaticCacheBySociete` filtre `data.js` (vehicules+amendes+factures+**conducteurs**) ; `seedCondCacheFromLS` et la migration localStorage→Supabase ne s'exécutent QUE pour PXP (sinon une nouvelle société hérite des données PXP).
  - ✅ **Navigation fluide** (façon SPA, sans réécriture) : `@view-transition { navigation: auto; }` dans `styles.css` (+ `view-transition-name: fp-sidebar` pour garder la sidebar fixe) et **Speculation Rules** (prefetch des liens sidebar au survol) injectées par `app.js`. Le re-rendu sur `fp:data-ready` n'a lieu QUE si les données ont changé (signature légère dans `supabase-client.js`).
  - Si on change `data.js`/`app.js`, prévenir l'utilisateur qu'**un seul Ctrl+Maj+R** suffit puis navigation normale (sinon le re-téléchargement à chaque hard-refresh paraît lent).
  - ⚠️ **CACHE-BUSTING OBLIGATOIRE** : les pages chargent `app.js` / `supabase-client.js` / `data.js` avec un suffixe de version `?v=AAAAMMJJx` (ex. `?v=20260610a`). GitHub Pages met le JS en cache ~10 min → sans ce suffixe, après un déploiement le navigateur garde l'**ancien** JS, et surtout en **navigant d'un onglet à l'autre** chaque page recharge le JS périmé (un hard-refresh sur UNE page ne suffit pas). **À CHAQUE modif de `app.js`/`supabase-client.js`/`data.js`, BUMPER le `?v=` partout** (sed sur tous les `.html`). C'était la vraie cause du « flash qui revient malgré le fix ».
  - ⚠️⚠️ **CACHE D'UN RÉSULTAT CALCULÉ = DOIT PORTER LA VERSION DE LOGIQUE** (consigne explicite, permanente — cause du bug « Ahmed après départ » qui restait figé) : dès qu'on **met en cache une valeur CALCULÉE** (trouvailles Contrôle, anomalies, agrégats mémorisés, toute liste dérivée gated par une « signature ») et pas seulement des **données brutes**, la clé/signature du cache **DOIT inclure `FP.ASSET_VERSION`** (app.js expose sa propre version `?v=`, lue automatiquement). Sinon un **correctif de LOGIQUE** (les données n'ayant pas bougé) est **masqué** par l'ancien résultat en cache — l'utilisateur « voit toujours les mêmes erreurs » après un fix. Comme on **bump le `?v=` à chaque modif d'app.js**, inclure `FP.ASSET_VERSION` invalide le cache **tout seul** au déploiement. Pour la logique **propre à une page** (pas dans app.js, ex. `buildFindings` de `controle.html`), ajouter EN PLUS un petit marqueur local (`DETECT_VERSION`) à bumper à la main. Réflexe : au moindre changement de règle métier, se demander « est-ce qu'un cache mémorise ce calcul ? » → si oui, il doit dépendre de `FP.ASSET_VERSION`. (Modèle de référence : `_buildSig()` dans `controle.html`. Les caches de **données brutes** — `fp_data_cache_v3`, `fp_cond_cache` — gardent, eux, leur propre version de mapping.)
  - ⚠️ **jsPDF PARESSEUX — NE PAS remettre en `<script defer>` sur chaque page** (cause de lenteur à la navigation, corrigé 2026-08-04) : jsPDF + autotable pèsent **~400 Ko** et ne servent QU'au clic sur un bouton « Télécharger PDF ». En `defer`, ils **bloquaient le `DOMContentLoaded`** (donc l'init de la page) à chaque ouverture d'onglet. Désormais chargés **à la demande** : les pages qui exportent posent un marqueur inline `<script>window.FP_PDF=1;</script>` (à la place des anciennes balises jspdf, **AVANT** `app.js`), et **`FP.ensureJsPDF()`** (app.js) les injecte en async (préchargement discret sur `requestIdleCallback` + injection immédiate au 1er clic). Tout point d'export fait `if(!(window.jspdf&&window.jspdf.jsPDF)){ FP.ensureJsPDF().then(<la même fonction>); return; }` (les helpers centraux `FP.fiche`/`openPreview` le font déjà). **Exception : `kit-commercial.html` n'inclut PAS `app.js`** → il garde sa balise `<script src=".../jspdf.umd.min.js">` statique (repli `window.print()`). **Tout NOUVEL export PDF DOIT passer par ce schéma**, jamais rajouter une balise jspdf bloquante.

0quater. ⚠️ **RECHERCHE AU CLAVIER — RÈGLE** (consigne explicite) : **tout** choix de véhicule /
   conducteur / plaque / nom doit être **filtrable en tapant** (jamais un `<select>` déroulant nu
   qu'on doit faire défiler). Helper global **`FP.searchSelect(<select>, {placeholder})`** (app.js) :
   transforme un `<select>` en champ de recherche + liste déroulante (au style du site), en gardant
   la valeur lisible via `.value` et l'événement `change`/`input` (menu en `position:fixed` → non
   rogné par les modales). Déjà branché : tâches (véhicule), factures (di-veh + filtres), entretiens,
   sinistres. ⚠️ **Tout NOUVEAU sélecteur de véhicule/conducteur DOIT passer par `FP.searchSelect`.**
   - ⚠️ **CONDUCTEUR — choisir OU créer** (consigne explicite) : partout où on désigne un conducteur
     (fiche amende, ajout amende, chauffeur véhicule, emprunts : emprunteur/rendu par/personne), on
     DOIT pouvoir le **choisir dans la liste existante OU en créer un nouveau** en tapant son nom (la
     plateforme détecte que c'est nouveau et demande ses infos). Helper global
     **`FP.conducteurPicker(<input>, {onPick})`** (app.js) : combobox conducteurs + option « ➕ Créer »
     → `FP.newConducteurModal` → `FP.conducteurs.create` (persisté, société auto-taggée, anti-doublon
     `FP.conducteurs.find`). **Tout NOUVEAU champ conducteur/emprunteur DOIT passer par `FP.conducteurPicker`.**

0quinquies. ⚠️ **BOUTON « RÉINITIALISER » PAR BARRE DE FILTRES — RÈGLE** (consigne explicite) : toute
   barre de filtres (recherche + puces + selects + dates) DOIT avoir **un bouton « ↺ Réinitialiser »**
   qui remet TOUS les filtres de la page à zéro d'un clic. Helper global **`FP.filterResetButton(bar,
   {onReset, mount, after})`** (app.js) : pose le bouton et, via `onReset` (recommandé), appelle la
   fonction de la page qui remet son `state` + resync les contrôles + re-render (fiable). Sans `onReset`,
   reset générique (vide les champs, selects → `all`, puces « Tous », émet les événements ; compatible
   `FP.searchSelect` qui resync sur `change`). Déjà branché : Sinistres, Factures, Amendes, Entretiens,
   Véhicules, Emprunts. ⚠️ **Toute NOUVELLE barre de filtres DOIT avoir son bouton via `FP.filterResetButton`.**

0sexies. ⚠️ **FILTRE DE PÉRIODE PARTOUT — RÈGLE** (consigne explicite) : dès qu'un écran affiche des
   **données datées** (conso, coûts, factures, bilans) OU propose un **export / rapport / relevé PDF**,
   il DOIT toujours offrir **DEUX moyens de choisir la période** : (1) un **filtre rapide par MOIS**
   (menu déroulant, pour aller vite) **ET** (2) un **intervalle de DATES « Du → Au »** (choix précis).
   Et surtout : **l'export / le rapport / le PDF exporte la PÉRIODE CHOISIE**, pas tout l'historique —
   la vue à l'écran et l'export lisent la **même source de période** (un seul helper `…Period()/…Src()`
   qui renvoie `{ src, label }`, réutilisé par le tableau, l'analyse ET les boutons d'export). Le titre du
   PDF/CSV rappelle la période. Déjà branché : Total Fleet & Ulys (mois + dates, exports suivent la période).
   ⚠️ **Tout NOUVEau tableau daté / export / bilan DOIT suivre ce schéma** (jamais un export « tout » figé).

0septies. ⚠️ **PRÉVENIR UN CONDUCTEUR = 3 CANAUX TOUJOURS (SMS + WhatsApp + E-MAIL)** (consigne
   explicite, permanente) : partout où on « prévient / relance / envoie un message » à un conducteur
   (accès véhicule, carte grise, relevé km, CT, révision, amende, annonce…), il faut TOUJOURS proposer
   les **3 canaux : SMS, WhatsApp ET E-mail** — jamais seulement SMS/WhatsApp. Source unique =
   **`FP.msg.open({phone, email, emailSubject, emailNomSoc, emailLogo, emailHtml, text, templates})`**
   (app.js) : le bouton **📧 Email** s'affiche dès qu'on lui passe `email` (e-mail brandé via `FP.mailBrand`,
   liens rendus cliquables). ⚠️ **Tout NOUVEAU point d'envoi DOIT passer `email` (+ marque société) à
   `FP.msg.open`** — même pour les nouvelles fonctionnalités. Et **prévoir un ENVOI GROUPÉ** (à tous les
   conducteurs du périmètre) quand ça a du sens (modèle : bouton « Envoyer l'accès à tous » sur Véhicules,
   via `FP.buildMail` + `FP.sendEmail`, avec barre de progression + résumé envoyés/sans-e-mail/échecs — cf.
   règle anti-perte silencieuse : jamais un « ✓ » menteur).

1. **Tailwind précompilé** — pour éviter le délai du CDN à chaque page, Tailwind est compilé en local dans `assets/css/tailwind.css` (les pages le chargent via `<link>`, plus de `cdn.tailwindcss.com`). ⚠️ Après toute modif de classes Tailwind dans le HTML/JS, REBUILD : `npx tailwindcss@3.4.17 -c tailwind.config.js -i assets/css/_tw-input.css -o assets/css/tailwind.css --minify` (sinon les nouvelles classes ne seront pas stylées). ⚠️ **`brochure.html` et `prix.html` utilisent désormais le Tailwind LOCAL** (ajoutés à `content` dans `tailwind.config.js`) → à inclure dans le REBUILD. Seule `logos.html` reste sur le CDN. Ces deux pages sont en **thème sombre « 21st »** via une classe `.sheet-dark` (styles inline, autonomes) ; dans `prix.html` l'**aide-mémoire interne** (`#sheet-interne`) reste volontairement CLAIR et `display:none` (jamais montré au client). Les PDF client sont dans `presentation/` (`Parc-Pilot-Brochure.pdf`, `Parc-Pilot-Tarifs.pdf`) et les boutons **« Télécharger en PDF »** de `brochure.html`/`prix.html` pointent dessus (`<a download>` = beau design en 1 clic). ⚠️ **À REGÉNÉRER quand le contenu de brochure/prix change** (sinon le PDF téléchargé est périmé), via Chromium headless : `"/opt/pw-browsers/chromium-1194/chrome-linux/chrome" --headless=new --no-sandbox --virtual-time-budget=12000 --no-pdf-header-footer --print-to-pdf-no-header --print-to-pdf="presentation/Parc-Pilot-Brochure.pdf" "file://$PWD/brochure.html"` (idem prix.html → Parc-Pilot-Tarifs.pdf). Le mode impression masque les boutons flottants et l'aide-mémoire interne.
1bis. ⚠️ **JS MINIFIÉ — `app.js` & `fleet-views.js`** (perf chargement mobile) : les pages chargent
   **`assets/js/app.min.js`** et **`assets/js/fleet-views.min.js`** (versions minifiées, ~2× plus légères
   à parser). ⚠️ On édite **TOUJOURS les sources** `app.js` / `fleet-views.js` — JAMAIS les `.min.js`.
   Après **toute** modif de ces sources, REGÉNÉRER : **`node scripts/build-min.mjs`** (utilise `npx terser`,
   comme le build Tailwind ; ne mangle PAS les propriétés → `FP.*` préservé). Un **garde-fou** dans
   `scripts/check-bugs.mjs` (empreinte `/*src=…*/` en tête de chaque `.min.js`) **FAIT ÉCHOUER le contrôle
   donc le déploiement** si un `.min.js` n'est pas à jour → impossible de déployer un JS minifié périmé.
   Réflexe combiné à chaque modif d'`app.js`/`fleet-views.js` : `build-min` **puis** bump `?v=` partout.
2. **Auth guard** synchrone dans le `<head>` de chaque page protégée (11 pages)
2bis. ⚠️ **ANTI-XSS — RÈGLE (audit sécurité)** : toute donnée **saisie ou lue par OCR/IA**
   (marque, modèle, chauffeur, description, fournisseur, n° facture, immatriculation, prénom…)
   injectée dans un `innerHTML` / template `${}` DOIT être échappée via **`FP.esc()`** (app.js).
   Une charge stockée (`<img onerror=…>`) sinon s'exécute dans le navigateur du CEO (qui voit
   toutes les sociétés) → exfiltration du jeton de session `localStorage`. Les helpers
   `FP.lienVehicule/lienConducteur/escAmende` échappent déjà ; tout NOUVEAU rendu de donnée
   utilisateur passe par `FP.esc`. ⚠️ **JAMAIS stocker de mot de passe** côté client (même
   base64 = réversible) — la persistance = session Supabase (« Se souvenir de moi »).
3. **Personnalisation** : tout est éditable en double-cliquant (titres, sous-titres, colonnes, onglets sidebar)
4. **Drag & drop** : colonnes et lignes réorganisables avec HTML5 Drag API
5. **Undo/Redo** : Ctrl+Z / Ctrl+Y via `FP.history`
6. **Localisation** : tout en français, formats `FP.euro()`, `FP.date()`, `FP.num()`
7. **Pas de sticky columns** (testé puis retiré sur demande utilisateur)
8. ⚠️ **TÉLÉCHARGER EN 1 CLIC — RÈGLE PERMANENTE** (consigne explicite) : partout où il y a un
   « Imprimer » / « PDF », TOUJOURS ajouter EN PLUS un bouton **« Télécharger en PDF »** bien visible
   qui produit un **vrai fichier en un clic** (via **jsPDF**, `assets/js/vendor/jspdf.umd.min.js` — pas
   seulement `window.print()` qui n'ouvre que la boîte d'impression). Repli `window.print()` si jsPDF
   indispo. Ex. de référence : le bouton `#kc-dl` de `kit-commercial.html` (parcourt le DOM et rend en
   texte jsPDF). Ne JAMAIS livrer une page imprimable sans son téléchargement direct.

## ⚖️ RÈGLES PERMANENTES DE DÉVELOPPEMENT (consigne explicite — s'appliquent à CHAQUE demande)

But : Parc Pilot doit devenir **autonome, fiable, cohérent, maintenable, administrable depuis l'app** (à terme, plus besoin de dev pour les réglages courants). Ces 42 règles sont **permanentes** et priment.

1. **NE RIEN CASSER (priorité absolue)** : jamais supprimer une feature / modifier une logique métier non demandée / casser une automatisation / changer un comportement en silence / supprimer une donnée / toucher Supabase (tables, colonnes, RLS, policies, auth, permissions, migrations, triggers) — **sans accord explicite**. Ne JAMAIS résoudre un bug en supprimant la feature ou en la simplifiant en douce.
2. **DANS LE DOUTE, DEMANDER AVANT** (intention, règle métier, impact, suppression, migration, action irréversible, 2 solutions aux conséquences différentes). Expliquer : (1) ce que j'ai découvert, (2) le doute, (3) les conséquences, (4) ma reco → puis demander. Pas de question pour un détail technique évident/sans conséquence métier.
3. **ANALYSER AVANT DE MODIFIER** : lire le code, comprendre l'existant, chercher dépendances + occurrences similaires, repérer impacts/risques, vérifier s'il existe déjà une source/helper, puis choisir la modif la + simple et sûre. Jamais coder sans comprendre.
4. **SOURCE UNIQUE DE VÉRITÉ** : une info/règle/calcul = défini UNE fois (helper/constante/config/composant) — couleurs, statuts, km, QR, TCO, conso, catégories, échéances, seuils, alertes, permissions, formatage…
5. **PROPAGATION GLOBALE** : ne jamais modifier QUE l'endroit cité — chercher partout où c'est affiché/calculé/imprimé/téléchargé/exporté/importé/envoyé/mobile/desktop/modale/tableau/fiche/dashboard/PDF/PNG/automatisation. Se demander : « un AUTRE endroit doit-il refléter ce changement ? ».
6. **CHERCHER PAR FONCTIONNALITÉ, pas par mot** (QR → qrcode, canvas, toDataURL, renderQrCard, print, download, PNG, export…).
7. **RÉUTILISER LES COMPOSANTS** : vérifier si un similaire existe avant d'en créer un ; préférer un composant configurable (boutons, modales, badges, tableaux, filtres, formulaires, sélecteurs…).
8. **DÉTECTER LES DOUBLONS** (autre nom/composant/page/ancien fichier). Si 2 systèmes font la même chose → le signaler ; centraliser si simple/sans risque, sinon demander avant.
9. **NE PAS CODER EN DUR ce qui devrait être configurable** (couleurs, délais, statuts, catégories, seuils, textes métier, alertes, types de docs, modèles). Centraliser quand ça a du sens.
10. **ADMINISTRABLE DEPUIS PARC PILOT** : se demander si l'admin devrait pouvoir le régler lui-même (Paramètres/Administration) plutôt que via un dev. Ne pas transformer une règle en paramètre si ça implique une grosse modif DB sans accord.
11. **AUTOMATISER** : si l'info existe déjà (conducteur, société, immat, km, établissement), la réutiliser — préremplissage / calcul / déduction / récupération / synchro auto.
12. **NE JAMAIS REDEMANDER une info déjà connue** : récupérer/proposer/préremplir/synchroniser plutôt que double saisie.
13. **CALCULS CENTRALISÉS** (TCO, conso, coût/km, carburant, budget, écarts, km, coûts mensuels, maintenance, KPI) : écran = dashboard = exports = PDF donnent EXACTEMENT le même résultat.
14. **DATES/ÉCHÉANCES CENTRALISÉES** (CT, entretien, assurance, restitution LLD, docs, permis, contrats) : une seule logique valide/bientôt/urgent/expiré.
15. **HISTORIQUE** : ne pas écraser en silence une info historique utile (conducteur, affectation, km, statut, entretien, sinistre, docs). Si ça touche la DB → demander avant.
16. **INTÉGRITÉ DES DONNÉES LIÉES** : avant modif/suppression, chercher les dépendances (un véhicule est lié à conducteur/factures/entretiens/sinistres/amendes/docs/km/contrats/QR/stats). Jamais traiter une entité isolément.
17. **FAVORISER L'ARCHIVAGE** vs suppression définitive (véhicules, users, conducteurs, docs, sociétés, contrats). Ne pas changer la logique de suppression actuelle sans accord.
18. **TESTER LE PARCOURS COMPLET**, pas juste le bouton (QR : créer→afficher→télécharger→imprimer→scanner ; sinistre : créer→modifier→doc→consulter→clôturer→historique ; etc.).
19. **ÉCRAN/IMPRESSION/PDF/PNG/EXPORT** = même donnée + même moteur métier ; seul le format de sortie change, jamais la logique.
20. **COHÉRENCE UI/UX** : une même action (Modifier, Supprimer, Télécharger, Imprimer, Sauvegarder, Annuler, Archiver, Filtrer) se comporte pareil partout ; composants similaires = apparence/comportement cohérents.
21. **DESIGN SYSTEM CENTRALISÉ** (couleurs, typo, espacements, radius, ombres, boutons, badges, cartes, tableaux, états, animations) — pas de valeurs visuelles arbitraires répétées.
22. **RESPONSIVE OBLIGATOIRE** (grand écran, laptop, tablette, mobile) : vérifier débordements, tableaux, modales, boutons, menus, formulaires, textes, cards.
23. **GÉRER TOUS LES ÉTATS** (chargement, succès, erreur, aucune donnée, partielles, accès refusé, fichier manquant, lent, action en cours) — jamais d'écran vide/incompréhensible.
24. **FEEDBACK UTILISATEUR** : toute action importante = retour visible (sauvegardé, supprimé, envoyé, importé, téléchargé, erreur, en cours). (cf. overlay « … en cours » puis « ✓/✕ ».)
25. **ANTI DOUBLE-ACTION** : protéger/désactiver pendant l'async (double création/envoi/sauvegarde/import/suppression/génération).
26. **VALIDER LES DONNÉES** avant enregistrement (valeurs négatives impossibles, dates incohérentes, km, champs obligatoires, doublons, format, fichiers, valeurs aberrantes). Ne pas changer les règles métier existantes sans accord.
27. **PERMISSIONS COHÉRENTES partout** : masquer un bouton ≠ sécurité ; une restriction doit tenir sur toute page/modale/API/bouton oublié (rôles CEO/Admin/Gestionnaire/Chauffeur via `FP.role`).
28. **SUPABASE — PRUDENCE MAX** : avant de toucher tables/colonnes/index/migrations/RLS/policies/storage/auth/fonctions/triggers, expliquer ; dans le doute DEMANDER ; jamais de migration destructrice/irréversible automatique.
29. **NE JAMAIS CASSER LES AUTOMATISATIONS** : ne pas renommer/supprimer en silence champs/statuts/fonctions/événements/routes/données/triggers utilisés par une automatisation.
30. **PERFORMANCE** : éviter requêtes inutiles, gros fetch sans pagination, recalculs/re-renders inutiles, images non optimisées, requêtes dupliquées ; partager les données communes proprement.
31. **PENSER À L'ÉCHELLE** (×10 véhicules/docs/users, multi-sociétés/établissements) sans over-engineering.
32. **FILTRES/RECHERCHES COHÉRENTS** (véhicule, conducteur, société, établissement, statut, période, catégorie) — une seule interprétation par filtre.
33. **EXPORTS FIABLES** : PDF/Excel/CSV/rapport = mêmes données et calculs que l'écran, jamais une valeur calculée autrement.
34. **AUCUNE DONNÉE FICTIVE EN PROD** (mocks, exemples, fallback, faux users/véhicules) — vérifier qu'ils ne restent pas actifs.
35. **PAS DE TODO SILENCIEUX** (TODO/FIXME/implémentation temporaire/feature partielle/code mort) — le signaler clairement.
36. **CORRIGER LA CAUSE RACINE**, pas le symptôme : trouver la cause, pourquoi elle existe, si elle est ailleurs, la correction minimale correcte. Éviter d'empiler des conditions spéciales fragiles. ⚠️ Si un changement semble **sans effet**, LIRE TOUT le mécanisme (un plafond/cache/autre code le neutralise) au lieu de re-régler la même valeur à l'aveugle.
37. **PRÉVENIR LES RÉGRESSIONS** : après une modif importante, vérifier les features proches ; tests si dispo, **syntaxe des scripts inline** (`node --check` / `new Function`), build, console. « Ça compile » ≠ terminé.
38. **IMPACT MÉTIER AVANT TECHNIQUE** : « supprimer un véhicule » ≠ `DELETE` — penser historique/docs/entretiens/sinistres/amendes/conducteurs/stats/contrats.
39. **CHANGEMENTS PETITS ET SÛRS** : ciblés, lisibles, réutilisables, par petites étapes. Pas de gros refactor non demandé (si nécessaire → expliquer + demander).
40. **WORKFLOW avant chaque tâche** : (1) Analyse (compris/fichiers/impacts/risques), (2) Recherche globale des occurrences liées, (3) Vérifier si une source commune existe, (4) Modif la + sûre, (5) Vérifs (syntaxe/build/tests), (6) Cohérence (pas d'ancienne version ailleurs), (7) Compte rendu (modifié quoi/où/centralisé/pas touché volontairement/points à surveiller).
41. **QUESTION FINALE** : « si le proprio fait la même action via une autre page/bouton/export/appareil/parcours, obtient-il exactement le comportement attendu ? » Si non/incertain → continuer l'analyse.
42. **OBJECTIF FINAL** : donnée unique → logique centralisée → composants réutilisables → propagation auto → automatisations → administration depuis l'app → tests → fiabilité. Rendre l'app progressivement + autonome, **sans jamais mettre en danger l'existant**.

## Workflow Git

⚠️ **Jamais de push direct sur `main`** (protégée). Une branche + une pull request par sujet :

```powershell
git switch main
git pull                                   # au début de chaque session (récupère les modifs des autres PC)
git switch -c sujet/description-courte     # branche dédiée
# ... tu modifies ...
git add <fichiers modifiés>                # éviter « git add . » (fichiers locaux, secrets)
git commit -m "ton message"
git push -u origin sujet/description-courte
gh pr create --fill                        # ou bouton « Compare & pull request » sur GitHub
```

Fusion de la PR quand les tests (`controles`, `e2e`) sont **verts** → GitHub Pages publie `main`
sur parc-pilot.fr en ~1-2 min. Les fonctions serveur (`supabase/functions/**`) sont déployées
automatiquement à la fusion (`.github/workflows/deploy-edge-functions.yml`).

## Tâches en attente

- [x] Activer RLS (Row Level Security) sur les tables Supabase — ✅ confirmé le 2026-06-15 : `rowsecurity = true` sur les 9 tables + policies `tenant_*` (isolation par société) sur vehicules, amendes, factures, conducteurs, documents, emprunts, total_conso, app_settings + `profiles_self_read`. (Reste recommandé : test réel avec un compte client `is_admin=false`.)
- [ ] Phase 3 : activer les écritures Supabase pour les mutations (drawer, bulk actions)
- [ ] Phase 4 : page "Espace salarié"
- [ ] 📎 **Scanner par lot les cartes grises** (KONA + reste de la flotte) via Tableau de bord → « Scanner un document » → remplit auto co2 / puissance fiscale / carburant / date 1re immat / prochain CT / masse **ET le VIN** dans les fiches. **À faire par Shakil, plus tard — LUI RAPPELER s'il oublie.** (L'onglet Alertes → « À compléter » liste en direct ce qui manque encore.)
- [ ] 🎬 Enregistrer la **vidéo de démonstration** (.mp4) avec voix off — **à faire par Shakil, plus tard**. Tout est prêt : la démo auto-jouée est `demo.html`, et le **script imprimable** (mode d'emploi enregistrement écran + texte à lire) est `script-demo.html`.
- [ ] 📧 **E-MAILS — « Solution 2 » (à faire PLUS TARD, validée par l'utilisateur le 2026-09-13, en attente)** : les e-mails métier (amendes, EDL…) partiront **au NOM de chaque société** mais **depuis le domaine plateforme** Parc Pilot (from = `<Nom société> <envoi@parc-pilot.fr>`, **reply-to = l'adresse de contact du client**), au lieu d'exiger que chaque client vérifie SON domaine. Le plus **simple + pro** : onboarding instantané, une seule vérif de domaine à vie, meilleure délivrabilité. Le domaine dédié du client reste une **option premium** (déjà géré par `send-email` via `mailExpediteur`+`mailDomaineEnvoi`). **Ce qu'il RESTE à faire quand l'utilisateur dira go** : (1) modifier le **repli** de `supabase/functions/send-email/index.ts` (aujourd'hui : société sans domaine vérifié → `EMAIL_FROM` = adresse PXP) pour → `<Nom société> <envoi@parc-pilot.fr>` + reply-to = mailExpediteur de la société ; (2) INFRA (utilisateur) : **vérifier `parc-pilot.fr` dans Resend** (records DNS chez GoDaddy — le même domaine sert déjà aux invitations) + secret Supabase `EMAIL_FROM`/`INVITE_FROM` = `Parc Pilot <envoi@parc-pilot.fr>`. ⚠️ NE PAS toucher aux adresses **PXP** (`shakil.nubee@projectxparis.fr`…) qui restent celles de PXP (PXP a déjà son domaine vérifié → inchangé).

## Pour Claude (nouvelle session)

Si tu reprends ce projet :
- ⚠️ **UTILISER LES SKILLS SYSTÉMATIQUEMENT** (consigne explicite de l'utilisateur) : dès qu'un
  skill correspond à la demande, l'invoquer **de toi-même**, sans attendre qu'il le nomme. Réflexe par
  défaut : **design/UX** (`frontend-design`, `ui-ux-pro-max`), **déploiement** (`deploy`, `rebuild`),
  **projet** (`parc-pilot-dev`), **graphiques** (`dataviz`), **revue/sécu** (`requesting-code-review`,
  `security-review`) et tout autre skill pertinent. Les skills de **guidage** (qui chargent juste des
  instructions) coûtent quasi rien → toujours les prendre. Les skills qui **lancent des agents**
  (revues, audits) coûtent des crédits réels → les lancer quand c'est utile et le signaler si c'est gros.
- L'utilisateur parle **français**, garde un ton direct et simple (il n'est pas dev)
- Il bosse sous **Windows / PowerShell 5.1** (pas Python, pas Node installés)
- Préfère les solutions **sans terminal** quand possible (UI Supabase, UI GitHub)
- Avant de modifier `data.js` : c'est un gros fichier, utilise Edit avec contexte précis
- Pour toute modif déployée : branche → commit → push de la branche → **pull request** → fusion quand les tests sont verts (GitHub Pages publie `main`). Jamais de push direct sur `main`.
- ⚠️ **AUDITS À LA DEMANDE** : quand l'utilisateur dit **« fais l'audit »** (ou « lance les
  audits »), lancer **en parallèle** les 12 auditeurs documentés dans **`docs/AUDITS.md`**
  (un Agent par domaine, sortie = findings vérifiés `fichier:ligne`+gravité, NE PAS modifier),
  puis vérifier chaque trouvaille dans le code réel et corriger les vraies + rapport priorisé.
  Il n'y a **plus d'audit automatique** (GitHub Action retirée à sa demande) : c'est LUI qui les
  déclenche de temps en temps.
