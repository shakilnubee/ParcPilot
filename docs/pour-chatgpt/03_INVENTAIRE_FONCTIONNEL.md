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

## B. Pages secondaires, tableau de bord & portail

> _Section complétée à partir de l'exploration dédiée (pages secondaires + public/portail)._ — **à compléter.**
