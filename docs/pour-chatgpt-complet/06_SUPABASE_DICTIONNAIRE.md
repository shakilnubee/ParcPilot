# 06 — Dictionnaire de données Supabase

> Instantané 03/11/2026, **documenté depuis les fichiers du dépôt** (migrations + scripts + mapping client), **aucun accès base**. Projet prod `tzjuptlzoywjeigmyfuj` · staging `csvjmzwexszsbowibxut`.
> Statut par fiche : **[confirmé migration]** = DDL versionné dans `supabase/migrations/` (appliqué en prod jusqu'au 30/10/2026 d'après `JOURNAL.md`) · **[archive historique]** = table/colonne créée à la main, DDL reconstitué depuis `supabase/historique/` + `supabase/*.sql` · **[à vérifier en base]** = le SQL versionné ne prouve pas l'état réel (voir aussi `00_MANIFESTE.md` §« à vérifier »).
> Aucun secret ni donnée personnelle ici.

## Conventions communes
- **Helpers RLS** (SECURITY DEFINER) : `fp_is_admin()` (true=CEO), `fp_societe()` (société du compte), `fp_role()` (`ceo`/`admin`/`gestionnaire`). **Patron « tenant »** répété : `USING/CHECK ( fp_is_admin() OR coalesce(societe,'PXP') = fp_societe() )`.
- **Mapping client** (`supabase-client.js`) : camelCase auto, overrides `montant_ht/tva/ttc↔montantHT/TVA/TTC`, `changer_cg↔changerCG`, `prochain_ct↔prochainCT`, `date_dernier_ct↔dateDernierCT`, **`note_pneus↔autonomie`**, **`type_pneus↔version`**. PK non standard : `conducteurs.key`, `edl_signatures.token`, `controle_findings.societe`, `push_log.dedup_key` ; tout le reste `id`.
- **Écriture résiliente** : une colonne inconnue est retirée et la ligne réécrite (`writeResilient`, schéma en retard toléré).

## 1. Tables de données métier (créées avant le dépôt)

