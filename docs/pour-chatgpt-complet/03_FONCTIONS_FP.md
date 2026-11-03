# 03 — Carte des fonctions `FP.*`

> Instantané 03/11/2026, lecture seule. Chaque ligne a été relue dans le code (`fichier:ligne`). Abréviations : **app** = `assets/js/app.js`, **sc** = `assets/js/supabase-client.js`, **fv** = `assets/js/fleet-views.js`. Sauf `[HYPOTHÈSE]`, chaque entrée est `[VÉRIFIÉ]`. Lignes approximatives (version 03/11/2026). Les fonctions **locales** aux pages sont dans `04`.

## 1. Persistance (file d'écriture, réglages, fusion, projections)
| Helper | fichier:ligne | Signature | Rôle | Lit/Écrit | Risque régression |
|---|---|---|---|---|---|
| `FP.persist` | app:13250 | `insert/upsert/update/delete(table,id?,row,record?)`, `rpc(fn,args,meta)`, `flush()`, `applyTo(data,q?)` | File d'écriture **durable optimiste** (item enfilé **avant** le réseau, retiré à la réussite) + retente | `localStorage fp_pending_writes_<soc>` ; toutes tables | **CŒUR anti-perte** — toute écriture passe par là ; casser = perte silencieuse |
| `FP.settings` | app:6381 | `get()`, `save(obj)`, `_pushSettings(obj,prev)`, `applyTheme()` | Réglages par société (ligne `app_settings`), cache mémoire | `app_settings` (id=société, repli `global`), `localStorage auto_flotte_settings_<soc>` | Source unique des réglages ; fusion delta multi-postes |
| `FP.settings._pushSettings` | app:6635 | `(obj, prevLocal)` | Écrit par **fusion delta** (serveur gagne), sans écraser les autres postes | `COLLECTION_KEYS` (app:6700) | Toute map de données absente de `COLLECTION_KEYS` = écrasée en bloc = perte |
| `FP._fusion` | app:6304 | `rejouer`, `mergeMap/mergeArr/mergeCollection`, `gapFill` | Rejoue une écriture de réglages restée en file sans remplacement complet | pur | Anti-vidage ; testé `tests/unit/fusion-reglages.mjs` |
| `FP.projections` | app:3519 | `ajouter(p)`, `charger(client,soc)`, `projeter(shared,lus,soc)` | Orchestre les tables dédiées lues en // des réglages | tables dédiées ; remplace `settings.<clé>` | Pivot données-de-travail |
| `FP.elementsReglages` | app:3546 | `apresSauvegarde`, `charger/projeter`, `COLLECTIONS{}` | Table générique `settings_items` (assurances/tâches/sinistres) | RPC `fp_element_enregistrer/archiver` ; `settings_items` | Nouvelle collection → l'ajouter ici ET à `fp_element_collection_ok` |
| `FP.congesTable` | app:3679 | `charger/projeter/versMap/nettoyer` | Table `driver_absences` (congés) | `driver_absences` → `settings.condConges` | Écriture congés via RPC `fp_conges_remplacer/renommer` seulement |
| `FP.affectationsTable` | app:9332 | `charger/projeter/enregistrer(vehId,liste)` | Table `vehicle_assignments` | `vehicle_assignments` → `settings.affectations` | Écriture via `FP.affectations._sauver` ; `km-collect` lit encore la copie |
| `FP.contratsLLD`/`Table` | app:9474/9406 | `contratsLLD.sauver(s)` | Table `lease_contracts` (1 contrat=1 ligne, id stable) | `lease_contracts` ↔ `settings.localeaseContrats` | Modifier LLD = `s.localeaseContrats` **puis** `FP.contratsLLD.sauver(s)` — jamais `settings.save` seul |
| `FP.forfaitsLeasingTable` | app:8903 | `charger/projeter/enregistrer(cle,forfait)/archiver(cle)` | Table `lease_overrides` (forfaits par plaque) | `lease_overrides` ↔ `settings.leasingContrats` | Écriture via `FP.saveLeasingOverride/resetLeasingOverride` |
| `FP.restaurerReglages` | app:9563 | `(data)` | Restaure une version des réglages **ET** remet les tables, sans rien supprimer | toutes tables dédiées + `app_settings` | **Seul** point d'entrée sûr pour restaurer/importer ; ajouter toute nouvelle donnée migrée |
| `FP.trash` | app:13137 | `add(type,rec,label?)`, `list/remove/restore` | Corbeille (filet local + `app_settings.corbeille`) | `localStorage fp_trash_<soc>` + `settings.corbeille` | `FP.persist.delete(…,record)` l'alimente |
| `FP.backups` | app:6233 | `snapshot/list/restore` | Historique local des réglages | `localStorage fp_bak_*` | Filet anti-perte indépendant serveur `[HYPOTHÈSE sur restore]` |

