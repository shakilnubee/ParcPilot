# 04 — Supabase & données

> Instantané 03/11/2026, **documenté à partir des fichiers du dépôt** (migrations + scripts SQL + mapping client), **pas** en interrogeant une base. Légende `[VÉRIFIÉ]` (dans le SQL) / `[DOC]` / `[HYPOTHÈSE]`.
> Projet **prod** : `tzjuptlzoywjeigmyfuj` · **staging** : `csvjmzwexszsbowibxut`.
> ⚠️ `supabase/LISEZ-MOI.md` : seules les **migrations versionnées** (`supabase/migrations/`) font foi de l'état réel. Les scripts à la racine `supabase/` et dans `historique/` sont des **archives à NE PAS rejouer** (plusieurs rouvriraient des failles corrigées). L'état appliqué en prod est consigné dans `supabase/migrations/JOURNAL.md`.

## 1. Tables de données métier (isolées par société via colonne `societe`)

| Table | PK | Rôle & colonnes notables | Source |
|---|---|---|---|
| `vehicules` | `id` | Fiche véhicule. Nombreuses colonnes (`carburant, assurance, proprietaire, crit_air, date_dernier_ct, derniere_revision, co2, puissance_fiscale, anti_pollution, cg_url, note_pneus, type_pneus, boite, couleur, autonomie, societe`) + migrations récentes `entite_rattachement`, `pays_immat`, `mode_detention`. | `[VÉRIFIÉ: migrations + historique]` |
| `amendes` | `id` | `points, cle, archived, justif_url, numero_telepaiement, immatriculation, pieces(jsonb)` + majoration (`date_majoration, majoree, montant_majore, numero_avis_majore`), `societe`. `pieces=[{id,label,url,date}]`. | `[VÉRIFIÉ: amendes-pieces.sql, add-amende-immatriculation.sql]` |
| `factures` | `id` | Facture fournisseur + **source/categorie/conducteur** (notes de frais — *migration en attente*). `montant_ht/tva/ttc`, `societe default 'PXP'`. | `[VÉRIFIÉ: factures-notes-de-frais-columns.sql]` |
| `conducteurs` | **`key`** (pas `id`) | `nom, prenom, adresse, date_naissance, tel, email, permis_*`, `societe`. Colonne `id uuid` préparée (`conducteurs-id-stable.sql`) mais **non branchée**. `key` = prénom / prénom-nom / id (cf. `FP.prenomDeCle`). | `[VÉRIFIÉ: PK_BY_TABLE]` |
| `documents` | `id` | Pièces liées aux fiches (`type` = `code-cession`, `controle-technique`, `sinistre-doc`…, `url`=lien Drive/scan). Colonnes exactes créées **avant** le dépôt. | `[VÉRIFIÉ existence+RLS]` / `[HYPOTHÈSE colonnes]` |
| `emprunts` | — | Prêts/réservations internes. Schéma non versionné. | `[HYPOTHÈSE]` |
| `total_conso` | — | Conso Total Fleet agrégée. RLS `tenant_total_conso`. | `[VÉRIFIÉ existence]` |
| `total_conso_tx` | `id` text | **Détail transaction** Total Fleet : `mois, date_tx, carte, conducteur, plaque, produit, categorie(carburant/repas/lavage/parking/autre), montant_ttc, facnum`. | `[VÉRIFIÉ: total-conso-tx-setup.sql]` |
| `ulys_conso` | `id` text | Conso Ulys (péage) par conducteur/mois : `badge, nb_trajets, km, total_ttc, numero_facture`. | `[VÉRIFIÉ: ulys-conso-setup.sql]` |
| `declarations_conducteur` | `id` text | Portail QR : `type(sinistre/probleme/etat_lieux/km/question), date_incident, lieu, description, tiers, blesses, photos(jsonb), statut(nouveau/traite), sinistre_id`. | `[VÉRIFIÉ: portail-conducteur.sql]` |
| `reservations` | `id` text | Réservation véhicule (public/interne) : `vehicule_id, demandeur_*, debut/fin, statut, source(public/interne/bloc), verifie`. **RLS sans policy anon** (écriture via Edge Function). | `[VÉRIFIÉ: 20261030150000]` |
| `dossiers_achat` | `id` text | Suivi **d'acquisition** (nous achetons) : `statut, marque, modele, prix_ht/ttc, acompte_*, paiements(jsonb), vehicule_id`. ⚠️ ≠ `offres_achat`. | `[VÉRIFIÉ: 20261030140000]` |
| `offres_achat` | `id` text | Offres reçues d'un **acheteur** (véhicule qu'on vend) : `token, vehicule_id, plaque, prix, acheteur(jsonb), statut(lien/recu/archive)`. Écriture publique via Edge Function (token). | `[VÉRIFIÉ: add-offres-achat.sql]` |

