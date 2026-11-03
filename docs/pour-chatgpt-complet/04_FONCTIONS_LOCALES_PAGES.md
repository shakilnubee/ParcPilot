# 04 — Fonctions locales des pages

> Instantané 03/11/2026, lecture seule. Fonctions JavaScript **locales** (définies dans le `<script>` d'une page, hors `FP.*`), les notables seulement. Références `fichier:ligne` (approx). `[V]`=vérifié, `[H]`=rôle inféré du nom. Micro-helpers triviaux dupliqués (`esc`/`euro`/`dfr` locaux) omis. Les helpers partagés sont dans `03`.

## `pages/vehicules.html`
- **renderTabBar** `1267` — barre d'onglets de groupes (avatars par groupe). · **favGet/favSave/toggleFav/pinFavFirst** `1319-1324` — favoris.
- **getVehDocs/addVehDoc/delVehDoc/restoreVehDoc/loadVehDocs** `1354-1587` — docs d'une fiche (table `documents`, cache `DOCS_CACHE_KEY`).
- **createEdlInspection/reanchorVehEdl/scanExistingEdlDocs/scanAllEdlKm** `1445-1521` — états des lieux + relecture OCR km (`settings.inspections`).
- **builtinDocsAll/docRowHTML/docsSectionHTML** `1612-1693` — docs « intégrés » + masquage. · **garageBlockHTML/rdvGarageHTML/tachesLieesHTML** `1849-1890`. · **edlBubbleHTML/edlHistoHTML/edlSectionHTML** `1920-1993`. · **vehTimelineHTML** `2086`.
- **affectRowsHTML/kmParcouruAffect/conducteursHistoHTML/refreshAffect** `2149-2226` — historique affectations (via `FP.affectations`). · **ctCell** `2406` — échéance CT.
- **getColWidth/getColConfig/renderTableHeaders/saveColLabel** `2461-2697` — éditeur de colonnes (DnD).
- **renderKPIs/filtered/renderTable/vehCardHtml/renderCartes/renderGalerieVeh/syncVehView/setVehView** `2766-3034` — KPIs + 3 vues.
- **renderBulkBar/bulkAddGroupe/bulkSetStatut/bulkDelete/bulkExport** `3034-3145` — actions en lot.
- **vehMasse** `3235` — masse champ G. · **parkingParis** `3249` / **parkingBadge** `3294` — **règle stationnement Paris VBE** (verdict gratuit/payant/à vérifier).
- **openDrawer/closeDrawer** `3315/4058` — tiroir fiche complet.
- **dbAvailable/nextVehId/vehToDb/persistVehicleUpsert/persistVehFields/persistVehicleDelete** `4288-4442` — persistance (camel→snake, `FP.db`/`FP.persist`). · **saveVehicule** `4461`.
- **openChecklist/finalizeProc/recordInspection/showEntreeProcess/showCessionProcess** `4646-4899` — processus entrée/cession. · **deleteVehicule** `4899`.
- **resetVehFilters/populateEntiteFilters** `4998-5064` (barre de filtres). · **completerDepuisCG/lireFacturesAchat** `5421-5536` — remplissage auto (OCR, `setIf` = ne remplit que si vide).
- **askKmLot/sendAccesLot** `5603-5642` — km en lot + envoi accès QR groupé. · **exportFichePDF** `6543` / **exportVentePDF** `6653`.
- **buildQrCanvas** `6753` / **renderQrCard** `6919` — **générateur unique** QR (écran/PNG/impression) ; **downloadQr/printQr/openQrHub** `6981-6867`.
- **parseCarteGrise** `7505` — **parseur OCR carte grise** (ancrage libellés/codes, VIN). · **handleCarteGriseBatch/createBatchVehicles** `7674-7798` — import **par lot** (anti-doublon `vehByImmat`).
- **simulateur/compare** `7260-7393` — simulateur achat/leasing + comparateur 2 véhicules. · **openVehFromUrl/openChecklistFromUrl** `8112` — deep-links.

## `pages/contrats.html`
- **getLoueurs/loueurDeVeh/loueurNomOf** `884-912`. · **bpceDocs/ficheContratDocs/allContratDocs** `919-1012` — docs de contrat par plaque (`settings.leasingDocs`).
- **rebuildLeasingData/refreshAllContrats/renderCartes** `1057-1104`. · **mensualiteFixe/penaltyHtml** `1172-1207` — pénalités dépassement km. · **renderKPIs/fleetTVS** `1216-1260`.
- **assurPrimes/getAssureurs/assureurOf/setAssureurVeh** `1264-1288` + onglet assurance `renderAssurance/renderAssurDashboard` `1294-1501`.
- **parseEtatParc/etatParcPdfText/parseEtatParcMatrix/importEtatParc** `1549-1769` — **import état de parc assureur** (texte PDF **par position**, primes HT/TTC par plaque, franchise ignorée ; aussi Excel).
- **renderLeasing** `1924` (jauge km). · **leasingExportRows/openContratReleve** `2171-2271` (relevé PDF suit l'onglet). · **openLeaseModal/collectAvenants** `2281-2317`. · **openRestit/leaseAction** `2333-2419` — restitution LLD.
- **parseOfferText/parseLeasingInvoice** `2592/2701` — parseurs offre/facture loueur. · **(contrats cadre)** `contratPdfText/scanContrat/groupDocs/zipDocs` `2927-3503`. · **(ventes société)** `openDetail/contactBuyer` `3629-3886`. · **(archive docs)** `3919-4037`.
- **parseLocaleaseOffer** `4109` / **localeasePdfToText** `4173` — **parseurs LLD** (texte par position, gabarits BPCE/Ayvens). · **renderLocalease/autoCreateVehFromContrat/locAction** `4192-4679` — contrats LLD (`FP.contratsLLD.sauver`). · **(recouvrement docs)** `applyScannedToTarget/readContractPdf` `4780-4952` — rapprochement PDF Drive → champs manquants. · **(comparateur devis)** `5514-5678`.

## `pages/sinistres.html`
- **maps/stageOf/buildGroups/visibleGroups** `541-568` — **buildGroups** regroupe les lignes en dossiers (`settings.sinistreGroupes`). · **renderConducteursRisque** `901` — podium. · **refreshAll** `968`.
- **associate/detach/forgetSinistre** `971-1013`. · **handleConstatScan/handleCourrierScan** `1090-1130` — scan constat/courrier. · **editSinField/deposeFactureSinistre** `1294+`.
- **(sinDeclare)** `1556` — déclaration manuelle ; `1257` appelle **DeclCond.exportPdf** (rapport PDF, générateur unique).
- **docSub/setDocSub/stripDeclCatPrefix/addSub/renameSub** `1819-1862` — sous-dossiers Drive + retrait préfixe catégorie.
- **loadSinDocs/addDossier/renderDrive/renderDriveGrid/uploadDrive** `1862-2118` — **renderDrive** = explorateur de dossiers par plaque (bucket privé signé).
- **DeclCond** (objet) `2198` — **inbox des déclarations conducteur** (table `declarations_conducteur`) : `.load` `2200`, `.photosHTML/.signPhotos` `2211` (URLs signées en //), `.cardHTML` `2227` (types + boutons SMS/WhatsApp/Email `FP.msg` + réponse persistée), **`.exportPdf`** `2463` (rapport PDF réutilisé). · **initGarages/renderGarages** `2836`.

## `pages/amendes.html`
- **scanPreview/piecesSectionHTML/addPiece/deletePiece** `584-669` — pièces jointes. · **categorize/pointsRetrait/motifPill/statutBadge** `709-805`. · **filtered/renderKPIs/renderTable** `805-956`.
- **lookupEmail/appliquerModele/mailPaiement/mailDesignation/relanceEmail** `1074-1266` — mails amendes (modèles brandés). · **sendAmendeAuto/bulkEnvoiAmendes** `1270-1311` — envoi (unitaire + lot).
- **renderPodium/renderHeatmap** `1347-1520`. · **majorationInfo** `1551` — majoration applicable selon date (l'app décide). · **openDrawer** `1578`.
- **markPaid/markConteste/attachJustif/extractJustifInfo** `1858-2048` — statuts + OCR justificatif. · **montantDu** `2235` (repli de `FP.montantDu`). · **lierMajoration** `2444`.
- **findDoublon/checkDoublonLive** `2267-2279` — **anti-doublon amende** live (n° avis+montant). · **startAvisQueue/handleAvis** `2299-2798` — file de scans.
- **fmtNumeroAvis/parseAvis** `2641-2648` — **parseur avis ANTAI** : `parseAvis` extrait les **3 montants** (`grabAmts` prend le plus petit, jamais `Math.max`), `/avis de majoration/i` **sur titre seulement**. · **relireTelepaiement** `2783`.

## `pages/factures.html`
- **rebuildFactures/typePill/filtered/renderKPIs** `636-709`. · **faIncoherent** `751` — détecte `HT+TVA≠TTC`. · **renderDoublons** `776`. · **renderTable/openDrawer** `819-1023`. · **editFaField/deleteFacture** `1026-1096`.
- **parseFacture** `1219` — parseur facture (ancrage libellés). · **deriveTotals** `1257` — **triplet auto-vérifiant HT/TVA/TTC**. · **applyFactureFields** `1306` (ne remplit que les vides, contrôle cohérence). · **handleFacture** `1349` / **handleFactureLot** `1436` (`routeStatements` route Total/Ulys). · **saveFacture/syncRevisionVehicule** `1512-1588`.
- **(Documents)** `loadDocs/renderDrive/handleDocLot/detectDocFor` `2086-2390`. · **(Notes de frais)** `nfRows/nfPeriod/importSheet` `2657-2831` (export suit la période). · **(Fournisseurs)** `applyRename/fnAction` `2967-3034`.
- ⚠️ **ulysPdfToText/parseTx ne sont PLUS ici** : la conso détaillée Total/Ulys vit dans `assets/js/fleet-views.js` (module partagé). `persistFacture` = `FP.persistFacture` (app.js).

## `pages/conducteurs.html`
- **toCondDb/upsertCond/deleteCondRow/loadConducteurs/purgeDepartedPII** `740-844` — CRUD (cache `COND_CACHE_KEY`, table `conducteurs`) + purge PII des partis (RGPD). · **permisSectionHTML/permisKeyOf** `893-965`. · **condDocsGet/condDocsSectionHTML** `986`.
- **buildDrivers** `1030` — construit la liste (fiches + affectations + amendes). · **driverAccidents/driverSinistreCout/driverStats** `1258-1305`. · **cardHtml/cartesHtml/renderGrid/renderGalerieCond** `1312-1505` — vues + cartes&badges.
- **openDrawer** `1632`. · **unassignVehiclesOf/deleteDriver/renameDriver/applyRename** `2051-2118` — **applyRename** `2118` appelle `FP.migrateCondKey` (déplace congés/cartes/docs). · **addDriver** `2185` (`FP.conducteurs.create`). · **openSortieModal/confirmSortie** `2352-2590`.
- **condFichePDF/exportCondPDF** `2707-2824`. · **_ajouterConge/_congeAddFromForm** `2840-2866` (→ `driver_absences`). · **parsePermis** `3059` — **parseur OCR permis**. · **ocrPermis/rereadPermisFromUrl/rereadAllPermis/applyReread** `3095-3235` — scan permis + relecture en lot. · **condDocReessayerLecture** `2970`.

## `pages/controle.html`
- **ensureFleetViews/mountFleetPane/switchTab** `361-396` — monte Total/Ulys (`fleet-views.js`). · **renderPrestaTabs/renderPresta** `414-430` — prestataires dynamiques. · **(Sanef)** `_snRender/_snImport/renderSanef` `464-645`.
- **_ctrlCK/_writeCtrlCache/_findCK/_writeFindingsCache** `715-739` — **caches locaux par société**. · **_probeSigFrom/_loadServerFindings/_saveServerFindings/loadData** `749-817`.
- **buildFindings** `895` — **cœur** : anomalies (conso pendant congé `FP.consoPendantConge`, diesel sur essence, rapprochement par carte/badge). · **rowHTML/render** `1074-1116`. · **renderCartes** `1249` (cartes&badges). · **exportCSV/exportPDF** `1410`.
- **_buildSig** `1484` — **signature de cache** incluant `FP.ASSET_VERSION` + `DETECT_VERSION` (`1502`) → invalide les findings en cache quand la logique change. · **rebuild/boot** `1505`.

## `pages/parametres.html`
- **renderGroupesForm/saveGroupes** `975-1043` — groupes véhicules (DnD). · **setupSettingsTabs** `1091`. · **renderNavLabelsForm/saveNavLabels** `1131-1231` — libellés+ordre sidebar.
- **renderSocietesUI/loadSociete/saveSociete/newSociete** `1281-1532` + **(ncWizard)** `1548` — multi-sociétés. · **recoverSettings/_deepFillGaps** `1347-1377` — récupération réglages (via `FP.restaurerReglages`). · **renderProfilForm** `1441`.
- **exportAll/importAll/resetAll** `1592-1735`. · **renderAutoBackups/renderServerBackups** `1602-1908` — sauvegardes. · **(aenConfigUI/aenImportUI)** `1815-1858` — barème AEN. · **(csvImport)** `parseCSV/analyze/run` `1942-2013` — import CSV générique.
- **renderJournal** `2072` — audit. · **renderEnvois** `2129` — historique e-mails. · **initColorPicker** `2237` — thème.
- **(customFields)** `2398`, **(docsRequis)** `2478`, **(automations)** `2546` — personnalisations par entité. · **gateCeoOnly** `2746` / **gateParamForGestionnaire** `2762` — **garde-fous rôle**. · **(initUsers)** `2789` — **Utilisateurs & accès** → `manage-users`. · **initCorbeille** `3184` — corbeille (`FP.trash`).

## `pages/statistiques.html`
- **updateTvsKpi/renderCO2** `363-383`. · **renderConformite** `474` — présence docs par véhicule. · **render(annee)** `612` — rendu TCO/coûts. · **renderKmConducteur/renderPodiumPerKm** `831-874`. · **renderTcoTable** `921`. · **renderComparaison** `946` — mois A vs B.

## `pages/budget.html`
- **assuranceTotal/leasingTotal/tvsTotal** `219-246` — totaux annuels. · **renderObjectifs** `281` (`settings.objectifs`). · **getBudget/render/renderExplain** `323-494` — budget par poste + explication des écarts (`settings.budget`).

## `pages/notifications.html`
- **notifHTML/render/smoothRemoveCard** `192-391` — alertes (3 visibles + « Voir tout », masquage persistant). · **renderEcheances/renderDecisions** `468-506`.
- **cfReqFields/missOf/rowCompHTML/sectionCompHTML** `677-751` — moteur **checklist « À compléter »** (champs manquants par entité). · **renderComplet** `938` — assemble les sections. · **(RAF)** `buildRaf/openRaf` `1048-1207` — assistant « remplir à la file ».
- **rkBuildRows/renderRelevekm/openKmConfig** `1222-1514` — relevés km reçus. · **renderSuiviFlotte** `1733` (colonnes configurables `FP.suivi`). · **renderRelances/relAllMail** `1876-1938` — relances + envoi groupé.

## `pages/taches.html`
- **getTaches/_withRdvVirtuels/saveTaches** `433-533` (`settings.taches`). · **filtered/renderListe/renderKanban/renderCal** `588-738` — 3 vues. · **saveTask** `877`. · **notifyFromTask/addToCalendar** `933-1035` — notif 3 canaux + .ics.
- **createFromModel** `1109` — modèles. · **getRappels/renderRappels/nextDueRappel** `1226-1330` — **rappels périodiques** (`settings.rappelsPerso/rappelsFaits`). · **autoTachesCT/createCTTaskFor** `1396-1547` — **génération auto** CT+révision (anti-doublon).

## `pages/emprunts.html`
- **load** `480` (table `emprunts`). · **empDispoVehs/filteredEmprunts/render** `506-680`. · **addEmprunt/openRet/saveRet/delEmprunt** `727-834` (anti-doublon). · **getResas/resaConflit/renderResas/startEmpruntFromResa** `847-956` — réservations (`settings.reservations`, conflit de dates). · **renderDemandes/acceptDemande/refuseDemande** `1099-1238` — demandes portail. · **openRsv/saveRsv** `1174-1199` (gardé `FP.canManageSociete`).

## `pages/a-vendre.html`
- **getVendreVehs/pipelineOf/renderPipeline** `316-348`. · **renderVenteQRs** `395` — QR annonces. · **loadOffresVente** `520`. · **achStatutOf/loadAchats/renderAchat/renderAchatArchived** `620-704` — pipeline **achats**. · **openAchatDetail/openAchatModal/onAchatClick** `730-901` — détail + CRUD.

## `dashboard.html`
- **fillMoneyKpis** `809` (`FP.coutFactureExploit`). · **refreshAlertes/renderAlertes** `908-970`. · **renderSante/renderVehicules** `985-1041`. · **drawDashCharts** `1088`. · **renderPodiumDash** `1180`.
- **(widgets)** `applyHidden` `1277` (`settings.dashHiddenWidgets`). · **(scanDocFeature)** `detectConducteur/findDuplicateFacture/saveBatch` `1394-1714` — **scanner universel** (détecte type, remplit, anti-doublon, enregistrement par lot). · **(shortcutsHub)** `renderConge/renderKmLot/renderKmPhoto/setImmo` `2031-2217` — raccourcis (congés, km lot/photo, immobilisations). · **(iaHealthBanner)** `2246`.

## Pages publiques (sans app.js — Supabase REST direct)
- **v.html** : `parkingParis/parkingBadgeHTML` `1015` (version publique autonome) · `renderAmendes/renderMyDecl/mdOpenEdit/mdSave` `1136-1203` · `renderVente/showVenteFiche` `1349` · `renderKm/submitKm` `1480-1510` · `renderSinTriage/chooseSinCat/renderConstat/constatText/constatPdf` `1584-1899` (déclaration sinistre + constat + schéma de choc + signature, pads canvas `drawChocPad/setupSigPad`).
- **km.html** : `paintForm` `281`, `submit` `340` (POST relevé). · **reserver.html** : `iso/boiteLabel/openGallery/lbRender` `136-144`, soumission `headers()`. · **signer.html** : `fitCanvas/start/move/end/padIsBlank` `234-310` (pad signature). · **carte.html** : `fromSnapshot/fromView/fromLive/render` `67-102` (RPC + replis). · **avis.html** : minimal (`fail` `26`).

## Notes transverses
- **Duplication connue** : plusieurs pages redéfinissent localement les mêmes micro-helpers (`escapeHtml`, `euro`, `toIsoDate`, `pdfText`, `loadScript`) — non centralisés (dette technique mineure, cf. `09`).
- **Parseurs de documents à couche texte** reconstruits **par position**, vivant dans les pages : `parseCarteGrise` (véhicules), `parseAvis` (amendes), `parseFacture`/`deriveTotals` (factures), `parsePermis` (conducteurs), `etatParcPdfText`/`localeasePdfToText`/`parseLocaleaseOffer`/`contratPdfText` (contrats). Les parseurs **Total/Ulys** (conso détaillée) sont dans `fleet-views.js`.
- **Clés de « données de travail »** manipulées par ces fonctions (toutes via `FP.settings.save`/`FP.persist`, jamais localStorage seul) : `inspections, vehMasse, vehNotes, restitutionChecklist, leasingDocs, assurancePrimes, assureurVeh, condDocs, permisMasque, sinistreGroupes/Sous/DocSub/Dossiers, controleStatuts/tfAnomOk, taches, rappelsPerso/rappelsFaits, reservations, objectifs, budget, customFields, docRequis, automations, dashHiddenWidgets, dashShortcuts`.
