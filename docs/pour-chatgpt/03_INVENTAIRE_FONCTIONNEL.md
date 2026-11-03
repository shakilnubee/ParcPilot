# 03 — Inventaire fonctionnel (par page / module)

> Instantané 03/11/2026, lecture seule. Légende `[VÉRIFIÉ]` / `[DOC]` / `[HYPOTHÈSE]`.
> Toutes les écritures passent par **`FP.persist`** (file durable optimiste) avec repli `FP.db` / `FP.supabase.from(...)`. Les réglages/maps de travail passent par **`FP.settings`** (table `app_settings` par société) et/ou les tables dédiées migrées (cf. `04`).

---

## A. Pages du cœur métier

### A.1 `pages/vehicules.html` (~8225 l.) — Véhicules
**Rôle** : référentiel central de la flotte (liste/fiches, affectations, documents, QR, scan, envois). `[VÉRIFIÉ]`
**Fonctionnalités** : vues tableau / cartes / **galerie 3D** (`FP.galerie3d.mount`) ; onglets par groupe avec **drag&drop** ; barre de filtres + reset (`FP.filterResetButton(onReset:resetVehFilters)`) ; **CRUD** véhicule (`FP.persist.insert/update/delete('vehicules')`, suppression restaurable/Corbeille) ; **anti-doublon** sur immatriculation (`FP.dupe`) ; **scan IA** carte grise unitaire+lot (`FP.CG_SCAN_PROMPT`), assurance, contrôle technique, factures, mémo ; bouton « Compléter cartes grises » (relit CG stockées → CO₂/puissance/masse/VIN/dates) ; **affectations** conducteur↔véhicule (`FP.conducteurPicker`) ; **QR** générateur unique `buildQrCanvas`+`renderQrCard` (PNG/impression) + hub QR ; **exports** fiche PDF, fiche vente PDF, relevé PDF/Excel, fiche groupe PDF, comparateur 2 véhicules ; **envois groupés 3 canaux** (`FP.msg.open` : relevé km, accès QR, message libre, RDV) ; logique **stationnement gratuit Paris** (`parkingParis`). `[VÉRIFIÉ]`
**Tables** : `vehicules`, `documents`, `app_settings` (affectations, km, masse, notes…), storage `scans`. `[VÉRIFIÉ]`
**Connexions** : socle de toutes les pages (clé immatriculation) ; chauffeur propagé vers `amendes.prenom` et `vehicules.chauffeur`. `[VÉRIFIÉ]`

### A.2 `pages/conducteurs.html` (~3457 l.) — Conducteurs
**Rôle** : annuaire conducteurs (fiches, permis, documents, affectations), forte attention RGPD/PII. `[VÉRIFIÉ]`
**Fonctionnalités** : grille cartes + galerie 3D ; recherche + reset ; **CRUD** (`FP.persist.upsert/update/delete('conducteurs', key)`) ; **renommage propagé** (`applyRename` met à jour `vehicules.chauffeur` + `amendes.prenom` et migre les données keyées via `FP.migrateCondKey`/`purgeCondKey`) ; **permis + scan IA** (`FP.scanIA(file,'permis')`), relecture en masse, masquage permis (`permisMasque`) ; création (`FP.newConducteurModal`/`FP.conducteurs.create`) ; **message de bienvenue 3 canaux** ; exports PDF/CSV ; **RGPD** : liste `_PII_FIELDS` nettoyée aux exports/cache. `[VÉRIFIÉ]`
**Tables** : `conducteurs`, `documents` (lecture), `vehicules`/`amendes` (propagation), `app_settings` (permisMasque, condDocs, congés via `FP.congesTable`), storage `scans`. `[VÉRIFIÉ]`
**Connexions** : pivot affectations/amendes/congés/péages/sinistres ; clés résolues par `FP.prenomDeCle`/`condKeyParNom`. `[VÉRIFIÉ]`