### `vehicules` — fiche véhicule **[archive historique]** + colonnes [confirmé migration]
- **PK** `id` (text). **RLS** `tenant_vehicules`.
- **Colonnes connues** (`historique/supabase-*.sql` + migrations) : `carburant text, assurance text, proprietaire text` (propriétaire **juridique**, distinct de `societe`), `crit_air text, date_dernier_ct date, derniere_revision date, valeur_achat numeric, commentaire text, photo_url text, sanef bool, etat_des_lieux bool, cle_siege/cle_salarie/cg_orig_siege/cg_orig_salarie bool, co2 numeric, puissance_fiscale numeric, anti_pollution date, autonomie text` (**ignorée** par l'app), `dimension_pneus text, type_pneus text` (réutilisée pour **version/finition**), `date_changement_pneus date, note_pneus text, prix_vente numeric, pipeline_statut text, cg_url text, couleur text, boite text` (Manuelle/Automatique), `societe text default 'PXP'`. Migrations `20261102*` : `entite_rattachement, pays_immat, mode_detention text` + index `vehicules_entite_idx` — **[à vérifier en base]** (absentes du JOURNAL).
- **Colonnes de base** (`immat`/`immatriculation`, `marque`, `modele`, `km`, `chauffeur`, `vin`, `pool`…) existent mais **types non prouvés [à vérifier en base]**.
- **Vue dérivée** : `vehicules_public` (QR, lecture seule — voir §Storage/Vues).

### `amendes` — contraventions **[archive historique]** + migrations
- **PK** `id` (text, ex. `AM-0009`). **RLS** `tenant_amendes`.
- **Colonnes** : `points numeric, societe text default 'PXP', justif_url text, archived bool, numero_telepaiement text, cle text, majoree bool default false, montant_majore numeric, date_majoration date, numero_avis_majore text, avis_url text, pieces jsonb not null default '[]'` (`[{id,label,url,date}]`), `immatriculation text`. Base (`prenom, montant, date, numero_avis`, montants minoré/forfaitaire) **[à vérifier en base]**. `amendes_backup` : RLS activée, fermée.

### `factures` — factures / coûts **[archive historique]** + migrations
- **PK** `id` (text). **RLS** `tenant_factures`.
- **Colonnes** : `societe text default 'PXP'`, `source text, categorie text, conducteur text` + index `idx_factures_source(societe, source)` (`factures-notes-de-frais-columns.sql` — **en attente**). Base (`montant_ht/tva/ttc, fournisseur, numero, file_id, immat, km, date, type`) **[à vérifier en base]**. `factures_backup` : RLS activée, fermée.

### `conducteurs` — collaborateurs **[archive historique]** + migrations
- **PK** **`key`** (text). **RLS** `tenant_conducteurs`. ⚠️ Contient de la **PII** (permis, adresse) → `data.js` public strippé.
- **Colonnes** : `nom, prenom, adresse text, date_naissance date, tel, email, note, poste text, permis_type, permis_numero text, permis_obtention/permis_expiration date, societe text default 'PXP', id uuid default gen_random_uuid() NOT NULL` + index unique `conducteurs_id_key` (**colonne secondaire** ; PK reste `key`). `masque, manuel, permis_url, permis_file_id` **[à vérifier en base]**.

### `documents` **[à vérifier en base]** · `emprunts` **[à vérifier en base]** · `total_conso` **[à vérifier en base]**
- **Aucun `CREATE TABLE` dans le dépôt** pour ces 3 tables. Colonnes connues : `documents` (usage app : `type`, `url`, `vehicule_id`/`immat`, `societe`) · `emprunts` (`societe` + véhicule/emprunteur/dates) · `total_conso` (`total_ht/total_tva numeric` ajoutés par `fix-total-conso-rls.sql`, `societe`). **RLS** `tenant_documents`/`tenant_emprunts`/`tenant_total_conso`. **Colonnes/PK exactes → à vérifier en base.**

## 2. Tables dédiées (créées par migration) **[confirmé migration]**

| Table | PK | Colonnes clés | Index / contraintes | RLS | Écriture |
|---|---|---|---|---|---|
| `driver_absences` (congés) | `id bigint identity` | `societe, cond_key, debut date, fin date, motif, deleted_at` | `(societe, cond_key)` | `tenant_driver_absences` | RPC `fp_conges_remplacer/renommer` |
| `vehicle_assignments` (affectations) | `id bigint identity` | `societe, veh_id (→vehicules.id, pas de FK), ordre, conducteur, debut/fin date, km_debut/fin int, *_manuel bool, extra jsonb, deleted_at` | `(societe, veh_id, ordre)` | `tenant_vehicle_assignments` | RPC `fp_affectations_remplacer` |
| `lease_contracts` (LLD) | `id bigint identity` | `societe, contrat_id, ordre, contrat jsonb, immat text GENERATED (contrat->>'immat'), deleted_at` | unique partiel `(societe, contrat_id) WHERE deleted_at IS NULL` | `tenant_lease_contracts` | RPC `fp_contrat_lld_enregistrer/archiver` |
| `lease_overrides` (forfaits/plaque) | `id bigint identity` | `societe, cle, forfait jsonb, immat_norm text GENERATED (upper regexp cle), deleted_at` | unique partiel `(societe, cle) WHERE deleted_at IS NULL` | `tenant_lease_overrides` | RPC `fp_forfait_leasing_enregistrer/archiver` |
| `settings_items` (générique) | `id bigint identity` | `societe, collection, cle, valeur jsonb, ordre, deleted_at` | unique partiel `(societe, collection, cle) WHERE deleted_at IS NULL` | `tenant_settings_items` | RPC `fp_element_enregistrer/archiver` |
| `dossiers_achat` (acquisition) | `id text` (ACH-) | `societe, statut default 'projet', marque/modele/version/motorisation/immat/vin, fournisseur, mode_financement, date_commande, date_livraison_prevue/reelle date, prix_ht/ttc/acompte_* numeric, paiements jsonb, vehicule_id, deleted_at` | `(societe)`, `(societe, statut)` | `tenant_dossiers_achat` | app (`FP.db`) |
| `reservations` | `id text` (RES-) | `societe, vehicule_id, immat, demandeur_nom/email/tel, motif, debut/fin timestamptz, statut default 'en_attente', verifie bool, source default 'public', deleted_at` | `(societe, vehicule_id)`, `(societe, debut)` | `tenant_reservations` (**pas d'anon** → Edge `reservation`) | Edge Function |

`settings_items` collections acceptées (liste fermée `fp_element_collection_ok`) : **assurances** (`assureurs, assureurVeh, assuranceEcheance, assurancePrimes, assuranceIgnore`), **tâches** (`taches, rappelsPerso, tachesAutoFaites, rappelsFaits, automationDone`), **sinistres** (`sinistreStatut, sinistreStage, sinistreGroupes, sinistreAssurance, sinistreSous, sinistreDocSub, sinistreDossiers, sinistreDossiersSupprimes`).

## 3. Tables techniques (scripts versionnés, hors `migrations/` → **[à vérifier en base]** pour l'application réelle)

| Table | PK | Colonnes clés | RLS / accès | Source |
|---|---|---|---|---|
| `app_settings` | `id text` (=société ; `global` gelé) | `data jsonb, updated_at, rev bigint` | `tenant_app_settings` : `fp_is_admin() OR id = fp_societe()` (⚠️ compare `id`) | `reglages-par-societe.sql` + triggers (voir §4) |
| `app_settings_history` | `id bigint` | `societe, data jsonb, summary, changed_at` | `tenant_app_settings_history` | `app-settings-history.sql` |
| `profiles` | `id uuid` **FK→auth.users** (on delete cascade) | `email, societe (null=CEO), is_admin bool default false, role text default 'admin'` | **seule** `profiles_self_read` (SELECT self) ; **aucune écriture** → `manage-users` | `roles-ceo-admin-gestionnaire.sql` |
| `scans` (traçabilité IA) | `id text` | `societe default 'PXP', type_document, sous_type, statut default 'a_valider', qualite, fichier_url, extraction jsonb, cible_table/id, created_by uuid default auth.uid()` | `tenant_scans` (⚠️ `societe=fp_societe()` sans coalesce) | `scans-table-setup.sql` |
| `total_conso_tx` | `id text` (facnum-idx) | `societe, mois, date_tx date, carte, conducteur, plaque, produit, categorie, montant_ttc numeric, facnum` | `tenant_total_conso_tx` + index perf | `total-conso-tx-setup.sql` |
| `ulys_conso` | `id text` (ULYSC-) | `societe, mois, conducteur, badge, nb_trajets int, km numeric, total_ttc numeric, numero_facture` | `tenant_ulys_conso` | `ulys-conso-setup.sql` |
| `qr_scans` | `id uuid` | `vehicule_id, plaque, societe, mode (portail/km), user_agent, scanned_at` (0 PII) | `tenant_qr_scans` (insert via Edge) | `qr-scans.sql` |
| `declarations_conducteur` | `id text` | `vehicule_id, plaque, societe, type (sinistre/probleme/etat_lieux/km/question), date_incident, lieu, description, tiers, blesses, photos jsonb, statut default 'nouveau', sinistre_id, reponse, reponse_at` | `tenant_declarations_conducteur` (insert via Edge `km-collect`) | `portail-conducteur*.sql` |
| `push_subscriptions` | `id uuid` | `societe, user_id uuid, email, endpoint text UNIQUE, p256dh, auth, user_agent` | `tenant_push_subscriptions` | `push-notifications.sql` |
| `push_log` | `dedup_key text` | `societe, created_at` | RLS activée, **écriture Edge service_role seulement** | `task-reminders-setup.sql` |
| `edl_signatures` | **`token text`** | `vehicule_id, plaque, societe, employe, modele, date, sens (remise/restitution), pdf_url, signed_pdf_url, field_employe/field_societe jsonb, signataires jsonb, statut default 'en_attente'` | `tenant_edl_signatures` (écriture via Edge `edl-sign`) | `edl-signatures.sql` |
| `km_requests` | `id uuid` | `token text UNIQUE, vehicule_id, plaque, societe, chauffeur, email, km_avant/recu int, expires_at, used_at, source` | `tenant_km_requests` (Edge `km-collect`) | `km-collecte-setup.sql` (+ `km-qr-setup.sql`) |
| `km_qr` | `token text` | `vehicule_id, plaque, societe, created_at` | `tenant_km_qr` | `km-qr-setup.sql` |
| `audit_log` | `id bigint` | `ts, user_email, action, entity, rec_id, label, champs, societe default coalesce(fp_societe(),'PXP')` | `audit_read` (admin/sa société), `audit_insert`, `audit_delete` (**CEO**), **pas d'UPDATE** (inviolable) | `audit-log.sql` |
| `messages` (aide) | `id uuid` | `societe, user_id uuid default auth.uid(), email, sujet, body, reponse, statut default 'ouvert'` | `messages_insert` (self), `messages_select` (auteur/CEO), `update/delete` (**CEO**) | `messages-aide.sql` |
| `prospects` | `id uuid` | `nom, email, tel, societe, message, statut default 'nouveau'` | `prospects_insert_anon` (**anon INSERT**, pas de SELECT) ; lecture = 2 e-mails propriétaires | `prospects.sql` |
| `controle_findings` | **`societe text`** | `sig, probe_sig, findings jsonb, updated_at` | `tenant_controle_findings` | `controle-findings-cache.sql` |
| `offres_achat` | `id text` | `token, vehicule_id, plaque, marque, modele, prix numeric, societe, type_acheteur, acheteur jsonb, statut default 'lien', ip, received_at` | `tenant_offres_achat` (écriture publique via Edge `offre-achat`) | `add-offres-achat.sql` |
| `amendes_backup` / `factures_backup` | — | copie | RLS activée **sans policy** (fermées) | `fix-isolation-backup-tables.sql` |

## 4. Triggers sur `app_settings` (ordre BEFORE par nom)
- `trg_00_geler_ligne_global` → refuse toute écriture/suppression de `id='global'` **[confirmé migration 20261016130000]**.
- `trg_01_anti_vidage_reglages` → refuse une MAJ qui supprime >10 % des clés / vide une collection « précieuse » (≥2→0) / vide le `profil` ; soupape `set local fp.autoriser_vidage='on'` ; helper `fp_taille_json(jsonb)` **[confirmé migration 20261017120000]**.
- `trg_app_settings_touch` → `updated_at=now(), rev=rev+1` **[à vérifier en base]**.
- `trg_snapshot_app_settings` → archive l'ancienne `data` dans `app_settings_history` (≈60 versions/société) **[à vérifier en base]**.
- `trg_guard_app_settings_config` → interdit à un **gestionnaire** de modifier `profil`/`societe`/`groupes`/`notif` (`gestionnaire-config-guard.sql`) **[à vérifier en base — présence incertaine]**.
- ⚠️ Le durcissement `durcissement-config-gestionnaire.sql` (écriture app_settings interdite au gestionnaire) a été **ANNULÉ** le 2026-08-25 (cassait les opérations) → **ne pas réappliquer** tant que config et données ne sont pas séparées en lignes distinctes.

## 5. Fonctions RPC (schéma `public`)
| Fonction | Params | Sécurité | EXECUTE | Rôle |
|---|---|---|---|---|
| `fp_is_admin()` / `fp_societe()` / `fp_role()` | — | DEFINER, stable | (implicite) | rôle/société du compte depuis `profiles` |
| `fp_slug(text)` / `fp_storage_acces(text)` | nom / chemin | IMMUTABLE / DEFINER | `authenticated` | slug dossier storage / droit d'accès fichier |
| `fp_taille_json(jsonb)` | valeur | IMMUTABLE | — | compte clés (anti-vidage) |
| `fp_conges_remplacer / fp_conges_renommer` | société, cond_key/noms, [congés] | **INVOKER** | `authenticated` | remplace/renomme congés (verrou advisory) |
| `fp_affectations_remplacer` | société, veh_id, périodes | INVOKER | `authenticated` | remplace périodes (valide dates/km avant effacement) |
| `fp_contrat_lld_enregistrer / _archiver` | société, id, [ordre, contrat] | INVOKER | `authenticated` | upsert/archive LLD |
| `fp_forfait_leasing_enregistrer / _archiver` | société, clé, [forfait] | INVOKER | `authenticated` | upsert/archive forfait |
| `fp_element_collection_ok(text)` + `fp_element_enregistrer / _archiver` | société, collection, clé, [valeur, ordre] | IMMUTABLE / INVOKER | `authenticated` | liste fermée + upsert/archive élément |
| `vehicule_public_par_plaque(text)` | p_immat | **DEFINER**, stable | **`anon` + `authenticated`** | 1 ligne `vehicules_public` par plaque (QR) — unique RPC exposée à anon |

Les RPC d'écriture (congés/affectations/contrats/forfaits/éléments) sont **INVOKER** → la RLS tenant s'applique ; appelées via `FP.persist.rpc` (file durable).

## 6. Storage — bucket `scans`
- **Privé** (`storage.buckets.public=false`) ; accès via **liens signés** uniquement. Accès anonyme **fermé** `[confirmé migration 20261016120000]`.
- **Rangement par société** `societes/<slug>/<dossier>/<fichier>` (`fp_slug` = `FP.storageSlug` / `fpSlug` Edge) ; anciens fichiers hors `societes/` = réputés PXP `[confirmé migration 20261017090000]`.
- 4 policies `scans_societe_{lecture,ajout,modification,suppression}` (`{authenticated}`), gardées par `fp_storage_acces(name)` (CEO=tout ; sinon fichier de sa société ; sinon ancien fichier + compte PXP). Edge Functions (service_role) contournent.
- **Vue `vehicules_public`** (QR) : lecture seule, SELECT retiré à anon/authenticated (`20261023110000`) → accès uniquement via RPC. **Définition exacte (colonnes/filtres) [à vérifier en base]** (aucun `CREATE VIEW` au dépôt).
- Lecture anonyme du dossier `avis/` **retirée** (2026-08-03) → e-mails d'amende = avis en pièce jointe + lien signé.

## 7. Tâches planifiées (pg_cron) **[à vérifier en base]**
`cron.schedule(...)` → `net.http_post` vers Edge Functions (header `x-cron-secret`) : `task-reminders` (`*/30 * * * *`), `km-relance-quotidienne` (`0 8 * * *`), `ulys-import-quotidien` (`30 6 * * *`). Vérifier `select * from cron.job`.

## 8. À vérifier directement en base (récap — voir `00_MANIFESTE`)
Colonnes/PK/types de `documents`/`emprunts`/`total_conso` et colonnes de base de `vehicules`/`amendes`/`factures`/`conducteurs` ; définition de la vue `vehicules_public` ; policy RLS réelle de `app_settings` + triggers réellement installés (surtout `trg_guard_app_settings_config`) ; existence+RLS des tables hors `migrations/` (scans, total_conso_tx, ulys_conso, qr_scans, declarations_conducteur, push_subscriptions, edl_signatures, km_requests, km_qr, audit_log, messages, prospects, offres_achat, controle_findings, push_log, app_settings_history, profiles) ; application réelle des migrations `20261102*` (absentes du JOURNAL) ; jobs pg_cron actifs + extensions ; privilèges EXECUTE des RPC. **Toutes les fiches `migrations/` sont confirmées appliquées jusqu'au 2026-10-30** (hors `20261102*`).
