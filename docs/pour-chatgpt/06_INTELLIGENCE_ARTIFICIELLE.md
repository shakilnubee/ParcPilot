# 06 — Intelligence artificielle (scan de documents)

> Instantané 03/11/2026, lecture seule. Légende `[VÉRIFIÉ]` / `[DOC]` / `[HYPOTHÈSE]`. Secrets = noms de variables uniquement.

## 1. Principe transverse `[DOC: CLAUDE.md — respecté dans le code]`

**Lire, jamais deviner.** L'IA/le scanner doit lire ce qui est **réellement écrit**, en s'ancrant sur les **libellés/termes techniques**, jamais sur une position au hasard ni sur le plus grand nombre. Règles : couche texte d'abord · contrôle de cohérence `HT + TVA = TTC` · montant **minoré** pour les amendes (jamais le majoré) · ne rien inventer (champ absent = `null`, conducteur inconnu = **signalé**) · anti-doublons via `FP.dupe`.

## 2. Pipeline côté client — `assets/js/app.js`

**`FP.scanIA(file, docType, promptOverride, opts)`** (`app.js:13832`) = **point d'entrée unique** de toute lecture IA : `[VÉRIFIÉ]`
1. Compresse les images (~1600 px) ; vérifie le format (jpeg/png/gif/webp/pdf).
2. **Couche texte d'abord** : pour un PDF à couche texte, `FP._pdfTextLayer` (`:13814`) la reconstruit **par position** (tri y↓ puis x↑) et l'injecte dans le prompt (« TEXTE EXTRAIT… fait FOI ») → l'IA lit le texte réel.
3. Envoie à l'Edge Function `scan-doc` (`FP.supabase.functions.invoke`), prompt **en chaîne**.
4. Expose la **lecture croisée** : `FP._scanLecteur`/`_scanControle`/`_scanAVerifier` + toast « champ(s) à vérifier » si les deux IA divergent.

