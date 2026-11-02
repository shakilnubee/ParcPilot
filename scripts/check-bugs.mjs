#!/usr/bin/env node
// ============================================================
// Vérificateur de bugs automatique — Parc Pilot
// Tourne avant chaque déploiement (hook) ET manuellement :
//   node scripts/check-bugs.mjs
// Contrôles (statiques, rapides, zéro dépendance) :
//   1. Syntaxe JS de assets/js/*.js (node --check)
//   2. Cohérence du cache-busting : un seul ?v= partout
//   3. Liens/assets internes cassés (href/src vers un fichier absent)
//   4. RGPD : aucune donnée personnelle dans data.js (repo public)
//   5. Anti « contrôle piégé » : pas de masquage d'ancêtre via .closest().style.display
// Sort en code 1 si un problème est trouvé (→ bloque le déploiement).
// ============================================================
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { TARGETS, srcHash, HASH_RE } from './min-common.mjs';

const ROOT = resolve(process.argv[2] || '.');
const errors = [];
const warn = [];

// -- liste des .html (racine + pages/) --
function htmlFiles() {
  const out = [];
  for (const f of readdirSync(ROOT)) if (f.endsWith('.html')) out.push(join(ROOT, f));
  const pdir = join(ROOT, 'pages');
  if (existsSync(pdir)) for (const f of readdirSync(pdir)) if (f.endsWith('.html')) out.push(join(pdir, f));
  return out;
}

// 1) Syntaxe JS
for (const js of ['assets/js/app.js', 'assets/js/supabase-client.js', 'assets/js/data.js', 'assets/js/fleet-views.js', 'assets/js/app.min.js', 'assets/js/fleet-views.min.js']) {
  const p = join(ROOT, js);
  if (!existsSync(p)) continue;
  try { execSync(`node --check "${p}"`, { stdio: 'pipe' }); }
  catch (e) { errors.push(`Syntaxe JS invalide : ${js}\n   ${String(e.stderr || e).split('\n').slice(0, 3).join('\n   ')}`); }
}

// 1ter) SYNTAXE DES SCRIPTS INLINE de chaque page HTML.
//   ⚠️ Bug vécu (2026-09) : un `});` manquant dans le script inline de controle.html cassait TOUTE la
//   page (script non parsé → aucun handler → « Chargement… » figé, onglets morts). node --check ne le
//   voyait PAS car il ne teste que les .js AUTONOMES. On extrait donc chaque <script> SANS src et on le
//   passe à node --check (les blocs JSON / template / speculationrules sont ignorés par leur `type`).
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const attrVal = (attrs, name) => { const m = new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i').exec(attrs || ''); return m ? m[1] : null; };
const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);
for (const h of htmlFiles()) {
  const txt = readFileSync(h, 'utf8');
  let blk = 0;
  for (const m of txt.matchAll(SCRIPT_RE)) {
    const attrs = m[1] || '', body = m[2] || ''; blk++;
    if (/\bsrc\s*=/i.test(attrs)) continue;                         // script EXTERNE (pas de corps inline)
    const type = (attrVal(attrs, 'type') || '').toLowerCase();
    if (!JS_TYPES.has(type)) continue;                              // JSON / speculationrules / template → pas du JS
    if (!body.trim()) continue;
    const tmp = join(tmpdir(), `pp-inline-${process.pid}-${blk}.${type === 'module' ? 'mjs' : 'js'}`);
    try { writeFileSync(tmp, body); execSync(`node --check "${tmp}"`, { stdio: 'pipe' }); }
    catch (e) {
      const line = txt.slice(0, m.index).split('\n').length;        // n° de ligne du <script> dans le HTML
      errors.push(`Script inline invalide dans ${h.replace(ROOT + '/', '')} (bloc #${blk}, ~ligne ${line}) :\n   ${String(e.stderr || e).split('\n').slice(0, 3).join('\n   ')}`);
    } finally { try { unlinkSync(tmp); } catch (_) {} }
  }
}