## 2. Données / cache / versions
| Helper | fichier:ligne | Rôle | Lit/Écrit | Risque |
|---|---|---|---|---|
| `FP.db` | sc:325 | `loadAll()` + CRUD + mapping snake↔camel + filtre société + pagination | toutes tables | `SNAKE_TO_CAMEL_OVERRIDES` (sc:179 : `note_pneus→autonomie`, `type_pneus→version`…) load-bearing ; `conducteurs` non bloquant (null ≠ []) |
| `seedFromCache` (IIFE) | app:27 | Ré-hydrate `FP_DATA` depuis le cache société **avant** rendu (anti-flash) | lit `FP_CACHE_KEY`, écrit `FP_DATA` | Cache vide ne doit jamais écraser `data.js` non vide |
| `_writeDataCache` | sc:427 | Écrit le cache des 4 tables (repli progressif quota) | `localStorage fp_data_cache_v4_<soc>` | Une table en échec ne vide pas le cache |
| `FP.refreshData` | sc:722 | Re-synchro données au 1er plan ; ré-émet `fp:data-ready` si signature change | tables → `FP_DATA` + cache | `_fpDataSig` (sc:414) doit couvrir tout champ affiché |
| `FP.refreshSettings` | sc:673 | Re-lit `app_settings` + tables projetées (focus/bfcache) | `app_settings` + tables | Pose `_serverSnap` (base de la fusion delta) |
| `FP.ASSET_VERSION` | app:2440 | Version du `?v=` d'app.js | lit son `<script src>` | Cache de résultat **calculé** sans elle = masque les correctifs |
| `FP.facturesParImmat` | app:2479 | Index factures par plaque normalisée (mémorisé) | `FP_DATA.factures` | Perf ; clé normalisée des 2 côtés |

## 3. Rôles / sociétés / accès
| Helper | fichier:ligne | Rôle | Source |
|---|---|---|---|
| `FP.role` | app:2539 | Rôle effectif (`ceo`/`admin`/`gestionnaire`/`chauffeur`) | `profiles` (jamais `user_metadata`) |
| `FP.isCEO/isGestionnaire/isChauffeur` | app:2554-2556 | Tests de rôle | `FP.role()` |
| `FP.isAdmin` | app:2558 | `ceo || admin` | `FP.role()` |
| `FP.isSuperAdmin` | app:2587 | `profile.is_admin === true` | `FP.profile` |
| `FP.canManageSociete` | app:2589 | Garde config société (UI) | tout écran de config doit en être gardé |
| `FP.canManageUsers` | app:2593 | Garde gestion comptes (+ portée serveur `manage-users`) | — |
| `FP.chauffeurImmats` | app:2561 | Plaques du compte chauffeur | **dormant** (non sécurisé serveur) `[HYPOTHÈSE: lit metadata]` |
| `FP.activeSociete`/`setActiveSociete`/`estVueToutesSocietes` | app:4795/4796/4801 | Société active (`__all__` = toutes) | `localStorage fp_societe` |
| `FP.getSocietes`/`addSociete`/`removeSociete` | app:4822/4838/4862 | Liste des sociétés (self-service, archivage) | `fp_societes_list` + `settings.societes` |
| `FP.societeProfil` | app:5337 | Profil société (mailExpediteur/mailCopie/logo) | utilisé par `sendEmail` |