**Prompts** (éditables sans redéployer la fonction) : `[VÉRIFIÉ]`
- **`FP.SCAN_PROMPT`** (`:13633`) : générique multi-docs. Champs : `docType, date, fournisseur` (émetteur, pas le client), `numeroFacture, vehiculeImmat, vin, km, montantHT/TVA/TTC, description, factureType`.
  - **Amendes — règle des 3 montants** : `montantMinore`/`montantForfaitaire`/`montantMajore` extraits **séparément** ; `montantTTC` = **minoré sinon forfaitaire**, **jamais le majoré** (la majoration est appliquée par l'app selon la date). FPS, télépaiement/clé, points selon barème légal.
- **`FP.CG_SCAN_PROMPT`** (`:13684`) : carte grise — `immat(A), dateMiseEnCirculation(B), marque(D.1), modele(D.3), vin(E), puissanceFiscale(P.6), carburant(P.3), co2(V.7), masse(G — pas G.1), proprietaire(C.1), prochainCT(X.1)`.
- `FP.constatPrompt` (`:13772`, responsabilité), `FP.courrierAssureurPrompt` (`:13794`), `FP.EDL_KM_PROMPT`, `FP.PRIME_ASSUR_PROMPT`.

**`FP.scanZone(opts)`** (`:13962`) : composant UI commun (zone + états + « Réessayer ») qui appelle `FP.scanIA` et remplit via `setIfEmpty` (ne jamais écraser une saisie). `[VÉRIFIÉ]`

**Contrôle de cohérence `HT+TVA=TTC`** (tolérance **0,02 €**) : au scan/parse (`factures.html:1333`, `deriveTotals` privilégie le triplet auto-vérifiant), à la saisie/édition, et en affichage (badge ⚠️ `faIncoherent`). **Anti-`Math.max` aveugle amendes** : repli OCR prend `Math.min` ; majoration détectée uniquement sur le **titre** « avis de majoration ». `[VÉRIFIÉ: factures.html, amendes.html]`

## 3. Côté serveur — `supabase/functions/scan-doc/index.ts`

- **Fournisseurs/modèles** : **Anthropic (Claude)** via `/v1/messages` — défauts essayés dans l'ordre `claude-sonnet-5, claude-haiku-4-5-20251001, claude-3-5-sonnet-20241022, claude-3-5-sonnet-latest` ; **OpenAI** via `/v1/responses` — `gpt-4o, gpt-4o-mini`. `[VÉRIFIÉ]`
- **Clés (variables d'env)** : `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` ; surcharges `ANTHROPIC_MODEL`/`OPENAI_MODEL`. Valeurs jamais dans le code. `[VÉRIFIÉ]`
- **Architecture additive** : si `OPENAI_API_KEY` présent → OpenAI = lecteur principal + Claude = 2ᵉ lecteur de validation sur docs « importants » (`RE_IMPORTANT` : facture|amende|carte grise|assurance|leasing|contrat|sinistre|CT…) ; un champ en **divergence → `null`** (jamais rempli en silence), INTROUVABLE gardé + signalé. Sans OpenAI → **Claude seul**. `[VÉRIFIÉ]`
- **Gestion d'erreur** : timeouts 55 s + `AbortController` ; repli modèle sur 404 « model » ; validation indispo → extraction renvoyée quand même ; JSON illisible → `{ok:false, raw}`. `[VÉRIFIÉ]`

## 4. Scanner unifié — `assets/js/scanner2.js` (page `pages/scanner.html`)

Module autonome `FP2` (514 l.) : 3 étapes — (1) détection du type (`DETECT_PROMPT`), (2) extraction par **schéma** par type (`SCHEMAS` : carte grise, permis, CI, contrat location, assurance, CT, factures entretien/carburant/Ulys/achat, sinistre, EDL, avis contravention, FPS), (3) contrôle de cohérence + **écran de validation** (champs incertains surlignés, `niveau_confiance` + `verification_humaine_requise`, **jamais d'auto-enregistrement**). S'appuie sur `FP.scanIA` + `FP.persist` + `FP.dupe`. `[VÉRIFIÉ]`

## 5. Où le scan IA est branché (points d'entrée) `[VÉRIFIÉ]`

- **Dashboard** → « Scanner un document » (scanner unifié) + km par photo du compteur.
- **Factures** : facture (`deriveTotals`) ; **Amendes** : avis, justificatif, télépaiement.
- **Cartes grises** (`FP.CG_SCAN_PROMPT`, fiche véhicule / import lot) ; **Conducteurs** : permis + docs.
- **Sinistres** : constats, courriers assureur, factures de réparation.
- **Contrats** : états de parc, contrats leasing/LLD, contrats-cadres, devis leasing/assurance.
- **À vendre** : devis/BC/facture d'achat. **Entretiens/véhicules/contrôle** : `FP.scanZone`.
- **Relevés Total/Ulys** : parsés **par position** côté client (`ulysPdfToText`), pas par l'IA vision ; Ulys importé aussi côté serveur par `ulys-daily` (en-têtes).

## 6. Activation & coûts `[DOC: supabase/BRANCHER-HAIKU.md]`

- Guide `BRANCHER-HAIKU.md` : créer la fonction `scan-doc`, poser `ANTHROPIC_API_KEY`, garder `Verify JWT`. Modèle décrit = **Claude Haiku** (~0,004 €/facture). ⚠️ Doc antérieure au choix multi-modèles actuel du code (sonnet-5 / haiku-4-5 / sonnet-3-5) ; le modèle réellement actif dépend des secrets (`ANTHROPIC_MODEL`/`OPENAI_MODEL`, non visibles dans le dépôt). `[VÉRIFIÉ code / HYPOTHÈSE sur le modèle actif en prod]`
- **État IA** visible dans l'app : Paramètres → Données → « état IA » ; bandeau « IA indisponible » sur le dashboard si le service ne répond pas. `[VÉRIFIÉ]`