// 1bis) GARDE-FOU MINIFICATION : chaque .min.js DOIT correspondre à sa source (empreinte en tête).
//   Empêche de déployer un JS minifié PÉRIMÉ (source éditée sans relancer build-min).
for (const t of TARGETS) {
  const sp = join(ROOT, t.src), op = join(ROOT, t.out);
  if (!existsSync(sp)) continue;
  if (!existsSync(op)) { errors.push(`Minifié manquant : ${t.out}. Lance : node scripts/build-min.mjs`); continue; }
  const want = srcHash(readFileSync(sp, 'utf8'));
  const m = HASH_RE.exec(readFileSync(op, 'utf8'));
  const got = m ? m[1] : null;
  if (got !== want) errors.push(`Minifié PÉRIMÉ : ${t.out} (empreinte ${got || 'absente'} ≠ source ${want}). ${t.src} a changé → relance : node scripts/build-min.mjs`);
}

// 2) Cohérence du cache-busting (?v=...) — UNIQUEMENT sur les assets partagés
//    (tailwind.css, styles.css, app.js, supabase-client.js, data.js, lucide.min.js).
//    On ignore les ?v= sur d'autres ressources (ex. logos images) qui ont leur propre versionnage.
const versions = new Set();
const ASSET_V = /(?:tailwind\.css|styles\.css|app\.min\.js|app\.js|supabase-client\.js|data\.js|fleet-views\.min\.js|fleet-views\.js|lucide\.min\.js)\?v=([A-Za-z0-9]+)/g;
for (const h of htmlFiles()) {
  const txt = readFileSync(h, 'utf8');
  for (const m of txt.matchAll(ASSET_V)) versions.add(m[1]);
}
if (versions.size > 1) {
  errors.push(`Cache-busting incohérent : plusieurs versions ?v= sur les assets partagés (${[...versions].join(', ')}). Bumpe TOUT au même numéro.`);
}

// 3) Liens / assets internes cassés
const IGNORE = /^(https?:|mailto:|tel:|javascript:|data:|#|\{)/i;
for (const h of htmlFiles()) {
  const txt = readFileSync(h, 'utf8');
  const base = dirname(h);
  for (const m of txt.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)) {
    let ref = m[1].trim();
    if (!ref || IGNORE.test(ref)) continue;
    ref = ref.split('?')[0].split('#')[0];               // enlève ?v=… et #ancre
    if (!/\.(html|js|css|svg|png|jpg|jpeg|webp|ico)$/i.test(ref)) continue; // que les fichiers locaux
    const target = resolve(base, ref);
    if (!existsSync(target)) {
      errors.push(`Lien cassé dans ${h.replace(ROOT + '/', '')} : "${m[1]}" → fichier introuvable`);
    }
  }
}

// 4) RGPD — aucune donnée personnelle dans data.js (repo public)
const dataPath = join(ROOT, 'assets/js/data.js');
if (existsSync(dataPath)) {
  const d = readFileSync(dataPath, 'utf8');
  const re = /"(email|adresse|dateNaissance|tel|nom|prenom|name|poste|permisNumero|permisUrl|permisFileId|chauffeur|vin|cgUrl|avisUrl|justifUrl)"\s*:\s*"[^"]+"/g;
  const hits = (d.match(re) || []).filter(s => !/:\s*""/.test(s));
  if (hits.length) errors.push(`RGPD : ${hits.length} champ(s) personnel(s) NON vidé(s) dans data.js (ex. ${hits[0].slice(0, 60)}…). Strippe l'identité avant commit.`);
}

// 5) Anti « contrôle piégé » : ne jamais masquer un conteneur ANCÊTRE via .closest(...).style.display
//    Bug historique : un <select> « Filtrer par loueur » masquait la carte qui le contenait
//    (sel.closest('div').style.display='none') → le filtre disparaissait avec la carte, plus moyen
//    de revenir. RÈGLE : masquer un wrapper DÉDIÉ (document.getElementById('...-wrap')), jamais
//    l'ancêtre trouvé par closest() qui embarque le contrôle lui-même.
const TRAP = /\.closest\([^)]*\)\s*\.style\.display\s*=/;
for (const h of htmlFiles()) {
  const lines = readFileSync(h, 'utf8').split('\n');
  lines.forEach((ln, i) => {
    if (TRAP.test(ln)) errors.push(`Contrôle potentiellement piégé dans ${h.replace(ROOT + '/', '')}:${i + 1} : masquage d'un ancêtre via .closest(...).style.display — le contrôle serait caché avec son conteneur. Masque un wrapper dédié (getElementById), pas l'ancêtre.`);
  });
}