## 4. Calculs métier (source unique — ne jamais réimplémenter)
| Helper | fichier:ligne | Rôle | Risque régression |
|---|---|---|---|
| `FP.montantDu` | app:486 | Montant dû amende (majoré si `majoree`, override si payé) | Podiums/stats/budget doivent l'utiliser (pas `a.montant`) |
| `FP.estFps` | app:504 | FPS vs contravention ANTAI | ne pas simplifier |
| `FP.estVendu`/`horsFlotte`/`estAPayer`/`estPayee` | app:419/427/1983/1986 | Statuts tolérants accents/casse | comparaisons `===` interdites ailleurs |
| `FP.amendeAnomalies` | app:552 | Incohérences amende | — |
| `FP.tvsDetail`/`tvsCo2`/`tvsPolluant` | app:401/378/392 | TVS (barème CO₂ `TVS_CO2_BAREME` app:367) | source TVS unique |
| `FP.aenDetail` | app:1407 | Avantage en nature (barème/officiel, import CSV) | — |
| `FP.assuranceAnnuelle`/`primeVeh` | app:1259/1244 | Total primes assurance | nouvelle prime → l'intégrer au total |
| `FP.leasingContrat` | app:9236 | **Source unique** contrat leasing (base + overrides tolérants plaque) | lire ce helper (pas `base[immat]`) |
| `FP.estLeasing`/`leasingInfo`/`leasingEcheance`/`leasingLoyerCourant`/`leasingCoutContrat` | app:9260/9295/9274/9114/10162 | Échéances & coûts leasing | échéance inconnue ≠ terminé |
| `FP.leasingAnnuelFlotte`/`leasingMensuelFlotte`/`leasingMalusAnnuelFlotte` | app:1644/1529/1621 | Coûts leasing flotte | TCO/Contrats/dashboard = même source |
| `FP.coutExploitAnnee` | app:2155 | Coût exploitation véhicule/an (dédupe + reste-à-charge) | même périmètre que dashboard/budget/TCO |
| `FP.coutMois`/`dedupeFactures`/`coutFactureExploit` | app:1772/1752/628 | Coût du mois (hors leasing/achat/cession/sinistre) | source unique coûts mensuels |
| `FP.resteChargeSinistre`/`coutSinistre` | app:1718/1690 | Reste à charge sinistre (franchise après remboursement) | — |
| `FP.kmActuel`/`setVehKm`/`kmAnnuel` | app:2183/2189/2272 | km réel = max(km, dernierReleve) ; écrivain canonique | km ne recule jamais (`reconcileVehKm` sc:220) |
| `FP.revisionInfo`/`derniereRevision`/`revisionIntervalle` | app:8707/2071/8682 | Prochaine révision | source unique révisions |
| `FP.echeanceStatut`/`joursRestants` | app:2248/338 | Statut/couleur d'échéance ; décompte minuit-à-minuit | une seule logique valide/urgent/expiré |
| `FP.normImmat`/`immatEq`/`vehByImmat`/`_mapGetImmat` | app:1214/1232/1236/2414 | Plaque = **source unique** | jamais comparer/indexer en brut |
| `FP.normPrenom`/`prenomDeCle`/`condKeyParNom`/`conducteurNomUnifie` | app:7721/3838/3961/3910 | Clé conducteur ↔ prénom/fiche | jamais `key.split` |
| `FP.condKeyDeConso`/`congeKeysPourPrenom`/`consoPendantConge` | app:3876/3854/4118 | Rattache conso (carte/badge) → conducteur → congé | détection centralisée (ne pas dupliquer) |
| `FP.migrateCondKey`/`purgeCondKey` | app:3782/3798 | Déplace toutes les données keyées au renommage/fusion | renommer sans migrer = orphelins |
| `FP.txCat`/`totalFleetAnomaliesTx`/`consoApresDepart` | app:8541/8576/4238 | Catégorisation conso + anomalies carburant/péage | pipeline contrôle |

## 5. Alertes / échéances / santé
| Helper | fichier:ligne | Rôle | Risque |
|---|---|---|---|
| `FP.buildAlertes` | app:10670 | Génère toutes les alertes (CT, assurance, leasing, docs, emprunts…) | alertes critiques jamais masquées ; `muteKey` + signature |
| `FP.alertes` | app:11592 | « ✓ Vu » par signature (réapparaît si contenu change) | la signature ne doit pas inclure le compte à rebours |
| `FP.buildEcheances` | app:11647 | Échéances datées (calendrier/renouvellements), barème aligné sur alertes | même gravité/couleur qu'Alertes |
| `FP.santeVehicule`/`santeConducteur` | app:10198/10238 | Score santé | — |
| `FP.recommandations`/`cartesAnomalies` | app:10385/10515 | Recommandations & anomalies cartes | — |

