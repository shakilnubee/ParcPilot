# 07 — Workflows détaillés (chaîne complète + chemins d'erreur)

> Instantané 03/11/2026, lecture seule. Chaîne type : **Interface → JavaScript (FP.*) → Supabase/Edge Function → Storage → Notifications → autres modules**. On note les **validations**, **protections anti-doublon** et **chemins d'erreur**. Légende `[VÉRIFIÉ]`/`[DOC]`.

## Mécanique d'écriture commune (vaut pour presque tous les workflows)
`UI → FP.persist.insert/update/delete/rpc` → **enqueue local AVANT l'appel réseau** (`fp_pending_writes_<societe>`) → appel Supabase → succès : retire de la file ; échec **réseau/JWT** : reste en file, retente (flush sur `online`/`visibilitychange`/`pagehide`), pastille `#fp-sync-badge` ; échec **base** (RLS 42501, doublon 23505, colonne inconnue 42703) : `_estPermanente` → `FP.notifyError` (jamais silencieux), `writeResilient` retire une colonne inconnue plutôt que perdre la ligne. Réglages : `FP.settings._pushSettings` écrit par **fusion delta** sur la **même ligne** (`_effectiveId`). `[VÉRIFIÉ]`

## 1. Créer / modifier un véhicule
UI (`vehicules.html` « Nouveau véhicule » ou scan carte grise) → **validation** (immat requise, anti-doublon `FP.dupe.confirmAdd('vehicules')` sur immatriculation) → `FP.persist.insert('vehicules')` → table `vehicules` (stampée `societe`) → **propagation** : `FP_DATA` + cache + `fp:data-ready` → recalcul partout (dashboard, stats/TCO, échéances). Documents → `FP.persist.insert('documents')` + bucket `scans` (rangé `societes/<slug>/`). QR → `renderQrCard` (pointe `carte.html`).
**Chemins d'erreur** : doublon immat → confirmation ; upload scan échoué → compté comme non rattaché + message ; suppression = **soft** (Corbeille `FP.trash`, restaurable), recalcul km véhicule sur factures restantes (`FP.recomputeVehiculeFromFactures`). `[VÉRIFIÉ]`