### A.3 `pages/amendes.html` (~3471 l.) — Amendes & contraventions
**Rôle** : gestion des avis ANTAI (import/scan, désignation conducteur, statut, paiement, e-mails). `[VÉRIFIÉ]`
**Fonctionnalités** : tableau + cycle de statut (payée/contestée/à payer/désignée, suppression restaurable) via `FP.persist.update('amendes')` ; ajout avec `FP.dupe.confirmAdd` ; **parseur dédié `parseAvis`** lisant les **3 montants** (minoré/forfaitaire/majoré), détection majoration par **titre dédié uniquement** (`/avis de majoration/i`), **anti-piège `Math.max`** (conforme CLAUDE.md) ; repli IA `FP.scanIA(file,'amende')`, télépaiement, justificatif ; **détection doublon en direct** (`checkDoublonLive`) ; `FP.searchSelect` + `FP.conducteurPicker` ; **envoi 3 canaux** + e-mails d'amende (expéditeur PXP figé, `avis.html`) ; exports Excel/CSV/période + **ZIP des avis PDF par conducteur**. `[VÉRIFIÉ]`
**Tables** : `amendes`, `conducteurs` (lecture), `app_settings` (montant payé, watch justif), storage `scans`. `[VÉRIFIÉ]`
**Connexions** : conducteur (prénom/désignation), véhicule (`FP.vehByImmat`), dashboard/stats (montants dus via `FP.montantDu`/`FP.estAPayer`). `[VÉRIFIÉ/HYPOTHÈSE usage helpers]`

### A.4 `pages/factures.html` (~3048 l.) — Factures
**Rôle** : factures fournisseurs + notes de frais + archives documentaires + fournisseurs. `[VÉRIFIÉ]`
**Fonctionnalités** : 4 onglets (Factures / Notes de frais / Documents / Fournisseurs) ; **CRUD** (`FP.persist` + helper `FP.persistFacture`), corbeille restaurable ; **scan IA facture** + repli OCR Tesseract (notes de frais), **contrôle HT+TVA=TTC** ; **anti-doublon** (n° + TTC) ; notes de frais (source `note-frais`) comptées dans coût véhicule/TCO ; mini-Drive Documents (CRUD `documents`, scan+upload) ; `FP.searchSelect` (filtres véhicule) + picker conducteur ; exports CSV (HT/TVA/TTC/Km) + **ZIP des PDF par véhicule**. `[VÉRIFIÉ]`
**Tables** : `factures`, `documents`, storage `scans`, `app_settings`. `[VÉRIFIÉ]`
**Connexions** : véhicule (coût/TCO), entretiens (factures d'entretien), sinistres (`type='sinistre'`), conducteur (notes de frais, Ulys). Lien Drive par `file_id`. `[VÉRIFIÉ]`

### A.5 `pages/entretiens.html` (~1165 l.) — Entretiens & maintenance
**Rôle** : suivi entretiens/révisions + répertoire garages/prestataires. `[VÉRIFIÉ]`
**Fonctionnalités** : tableau (les entretiens **sont des factures filtrées** sur `data.factures`) ; MAJ véhicule (`FP.persist.update('vehicules', {derniereRevision, kmDernierReleve})`) ; suppression/restauration ; garages éditables inline + **scan IA garage** + ajout prestataire + `FP.searchSelect` ; **rappel 3 canaux** ; filtres + reset ; export CSV. `[VÉRIFIÉ]`
**Tables** : `factures`, `vehicules` (update révision/km), `app_settings` (garages/prestataires), storage `scans`. `[VÉRIFIÉ]`
**Connexions** : dérivé de `factures` ; met à jour `vehicules` → dashboard + alertes CT/révision. `[VÉRIFIÉ]`

### A.6 `pages/sinistres.html` (~2908 l.) — Sinistres & incidents
**Rôle** : sinistres/incidents (déclarations portail, dossiers par véhicule, constats, factures réparation, remboursements). `[VÉRIFIÉ]`
**Fonctionnalités** : **déclarations conducteur** lues depuis table dédiée `declarations_conducteur` (affichées en tête ; MAJ statut/réponse/suppression) ; sinistres = factures `type='sinistre'` ; **scan IA** constat (`FP.constatPrompt(immat)`), courrier assureur, factures réparation ; dossiers/sous-dossiers par véhicule + vignettes, documents `type='sinistre-doc'` ; anti-doublon factures ; **podium conducteurs** ; KPI « Remboursé par l'assurance » ; filtres + reset, `FP.searchSelect`, `FP.conducteurPicker` ; **Rapport PDF** (générateur `DeclCond.exportPdf`, refondu 03/11 : format « Déclaration », pièces jointes scopées à l'incident — cf. 07) ; export CSV. `[VÉRIFIÉ]`
**Tables** : `declarations_conducteur`, `factures`, `documents`, `app_settings`/`settings_items` (statut/stage/groupes/dossiers), storage `scans`. `[VÉRIFIÉ]`
**Connexions** : véhicule (dossier par immat), conducteur (responsable/podium), factures (réparations), portail `v.html` + Edge Functions (déclarations + photos EDL). `[VÉRIFIÉ]`