## 6. IA / scan / OCR / stockage
| Helper | fichier:ligne | Rôle | Risque |
|---|---|---|---|
| `FP.scanIA` | app:13832 | Moteur de scan **unique** (couche texte PDF d'abord, sinon IA via Edge `scan-doc`) | jamais un 2ᵉ scanner |
| `FP.SCAN_PROMPT`/`CG_SCAN_PROMPT`/`EDL_KM_PROMPT`/`PRIME_ASSUR_PROMPT` | app:13633/13684/13928/14072 | Prompts IA (amende : 3 montants, jamais le majoré par défaut) | régression récurrente « majoré / Math.max » |
| `FP.scanZone` | app:13962 | Zone de dépôt/scan réutilisable | composant UI unique |
| `FP.uploadScan`/`signedScanUrl`/`openScan` | app:14320/14437/14471 | Upload privé rangé par société + accès signé | le bucket `scans` doit rester privé |
| `FP.detectDoc`/`askIA`/`aiHealth`/`ocr` | app:16808/14219/14275/14813 | Détection type doc, Q/R IA, diagnostic, OCR local | — |

## 7. UI / composants réutilisables
| Helper | fichier:ligne | Rôle | Risque |
|---|---|---|---|
| `FP.searchSelect` | app:2624 | `<select>` → recherche clavier | tout sélecteur véhicule/conducteur doit y passer |
| `FP.conducteurPicker` | app:4742 | Combobox conducteurs + « ➕ Créer » | tout champ conducteur/emprunteur doit y passer |
| `FP.newConducteurModal` | app:4696 | Modale création conducteur (2 champs prénom/nom) | identité = 2 champs |
| `FP.conducteurs` | app:3027 | Module conducteurs (affichage = prénom seul sauf homonyme) | source unique affichage/recherche |
| `FP.filterResetButton` | app:2849 | Bouton « ↺ Réinitialiser » de barre de filtres | toute barre de filtres doit l'avoir |
| `FP.msg` | app:19038 | **Prévenir un conducteur = SMS + WhatsApp + E-mail** | tout point d'envoi doit passer `email` |
| `FP.galerie3d` | app:19415 | Galerie/carrousel 3D de cartes | galerie photos unique |
| `FP.docsFolder` | app:16173 | Documents d'une fiche (types, checklist vente) | émet `fp:docs-changed` |
| `FP.dialog`/`confirm`/`alert`/`prompt` | app:12030/12144-12150 | Boîtes de dialogue (remplace `window.confirm`) | — |
| `FP.toast`/`notifyError`/`undoToast` | app:11991/11981/18975 | Feedback visible | feedback obligatoire |
| `FP.history` | app:17360 | Undo/Redo (Ctrl+Z/Y) | `renderAll` défini par chaque page |
| `FP.qr` | app:677 | QR véhicule — **source unique** (`renderQrCard`, écran/PNG/impression) | les 3 sorties du même générateur |
| `FP.ensureJsPDF` | app:5498 | Charge jsPDF+autotable à la demande (perf) | tout export PDF via ce schéma |
| `FP.fiche` | app:18597 | Relevé PDF configurable (colonnes, période) | — |
| `FP.csv`/`xlsx`/`exportRows` | app:18009/18086/18204 | Exports CSV/Excel | mêmes données/calculs que l'écran |

## 8. E-mail
| Helper | fichier:ligne | Rôle | Risque |
|---|---|---|---|
| `FP.sendEmail` | sc:52 | Envoi via Edge `send-email` (from/reply-to par société + copies auto) | ne pas changer les adresses PXP ; from = domaine vérifié |
| `FP.buildMail`/`registerMail`/`mails` | app:19914/19908/19906 | Construit/registre des e-mails enregistrés | — |
| `FP.mailBrand` | app:19756 | Ossature e-mail brandée par société | source unique mise en forme |
| `FP.mailModeleProfilL`/`mailObjetL`/`fillTags` | app:5056/5107/5017 | Modèles/objets par profil + langue + substitution de tags | — |

## 9. Anti-doublon
| Helper | fichier:ligne | Rôle | Risque |
|---|---|---|---|
| `FP.dupe` | app:16584 | `find`/`confirmAdd`/`mergePatch` (factures n°+TTC ; amendes n° avis ; véhicules immat ; conducteurs key/nom ; emprunts ; dossiers_achat) | tout nouveau point d'ajout DOIT y passer |

## 10. `fleet-views.js`
`FP.mountUlys(container)` (fv:18) / `FP.mountTotal(container)` (fv:607) : injectent les vues Total Fleet / Ulys (KPI, conso par conducteur/badge, filtres période, exports, anomalies) — réutilisées par `factures.html` **et** `controle.html` (un seul code source, plus d'iframe). Réutilise `FP.estUlys`/`estTotalFleet`/`norm`/`euro`/`ocr`/`txCat`.

## Notes transversales
- **Chaîne d'écriture canonique** : UI → `FP.settings.save`/`FP.persist.*` → (fusion delta `FP._fusion` / tables via `FP.projections`) → Supabase → `loadAll`/`refreshData` → `fp:data-ready` → re-render. Casser un maillon = perte silencieuse (priorité n°1).
- **`COLLECTION_KEYS`** (app:6700) : liste blanche des maps de données fusionnées finement. Toute nouvelle donnée keyée (par conducteur/véhicule/sinistre) **doit** y être ajoutée.
- Quelques détails internes marqués `[HYPOTHÈSE]` (`FP.ocr`, `FP.backups.restore`, `FP.chauffeurImmats`) — leur ligne de **définition** est vérifiée, pas tout le corps.