// 7) RÉFÉRENTIEL — IDENTITÉ : un champ « nom complet » / « nom et prénom » est INTERDIT.
//    Une personne = DEUX champs « Prénom » puis « Nom » (CLAUDE.md § Checklist obligatoire). On cible les
//    LIBELLÉS/placeholders explicitement COMBINÉS (« nom et prénom », « nom complet », « full name »…) ; on
//    N'inclut PAS le simple placeholder « Prénom Nom » (utilisé légitimement comme indice de recherche par les
//    sélecteurs de conducteur FP.conducteurPicker). Exception justifiée → « pp-allow:nom-unique » SUR la ligne.
const FULLNAME_RE = /(nom\s*(?:et|&amp;|&)\s*pr[eé]nom|pr[eé]nom\s*(?:et|&amp;|&)\s*nom|nom\s+complet|full\s*-?\s*name|fullname|display\s*-?\s*name)/i;
for (const h of htmlFiles()) {
  const rel = h.replace(ROOT + '/', '');
  readFileSync(h, 'utf8').split('\n').forEach((ln, i) => {
    if (!/(placeholder\s*=|<label\b|field-label)/i.test(ln)) return;   // uniquement un libellé/placeholder de champ
    if (/pp-allow:\s*nom-unique/i.test(ln)) return;                     // exception documentée
    if (FULLNAME_RE.test(ln)) errors.push(`Identité : champ « nom complet / nom et prénom » détecté dans ${rel}:${i + 1} — utilise DEUX champs « Prénom » puis « Nom » (jamais un seul). Exception justifiée ? ajoute « pp-allow:nom-unique » sur la ligne (avec commentaire).`);
  });
}

// 8) RÉFÉRENTIEL — « Voir tout / Voir plus » ne doit PAS être un <details> natif (rend moche ; vrai toggle
//    repliable attendu, CLAUDE.md § 0bis). Exception → « pp-allow:details » sur la ligne.
const DETAILS_VOIR = /<summary\b[^>]*>[^<]*voir\s*(?:tout|plus|moins|\d)/i;
for (const h of htmlFiles()) {
  const rel = h.replace(ROOT + '/', '');
  readFileSync(h, 'utf8').split('\n').forEach((ln, i) => {
    if (DETAILS_VOIR.test(ln) && !/pp-allow:\s*details/i.test(ln)) errors.push(`« Voir tout » en <details> natif dans ${rel}:${i + 1} — utilise un vrai toggle repliable (3 lignes + bouton « Voir tout (N) » / « Voir moins »), pas <details>.`);
  });
}

// 6) GARDE-FOU ANTI-PERTE (NON bloquant, warning seulement) : vérifie que le correctif de FOND du moteur
//    de fusion (« une suppression de clé synchronisée est vraiment appliquée », pas de husk {} qui
//    ressuscite l'entrée) est toujours présent dans mergeMap. S'il disparaissait, toute la famille de bugs
//    « ça revient » (RDV garage, immobilisation, anomalies…) pourrait réapparaître. ⚠️ Enveloppé dans un
//    try/catch et poussé dans `warn` (jamais `errors`) → NE PEUT PAS bloquer un déploiement.
try {
  const appTxt = readFileSync(join(ROOT, 'assets/js/app.js'), 'utf8');
  if (!/if \(ov === undefined\) \{ delete out\[k\]; return; \}/.test(appTxt)) {
    warn.push('Anti-perte : le correctif de fusion « suppression réelle » semble ABSENT de mergeMap (app.js) → risque de retour des bugs « ça revient ». Détails : node scripts/audit-persist.mjs');
  }
} catch (e) { /* jamais bloquant */ }

// -- rapport --
if (warn.length) for (const w of warn) console.log(`⚠️  ${w}`);
if (errors.length) {
  console.error(`\n❌ ${errors.length} problème(s) détecté(s) :\n`);
  for (const e of errors) console.error(' • ' + e);
  console.error('\nCorrige avant de déployer.');
  process.exit(1);
}
console.log('✅ check-bugs : RAS (syntaxe JS, cache ?v=, liens internes, RGPD data.js, identité 2 champs, Voir-tout).');