### A.7 `pages/contrats.html` (~5686 l.) — Contrats
**Rôle** : engagements financiers (leasing/LLD, assurance, contrats cadre, archives, TVS, restitutions, offres acheteurs). `[VÉRIFIÉ]`
**Fonctionnalités** : 4 sous-onglets (Leasing / Assurance / Contrats cadre / Archive), ordre persistant ; **Leasing/LLD** lu via helper canonique `FP.leasingContrat(immat)`, écrit **obligatoirement** via `FP.contratsLLD.sauver` → table `lease_contracts` ; **lecture déterministe de PDF par position** (`etatParcPdfText`, `localeasePdfToText`/`parseLocaleaseOffer`, gabarits BPCE/Ayvens) + repli `FP.scanIA` (`etat-parc`/`leasing`/`contrat-leasing`/`contrat-cadre`/`devis-*`) ; **Assurance** (primes `assurancePrimes`, `assureurVeh`/`setAssureurVeh`, tri) ; **TVS** via helper canonique `FP.tvsDetail` + `FP.tvsAnnuelleFlotte` ; **restitutions LLD** (checklist) ; création véhicule depuis contrat (`autoCreateVeh`/« to fleet ») ; **offres acheteurs** (recontact `FP.msg.open`) ; archives/documents (suppression storage). `[VÉRIFIÉ]`
**Tables** : `vehicules`, `documents`, `app_settings` + tables migrées `lease_contracts` / `lease_overrides` (via `FP.contratsLLD`/`FP.forfaitsLeasingTable`), storage `scans`. `[VÉRIFIÉ / DOC]`
**Connexions** : véhicule (leasing/assurance/TVS → fiche + stats/TCO + dashboard), factures (coûts), a-vendre (offres). `[VÉRIFIÉ]`

#### Synthèse cœur métier `[VÉRIFIÉ par l'exploration du code]`
- **Source unique respectée** : plaques (`FP.normImmat`/`immatEq`/`vehByImmat`), conducteurs (`FP.prenomDeCle`/`conducteurPicker`/`condKeyParNom`), leasing (`FP.leasingContrat`), TVS (`FP.tvsDetail`), QR (`renderQrCard`).
- **Scan IA centralisé** : moteur unique `FP.scanIA(file, type, prompt)`, + parseurs déterministes par position pour PDF à couche texte (`parseAvis`, `etatParcPdfText`, `localeasePdfToText`).
- **Exports** : PDF via `FP.ensureJsPDF` (jsPDF paresseux), CSV via `FP.csv` (+ `FP.makeExportMenu`), ZIP de pièces (amendes, factures).
- **Aucun `TODO`/`FIXME`/handler orphelin** détecté dans ces 7 pages → code mature. Pas de conclusion d'incomplétude faute de preuve.

---

## B. Pages secondaires & tableau de bord `[VÉRIFIÉ]`

**Infra commune** (pages `pages/*` + dashboard) : garde d'auth synchrone dans `<head>` (token `sb-tzjuptlzoywjeigmyfuj-auth-token` → `login.html`, tolérante hors-ligne) ; sidebar reconstruite avant 1er affichage depuis `localStorage` (`navOrder`/`navHidden`/`sidebarLabels`) ; `FP_DATA` peuplé depuis le cache `fp_data_cache_v4_<societe>` (repli `data.js`) ; re-render sur `fp:data-ready` ; thème sombre `fp-dark`.