## 2. Tables techniques / config

| Table | PK | Rôle | Source |
|---|---|---|---|
| `app_settings` | `id` (= nom société, ex. `PXP`) | **Cœur config + données de travail** : `data(jsonb)`, `updated_at`, `rev(bigint)` (trigger `touch`). Écriture ciblée via `FP.settings._effectiveId` (anti bug « deux tiroirs » PXP/global). | `[VÉRIFIÉ: app_settings-concurrence.sql]` |
| `app_settings_history` | — | Snapshots versionnés (trigger `fp_snapshot_app_settings`). | `[VÉRIFIÉ: app-settings-history.sql]` |
| `profiles` | `id`→`auth.users` | **Source de vérité des rôles** : `email, societe, is_admin, role`. Seule policy `profiles_self_read` ; **aucune policy d'écriture** (anti-escalade) → seule `manage-users` (service_role) écrit. | `[VÉRIFIÉ: roles-ceo-admin-gestionnaire.sql]` |
| `scans` (table) | `id` text | Traçabilité Scanner IA : `type_document, statut(a_valider/valide/ignore), fichier_url, extraction(jsonb), cible_table/id`. ⚠️ ≠ bucket `scans`. | `[VÉRIFIÉ: scans-table-setup.sql]` |
| `driver_absences` | `id` | **Congés** (1 ligne/congé) : `cond_key, debut, fin, motif, deleted_at`. | `[VÉRIFIÉ: 20260918]` |
| `vehicle_assignments` | `id` | **Affectations** véhicule↔conducteur : `veh_id, ordre, conducteur, debut, fin, km_debut/fin, extra(jsonb), deleted_at`. Pas de FK (historique survit au véhicule). | `[VÉRIFIÉ: 20261020140000]` |
| `lease_contracts` | `id` | **Contrats LLD** : `contrat_id, ordre, contrat(jsonb), immat GENERATED`. | `[VÉRIFIÉ: 20261021090000]` |
| `lease_overrides` | `id` | **Forfaits leasing par plaque** : `cle, forfait(jsonb), immat_norm GENERATED`. | `[VÉRIFIÉ: 20261021100000]` |
| `settings_items` | `id` | **Table générique** « 1 élément = 1 ligne » : `collection, cle, valeur(jsonb), deleted_at`. Collections (liste fermée `fp_element_collection_ok`) : assurances, tâches, sinistres (cf. §4). | `[VÉRIFIÉ: 20261021110000+]` |
| `controle_findings` | `societe` (upsert) | Cache des trouvailles de la page Contrôle (lu par le KPI alertes du dashboard). | `[VÉRIFIÉ: controle-findings-cache.sql + usage]` |
| `qr_scans` | `id` uuid | Journal des scans QR (mode portail/km, user_agent), **aucune PII**, anti-spam 20 min. | `[VÉRIFIÉ: qr-scans.sql]` |
| `audit_log` | `id` | Journal d'audit par société : `user_email, action, entity, rec_id, champs`. `audit_insert` ouvert, `audit_delete`=**CEO**, **pas d'UPDATE** (inviolable). | `[VÉRIFIÉ: audit-log.sql]` |
| `push_subscriptions` | `id` uuid | Abonnements Web Push (VAPID) : `endpoint(unique), p256dh, auth`. | `[VÉRIFIÉ: push-notifications.sql]` |
| `push_log` | `dedup_key` | Anti-doublon des rappels push (écrit par Edge Function service_role). | `[VÉRIFIÉ: task-reminders-setup.sql]` |
| `edl_signatures` | **`token`** | Signature EDL intégrée : `sens(remise/restitution), pdf_url, signed_pdf_url, signataires(jsonb), statut`. | `[VÉRIFIÉ: edl-signatures.sql]` |
| `km_requests` | `id` uuid | Collecte km par lien e-mail : `token(unique), km_avant/recu, expires_at, used_at`. | `[VÉRIFIÉ: km-collecte-setup.sql]` |
| `messages` | `id` uuid | Boîte « Aide » (support in-app → CEO) : `sujet, body, reponse, statut`. Lecture auteur+CEO, modif/suppr **CEO**. | `[VÉRIFIÉ: messages-aide.sql]` |
| `prospects` | `id` uuid | Formulaire « intéressé ». ⚠️ `prospects_insert_anon` (anon **INSERT seul**, aucun SELECT) ; lecture réservée à 2 e-mails propriétaires. | `[VÉRIFIÉ: prospects.sql]` |

