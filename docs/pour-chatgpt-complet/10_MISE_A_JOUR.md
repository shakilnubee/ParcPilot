# 10 — Processus de mise à jour de la documentation

> Instantané 03/11/2026, lecture seule. ⚠️ **Aucune tâche planifiée ni modification de workflow GitHub n'est créée** (interdit sans autorisation explicite). Ce document décrit un processus **manuel, à la demande**.

## 1. Quand régénérer
Après une **évolution importante** de Parc Pilot : nouvelle page/fonctionnalité, nouveau helper `FP.*`, changement de schéma Supabase (table/colonne/RLS/RPC), nouvelle Edge Function ou automatisation, correction de bug notable, nouvelle limitation.

## 2. Comment régénérer (à la demande, lecture seule)
Demander à l'assistant : « **régénère la doc `pour-chatgpt-complet`** » (ou cibler une section). Déroulé :
1. **Relever le contexte** : commit courant (`git rev-parse HEAD`), version `?v=` (`version.json`), inventaire des fichiers (cf. `00_MANIFESTE`).
2. **Explorer en lecture seule** le périmètre concerné (pages, `FP.*`, migrations, Edge Functions, workflows) — idéalement via des explorations parallèles par domaine (pages / fonctions `FP.*` / Supabase / Edge+automatisations+IA), comme lors de la génération initiale.
3. **Mettre à jour les fichiers** `01`→`10` + `00_MANIFESTE` (section « Évolutions depuis la précédente documentation ») + `INDEX`.
4. **Mettre à jour la section « à vérifier en base »** si des zones restent non prouvées par le dépôt.
5. **Regénérer l'archive ZIP** (voir `INDEX` §Archive).
6. **Ne pas** modifier le code applicatif, Supabase, les workflows, ni créer de tâche planifiée.

## 3. Mise à jour différentielle (recommandée entre deux régénérations complètes)
Plutôt qu'une régénération totale, produire un **delta** (fichier `99_CHANGELOG_<AAAAMMJJ>.md` dans ce dossier) listant uniquement ce qui a changé depuis le commit documenté. Modèle :

```markdown
# Delta documentation — <AAAA-MM-JJ> (commit <hash>)
> Base précédente : commit <hash_précédent> (<date>). Version ?v= : <build>.

## Nouvelles fonctionnalités
- <page/feature> — <description> — réf <fichier:ligne / table / Edge Function>

## Fonctions modifiées
- `FP.<x>` / `<fonction locale>` (<fichier:ligne>) — <quoi a changé> — impact : <dépendances/risque régression>

## Tables / schéma modifiés
- <table> — <colonne/RLS/RPC/index ajouté ou changé> — migration `<fichier>` — statut (appliqué prod ? JOURNAL ?)

## Automatisations modifiées
- <Edge Function / cron / workflow> — <changement> — secrets concernés (noms)

## Bugs corrigés
- <bug> — <correctif> — réf

## Nouvelles limitations / dette
- <limite> — [VÉRIFIÉ]/[HYPOTHÈSE] — réf

## Tests ajoutés
- <test> (`scripts/…` ou `tests/…`)

## Fichiers de doc touchés
- <01…10 / INDEX / MANIFESTE>
```

## 4. Hygiène
- Conserver la **légende** `[VÉRIFIÉ]`/`[DOC]`/`[HYPOTHÈSE]`/`[À VÉRIFIER EN BASE]` et les références `fichier:ligne`/table.
- **Jamais** de secret, token, clé, URL signée privée, identifiant de session ni donnée personnelle (dépôt public).
- Ne pas écraser la série précédente `docs/pour-chatgpt/` (vue d'ensemble) — ce dossier (`pour-chatgpt-complet/`) est le niveau détaillé.
- Après mise à jour : `node scripts/check-bugs.mjs .` doit rester vert (les `.md` n'affectent pas le site) ; commit sur une branche + PR comme tout changement de dépôt.

## 5. Historique des générations
| Date | Commit base | Portée | Note |
|---|---|---|---|
| 2026-11-03 | `92a8404` | Génération initiale complète (00→10 + INDEX + ZIP) | Succède à `docs/pour-chatgpt/` |
