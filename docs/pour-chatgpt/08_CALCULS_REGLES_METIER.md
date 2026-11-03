# 08 — Calculs & règles métier

> Instantané 03/11/2026, lecture seule. Chaque règle a **un seul** helper source (`FP.*`, `assets/js/app.js`) réutilisé par écrans, dashboard, exports et PDF (règle « source unique »). Lignes approximatives. Légende `[VÉRIFIÉ]`.

## 1. Coûts & TCO
| Concept | Helper source | Réf | Règle |
|---|---|---|---|
| Coût du mois | `FP.coutMois(data, ym)` | 1772 | Factures **dédoublonnées** + filtre exploitation |
| Dédoublonnage factures | `FP.dedupeFactures(list)` | 1752 | par n° + TTC |
| Facture = coût d'exploitation ? | `FP.coutFactureExploit(f)` | 628 | **exclut** leasing, sinistre, achat, cession |
| Coût exploitation annuel / véhicule | `FP.coutExploitAnnee(v, annee, factures)` | 2155 | |
| Coût sur période | `FP.coutParPeriode(opts)` | 8822 | |
| Décote / valeur de revente | `FP.decoteVehicule` / `FP.valeurRevente` | 10347/10370 | |

Le **TCO par véhicule** (page statistiques) agrège factures d'exploitation + leasing + assurance + TVS + reste à charge sinistres ; il **exclut** le prix d'achat et les cessions. `[VÉRIFIÉ: statistiques.html via helpers]`

## 2. Leasing / LLD
| Concept | Helper | Réf |
|---|---|---|
| Contrat leasing d'une plaque (base + overrides, tolérant) | `FP.leasingContrat(immat)` | 9236 |
| Suivi forfait km (projection, dépassement) | `FP.leasingInfo(v)` | 9295 |
| Test / fin / terminé / actif | `FP.estLeasing` / `leasingEcheance` / `leasingTermine` / `leasingActif` | 9260+ |
| Coûts (contrat, loyer courant, total versé, malus) | `FP.leasingCoutContrat` / `leasingLoyerCourant` / `leasingTotalVerse` / `leasingMalus` | 10162/10114/10120/1567 |
| Agrégats flotte (annuel, mensuel) | `FP.leasingAnnuelFlotte` / `leasingMensuelFlotte` | 1644/1529 |

## 3. Fiscalité automobile
| Concept | Helper | Réf | Règle |
|---|---|---|---|
| TVS détaillée | `FP.tvsDetail(v)` | 401 | **CO₂ + polluant**, barème 2026 |
| Composantes TVS | `FP.tvsCo2` / `FP.tvsPolluant` | 378/392 | |
| TVS annuelle flotte | `FP.tvsAnnuelleFlotte` | 1275 | |
| Avantage en nature | `FP.aenDetail(v)` / `aenOfficielMontant` / `aenAnnuelFlotte` | 1407/1333/1466 | AEN officiel loueur |

## 4. Assurance
| Concept | Helper | Réf |
|---|---|---|
| Prime / annuel / échéance | `FP.primeVeh` / `assuranceAnnuelle` / `assuranceEcheanceOf` | 1244/1259/5326 |
| Assureur / libellé d'un véhicule | `FP.assureurOf` / `assuranceLabel` | 5252/5229 |

## 5. Amendes
| Concept | Helper | Réf | Règle |
|---|---|---|---|
| Montant dû | `FP.montantDu(a)` | 486 | majoré **si** `majoree`, sinon montant ; override si payée |
| Statut « à payer » / payée | `FP.estAPayer` / `estPayee` / `amendeStatut` | 1983/1986/1992 | tolérant accents/casse |
| FPS vs contravention, année, plaque | `FP.estFps` / `anneeAmende` / `amendePlaque` | 504/623/2004 | |
| Contrôles de cohérence | `FP.amendeAnomalies` / `amendeAnomaliesBanner` | 552/610 | |