## 3. RLS, permissions & isolation multi-sociétés

- **RLS activée** sur les tables de données (`enable-rls.sql`), suppression des anciennes policies « tout autoriser ». `[VÉRIFIÉ]`
- **Patron tenant** (`multi-societe-rls.sql`) sur chaque table : `using/with check ( fp_is_admin() OR coalesce(societe,'PXP') = fp_societe() )`. Toutes les tables récentes le reprennent (`tenant_<table>`). `[VÉRIFIÉ]`
- **Fonctions SECURITY DEFINER** qui lisent `profiles` sans boucler sur la RLS : `fp_is_admin()`, `fp_societe()`, `fp_role()` (→ `ceo`/`admin`/`gestionnaire`). `[VÉRIFIÉ]`
- **Isolation** : colonne `societe` sur chaque table (sans étiquette = `PXP`), filtrage **en base** par les policies (pas seulement l'affichage) ; côté client, `filterSociete()`/`stampSociete()` (localStorage `fp_societe`, `__all__`=tout). `[VÉRIFIÉ]`
- **`app_settings` — correctif gestionnaire (2026-08-25)** : le durcissement du 2026-07-30 (`fp_role() <> 'gestionnaire'`) a été **annulé** (il cassait les opérations normales car `app_settings.data` mêle config ET données de travail). État : policy permissive `tenant_app_settings` (`fp_is_admin() OR id = fp_societe()`). Config réservée à l'admin **au niveau interface** (`FP.canManageSociete()`/`gateParamForGestionnaire`). ⚠️ Ne pas réappliquer le durcissement tant que config et données ne sont pas séparées. `[VÉRIFIÉ: gestionnaire-app-settings-fix.sql + DOC]`

## 4. Données de travail migrées `app_settings` → tables dédiées

Mécanisme `FP.projections` : lecture des tables **en parallèle** des réglages ; supabase-client **remplace** `settings.<clé>` par leur contenu ; les écrans lisent toujours `settings.<clé>` (projection + copie de transition). `[VÉRIFIÉ: migrations + JOURNAL — appliqué prod 20-21/10]`

| Clé `app_settings.data` | Table | RPC d'écriture |
|---|---|---|
| `condConges` | `driver_absences` | `fp_conges_remplacer` / `fp_conges_renommer` |
| `affectations` | `vehicle_assignments` | `fp_affectations_remplacer` (valide dates/km **avant** d'effacer) |
| `localeaseContrats` (LLD) | `lease_contracts` | `fp_contrat_lld_enregistrer` / `_archiver` |
| `leasingContrats` (forfaits/plaque) | `lease_overrides` | `fp_forfait_leasing_enregistrer` / `_archiver` |
| `assureurs, assureurVeh, assuranceEcheance, assurancePrimes, assuranceIgnore` | `settings_items` | `fp_element_enregistrer` / `_archiver` |
| `taches, rappelsPerso, tachesAutoFaites, rappelsFaits, automationDone` | `settings_items` | idem |
| sinistres (8 collections : `sinistreStatut/Stage/Groupes/Assurance/Sous/DocSub/Dossiers/DossiersSupprimes`) | `settings_items` | idem |

Restauration/import : **toujours** via `FP.restaurerReglages(data)` (remet aussi les tables). ⚠️ `km-collect` lit encore la **copie de transition** des affectations.

## 5. Storage (bucket `scans`, privé)

- **Bucket unique `scans`** (cartes grises, permis, avis, constats, EDL, contrats, photos), rendu **privé** (`storage-scans-prive.sql`) → tout servi via **liens signés temporaires** (`FP.signedScanUrl`). `[VÉRIFIÉ]`
- **Accès anonyme fermé** (`20261016120000`, appliqué 16/10). `[VÉRIFIÉ: JOURNAL]`
- **Cloisonnement par société** (`20261017090000`, appliqué 17/10) : rangement `societes/<slug>/<dossier>/<fichier>` (`fp_slug`), fonction `fp_storage_acces(objet)` (CEO, ou sa société, ou ancien fichier hors `societes/` pour PXP). Helpers `FP.storageSlug`/`storageDossierSociete`, miroir `fpSlug` Edge Functions. ⚠️ `ISOLATION-STORAGE-A-FAIRE.md` décrit l'**ancien** plan (`<societe>/`) — **remplacé**. `[VÉRIFIÉ]`
- **Vue `vehicules_public`** (QR) : lecture seule (`20261016120100`), puis SELECT direct retiré à anon/authenticated (`20261023110000`) → accès uniquement via RPC `vehicule_public_par_plaque` (1 ligne/plaque). `[VÉRIFIÉ]`
- **Avis publics** : accès anonyme au dossier `avis/` retiré (2026-08-03) ; e-mails d'amende = avis en pièce jointe + lien signé 7 j. `[VÉRIFIÉ: storage-avis-public-lien.sql]`

## 6. Triggers & garde-fous (sur `app_settings`)

- `trg_00_geler_ligne_global` → refuse toute écriture de la ligne `id='global'` (archive gelée du correctif « deux tiroirs »). `[VÉRIFIÉ: 20261016130000]`
- `trg_01_anti_vidage_reglages` → refuse un UPDATE qui supprime >10 % des clés, vide une collection « précieuse » (≥2 éléments), ou vide le `profil`. Soupape `set local fp.autoriser_vidage='on'`. `[VÉRIFIÉ: 20261017120000]`
- `trg_app_settings_touch` (incrémente `rev`, `updated_at`) ; `trg_snapshot_app_settings` (historise). `[VÉRIFIÉ]`

## 7. Fonctions RPC

`fp_is_admin`/`fp_societe`/`fp_role` (SECURITY DEFINER) · `fp_slug`/`fp_storage_acces` · `fp_conges_remplacer`/`_renommer` · `fp_affectations_remplacer` · `fp_contrat_lld_enregistrer`/`_archiver` · `fp_forfait_leasing_enregistrer`/`_archiver` · `fp_element_collection_ok` + `fp_element_enregistrer`/`_archiver` · `fp_taille_json` · **`vehicule_public_par_plaque`** (EXECUTE à anon + authenticated, QR). Toutes les écritures app passent par `FP.persist.rpc` (file durable). `[VÉRIFIÉ]`

## 8. Migrations en attente / points ouverts `[VÉRIFIÉ: MIGRATIONS-EN-ATTENTE.md, CLAUDE.md]`

- **`app_settings-concurrence`** : phase 1 (`rev`/trigger) appliquée ; **phase 2 côté code** (CAS `rev=ancien`, relire/refusionner) **non faite**.
- **`conducteurs-id-stable`** : `id uuid` préparé, bascule des liens `key`→`id` **non faite** (lourde, priorité faible).
- **`factures-notes-de-frais-columns`** : **à lancer** (sans, catégorie/conducteur des notes de frais ne persistent pas).
- **`ISOLATION-STORAGE-A-FAIRE.md`** : **résolu** par `20261017090000` (doc obsolète).
- **Espace salarié (chauffeur)** : **dormant** — avant activation : stocker `role='chauffeur'`+plaques dans `profiles`, étendre `fp_role()`, policies RLS lecture seule scopées plaque.
- **« Solution 2 » e-mails** (envoi au nom société depuis domaine plateforme) : en attente de go.

> **Fiabilité** : colonnes exactes de `documents`, `emprunts`, `total_conso` non trouvées en SQL versionné (tables créées avant le dépôt) → `[HYPOTHÈSE]` sur leur schéma ; existence + RLS confirmées. Aucun secret/donnée perso recopié.
