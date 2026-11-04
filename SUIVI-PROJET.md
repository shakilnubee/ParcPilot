# Parc Pilot — Suivi du projet de fiabilisation

> Document de suivi partageable. **Tenu à jour à chaque étape** (voir « Comment ce document est tenu à jour » en bas).
> Dernière mise à jour : **04/11/2026** (**Sinistres — documents** : Voir / Télécharger / **Remplacer** / **Supprimer** (confirmation, suppression storage seulement si plus référencé) + **🔁 Relire (IA)** ; lecture IA du courrier **automatique** à l'import avec **fenêtre de validation** (champ par champ, rien enregistré sans accord) + **détection de divergence** (conducteur figé jamais remplacé, plaque/date/dossier) ; champs **N° police** + **Courtier** ajoutés ; montants : seulement franchise contractuelle + PEC annoncée. `?v=20261104f`. Avant : **Demandes d'achat** déplacées de Contrats→Archive vers **Achat & vente** (nouvel onglet « Demandes d'achat ») — même source `offres_achat`, zéro doublon ; Contrats→Archive = coffre-fort de documents seul ; badge carte + alerte + anciens liens réaiguillés ; `?v=20261104e`. Avant : **filtre « Tous loueurs »** corrigé (ne liste que les vrais loueurs via `FP.estLeasing`, plus les sociétés) — PR #1208. Avant : Refonte du **suivi financier des sinistres** : 9 montants distincts — coût estimé/facturé, franchise contractuelle/appliquée, PEC annoncée/confirmée, versements multiples — + synthèses (reste à recevoir / reste à charge prévisionnel / définitif), règle « À déterminer » jamais remplacée par 0 ; source unique `FP.sinistreFin`, TCO inchangé (rétro-compatible) ; scan courrier assureur lit franchise + PEC si étiquetées ; `?v=20261104d`. Avant : Traduction du **contenu** des tâches dans les messages conducteur : le **motif** (dictionnaire central, sans IA) et le **texte libre** (note/lieu, via IA — Edge `translate-text`) partent en **anglais** pour un conducteur non francophone ; le rappel auto garage (Edge `km-relance`) traduit aussi son motif ; interface toujours en français ; conception fail-safe ; `?v=20261104c`. Avant : Navigation « clic molette = nouvel onglet » rétablie partout où une vraie page existe — menu, cartes véhicule/conducteur — via un helper central `data-nav-href` + garde-fou du menu, sans toucher les `<a>` existants ; testé Chromium headless. Avant : Audit fiabilité/sécurité/synchro livré — `docs/pour-chatgpt-complet/AUDIT-2026-11-03.md`. Correctifs : **F6** verrou serveur de la config société — un gestionnaire ne peut plus altérer la config (e-mails, groupes, seuils…) via l'API, sans bloquer ses données de travail (déclencheur `trg_guard_app_settings_config`, fail-open, appliqué prod) ; **F1** verrou anti-écrasement de la config concurrente (CAS `rev`) → socle `20261103130000` appliqué prod + verrou code déjà présent désormais **actif** (F1/F4 clos) ; **F10** colonnes notes de frais → migration versionnée `20261103120000` (testée staging, appliquée prod) ; **F14** idempotence des déclarations QR (sinistre/problème + question) — jeton client stable `clientToken` + enregistrement idempotent côté Edge `km-collect` → un renvoi réseau/double-tap ne crée plus de doublon, repli `genId` pour les anciens clients, **zéro changement de comportement visible** ; **F18** l'Edge `km-collect` lit désormais le conducteur dans la **table source `vehicle_assignments`** (repli sûr sur l'ancienne copie `app_settings.affectations` → anti‑régression). Avant : Rapports PDF de sinistres refondus au format « Déclaration de sinistre » validé avec l'utilisateur : rubriques en cartes, **retrait à l'affichage** du préfixe de catégorie « Autre souci — » collé par le portail conducteur — base intacte —, **suppression de la ligne « Nature » contradictoire**, **mise en page photos adaptative** (1 grande / 2–4 grille / 5+ paginé, sans déformer), et **pièces jointes scopées au seul incident** (fin de la fuite des photos d'EDL / d'un autre sinistre du même véhicule). Modif HTML pure — `pages/sinistres.html` + manuel ; pas de migration Supabase. Avant : 4 lots de correctifs d'audit fiabilité/sécurité/cohérence — PR #1161 à #1164 ; réservation de véhicules + module « Acheter » actifs.)
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

### 04/11/2026 — Sinistres : documents (supprimer/remplacer/télécharger) + lecture IA à validation 🟢
**Besoin.** Dans un sinistre, on pouvait seulement « Voir le courrier » — impossible de le **supprimer/remplacer**, et la lecture IA remplissait en partie **sans fenêtre de validation**.
**Fait (pur client, aucun Edge/Supabase/table/RLS touché).**
- **Documents du dossier** (courrier + constat) : rubrique « 📎 Documents du dossier » avec **👁 Voir · ⬇ Télécharger · 🔄 Remplacer · 🗑 Supprimer** (confirmation nommée) ; **🔁 Relire (IA)** pour le courrier. Suppression = retire la **référence** (`courrierUrl`/`constatUrl`) **puis** supprime le **fichier storage uniquement s'il n'est plus référencé** (`sinFileReferencedElsewhere` + `FP._storageRef` + `storage.remove`) → pas d'orphelin, pas de lien cassé, pas de fichier partagé supprimé. Ne touche jamais le sinistre, les autres docs, les photos d'EDL, ni les montants déjà saisis. Remplacer purge l'ancien fichier (anti-doublon).
- **Lecture IA auto + fenêtre de validation** : au dépôt (et via « Relire »), `FP.scanIA` lit le courrier puis **`openCourrierValidation`** affiche par champ **valeur actuelle vs proposition IA + case à cocher** (vides pré-cochés, champs remplis préservés). **Rien d'enregistré sans validation.** Re-scan sans ré-upload : récupère le fichier via `FP.signedScanUrl` → `scanIA`.
- **Détection de divergence** : conducteur (jamais remplacer le **figé**), plaque, date de sinistre, n° de dossier → avertissement « À vérifier » ; plaque différente = « document d'un autre véhicule ».
- **Champs ajoutés** (jsonb, additifs) : **N° de police** + **Courtier/gestionnaire**. **Prompt IA** `FP.courrierAssureurPrompt` étendu (police, courtier, conducteur, plaque, dateSinistre) — « lire, jamais deviner », police ≠ dossier.
- **Règles financières respectées** : un courrier ne renseigne que **franchiseContractuelle + pecAnnoncee** — jamais remboursement / coût facturé / reste à charge.
`app.min.js` régénéré, `?v=20261104f`, `check-bugs` vert, manuel (s-sinistres) à jour. **Audit autres modules** : rapport seul (demandé) — factures/entretiens ont déjà voir/supprimer via `FP.docsFolder`/`FP.dupe` ; les docs archivés (Contrats) ont déjà voir/renommer/supprimer ; cohérence globale OK, pas de correction nécessaire pour l'instant.

### 04/11/2026 — Demandes d'achat déplacées de Contrats→Archive vers Achat & vente 🟢
**Besoin.** La page Contrats→Archive mélangeait deux choses : les **demandes d'achat** (acheteurs) et le **coffre-fort de documents**. La gestion des acheteurs appartient au module **Achat & vente**.
**Vérif anti-doublon (demandée).** `a-vendre.html` n'avait **pas** de gestion des demandes dupliquée : seulement un badge « 📥 N demande(s) reçue(s) » sur les cartes (lecture de `FP.offreAchat`) qui renvoyait vers Contrats→Archive. Donc **déplacement**, pas duplication.
**Fait.** Nouvel onglet **« 🧾 Demandes d'achat »** dans `a-vendre.html` (3ᵉ sous-onglet, patron `av-tab`). Le bloc HTML + le module JS `archiveModule` (liste, KPIs, filtres, détail, recontacter, dossier de vente, classer/supprimer, ajout manuel, bouton Réinitialiser) ont été **déplacés depuis `contrats.html`**. **Source de données inchangée** : `FP.offreAchat` → table `offres_achat` (Supabase), zéro migration, zéro doublon → les 3 demandes existantes, statuts, coordonnées, dossiers de vente, isolation société : tout suit.
**Rewiring.** Le badge de la carte véhicule bascule désormais sur l'onglet local (`window.__openDemande`) au lieu de renvoyer vers Contrats. L'**alerte « demande d'achat reçue »** (`app.js` buildAlertes) pointe vers `a-vendre.html?tab=demandes&offre=`. Les **anciens liens** `contrats.html?ctab=archive&offre=` sont **redirigés** vers le nouvel onglet (compat). Deep-link `?tab=demandes` / `?offre=` géré au chargement.
**Contrats→Archive** ne contient plus que le **coffre-fort de documents** (dépôt, catégories, années, recherche, consultation, téléchargement, renommage, suppression protégée, synchro, permissions) — **inchangé**. `app.min.js` régénéré, `?v=20261104e`, `check-bugs` vert, manuel (s-contrats + section À vendre) à jour. Pur client, aucun Edge/Supabase touché. Statuts demande **non** fusionnés avec le pipeline de vente, statut véhicule **non** modifié à la réception (comme demandé).

### 04/11/2026 — Véhicules : filtre « Tous loueurs » = uniquement les vrais loueurs 🟢
**Problème.** Le filtre mélangeait loueurs (BPCE, TEMSYS) et **sociétés** (TJMAX, PROJECT X PARIS RETAIL, PXPR GE/IT/NL). **Cause racine** : le filtre était peuplé depuis `FP.loueurOf(v)` sur tous les véhicules ; `FP.loueurOf` retombe sur le champ `proprietaire` brut (= la société, pour un véhicule **acheté**). **Aucune donnée mal classée** (proprietaire=société est correct) → bug d'affichage. **Correctif** (`vehicules.html`, 1 ligne) : ne peupler le filtre qu'avec les véhicules **en leasing** (`FP.estLeasing`). Dynamique, zéro nom en dur. Contrats construisait déjà sa liste correctement (registre `settings.loueurs`) → non touché. HTML seul (pas de minif/bump). PR #1208.

### 04/11/2026 — Refonte du suivi financier des sinistres (9 montants + versements + synthèse) 🟢
**Besoin.** Le suivi d'un sinistre se limitait à 2 montants (franchise + remboursé). Refonte validée (maquette) : distinguer **tous les montants** d'un dossier, sans jamais les mélanger, avec la règle d'or **« À déterminer » (jamais un 0 inventé)**.
**Modèle de données (additif, zéro migration Supabase).** `sinistreAssurance[incident]` (jsonb déjà synchronisé via `settings_items`) accueille : `coutEstime`, `franchiseContractuelle` (repli legacy `franchise`), `franchiseAppliquee`, `pecAnnoncee`, `pecConfirmee`, `versements[]` (remplace le scalaire `rembourse`, lu en repli → anti-perte), `solde` (bool). Le **coût facturé** est calculé des factures rattachées (jamais stocké).
**Source unique `FP.sinistreFin(incidentKey, factures)`** (app.js) : renvoie les 9 montants + synthèse (reste à recevoir = PEC confirmée − encaissé ; **reste à charge prévisionnel** = franchise appliquée si saisie, sinon coût éco − PEC confirmée ; **reste à charge définitif** seulement si dossier soldé). `FP.resteChargeSinistre` (TCO/Budget/fiche/Statistiques) **réécrit sur cette base** mais **réduit exactement à l'ancien calcul sur les données existantes** (vérifié : pec → franchise ; non-pec → coût − encaissé) → **aucun chiffre ne bouge** pour l'historique. `FP.coutSinistre` inchangé.
**UI (`pages/sinistres.html`).** Bloc « 💶 Suivi financier » dans le dossier d'incident : 6 champs montants éditables + **coût facturé** en lecture seule + **liste des versements** avec « + Ajouter » / retrait + **3 synthèses** (À déterminer en violet, 0 € confirmé en vert) + case **« Dossier financièrement soldé »** + légende. KPIs de page (reste à charge, encaissé) alignés sur `FP.sinistreFin`. Persistance via le handler générique `.sin-doss` (nombres + case à cocher) et des handlers versements dédiés (migration douce `rembourse`→`versements`).
**Scan IA courrier assureur enrichi** : `FP.courrierAssureurPrompt` lit **en plus** la **franchise** et la **PEC annoncée** — **uniquement si clairement étiquetées** (règle « lire, jamais deviner » ; anti-`Math.max`) — reportées dans le suivi (vides sinon). `app.min.js` régénéré, `?v=20261104d`, `check-bugs` vert, manuel (s-sinistres) à jour. **Pur client** (aucun Edge/Supabase/RLS touché). Suite possible (non incluse) : alertes « dossier non soldé » / « reste à recevoir » dans la checklist « À compléter ».

### 04/11/2026 — Traduction du CONTENU des tâches dans les messages (motif + texte libre) 🟢
**Besoin.** L'interface de gestion reste **100 % en français**, mais quand une tâche/un rendez-vous est envoyé à un conducteur **non francophone** (SMS / WhatsApp / e-mail / rappel auto / aperçu), le **contenu** doit partir en **anglais**. Les **modèles** d'e-mail étaient déjà bilingues (étape précédente) ; restaient les parties **dynamiques saisies par le gestionnaire** : le **motif/intitulé** et le **texte libre** (note/description, lieu), qui partaient encore en français.
**Méthode (consigne respectée).** 1) **Dictionnaire central** des motifs connus (Révision→Scheduled maintenance, Contrôle technique→Vehicle inspection, Vidange→Oil change…) → traduction **instantanée, SANS IA** ; 2) **IA (Claude)** uniquement pour le **texte libre** (intitulé personnalisé, note, lieu) — noms propres/garages/adresses/plaques **gardés tels quels**, **rien d'inventé**. Pas de nouveau « moteur » : réutilise les flux existants ; **aucun doublon** de modèles (les EN éditables de Paramètres → E-mails sont réutilisés).
**Réalisé.**
- **Edge `translate-text`** (nouvelle fonction, `verify_jwt` par défaut = connecté requis) : dico d'abord, IA pour le reste, renvoie un statut `ok` **par élément** (jamais de français silencieux). Secret `ANTHROPIC_API_KEY` (déjà présent, scan-doc).
- **Client** `assets/js/app.js` : `FP.MOTIFS_TRAD` (dico), `FP.tradMotifLocal`, `FP.tradTacheContenu(parts, lang)` (FR → tel quel, zéro latence ; EN → dico + IA). **`taches.html` → `notifyFromTask`** : traduit motif + note + lieu, **ajoute la note et le lieu au message** (contenu plus complet, FR comme EN), agenda `.ics` + objet + titre e-mail traduits. **Échec/incertitude** → toast d'alerte + composer **éditable** (le gestionnaire corrige avant d'envoyer).
- **Rappel auto garage (Edge `km-relance`)** : le motif du **rappel la veille** est désormais traduit (dico + IA), plus seulement « Contrôle technique ». Si la traduction d'un motif libre est **incertaine**, ce rappel est **sauté** avec une **erreur exploitable** dans le rapport (les autres continuent) — jamais de français « en douce ».
**Source unique.** Le **dictionnaire** (donnée) est volontairement **miroir** aux 3 endroits (`app.js` / `translate-text` / `km-relance`) — pattern self-contained du projet (comme `FP.condLangue`/`fillTags` déjà mirrorés côté Edge) ; commentaire de synchro dans les 3. `app.min.js` régénéré, `?v=` bumpé (`20261104c`), `check-bugs` vert, manuel à jour. ⚠️ `translate-text` et la modif `km-relance` se **déploient à la fusion** (deploy-edge-functions.yml) — pas de test staging auto possible pour l'IA ; **conception fail-safe** : si l'Edge est indisponible, le client retombe sur dico seul + alerte, et km-relance sur dico seul + saut.

