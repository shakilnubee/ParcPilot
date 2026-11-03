# 09 — Problèmes, limites & dette technique

> Instantané 03/11/2026, lecture seule. **Séparation stricte** : A = faits vérifiés · B = hypothèses / à vérifier · C = recommandations. Ne jamais présenter B ou C comme un problème confirmé.

## A. Faits vérifiés `[VÉRIFIÉ]`

### A.1 Bugs corrigés récemment (plus actifs)
- **Fuite de pièces jointes dans le rapport PDF sinistre** (photos d'EDL / d'un autre sinistre du même véhicule) → **corrigée le 03/11/2026** (pièces jointes scopées à l'incident ; suppression du tirage par plaque depuis `DeclCond.rows`). `pages/sinistres.html`.
- **Préfixe de catégorie « Autre souci — » dans le récit du rapport** → **retiré à l'affichage** le 03/11/2026 (`stripDeclCatPrefix`), la déclaration en base est inchangée.
- Galerie 3D : clic sur une carte n'ouvrait pas la fiche → corrigé (garde de drag par déplacement net).

### A.2 Fonctions incomplètes / dormantes (par conception)
- **Espace salarié (`pages/espace-salarie.html`)** : page fonctionnelle mais **non activée** — le rôle `chauffeur` et les plaques vivent encore dans `user_metadata` (falsifiable) et la RLS n'isole que par société → un compte chauffeur verrait **toute** sa société (dont PII permis/adresses). **Aucun compte chauffeur en prod.** (Finding sécurité « élevé », dormant.)
- **`ulys-sync`** : passerelle API Ulys **lecture seule** (aucune écriture — paliers suivants non faits).
- **Ancien scanner-modale** du dashboard : **code mort volontaire** (secours), activé seulement si `#btn-scan-doc-classic` existe.

### A.3 Migrations / colonnes en attente
- **Notes de frais** : `factures.source/categorie/conducteur` (`factures-notes-de-frais-columns.sql`) **en attente** → sans elle, catégorie/conducteur des notes de frais ne persistent pas.
- **Concurrence `app_settings`** : phase 1 (`rev`/triggers) appliquée ; **phase 2 côté code** (CAS optimiste `rev=ancien_rev`, relire/refusionner) **non branchée** → risque théorique d'écrasement en cas d'écritures concurrentes très rapprochées sur la même société (atténué par la fusion delta + l'anti-vidage).
- **`conducteurs.id` stable** : colonne préparée, **bascule des liens `key`→`id` non faite** (priorité faible).
- Migrations **`20261102*`** (vehicules `type_pneus`, `entite_rattachement`/`pays_immat`/`mode_detention`) : **absentes du `JOURNAL.md`** → probablement **pas encore appliquées en prod**.

### A.4 Incohérences / dette technique (constatées)
- **Écart de documentation** : `CLAUDE.md` mentionne le cache `fp_data_cache_v3`, le code utilise **`v4`** (`app.js:26`, `supabase-client.js:428`).
- **Duplication de micro-helpers** : plusieurs pages redéfinissent localement `escapeHtml`/`euro`/`toIsoDate`/`pdfText`/`loadScript` (non centralisés). Dette mineure, sans risque fonctionnel immédiat.
- **Copie de transition** : la fonction serveur `km-collect` lit encore la **copie** des affectations dans `app_settings`, pas la table `vehicle_assignments`.
- **`app_settings` surchargé** : mélange config société **et** données de travail → la config n'est protégée **qu'au niveau interface** pour les gestionnaires (RLS permissive `tenant_app_settings`). Le durcissement base a dû être annulé (cassait les opérations).
- **`scans` (table) RLS** : `societe = fp_societe()` **sans** `coalesce(...,'PXP')` (contrairement aux autres tables) → une ligne `societe` NULL ne serait pas lisible par un non-CEO. `[VÉRIFIÉ: scans-table-setup.sql]` (à confirmer si des lignes NULL existent).

### A.5 Points forts (anti-perte, sécurité) — à ne pas casser
- File d'écriture durable optimiste (`FP.persist`), fusion delta (`FP._fusion`), `COLLECTION_KEYS`, `_effectiveId`, projections en tables dédiées, Corbeille, sauvegarde nocturne chiffrée + restauration d'essai.
- RLS `tenant_*` + tests d'isolation/accès anonyme quotidiens ; `profiles` sans écriture client (anti-escalade) ; storage privé cloisonné ; `send-email` anti-usurpation ; `audit_log` inviolable ; QR via RPC (pas de listing du parc).

## B. Hypothèses / à vérifier `[HYPOTHÈSE]` / `[À VÉRIFIER EN BASE]`
> Ce ne sont **pas** des bugs confirmés — ce sont des zones non prouvées par le dépôt.
- **Schémas non versionnés** : colonnes/types/PK exacts de `documents`, `emprunts`, `total_conso` et colonnes de base de `vehicules`/`amendes`/`factures`/`conducteurs` (cf. `06`). Vérifier via `information_schema`.
- **État réel des policies/triggers `app_settings`** : quelle policy RLS est active, quels triggers sont installés (surtout `trg_guard_app_settings_config`). Vérifier via `pg_policies`/`pg_trigger`.
- **Définition de la vue `vehicules_public`** (colonnes/filtres/`security_invoker`).
- **Jobs pg_cron réellement actifs** et secrets configurés (`select * from cron.job`).
- **Modèle IA actif en prod** (secrets `ANTHROPIC_MODEL`/`OPENAI_MODEL`).
- **Détail interne** de quelques helpers marqués `[HYPOTHÈSE]` dans `03` (`FP.ocr`, `FP.backups.restore`, `FP.chauffeurImmats`).

## C. Recommandations `[RECO]` (propositions, à valider — ne rien casser)
1. **Finir la sortie de `app_settings`** : séparer config / données de travail en lignes distinctes, puis reprotéger la config côté base (RLS) + brancher la phase 2 de concurrence (CAS `rev`).
2. **Basculer `km-collect`** sur `vehicle_assignments` (supprimer la copie de transition).
3. **Sécuriser l'espace salarié** avant toute activation (role+plaques dans `profiles`, RLS lecture seule scopées plaque) — condition **bloquante** pour un usage chauffeur.
4. **Catégorie de déclaration en champ structuré** (`v.html`) au lieu du préfixe dans le texte.
5. **Lancer la migration notes de frais** ; **appliquer/journaliser** les migrations `20261102*` après test staging.
6. **Aligner `CLAUDE.md`** sur le cache `v4` ; **centraliser** les micro-helpers dupliqués (`esc`/`euro`/`pdfText`) quand c'est sans risque.
7. **Uniformiser la RLS de `scans`** (`coalesce(societe,'PXP')`) si des lignes NULL peuvent exister.
8. **Versionner le schéma** des tables héritées (`documents`/`emprunts`/`total_conso`) dans une migration de référence (doc + staging).
9. **Observabilité des CRON** : petit tableau de bord interne (dernier run/erreurs km-relance/ulys-daily/task-reminders).
10. **Échelle multi-clients** : surveiller la taille de `app_settings.data` par société à mesure que les données de travail en sortent ; généraliser la pagination (`FP.selectAllPaged`).

> **Rappel pour ChatGPT** : toute évolution doit respecter les 16 règles (`01`), réutiliser les helpers `FP.*` (`03`/`04`), passer par migration versionnée testée sur staging (`06`), et par branche + PR + CI (`01`/`02`). En cas de doute → expliquer et demander validation.