## 2. Affecter un conducteur
UI (fiche → affectation, `FP.conducteurPicker` choisir/créer) → `FP.affectations._sauver` → **RPC `fp_affectations_remplacer(societe, veh_id, periodes)`** (verrou advisory par véhicule, **valide dates/km AVANT d'effacer**) → table `vehicle_assignments` → met à jour `vehicules.chauffeur` → propage aux amendes (prénom) + santé conducteur.
**Erreur** : dates/km incohérents → RPC refuse (écriture **non perdue**, reste en file). Renommage conducteur → `applyRename` + **`FP.migrateCondKey`** (sinon congés/cartes/docs orphelins). `[VÉRIFIÉ]`

## 3. QR conducteur (sinistre / problème / EDL / km / question)
UI `v.html?h=token` → `postJSON` → **Edge `km-collect`** (`verify_jwt=false`, sécurité = token/QR) → selon action : insert `declarations_conducteur` (+photos), update `vehicules.km` (si supérieur), insert `documents`, journalise `qr_scans` → **push VAPID** aux gestionnaires → côté gestionnaire `sinistres.html` lit `declarations_conducteur`.
**Validations/erreurs** : QR **désactivé** si véhicule hors flotte (vendu/cédé/HS) ; km inférieur refusé (`km_lower`) ; anti-spam scan 20 min ; `Cache-Control:no-store`. `[VÉRIFIÉ]`

## 4. Déclaration → sinistre → rapport PDF
UI `sinistres.html` « Créer le sinistre » (depuis une déclaration, pré-rempli) → insert facture `type='sinistre'` (`FP.persist`) + copie des photos de la déclaration en `documents` type `sinistre-doc` **rangées dans l'incident** (`sinistreDocSub='sin:'+id`) + marque la déclaration `traite`. Dossier assurance → `settings_items` (collections `sinistre*`). **Rapport PDF** (`DeclCond.exportPdf`) : récit nettoyé (`stripDeclCatPrefix`), pièces jointes **scopées à l'incident** (docSub = clé/lignes du groupe ; repli si véhicule à 1 seul incident), photos adaptatives, PDF constat en page pleine.
**Anti-doublon** : facture de réparation `FP.dupe.find` ; « Déposer la facture » complète la ligne (jamais 2× le montant). **Erreur** : upload photo échoué → signalé (pas de « ✓ » menteur). `[VÉRIFIÉ]`

## 5. État des lieux (EDL) & signature
UI `v.html` (EDL, photos remise/restitution) → `km-collect` insert `declarations_conducteur` type `etat_lieux`. Signature : `signer.html?t=&who=` → **Edge `edl-sign`** (token) : enregistre la signature (dataURL PNG) dans `edl_signatures`, reconstruit le **PDF signé** (pdf-lib) → `documents` + bucket `scans`. Alternative externe : Edge `yousign` (API Yousign, env `sandbox` par défaut).
**Erreur** : refus avec **motif obligatoire** (annule la demande + prévient le gestionnaire). `[VÉRIFIÉ]`

## 6. Réservation de véhicule
UI `reserver.html?t=token` (dates → dispos → coordonnées) → **Edge `reservation`** : **re-vérifie la dispo serveur** (anti double-résa, croise `reservations`+`emprunts`) → insert `reservations` (statut `en_attente`) → **push/e-mail** gestionnaires → `emprunts.html` « Demandes en attente » (confirmer/refuser).
**Validation** : e-mail **ou** tél obligatoire ; photos servies en URLs **signées images-only**. `[VÉRIFIÉ]`

## 7. Facture (scan) & cohérence
UI `factures.html` scan → `FP.scanIA('facture')` → Edge `scan-doc` (lecture croisée si OpenAI présent) → `deriveTotals` (triplet auto-vérifiant) → **contrôle HT+TVA=TTC** (tolérance 0,02 €, badge ⚠️ sinon) → anti-doublon `FP.dupe` (n°+TTC) → `FP.persistFacture`/`FP.persist.insert('factures')` + `documents`/bucket → coût exploitation (`FP.coutFactureExploit`/`dedupeFactures`) → stats/budget/dashboard.
**Erreur** : montants incohérents signalés, jamais validés en silence. `[VÉRIFIÉ]`

## 8. Entretien & maintenance
UI `entretiens.html` scan facture d'entretien → `FP.persist.insert('factures')` + update `vehicules.derniereRevision`/`kmDernierReleve` → alimente échéances révision/CT (`FP.buildEcheances`) + tâches auto. RDV garage (`FP.rdvGarage`) + rappel 3 canaux (`FP.msg.open`). `[VÉRIFIÉ]`

## 9. Amende
UI `amendes.html` import/scan → `parseAvis` (3 montants, anti-`Math.max`) ou `FP.scanIA('amende')` → **anti-doublon direct** `checkDoublonLive` (n° d'avis + montant) → `FP.persist.insert('amendes')`. Désignation conducteur (`FP.conducteurPicker`). **E-mail d'amende** (`send-email`, expéditeur société) avec avis en pièce jointe + lien `avis.html` (signé). Montant dû (`FP.montantDu`, majoré seulement si date dépassée) → dashboard/stats.
**Erreur** : ré-import d'un avis = **doublon** (bandeau), pas une majoration. `[VÉRIFIÉ]`

## 10. Carburant / péage & anomalies
Import (scanner `FP2` ou parseurs par position `ulysPdfToText` ; Ulys en-têtes via cron `ulys-daily`) → `total_conso_tx` / `ulys_conso` (daté, carte/badge, catégorie `FP.txCat`) → `controle.html` `buildFindings` (anomalies `FP.consoPendantConge`/`consoApresDepart`, diesel sur essence…) → cache `controle_findings` (`onConflict:'societe'`) → **KPI alertes** dashboard. Rattachement **par n° de carte/badge** (`FP.condKeyDeConso`). `[VÉRIFIÉ]`

## 11. Alertes & rappels automatiques
`FP.buildEcheances(data)` (source unique) → `calendrier`/`renouvellements`/`notifications` + tâches auto (`taches.html`). Relances : cron **`km-relance`** (km + CT la veille), cron **`task-reminders`** (push/e-mail), relance manuelle 3 canaux. `[VÉRIFIÉ]`

## 12. E-mails (transactionnels)
`FP.sendEmail(msg)` → Edge **`send-email`** (Resend) : **from/cc calculés serveur** par société (anti-usurpation — un non-CEO ne peut usurper une autre société), en-têtes de fil transmis (relances dans le même thread), avis en pièce jointe pour les amendes. Journal : `email-log` (CEO). `[VÉRIFIÉ]`

## 13. Exports PDF / ZIP
PDF via `FP.ensureJsPDF` (jsPDF **chargé paresseusement** — jamais bloquant) : fiche véhicule/vente, rapport sinistre, rapport direction, budget, facturation. CSV/Excel via `FP.csv`/`FP.xlsx` (+ `FP.makeExportMenu`, filtre période). ZIP : avis d'amende par conducteur (`amendes.html`), factures PDF par véhicule (`FP.facturesZip`). Les exports lisent la **même période/source** que l'écran. `[VÉRIFIÉ]`

## 14. Suppression & restauration
Suppression = `FP.persist.delete(table, id, record)` → capture l'enregistrement en **Corbeille** (`FP.trash`, restaurable) ; soft-delete `deleted_at` pour les tables de projection. Restauration de réglages → **`FP.restaurerReglages(data)`** (remet aussi les tables dédiées, élément par élément, sans rien supprimer). Sauvegarde serveur nocturne chiffrée en filet. `[VÉRIFIÉ]`

## 15. Comptes & nouveau client
UI `parametres.html` → « Nouveau client » / « Utilisateurs & accès » → Edge **`manage-users`** (service_role, portée CEO/Admin) : create/invite (mot de passe aléatoire jamais communiqué + lien recovery + e-mail brandé), updateRole, resetPassword, delete. Rôle/société écrits dans `profiles` (source de vérité). **Garde** : Admin limité à sa société, ne peut créer/toucher un CEO. `[VÉRIFIÉ]`