### 04/11/2026 — Langue automatique FR/EN des messages conducteur + nettoyage des modèles 🟡 (manuel ✅ ; auto Edge = suite)
**Problème 1 — mauvaise langue.** Un conducteur non francophone (ex. Gionata, italien) recevait des messages en **français** depuis certains flux. La logique de langue existait déjà (`FP.condLangue` → fr/en, accesseurs bilingues `FP.mailModeleProfilL`/`FP.mailObjetL`) mais **plusieurs flux appelaient les versions FR-only** ou du texte « en dur ». Corrigé (ils résolvent la langue du conducteur et choisissent FR/EN) :
- **Tâche → « Envoyer »** (le bug montré), **fiche véhicule → « Prévenir du rendez-vous »**, **message de bienvenue** conducteur, **réponse SMS/WhatsApp à un signalement** (sinistre).
- Déjà bilingues (vérifié) : **amendes**, **relances** (`FP.relances.message`), **entretiens**, **« Prévenir accès »**, **e-mail de réponse sinistre**.
- **Réservation (emprunts)** : destinataire = demandeur externe, langue inconnue → reste **FR** (règle : langue non renseignée = défaut), documenté.
- ✅ **Rappels AUTOMATIQUES (Edge `km-relance` : demande/relance km + rappel CT la veille)** : rendus **bilingues** (PR Edge isolée) — helper `resolveCondLang` (langue lue dans `app_settings.condLangues`, miroir de `FP.condLangue`) + défauts EN côté serveur + priorité « perso EN → perso FR → défaut EN → défaut FR » (respecte les modèles saisis par la société) + libellés fixes des e-mails localisés (titre, bouton, agenda). **Logique testée en Node** (Gionata italien → EN, non réglé → FR, perso respectée). `task-reminders` = messages **gestionnaire** → restent FR (règle).

