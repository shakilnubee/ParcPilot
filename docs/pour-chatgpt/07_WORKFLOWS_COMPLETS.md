# 07 — Workflows complets (parcours bout-en-bout)

> Instantané 03/11/2026, lecture seule. Chaque workflow indique : actions utilisateur → données créées/modifiées → modules mis à jour → notifications. Synthèse à partir du code (cf. `03`/`04`/`05`/`06`). Légende `[VÉRIFIÉ]` / `[HYPOTHÈSE]`.

## 1. Créer & gérer un véhicule
1. `pages/vehicules.html` → « Nouveau véhicule » (ou scan **carte grise** `FP.CG_SCAN_PROMPT` qui pré-remplit immat/marque/modèle/VIN/CO₂/puissance/masse/carburant/dates). Anti-doublon immatriculation (`FP.dupe`).
2. Écriture `FP.persist.insert('vehicules')` (file durable, suppression restaurable).
3. **Propagation** : apparaît partout (clé immatriculation via `FP.normImmat`/`vehByImmat`) — dashboard, statistiques/TCO, contrats, alertes/échéances, QR.
4. Documents rattachés → table `documents` ; QR généré (`renderQrCard`) pointant vers `carte.html`. `[VÉRIFIÉ]`

## 2. Affecter un conducteur
1. Fiche véhicule → affectation (`FP.conducteurPicker` : choisir **ou** créer un conducteur). Km début/fin saisissables.
2. Écriture via `FP.affectations._sauver` → RPC `fp_affectations_remplacer` → table `vehicle_assignments` (valide dates/km **avant** d'effacer ; échec = écriture refusée, pas perdue).
3. Met à jour `vehicules.chauffeur` ; le chauffeur se propage aux **amendes** (prénom) et à la santé conducteur. Renommage conducteur → `applyRename` + `FP.migrateCondKey` (déplace congés/cartes/docs). `[VÉRIFIÉ]`

## 3. Déclaration conducteur via QR (sinistre / problème / EDL / km / question)
1. Le conducteur scanne le QR du véhicule → `v.html?h=<token>` (multilingue). Choisit « J'ai un problème » (catégorie + description + photos), ou EDL, ou relevé km, ou question.
2. `postJSON` → Edge Function **`km-collect`** (service_role, `verify_jwt=false`) → insert `declarations_conducteur` (type + photos) et/ou update `vehicules.km` ; journalise `qr_scans`.
3. **Push** envoyé aux gestionnaires (VAPID).
4. Côté gestionnaire : `pages/sinistres.html` lit `declarations_conducteur` (en tête), permet de **répondre** (3 canaux) ou de **« Créer le sinistre »** (pré-rempli) ; les photos de la déclaration sont copiées en `documents` type `sinistre-doc` rangées dans l'incident (`sinistreDocSub = 'sin:'+id`). `[VÉRIFIÉ]`

## 4. Gérer un sinistre et son rapport
1. Sinistre = facture `type='sinistre'` (créée depuis une déclaration ou manuellement). Scan constat (`FP.constatPrompt`), courrier assureur, factures de réparation (anti-doublon).
2. Dossier assurance (lieu, tiers, responsabilité, franchise, remboursé, dates) dans `app_settings`/`settings_items` (collections `sinistre*`). Suivi d'étapes + statut remboursement + podium conducteurs + KPI « remboursé ».
3. **Rapport PDF** (`DeclCond.exportPdf`, refondu 03/11/2026) : format « Déclaration de sinistre » en cartes, récit sans préfixe de catégorie, photos adaptatives, **pièces jointes scopées au seul incident** (plus de fuite EDL/autre sinistre).
4. EDL signé via `signer.html` → Edge Function `edl-sign` → PDF signé rangé dans `documents`. `[VÉRIFIÉ]`

## 5. Entretiens & maintenance
1. `pages/entretiens.html` : les entretiens **sont des factures** filtrées. Scan facture d'entretien (`FP.scanIA`), répertoire garages (scan + ajout prestataire).
2. Écriture `factures` + update `vehicules.derniereRevision`/`kmDernierReleve`.
3. Alimente alertes révision/CT (`FP.buildEcheances`) + TCO/coûts. Relance conducteur / RDV garage (3 canaux). `[VÉRIFIÉ]`

## 6. Amendes / contraventions
1. `pages/amendes.html` : import/scan de l'avis → parseur `parseAvis` (3 montants, anti-`Math.max`) ou repli `FP.scanIA(file,'amende')`. Anti-doublon en direct (`checkDoublonLive`).
2. Désignation du conducteur (`FP.conducteurPicker`), statut (payée/contestée/désignée), montant payé. Écriture `amendes`.
3. **E-mail d'amende** (expéditeur société, PXP figé) avec l'avis en pièce jointe + lien `avis.html` (signé). Montant dû via `FP.montantDu` (majoré seulement si date dépassée) → dashboard/stats. `[VÉRIFIÉ]`

## 7. Documents & factures (hors entretien)
1. `pages/factures.html` : scan facture (`deriveTotals`, contrôle HT+TVA=TTC) ou notes de frais (OCR Tesseract repli). Anti-doublon (n°+TTC). Mini-Drive « Documents » (CRUD `documents`, scan+upload bucket `scans`).
2. Écriture `factures`/`documents`. Lien Drive par `file_id`. Coût d'exploitation via `FP.coutFactureExploit`/`dedupeFactures` → statistiques/TCO/budget/dashboard. `[VÉRIFIÉ]`

## 8. Réservation de véhicules
1. Lien public permanent (depuis `pages/emprunts.html`) → `reserver.html?t=<token>` : dates → véhicules disponibles (galerie photos signées) → coordonnées (e-mail **ou** tél).
2. `postJSON` → Edge Function **`reservation`** : re-vérifie la dispo serveur (anti double-résa) → insert `reservations` (statut `en_attente`) → **push/e-mail** aux gestionnaires.
3. Côté gestionnaire : `emprunts.html` → « Demandes en attente » (confirmer/refuser) ; emprunts internes dans table `emprunts`. `[VÉRIFIÉ]`

## 9. Carburant & dépenses (Total Fleet / Ulys / prestataires)
1. Import des relevés : scan unifié (`pages/scanner.html`/`FP2`) ou parseurs **par position** (`ulysPdfToText`) ; Ulys aussi importé en-têtes par le CRON `ulys-daily`.
2. Détail écrit dans `total_conso_tx` / `ulys_conso` (daté, par carte/badge, conducteur, catégorie `FP.txCat`).
3. `pages/controle.html` : détection d'anomalies (`FP.consoPendantConge`/`consoApresDepart`, diesel sur flotte essence…) → cache `controle_findings` → **KPI alertes** du dashboard. Rattachement au conducteur **par n° de carte/badge** (`FP.condKeyDeConso`). `[VÉRIFIÉ]`

## 10. Alertes & rappels
1. `FP.buildEcheances(data)` (source unique) calcule CT, assurance, anti-pollution, permis, pièces d'identité, fins de leasing, forfaits km.
2. Affichage : `calendrier.html`, `renouvellements.html`, `notifications.html` (+ « À compléter »). Tâches auto générées dans `taches.html`.
3. Relances automatiques : CRON `km-relance` (km + CT la veille), `task-reminders` (push/e-mail des tâches). Relance manuelle 3 canaux (`FP.msg.open`). `[VÉRIFIÉ]`

## 11. Exports & téléchargements
- **PDF** via `FP.ensureJsPDF` (jsPDF chargé paresseusement) : fiche véhicule, fiche vente, relevé, rapport sinistre, rapport de direction, budget, facturation client.
- **CSV/Excel** via `FP.csv`/`FP.xlsx` (+ `FP.makeExportMenu`, filtre période) sur la plupart des tableaux.
- **ZIP** de pièces jointes (avis d'amende par conducteur, factures PDF par véhicule).
- **Sauvegarde in-app** (`FP.injectDataIO`) + sauvegarde serveur nocturne chiffrée. Les exports lisent la **même source** que l'écran (même période, mêmes helpers). `[VÉRIFIÉ]`

## 12. Gestion des comptes & nouveau client (self-service)
1. `pages/parametres.html` → « Nouveau client » (société + compte admin) et « Utilisateurs & accès » → Edge Function **`manage-users`** (service_role, portée CEO/Admin).
2. Création = mot de passe aléatoire jamais communiqué + lien recovery + e-mail d'invitation brandé. Rôle/société écrits dans `profiles` (source de vérité). `[VÉRIFIÉ]`