- **`dashboard.html`** — Tableau de bord. KPIs (véhicules, conducteurs, amendes à payer, **coût d'exploitation du mois** + sparkline, alertes) ; sélecteur **société** (multi-tenant), **Mode écran** (`pages/ecran.html`), **Raccourcis** personnalisables, **Scanner un document** (→ `pages/scanner.html`), modales (km en lot, **km par photo du compteur** OCR, immobiliser, congé), widgets réordonnables/masquables (coûts, podium&tâches, alertes, santé, emprunts). Lit `controle_findings` (KPI alertes). Helpers : `FP.coutMois`, `FP.montantDu`, `FP.buildEcheances`, `FP.scanIA`. *(Un ancien scanner-modale subsiste **dormant**, activé seulement si `#btn-scan-doc-classic` existe.)* `[VÉRIFIÉ]`
- **`pages/statistiques.html`** — Analyse dépenses/fournisseurs + **TCO par véhicule**. Filtre période, **Rapport de direction**, 4 graphiques Chart.js (mois/type/fournisseurs/société). Helpers canoniques `FP.dedupeFactures`/`coutFactureExploit`/`resteChargeSinistre`/`tvsDetail`/`assuranceAnnuelle`. TCO exclut prix d'achat et cessions. Pas de table directe (lit `FP_DATA`). `[VÉRIFIÉ]`
- **`pages/budget.html`** — Budget prévisionnel par poste (Prévu/Réel/Écart) + prévision trésorerie 12 mois + objectifs. Relevé PDF + Export Excel. Postes via `FP.leasingAnnuelFlotte`/`assuranceAnnuelle`/`tvsAnnuelleFlotte`/`montantDu`. Prévu/objectifs dans `app_settings` (clés `budget`, `objectifs`). `[VÉRIFIÉ]`
- **`pages/notifications.html`** — Suivi & alertes. Onglets : Alertes, Relances, Relevé km, Renouvellements, **À compléter** (checklist infos manquantes véhicules/conducteurs/amendes/config, chaque ligne cliquable), Suivi flotte, Décisions. `FP.buildEcheances` + `FP.buildAlertes`. Purge doublons de documents (`FP.db.delete('documents')`). `[VÉRIFIÉ]`
- **`pages/taches.html`** — Tâches & RDV. 3 vues (liste/kanban/calendrier), modèles, **rappels récurrents**, génération auto de tâches (entretien/CT/révision, anti-doublon `tachesAutoFaites`), relance conducteur 3 canaux. Données : `settings.taches`/`rappelsPerso`/`tachesAutoFaites` → table `settings_items`. `[VÉRIFIÉ]`
- **`pages/controle.html`** — Contrôle des consommations. Onglets Total Fleet / Ulys / Sanef + prestataires perso + **Contrôle** (anomalies). Détection centralisée `FP.consoPendantConge`/`consoApresDepart` ; `buildFindings` versionné (`DETECT_VERSION` + `_buildSig` incluant `FP.ASSET_VERSION`). Tables : `total_conso_tx`, `ulys_conso` (lecture paginée), **`controle_findings`** (cache du résultat, upsert `onConflict:'societe'`), `conducteurs`. Alimente le KPI alertes du dashboard. `[VÉRIFIÉ]`
- **`pages/emprunts.html`** — Emprunts + réservations internes + **demandes de réservation en ligne** (public). Modales (nouvel emprunt `FP.conducteurPicker`, retour, réserver), lien permanent public → `reserver.html`, Relevé PDF/Excel, anti-doublon `FP.dupe`. Table `emprunts` (cache `fp_emprunts_<societe>`), réservations dans `app_settings`, demandes publiques via Edge Function `reservation`. `[VÉRIFIÉ]`
- **`pages/a-vendre.html`** — Achat & vente. KPIs (valeur estimée/encaissé), cartes par véhicule (prix visé éditable, statut), **QR annonce de vente** (`v.html?vue=vente`), formulaire acheteur 3 canaux, **dossier d'achat** (crée le véhicule). `FP.estVendu` (source unique). Tables : `vehicules`, **`dossiers_achat`**. Offres publiques via Edge Function `offre-achat`. `[VÉRIFIÉ]`
- **`pages/calendrier.html`** — Calendrier mensuel des échéances (CT, anti-pollution, permis, pièces d'identité, fins de leasing). `FP.buildEcheances` (source unique) + `FP.joursRestants`. Pas de table directe. `[VÉRIFIÉ]`
- **`pages/renouvellements.html`** — Liste tabulaire filtrable des échéances (KPIs en retard / ≤30j / ≤90j, filtres + reset). `FP.buildEcheances`. `[VÉRIFIÉ]`
- **`pages/scanner.html`** — **Scanner IA v2** (dépôt en vrac, détection type → extraction → cohérence → validation humaine, pas d'auto-enregistrement). Moteur **`FP2`** = `assets/js/scanner2.js`. Bloque en vue « Toutes les sociétés ». Mode embarqué `?embed=1` (onboarding). `[VÉRIFIÉ]`
- **`pages/facturation.html`** — **Propriétaire (JIS)** : abonnements Parc Pilot par société cliente, MRR, factures PDF. Verrou `FP.isJisOwner`. Données `jis_billing` dans `app_settings`. `[VÉRIFIÉ]`
- **`pages/espace-salarie.html`** — Espace chauffeur (ses véhicules, échéances CT, dépôt photos/docs). ⚠️ **partiel/dormant** : rôle `chauffeur`/plaques encore dans `user_metadata`, sécurité serveur à construire avant activation (aucun compte chauffeur en prod) — cohérent avec CLAUDE.md. Table `documents`. `[VÉRIFIÉ]`
- **`pages/parametres.html`** — Configuration société + **gestion des comptes self-service**. Onglets : Groupes, Affichage, Champs perso, Documents obligatoires, Automatisations, Société (identité/assurance/AEN), E-mails, Données (sauvegarde/historique/export-import/sync/état IA/import Excel-CSV), Journal, Envois e-mails (`email-log`), Notifications (push), **Compte (Utilisateurs & accès → Edge Function `manage-users`)**. Assistant **Nouveau client**. Config gardée par `FP.canManageSociete()`, comptes par `FP.canManageUsers()` ; `gateParamForGestionnaire` masque la config aux gestionnaires. Tables : `app_settings`, `profiles` (via `manage-users`), `vehicules`. `[VÉRIFIÉ]`

## C. Portail conducteur & pages publiques `[VÉRIFIÉ]`

> Ces pages **ne chargent pas `app.js`** : elles parlent aux Edge Functions via `postJSON` avec la clé publishable (détail Edge Functions dans `05`).

- **`v.html`** — **Portail QR conducteur** (`?h=<token>`), multilingue FR/EN/ES/IT/DE/中文. Modes `&vue=vente`, `&vt=`, `&edl=`. Menu : Mon véhicule, Relever km, Mes documents, Mes amendes, **J'ai un problème** (sinistre guidé — catégorie + photos), Poser une question, Mes signalements (statut + modif tant que non traité), États des lieux (photos remise/restitution), Guide, À vendre. Tout via Edge Function **`km-collect`** (actions `myDeclarations`/`editDeclaration`/`question`/`edl`/km). `[VÉRIFIÉ]`
- **`reserver.html`** — Réservation publique (`?t=<token>`) en 3 étapes (dates → véhicules dispos avec galerie photos → coordonnées Prénom/Nom/e-mail/tél/motif, e-mail **ou** tél obligatoire). Edge Function **`reservation`**. `[VÉRIFIÉ]`
- **`km.html`** — Relevé km public (QR `?q=` ou lien e-mail usage unique `?t=`), 6 langues, garde-fou saut de km. Edge Function **`km-collect`**. `[VÉRIFIÉ]`
- **`signer.html`** — Signature électronique d'un EDL (`?t=<token>&who=employe|societe`), pad canvas tactile, **refus avec motif obligatoire**, téléchargement du PDF signé. Edge Function **`edl-sign`**. `[VÉRIFIÉ]`
- **`carte.html`** — Fiche véhicule publique (QR, lecture seule) via **RPC `vehicule_public_par_plaque`** (repli vue `vehicules_public`, puis `data.js`). `[VÉRIFIÉ]`
- **`avis.html`** — Avis de contravention public : ouvre le PDF via **lien signé temporaire** (bucket `scans` privé, sous-dossier `avis/`, 1h). `[VÉRIFIÉ]`
- **`onboarding.html`** — Outil **propriétaire** (garde OWNERS + `is_admin`) : checklists, dépôt en masse (iframe scanner), modèle d'e-mail. `[VÉRIFIÉ]`
- **`login.html`** — Auth Supabase (`signInWithPassword`, « Se souvenir de moi », mot de passe oublié, reprise liens `recovery`/`invite`) + formulaire **prospect** (insert anonyme `prospects`). `[VÉRIFIÉ]`
- **`index.html`** — Landing marketing (SEO), statique. `[VÉRIFIÉ]`
- Autres pages commerciales : `brochure.html`, `prix.html`, `devis.html`, `contrat.html`, `bareme.html`, `demo.html`, `kit-commercial.html`, `argumentaire.html`, `promo.html`, `carte-visite.html`, `liens.html`, `offre-achat.html`, `prospects.html`, `script-demo.html`, `logos.html` — supports de vente/présentation (certaines utilisent `bareme.js`). `[VÉRIFIÉ: ls]`