**Problème 2 — rédaction.** Nettoyage des **modèles par défaut** (code `FP.MAIL_DEFAUT`, FR **et** EN) : suppression des **tirets « — » utilisés comme séparateurs de phrases** (prévenir CG/EDL/CT/annonce, relances CT/entretien/garage/amende, et leurs versions EN), phrases rendues naturelles. **Variables préservées** (`{prenom}`, `{immat}`, `{lien}`, `{date}`, `{motif}`, `{revision}`…). **Aucune personnalisation client touchée** (stockée dans `app_settings`, intacte) ; `_MAIL_OBSOLETE` (détection d'anciens défauts) **non modifié**. Les tirets d'**objet** d'e-mail (« Titre — {immat} », mise en forme conventionnelle) sont conservés.

**Méthode.** Cause racine corrigée, **fonctions communes réutilisées** (pas de nouveau moteur), Supabase/Edge/RLS/QR/perms/automatisations/destinataires/délais **inchangés** pour cette PR. `app.js` + `.min.js` régénérés, `?v=` bumpé (`20261104b`), `check-bugs` vert, manuel à jour.

### 04/11/2026 — Navigation « clic molette = nouvel onglet » (partout où une vraie page existe) ✅
Comportement standard des navigateurs rétabli : **clic molette** (et **Ctrl/Cmd/Maj+clic**) ouvre la destination dans un **nouvel onglet**, sans quitter la page courante ; le **clic gauche** simple est inchangé.
- **Deux causes racines** identifiées : (1) le menu latéral faisait `preventDefault()` sans vérifier les touches → Ctrl/Cmd+clic annulé ; (2) beaucoup de **cartes/lignes** naviguent en JavaScript (pas des `<a>`) → molette = rien, Ctrl/Cmd = même onglet.
- **Correction centrale** (`app.js`, réutilisable) : (A) le gestionnaire du menu **sort** sur tout clic modifié/non-gauche → comportement natif ; (B) helper global `data-nav-href` — tout élément porteur de `data-nav-href="URL"` s'ouvre en **nouvel onglet** au clic molette/Ctrl/Cmd/Maj (clic gauche = handler existant conservé). ⚠️ Le helper **ne touche pas** les vrais `<a>`/boutons/champs (comportement natif préservé, jamais deux onglets).
- **Appliqué** aux éléments qui visent une **vraie page** : cartes véhicule du **tableau de bord**, cartes **et lignes** de la page **Véhicules** (ouvre la fiche en onglet, le volet de détail reste pour le clic gauche), cartes **Conducteurs**. Les **plaques/prénoms** (`FP.lienVehicule/lienConducteur`) et le **menu** étaient déjà de vrais `<a>` (molette OK).
- **Signalé (non concerné)** : les clics de listes **Amendes / Factures / Emprunts / Sinistres / Entretiens / Contrats** ouvrent une **fenêtre de détail sur la même page** (pas d'URL dédiée par enregistrement) → ne peuvent pas s'ouvrir en onglet séparé sans créer une page dédiée (non demandé). a-vendre : la **plaque** est déjà un vrai lien.
- **Compromis assumé** (réserve) : les cartes contenant des boutons ne peuvent pas être de vrais `<a>` (imbrication interdite) → le helper utilise `window.open` pour elles ; conséquence mineure : l'onglet s'ouvre au **premier plan** et le **clic droit → « ouvrir dans un nouvel onglet »** n'est dispo que sur les vrais liens (plaques, menu). Le besoin principal (molette + Ctrl/Cmd) est couvert partout.
- **Testé** en navigateur headless (Chromium) sur le vrai code : molette/Ctrl/Cmd = nouvel onglet ✓, clic gauche inchangé ✓, pas de double onglet sur les liens/boutons internes ✓. `app.js` + `.min.js` régénérés, `?v=` bumpé (`20261104a`), `check-bugs` vert, manuel à jour. **Mobile/tactile non modifié.**

### 04/11/2026 — Audit F22/F23 : supervision des tâches automatiques (lecture seule) ✅ (en production)
Il n'existait **aucun tableau de bord** pour voir si les envois automatiques du serveur (relances km, rappels de rendez-vous, rappels de tâches, import des péages Ulys) tournent bien — seul le CEO voyait le journal Resend des e-mails. Ajout d'une **supervision lecture seule** :
- **Table `cron_runs`** (migration `20261104100000`, testée staging) : garde l'historique des exécutions. Lecture ouverte à tout compte connecté (gestionnaire inclus) ; **écriture réservée au serveur**. Contenu **non sensible** (nom de tâche, statut, horodatages, **compteurs globaux** — aucun nom de société ni donnée perso).
- **3 Edge Functions instrumentées** (`km-relance`, `task-reminders`, `ulys-daily`) : chacune écrit **une ligne** à la fin de son exécution, dans un **`try/catch` qui ne peut JAMAIS bloquer la tâche** (si la table n'existe pas encore en prod, le log est simplement ignoré). Ajouts **purement additifs** (42 lignes, aucune suppression) ; le déploiement Edge **échoue proprement** en cas d'erreur (l'ancienne version reste en ligne).
- **Écran** « 🩺 Tâches automatiques — dernière exécution » (Paramètres → **Notifications**, visible gestionnaire) : pour chaque tâche, **dernière exécution** (il y a X h/j), pastille **OK/Échec** et nombre d'envois. Pur voyant, rien à régler.
- **F20** (jobs pg_cron réellement actifs) : non vérifiable sans accès base → **SQL de contrôle fourni** (`select jobname, schedule, active from cron.job;`) ; l'écran rend aussi le défaut visible (une tâche qui ne tourne plus « vieillit »).
- Changement **sans `?v=`/min** (parametres.html + inline JS + Edge + migration + docs ; aucun `app.js`/`fleet-views.js`). `check-bugs` vert, manuel à jour. PR #1201. Edge déployées (run #120 ✅). **Migration `cron_runs` appliquée en production le 04/11** → supervision active.

### 03/11/2026 — Audit F26 : anti-doublon au dépôt de documents ✅ (en production après fusion)
La table `documents` n'avait **pas** de garde anti-doublon centralisée (`FP.dupe`) → on pouvait déposer deux fois le même document (d'où l'outil de purge manuel existant). Corrigé :
- **Cas `documents` ajouté à `FP.dupe`** (source unique anti-doublon de la plateforme) : doublon = **même véhicule + même type** + soit le **même fichier Drive** (`driveId`/`fileId`, id stable), soit le **même libellé** (un upload reçoit une URL neuve → on compare le libellé, pas l'URL).
- **Garde `confirmAdd` branchée au point d'ajout MANUEL** (`FP.docsFolder`, **avant** l'upload → pas de fichier orphelin dans le stockage). C'est un **confirm** (« Doublon possible — l'ajouter quand même ? »), pas un blocage.
- **Volontairement exclu** : dépôts automatiques/multi-photos (états des lieux, photos de sinistre — chacune a un libellé/URL distinct, jamais flaguée) et types « une seule par véhicule » (carte grise… qui remplacent déjà l'ancien).
- `app.js` + `.min.js` régénérés, `?v=` bumpé partout (`20261103a`), manuel à jour, `check-bugs` vert. PR #1200.

### 03/11/2026 — Audit F6 : verrou serveur de la config société (gestionnaire) ✅ (en production)
Un compte **gestionnaire** pouvait, via l'API, modifier la config de **sa** société (e-mails d'amende, nom, groupes, seuils d'alerte, champs perso, documents obligatoires, automatisations) — c'était bloqué **seulement à l'écran**. Jamais une AUTRE société (l'isolation tenait). Fermé **côté base** :
- **Approche choisie avec l'utilisateur** : un **verrou serveur qui reflète le cadenas de l'écran**, **sans** refondre le cœur des réglages (`FP.settings`) → on évite le risque « deux tiroirs » (perte de réglages) de la séparation en 2 lignes.
- **Comment** : un déclencheur `trg_guard_app_settings_config` qui, **pour un gestionnaire uniquement**, refuse de **changer** une clé de config (`societe`, `groupes`, `notif`, `pleinSeuilAnormal`, `customFields`, `docRequis`, `automations`, et `profil` **sauf** `logoUrl`). **Tout le reste passe** (données de travail, affichage, cache du logo e-mail, clés inconnues) = **fail-open** → aucune opération du gestionnaire cassée. CEO/Admin : non concernés.
- **Pourquoi c'est sûr** : le client écrit par **fusion delta** → une clé de config non modifiée reste identique au serveur, donc jamais bloquée ; seul un vrai changement de config par un gestionnaire (appel forgé) est refusé. Chaque clé protégée vérifiée sans chemin d'écriture gestionnaire (savers de seuils gardés par `FP.canManageSociete()`, édition loueurs masquée, `hostSocieteLogo` n'écrit que `profil.logoUrl` → exclu).
- **Tests** : **vrai PostgreSQL 16** (9 scénarios gestionnaire + 2 admin + idempotence) + **staging** (migration-staging.yml, isolation préservée), PR #1198. Migration `20261103140000_gestionnaire_config_guard.sql` **appliquée en production** (accord explicite, `JOURNAL.md`). Rollback d'une ligne fourni.
- **Reste (distinct, Phase 4, sans faille)** : sortir complètement les données de travail résiduelles d'`app_settings` vers des tables dédiées (item ⑦). Pas urgent.

### 03/11/2026 — Audit F1 : verrou anti-écrasement de la config (CAS `rev`) ✅ (en production)
La configuration d'une société tient dans **une seule ligne** `app_settings` : si deux admins modifiaient la **même** info de config à quelques secondes d'intervalle depuis deux appareils, le second pouvait **écraser en silence** la modif du premier (« dernier qui écrit gagne »). Corrigé, en deux parties :
- **Socle base** (migration versionnée `20261103130000`, PR #1196) : ajoute à `app_settings` un **numéro de révision `rev`** (+ `updated_at`) incrémenté automatiquement à chaque écriture par le trigger `trg_app_settings_touch`. **100 % additif, idempotent, non bloquant** — testé sur le staging (run #29 ✅), puis **appliqué en production** (Shakil, accord explicite). Consigné dans `JOURNAL.md`.
- **Verrou côté code (CAS)** : le code de `FP.settings._pushSettings` faisait **déjà** le bon travail (lit `rev`, écrit « seulement si personne n'a modifié entre-temps », sinon **relit + refusionne + réessaie**) — livré de longue date, en **feature-detecting** (repli par fusion sûre quand `rev` n'existait pas). Il était **dormant** faute de colonne `rev` en prod ; **depuis l'application du socle, le verrou est actif tout seul**. Aucun redéploiement nécessaire (build minifié déjà à jour, `check-bugs` vert).
- **Rectificatif d'audit** : la note « le code ne lit jamais `rev` » (findings F1/F4) était **inexacte** — le constat visait la branche *additive* (1er push, sans risque d'écrasement) ; le chemin normal faisait bien le CAS. Docs corrigées (`AUDIT-2026-11-03.md`, `MIGRATIONS-EN-ATTENTE.md`). **F1 et F4 clos.** Reste ouvert : **F6** (séparer config et données de travail dans `app_settings` puis reprotéger la config côté RLS), chantier distinct et plus lourd, à mener par petites étapes testées.

### 30/10/2026 — Audit fiabilité/sécurité/cohérence : 4 lots de correctifs sûrs ✅ (en production)
Audit en lecture seule (4 auditeurs parallèles + vérification manuelle dans le vrai code), puis correction des anomalies **vérifiées et sans risque**, en 4 pull requests testées (CI verte) :
- **Lot 1 — intégrité des données** (PR #1161) : `condCustom` (champs personnalisés conducteur) ajouté à `FP.condKeyMaps` → plus d'orphelins au renommage ni d'héritage par un homonyme recréé ; deux échecs d'écriture jusque-là silencieux (`offres_achat`, synchro des modifs locales de véhicule) rendus **visibles** (`FP.notifyError`, règle ③).
- **Lot 2 — pipeline des alertes** (PR #1162) : la page Alertes charge désormais les demandes de **réservation** (apparition fiable au 1er affichage) ; la **pastille du menu** s'éteint quand on consulte les demandes d'achat/réservation (la carte reste tant que non traitée) ; la pastille « Activité QR » utilise la **même fenêtre (1 h)** que la carte → plus de pastille fantôme.
- **Lot 3 — cohérence des coûts** (PR #1163) : l'écran mural calcule le **mois courant en heure locale** (`FP.ymLocal`, comme le dashboard) ; le « Top coûts par véhicule » du rapport PDF regroupe par **plaque normalisée** (`FP.normImmat`) → plus de doublon dû au format de plaque.
- **Lot 4 — anti-doublon** (PR #1164) : le nouveau point d'ajout « dossier d'achat » passe par le helper central `FP.dupe` (règle prudente : plaque forte, sinon marque+modèle+fournisseur+date de commande, pour ne pas flaguer un achat en lot).
- **Vérifié puis NON modifié** (fausses pistes ou choix voulus) : cible de l'alerte « relevé km » (→ Sinistres = correct, inbox unifiée), `muteKey` par nombre (réapparition voulue d'une alerte au nouvel événement).
- **Laissé pour décision/accord explicite** (non touché) : tuile « Facturé ce mois » tous types ; refactor `app_settings` config/données ; RGPD de la fonction `km-collect` ; vérif colonne `rev` en prod ; mode paysage mobile (2 systèmes de nav) ; inventaire des textes ; CT edge function + migration ; activation de l'espace salarié.

### 30/10/2026 — Réservation de véhicules par lien public (Phases 3A/3B/3C) ✅ (en production)
Nouvelle fonctionnalité : un **collègue sans compte Parc Pilot** peut demander à réserver un véhicule via un **lien sécurisé** partagé par le gestionnaire, qui accepte ou refuse la demande depuis l'application.
- **3A** — table `reservations` (1 réservation = 1 ligne, isolation par société via RLS, pas de policy anonyme) + helper `FP.vehDispo` (disponibilité d'un véhicule). Migration **testée sur staging**.
- **3B** — **portail public** : page `reserver.html` (sans compte, 3 étapes : dates → véhicules disponibles → coordonnées) + fonction serveur `reservation` (service_role, protégée par un token société secret ; disponibilité vérifiée **côté serveur** ; prévient le gestionnaire par notification + e-mail et confirme au demandeur).
- **3C** — **gestion in-app** (Emprunt véhicule) : génération/partage du lien, choix des **véhicules proposés** (par défaut aucun — exposition volontaire), **boîte de réception** des demandes (Accepter → réservation ajoutée à la liste existante + e-mail ; Refuser → e-mail), alerte « demandes à valider ». Une **seule source** par état (demandes en attente dans la table, réservations confirmées dans la liste existante). Disponibilité du portail **exhaustive** : réservations + emprunts en cours + statut + immobilisation.
- ⚠️ **Inerte en production** tant que la migration `reservations` n'y est pas appliquée (en attente d'accord + sauvegarde).

### 26/10/2026 — Audit profond #3 (angle complémentaire) : 13 correctifs
Troisième passe, **angle différent** des 2 premières (par PAGE et par FLUX bout-en-bout + domaines non encore tracés : performance/volumétrie, dates/échéances, imports/robustesse, automatisations, PWA/accessibilité). Verdict d'ensemble inchangé : plateforme **solide**. **13 correctifs** :
- **① [ÉLEVÉ] Facture Ulys — `Math.max` aveugle réintroduit** dans le parseur canonique (`app.js` `FP.ulys.parse`) : si le « NET A PAYER TTC … € » n'était pas lu (glyphe € perdu par pdf.js), le TTC prenait le **plus grand nombre de la page** (référence parasite → ex. 1875 €), HT/TVA dérivés → triplet faux mais cohérent, importé en silence. Remplacé par la recherche d'un **couple base/TVA cohérent** (TVA≈20 %) ; sinon TTC=null → facture signalée illisible au lieu d'un montant inventé.
- **② [MOYEN] Dépôt groupé au scanner — compteur menteur** : un doublon refusé (FP.dupe renvoie `{annule:true}` sans lever) était compté « enregistré ». Désormais compté **« doublon ignoré »** (bilan + toast honnêtes).
- **③ [MOYEN] Export « Coût par véhicule » (Stats) ≠ écran** : l'export incluait les véhicules sortis de flotte (total gonflé). Aligné sur le filtre écran (`FP.horsFlotte`).
- **④ [MOYEN] Colonne « Prochain CT » (tableau Véhicules)** affichait « CT dépassé » en rouge pour un véhicule **étranger/exempté** (`FP.ctIgnored`) ou **vendu** (`FP.horsFlotte`), alors qu'il n'alerte nulle part ailleurs. Exemptions désormais respectées (date neutre).
- **⑤ [MOYEN] `pp-build` — purge totale du cache + reload à chaque navigation croisée** (liens↔app, km↔v) : la constante de build divergeait entre pages (même clé localStorage) → purge/reload inutiles. Normalisée sur le build unique (la fraîcheur après déploiement reste assurée par la sonde `version.json` + le Service Worker).
- **⑥ Tableau de bord — KPI km figés** : les raccourcis « Km en lot / par photo » émettent `fp:veh-km` (pas `fp:data-ready`) → « Km total » et « N à compléter » ne se rafraîchissaient qu'après F5. Listener `fp:veh-km` ajouté.
- **⑦ Perf à l'échelle (×10)** : `FP.derniereRevisionInfo` (santé véhicule, tableau de bord) et `FP.santeConducteur` (grille conducteurs) rebalayaient TOUTE la table factures **par entité** (O(véhicules×factures)). Nouvel **index plaque→factures mémorisé** (`FP.facturesParImmat`, invalidé à chaque écriture de factures) → une seule construction par rendu. + `FP.coutMois` ne redédoublonne plus 14× sur le tableau de bord.
- **⑧ Permis (en-tête fiche conducteur)** : puce « valide/expiré » calculée à l'heure courante → « expiré » le matin du jour J alors que le détail le disait valide. Passée à `FP.joursRestants` (minuit→minuit).
- **⑨ Recherche Amendes** débouncée (180 ms) comme la page Factures.
- **⑩ Scanner hors-ligne** : ne redirige plus vers `login.html` (qui a besoin du réseau) sur un simple token expiré hors-ligne (même garde que le dashboard).
- **⑪ Barème** (`bareme.js`) : l'échec de synchro n'est plus **avalé** → erreur visible (`FP.notifyError`).
- **⑫ `docRequis` / `automations`** ajoutés à `COLLECTION_KEYS` (fusion fine par id, comme `customFields`) → plus d'écrasement en bloc si deux appareils éditent ces listes en même temps.
- Laissés (faibles/atténués/risqués) : repli `Math.max` du scanner générique (neutralisé par lecture par libellé), lecture Total Fleet par ordre de fragments (OK sur le gabarit connu), seuil de couleur « fin de leasing » 90/180 vs 30/60 (décision métier), rappels CT-veille/Ulys côté Edge (double-envoi seulement sur retry cron), quelques `aria-label` de boutons « fermer ».
- Fichiers : `app.js` (+min), `bareme.js`, `scanner/statistiques/vehicules/conducteurs/amendes.html`, `dashboard.html`, + normalisation `pp-build` sur 37 pages. bump `?v= 20261026h → 20261026i`. check-bugs OK, test-calculs 33/33.

### 26/10/2026 — Audit profond #2 (8 auditeurs) : 11 correctifs de fiabilité
Deuxième passe complète (8 auditeurs parallèles), chaque trouvaille vérifiée dans le vrai code. Verdict d'ensemble : plateforme **très solide** (sécurité, isolation, synchro « exceptionnellement blindées », OCR verrouillé, source unique largement respectée). **11 vrais problèmes corrigés** :
- **① Documents perso d'un conducteur effacés à tort** (`conducteurs.html`) : « Supprimer » un conducteur lié à des véhicules/amendes = **masquage réversible**, mais `condDocsRemove` tournait quand même → effaçait ses pièces d'identité (CI, titre de séjour) et **dé-masquait son n° de permis**. Déplacé en suppression **définitive** uniquement.
- **② Revenants (élément supprimé qui « flashe » au rechargement)** : amendes/factures/conducteurs mutaient la mémoire + Supabase mais pas le cache société (`fp_data_cache_v4`) → le 1er rendu de la page suivante réaffichait l'élément supprimé. Corrigé **à la source unique** : `FP.persist` resynchronise le cache après chaque écriture des 4 tables (débounce + flush au départ de page).
- **③ Relevé km/EDL par QR pouvait écraser une sauvegarde de réglages** (`km-collect`) : l'ajout d'inspection réécrivait tout le blob `app_settings` **sans compare-and-swap** → un réglage enregistré par un gestionnaire au même instant pouvait être perdu. Ajout d'une **boucle CAS sur `rev`** (même garde que le client).
- **④ Facture contrat-cadre — PDF non joint en silence** (`contrats.html`) : si le téléversement du PDF échouait, l'app affichait quand même « ✓ Contrat lu ». Alerte visible ajoutée (« PDF non joint — rattache-le »).
- **⑤ Signature EDL — état non vérifié** (`edl-sign`) : l'enregistrement de la signature n'était pas contrôlé → un « ✓ signé » pouvait mentir (signataire re-sollicité). Erreur vérifiée (code `sign_save`) + log de l'insert `documents`.
- **⑥ Suppression de compte — profil orphelin** (`manage-users`) : la suppression de la ligne `profiles` n'était pas vérifiée. Erreur désormais remontée.
- **⑦ « Coût du mois » de la page Factures ≠ « Coûts du mois » du tableau de bord** (même libellé, 2 chiffres) : la tuile Factures comptait tous les types (achat/leasing/sinistre), le dashboard seulement l'exploitation. Tuile renommée **« Facturé ce mois »** + infobulle explicative (plus de collision).
- **⑧ Assurance/AEN — alignement `horsFlotte`** : Budget/Contrats (prime d'assurance, TVS) et l'AEN excluaient seulement `vendu` (`FP.estVendu`) alors que les Statistiques excluent tout véhicule **sorti de flotte** (`FP.horsFlotte` = vendu/cédé/restitué/HS/archivé). Alignés → mêmes chiffres partout ; corrige aussi l'incohérence interne de l'AEN (compteur ≠ total).
- **⑨ Compteurs véhicules tolérants** (`vehicules.html`) : « actifs »/« en entretien » comparaient le statut en **exact** (`=== 'actif'`) → un « Actif »/« ACTIF » importé disparaissait du compteur. Comparaison tolérante (min/espaces).
- **⑩ Boutons Désigner/Contester d'une amende** (`amendes.html`) : comparaison de statut exacte (accents/casse) → pouvaient réapparaître sur une amende déjà désignée/contestée. Rendue tolérante (comme `FP.estPayee`).
- **⑪ Durcissements** : `esc()` de `fleet-views.js` échappe aussi les guillemets (XSS défense en profondeur, iframe facture) ; inputs photo (portail + EDL) acceptent explicitement **HEIC/HEIF** (iPhone) ; suppression de factures en lot purge aussi `revisionOverride` (symétrie avec l'unitaire).
- Laissés (faibles, atténués/non atteignables) : repli `Math.max` TTC du lecteur OCR local (IA + lecture par libellé priment, l'utilisateur relit les champs), montant d'amende non majoré dans le **portail conducteur** (v.html ne charge pas app.js), inserts véhicule contrats/Sanef hors `FP.dupe` (anti-doublon inline présent).
- Fichiers : `app.js` (+min), `fleet-views.js` (+min), `conducteurs/factures/vehicules/amendes/contrats/budget.html`, `v.html`, Edge `km-collect`/`edl-sign`/`manage-users`. bump `?v= 20261026g → 20261026h`. check-bugs OK, test-calculs 33/33.

### 26/10/2026 — Audit complet (8 auditeurs) : 13 correctifs de fiabilité
Audit systématique (8 domaines, chaque trouvaille vérifiée dans le vrai code avant correction — 0 faille XSS, 0 régression critique). **13 vrais problèmes corrigés** :
- **① Perte de conducteurs possible** (`supabase-client.js`) : un blip réseau sur la **seule** table `conducteurs` renvoyait `[]` → l'écran et le cache pouvaient être vidés (« 46 → 0 »). Désormais `null` en cas d'erreur → les conducteurs déjà chargés sont **préservés** (gardes `Array.isArray` + repli `window.FP_DATA` dans `_writeDataCache`).
- **② Relevé km du portail — échec silencieux** (`km-collect`) : les écritures (fiche véhicule + journal) ne vérifiaient pas l'erreur → un « ✓ enregistré » pouvait **mentir**. Contrôle ajouté → code `km_save` + message **traduit** (6 langues) côté `v.html`/`km.html`.
- **③ Sinistres — KPI « Reste à charge »** : comptait `coûtRéel − remboursé` à la main → ignorait la **franchise** d'un dossier pris en charge. Passé à la source unique `FP.sinistreResteIncident` (comme la carte + Statistiques).
- **④ Statistiques — véhicules sortis de flotte** : le podium coût/km, le KPI coût/km et le tableau TCO filtraient `FP.estVendu` (vendu seulement) → un véhicule **cédé/restitué/HS** restait compté. Aligné sur `FP.horsFlotte` (même périmètre que l'annulation des charges).
- **⑤ Fiche véhicule — « Dépensé {année} »** : le reste à charge sinistre était sommé **facture par facture** (le remboursement, saisi **par incident**, n'était pas déduit) → total surévalué vs TCO/Budget. Passé en bloc à `FP.resteChargeSinistre`.
- **⑥ État des lieux — photos non envoyées en silence** (`vehicules.html`) : si une photo échouait à l'upload, le toast affichait quand même « ✓ » → alerte `FP.notifyError` ajoutée (« N photo(s) non envoyée(s) »).
- **⑦ Documents véhicule non rechargés** (`vehicules.html`) : `loadVehDocs()` ne tournait qu'à l'init (avant l'auth) → carte grise/EDL/docs pouvaient rester invisibles. Rechargés sur `fp:data-ready`.
- **⑧ Suppression véhicule durable** (`vehicules.html`) : passait par `FP.db.delete` (perdue si navigation immédiate) → passée par `FP.persist.delete` (file durable + corbeille).
- **⑨ MAJ km en lot (tableau de bord)** : copie locale divergente de `FP.setVehKm` (pas d'override local, pas d'événement, `kmDernierReleve` non recalé) → déléguée à l'écrivain canonique `FP.setVehKm` (source unique).
- **⑩ Camembert factures (stats)** : libellés via un helper inexistant → nouveau `FP.factureTypeLabel` (source unique code → libellé).
- **⑪ Facture — édition de la description** (`factures.html`) : n'relançait pas le recalcul de la fiche véhicule → « dernière révision »/date pneus figées (ces champs sont détectés sur la **description**). `description` ajoutée au déclencheur.
- **⑫ Infobulles stats** corrigées (leasing compté dans le coût d'usage/km, retiré de la liste des ajouts TCO).
- **⑬ Alerte « PDF contrat leasing manquant »** (`notifications.html`) : lisait `leasingDocs` par clé brute (`.toUpperCase()`) → un PDF déjà joint était vu « manquant » selon le format de plaque. Lecture tolérante `FP._mapGetImmat`.
- Fichiers : `supabase-client.js`, `app.js` (+min), `km-collect`, `v.html`, `km.html`, `vehicules.html`, `factures.html`, `notifications.html`, `sinistres.html`, `statistiques.html`, `dashboard.html`. bump `?v= 20261026f → 20261026g`. check-bugs OK, test-calculs 33/33.

### 26/10/2026 — Lot ergonomie 3 (finitions portail + sinistres)
- **Portail conducteur** — messages d'erreur du relevé km **traduits** (6 langues) : l'Edge `km-collect` renvoie un **code** (`km_invalid`/`km_lower`) + repli FR, traduit côté `v.html`/`km.html` (fini la phrase en français qui surgit pour un conducteur étranger). · **Anti-spinner infini** : le chargement a un **délai max (~12 s)** → bascule sur l'écran d'erreur avec un bouton **« Réessayer »** (multilingue) au lieu d'un spinner sans fin sur réseau faible.
- **Sinistres** — nouveau filtre **« Clôturés »** (compteur inclus) pour isoler les dossiers terminés.
- **Statistiques — véhicules VENDUS exclus** (demande utilisateur) du **podium coût au km**, du **KPI « Coût d'usage / km »** (numérateur factures ET dénominateur km) et du **tableau TCO** (flag `vendu` sur chaque ligne TCO + filtre). · **Correctif AEN** : `FP.aenAnnuelFlotte` excluait seulement par nom de chauffeur → un véhicule **vendu** avec un chauffeur réel restait compté dans l'avantage en nature ; il est désormais exclu sur le même périmètre que la TVS/assurance (`FP.horsFlotte`). La **TVS excluait déjà** les vendus (inchangée).
- `supabase/functions/km-collect/index.ts` (déployé auto à la fusion) + `v.html`/`km.html` + `sinistres.html` + `statistiques.html` + `app.js`. bump `?v= 20261026e → 20261026f`. check-bugs OK, test-calculs 33/33.

### 26/10/2026 — Lot ergonomie 2 (audit parcours « clients » : portail, sinistres, stats)
Second audit (portail conducteur, sinistres, statistiques/TCO) → corrections. Décisions utilisateur : **compter la franchise**, **portail gardé ouvert**, **podium gardé**.
- **Sinistres** — **la franchise est désormais comptée** dans le reste à charge : un sinistre « pris en charge » avec 500 € de franchise affiche **500 €** (plus « 0 € » trompeur). Source unique `FP.sinistreResteIncident` (agrégat KPI + carte). · Saisir un **« Remboursé » > 0** bascule **auto** le statut sur « Remboursé » (fin des statuts contradictoires). · La **mini-timeline du dossier est toujours visible** sur la carte (avant : cachée dans un volet replié). · Recherche élargie (**conducteur, n° de dossier, tiers**). · Bouton du haut renommé **« Nouveau sinistre (par sa facture) »** (évite le doublon avec « Déposer la facture » d'un sinistre déjà déclaré).
- **Statistiques / TCO** — infobulles **ⓘ** sur **TVS**, **Avantage en nature** et **Coût d'usage/km** (vs €/km TCO « tout compris » du classement) — fin de la confusion « 3 coûts au km ». · Sous-titre sous le filtre Période (ce qu'il recalcule vs l'état actuel). · Camembert « Répartition par type » avec de **vrais libellés** (`FP.factures.typeLabel`, fini « ulys »/« reparation »).
- **Portail conducteur (mobile)** — **garde-fou faute de frappe** sur le relevé km : un saut énorme (ex. un zéro en trop) demande une **confirmation douce** multilingue avant d'écraser la fiche (`v.html` + `km.html`). · Icône du relevé km **📸 → 🔢** (c'est une saisie, pas une photo).
- Restent proposés (Lot 3) : messages d'erreur serveur traduits (Edge `km-collect`), spinner « Réessayer » si réseau lent, et finitions sinistres (clôturer sur la carte + filtre « clôturés », regroupement des boutons de documents).
- `app.js` + sinistres/statistiques.html + `v.html`/`km.html` ; rebuild min, bump `?v= 20261026d → 20261026e`. check-bugs OK, test-calculs 33/33. Aucune modification Supabase.

### 26/10/2026 — Lot ergonomie 1 (audit facilité d'utilisation)
Suite à un audit parcours-par-parcours (ajout véhicule, amende, restitution, prévenir un conducteur, comptes), corrections de friction, toutes sûres, sans toucher la logique métier :
- **Amendes** — le bouton « Prévenir » propose désormais les **3 canaux** (SMS + WhatsApp + **E-mail**) dans la même fenêtre (règle 0septies respectée partout) · le **n° d'avis n'est plus obligatoire** pour une amende **étrangère** (plus de blocage navigateur) · une ligne **« 3 tarifs lus »** (minoré/forfaitaire/majoré, retenu en gras) s'affiche sous le montant après un scan, pour vérifier d'un coup d'œil · placeholder conducteur clarifié.
- **Véhicule (ajout)** — à la **création**, une seule zone « Importer la carte grise » (les imports en lot + autre document sont masqués, réapparaissent en édition) · champs **anti-pollution** réordonnés (« dernier réalisé le » d'abord → « prochaine échéance » calculée) · **garde-fou société** déplacé **avant** l'ouverture du formulaire (plus de carte grise uploadée pour rien).
- **Restitution / EDL** — le libellé de date suit le type (« Date de **restitution** » quand c'est une sortie) · checklists renommées **« Remise — je donne la voiture »** / **« Reprise — je récupère la voiture »**.
- **Comptes** — les boutons d'action (réinit. e-mail / définir mot de passe / supprimer) ont un **libellé texte** (plus d'icône seule ambiguë) · **« ✓ Accès mis à jour »** après un changement de rôle · rôles **CEO** et **chauffeur** expliqués.
- `app.js` + amendes/vehicules/parametres.html ; rebuild min, bump `?v= 20261026c → 20261026d`. check-bugs OK, test-calculs 33/33. Aucune modification Supabase.

### 26/10/2026 — Bulles repliables (fiches conducteur & véhicule)
- Sur la fiche **véhicule** et la fiche **conducteur**, chaque rubrique (bulle) se **replie/déplie** d'un clic sur son titre (flèche à droite). **Ouvertes par défaut** (rien de caché) ; l'état replié est **mémorisé par appareil** (localStorage) et re-appliqué à l'ouverture suivante. Demande utilisateur (uniformité avec la bulle « États des lieux »).
- **Source unique** : helper `FP.makeCollapsible(card, scope)` (app.js) appliqué à chaque bulle connue des deux fiches (aucun scan DOM hasardeux). Gère le `<details>` natif (EDL) ET les bulles en `<div>` (contenu enveloppé dans `.fp-coll-body`). Un clic sur un élément interactif du titre ne replie pas. CSS commun dans `styles.css`. Ne casse ni la mise en page 3 colonnes ni les formulaires (congés…). `app.js` + `styles.css` + 2 fiches + manuel ; bump `?v=` `20261026b → 20261026c`.

### 26/10/2026 — Correctifs : attribution EDL sur borne partagée + alertes périmées au tableau de bord
- **États des lieux — borne partagée (bug signalé)** : une restitution datée le **jour de fin** d'une période (= jour de début de la période suivante, ex. Samira finit le 23/10 / Enguerrand commence le 23/10) était rattachée au **mauvais conducteur** (le suivant). Nouvelle règle **source unique** `FP.edlHisto.appartientSens(date, sens, période)` : une **restitution** sur une borne appartient à la période qu'elle **clôt** (fin), une **remise** à la période qu'elle **ouvre** (début). Appliquée partout : fiche véhicule (`parVehicule`), fiche conducteur (`parConducteur`) **et** l'affectation du km (`applyEdlKm` → le km de restitution va bien sur `kmFin` de la bonne période). Repli sûr sur l'ancienne logique quand la borne n'a pas de voisin concurrent (pas d'orphelin).
- **Tableau de bord — anciennes alertes qui restaient (bug récurrent, sur PC)** : au **retour au 1er plan** (focus / changement d'onglet / « précédent » via bfcache), seuls les **réglages** étaient re-synchronisés (`FP.refreshSettings`) — **pas les données** (tables véhicules/amendes/factures). Une action faite ailleurs qui vit dans une table (amende traitée, EDL, facture…) restait donc affichée jusqu'à un **F5**. Ajout de **`FP.refreshData()`** (re-télécharge les tables, ré-émet `fp:data-ready` **seulement si ça change** → aucun clignotement) câblé sur focus/visibilité/bfcache, à côté de `refreshSettings`. Les sources d'alertes async du tableau de bord (EDL en attente de signature, demandes d'achat) sont aussi rechargées au retour au 1er plan. Signature de données **extraite en helper unique** (`_fpDataSig`) partagée entre le chargement et la re-synchro.
- Aucune modification Supabase. `app.js` + `supabase-client.js` + `dashboard.html` ; rebuild min OK, `check-bugs` vert, `test-calculs` 33/33. Bump `?v=` `20261023d → 20261026a`.
- **Suivi (même jour) — attribution EDL fiable quel que soit le mode de saisie** : la restitution **signée sur place** enregistrait sa date au **format français** dans le libellé du document (`23/10/2026`), alors que `FP.edlHisto.dateDe` ne lit qu'une date **ISO** → il retombait sur la **date d'upload (aujourd'hui)** et classait l'EDL chez le **mauvais conducteur** (régression indépendante de la règle de borne). Correctifs : (1) les documents EDL signés sur place **et leurs photos** encodent désormais la **date ISO** dans le libellé (même convention que l'import PDF) ; (2) `dateDe` lit **aussi** une date française `JJ/MM/AAAA` en repli → **répare rétroactivement** les EDL déjà enregistrés sans avoir à les refaire. `app.js` seul ; bump `?v=` `20261026a → 20261026b`.

### 21/10/2026 — Vue « Galerie » 3D : flèches clavier partout, podium Amendes, Tableau de bord
- **Moteur unique `FP.galerie3d`** (app.js) : les **flèches ← → du clavier** pilotent désormais l'anneau **sous la souris** ou, à défaut, l'anneau **au centre de l'écran** — plus besoin de survoler d'abord (demande utilisateur « flèches partout »).
- **Page Amendes** : le **podium des conducteurs** a un sélecteur **Liste / Galerie** (Liste par défaut = comme avant). Les deux vues lisent la **même source** (`podiumRows()`) ; un clic (ligne ou carte) filtre les amendes sur la personne.
- **Tableau de bord** : le camembert **« Véhicules par groupe » retiré** ; le **podium conducteurs — amendes** reste **affiché par défaut** (pleine largeur) ; la bulle **« Véhicules » passe en Galerie 3D** (mêmes infos que les bulles).
- Aucune modification Supabase. `app.js` (moteur) + 3 pages HTML + manuel ; rebuild min OK, `check-bugs` vert. Vérifié par test navigateur (Playwright) : galeries montées, rotation, clics, 0 erreur JS.

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

### 20/10/2026 — Migration des données, étape 7 : les sinistres ✅ (en production)
- **Quoi** : le suivi des sinistres : statuts, étapes, groupes, suivi d'assurance (franchise, clôture…), sous-dossiers, classement des documents et liste des dossiers. En production : 30 statuts, 5 suivis d'assurance, 2 groupes, 58 dossiers.
- **Sur la table générique**, sans nouvelle table ni page modifiée : toutes les écritures passent déjà par l'enregistrement des réglages. Les listes de plaques gardent désormais leur **ordre d'affichage**.
- **Tests** : 3 tests automatiques de plus (21 au total) et le test du staging élargi aux sinistres.
- **Mis en production le 20/10/2026** : liste des données acceptées élargie, puis recopie lancée par François : 30 statuts, 5 suivis d'assurance, 2 groupes, 58 dossiers, 0 écart.
- **Note** : la recopie des assurances, déjà appliquée, donnait l'ordre 0 aux « plaques ignorées » (vides en production). Si elle était relancée, l'application rectifierait l'ordre au premier enregistrement, sans perte.

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
| #1040 | Migration des données, étape 7 : les sinistres | ✅ Fusionnée, en production |

## 7. Prochaines étapes

1. ✅ ~~Mise en production de l'anti-vidage des réglages~~ : fait le 17/10/2026.
2. ✅ ~~Vérification visuelle et cloisonnement des fichiers~~ : fait le 17/10/2026.
3. ✅ ~~Sauvegardes~~ : actives chaque nuit depuis le 20/10/2026. Restent : remplacer la clé provisoire de Shakil, puis un test de restauration complet par un humain.
4. **GitHub** : préparé le 20/10/2026 (voir le journal). Reste la protection de la branche principale, à activer par Shakil.
5. **Migration des données**, une à une, du gros bloc de réglages vers de vraies tables. **Étape 1, les congés** : ✅ en production depuis le 20/10/2026 (PR #1014). **Étape 2, les affectations** : ✅ en production depuis le 20/10/2026 (PR #1019). **Étape 3, les contrats LLD** : ✅ en production depuis le 20/10/2026 (PR #1025). **Étape 4, les forfaits de leasing** : ✅ en production depuis le 20/10/2026 (PR #1034). **Étape 5, les assurances** : ✅ en production depuis le 20/10/2026 (PR #1037). **Étape 6, les tâches** : ✅ en production depuis le 20/10/2026 (PR #1038). **Étape 7, les sinistres** : ✅ en production depuis le 20/10/2026 (PR #1040). Ensuite : assurances, tâches, sinistres… Suppression enfin du système de fusion maison.
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