**Règle des 3 montants (scan)** : minoré / forfaitaire / majoré lus séparément ; `montantTTC` = minoré sinon forfaitaire, **jamais** le majoré (l'app applique la majoration selon la date du jour). Anti-piège `Math.max` (repli OCR = `Math.min`). `[VÉRIFIÉ: cf. 06]`

## 6. Kilométrage & échéances
| Concept | Helper | Réf | Règle |
|---|---|---|---|
| Km réel | `FP.kmActuel(v)` | 2183 | `max(km, kmDernierReleve)` |
| Écriture km / relevé / km annuel | `FP.setVehKm` / `marquerReleveKm` / `kmAnnuel` | 2189/2222/2272 | |
| Décompte en jours | `FP.joursRestants(iso)` | 338 | calendaire, minuit→minuit |
| Statut échéance | `FP.echeanceStatut` + `ECHEANCE_SEUILS`/`ECHEANCE_COULEUR` | 2248/2239 | valide/bientôt/urgent/expiré |
| Échéances (toutes) | `FP.buildEcheances(data)` | 11647 | **source unique** calendrier/renouvellements/notifications |
| Révisions / intervalle | `FP.revisionInfo` / `revisionIntervalle` / `compteCommeRevision` | 8707/8682/2036 | |

## 7. Identité & normalisation (source unique)
| Concept | Helper | Réf |
|---|---|---|
| Plaque (normaliser / comparer / trouver véhicule) | `FP.normImmat` / `immatEq` / `vehByImmat` | 1214/1232/1236 |
| Prénom / clé conducteur | `FP.normPrenom` / `prenomDeCle` / `conducteurNomUnifie` | 7721/3838/3910 |
| Clé conducteur depuis une conso (carte/badge) | `FP.condKeyDeConso` | 3876 |
| Statut « vendu » / hors flotte / en entretien | `FP.estVendu` / `horsFlotte` / `estEnEntretien` | 419/427/422 |
| Loueur / assureur d'un véhicule (multi) | `FP.loueurOf` / `assureurOf` | 2370/5252 |

## 8. Carburant / péage & anomalies
| Concept | Helper | Réf |
|---|---|---|
| Catégorie d'une transaction | `FP.txCat` | 8541 |
| Conso pendant congé / après départ | `FP.consoPendantConge` / `consoApresDepart` | 4118/4238 |
| Anomalies Total Fleet | `FP.totalFleetAnomaliesTx` | 8576 |
| Type de relevé | `FP.estUlys` / `estTotalFleet` / `estCarburantPeage` | 1204/1205/1206 |

## 9. Agrégations, santé & rapports
| Concept | Helper | Réf |
|---|---|---|
| Santé véhicule / conducteur | `FP.santeVehicule` / `santeConducteur` | 10198/10238 |
| Recommandations | `FP.recommandations` | 10385 |
| Rapport de direction / RSE | `FP.rapportDirection` / `rapportRSE` | 11750/11908 |
| Coût d'un sinistre / reste à charge | `FP.coutSinistre` / `resteChargeSinistre` | 1690/1718 |
| Dépendances avant suppression véhicule | `FP.vehiculeDependances` / `vehiculeDeleteMessage` | 1648/1664 |

## 10. Intégrité des calculs
- **Même moteur partout** : écran = dashboard = export = PDF donnent le même résultat (helpers canoniques). `[VÉRIFIÉ]`
- **Cache d'un résultat calculé** : doit inclure `FP.ASSET_VERSION` (bumpé à chaque `?v=`) pour s'invalider au déploiement ; marqueur local `DETECT_VERSION` pour la logique propre à une page (ex. `controle.html`). `[DOC: CLAUDE.md — respecté]`
- **Tests** : `scripts/test-calculs.mjs` (calculs métier) + `tests/unit/*` (fusion réglages, projections) exécutés en CI. `[VÉRIFIÉ: README, ci.yml]`
- **Incohérences connues** : aucune incohérence de calcul prouvée dans le code au moment de l'audit ; les écarts historiques (forfait leasing, montant dû, « vendu » sensible à la casse) ont été centralisés dans les helpers ci-dessus. `[VÉRIFIÉ / DOC]`
