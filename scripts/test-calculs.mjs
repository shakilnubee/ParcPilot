// ============================================================
//  Parc Pilot — Tests unitaires des calculs métier
//  Lancement : node scripts/test-calculs.mjs
//  Zéro dépendance. Extrait chaque helper FP.* de app.js et le teste en isolation
//  (avec des stubs pour FP.settings / FP.primeVeh / FP.tvsDetail). Sort code ≠ 0 si un test échoue
//  → branchable comme contrôle BLOQUANT avant commit / en CI.
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'assets/js/app.js'), 'utf8');

// --- Extracteur : récupère la source d'un helper « FP.NAME = <expr>; » (équilibrage {} () []). ---
function extract(name) {
  const re = new RegExp('FP\\.' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=');
  const m = re.exec(SRC);
  if (!m) throw new Error('helper introuvable dans app.js : FP.' + name);
  let i = SRC.indexOf('=', m.index) + 1;
  let depth = 0, inStr = null, prev = '';
  for (; i < SRC.length; i++) {
    const c = SRC[i];
    if (inStr) { if (c === inStr && prev !== '\\') inStr = null; prev = c; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; prev = c; continue; }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ';' && depth === 0) break;
    prev = c;
  }
  return SRC.slice(m.index, i + 1);
}

// --- Extracteur de MÉTHODE d'objet (ex. « applyTo(data, q) { … } ») → fonction autonome. ---
function extractMethod(signature, argList) {
  const i0 = SRC.indexOf(signature);
  if (i0 < 0) throw new Error('méthode introuvable : ' + signature);
  let i = SRC.indexOf('{', i0); const start = i; let depth = 0, inStr = null, prev = '';
  for (; i < SRC.length; i++) {
    const c = SRC[i];
    if (inStr) { if (c === inStr && prev !== '\\') inStr = null; prev = c; continue; }
    // Sauter les commentaires AVANT de détecter les quotes : une apostrophe dans un commentaire
    // (ex. « l'heure ») ne doit pas ouvrir une fausse chaîne et dérégler le comptage d'accolades.
    if (c === '/' && SRC[i + 1] === '/') { const nl = SRC.indexOf('\n', i); i = (nl < 0) ? SRC.length : nl; prev = '\n'; continue; }
    if (c === '/' && SRC[i + 1] === '*') { const e = SRC.indexOf('*/', i + 2); i = (e < 0) ? SRC.length : e + 1; prev = '/'; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; prev = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
    prev = c;
  }
  return new Function(...argList, SRC.slice(start + 1, i - 1));
}

// --- Bac à sable : un FP minimal + stubs, puis on évalue les helpers extraits dedans. ---
function makeFP(settings) {
  const FP = {};
  FP.settings = { get: () => settings || {} };
  FP.primeVeh = (v) => (settings && settings.assurancePrimes && settings.assurancePrimes[v.immat]) || 0;
  FP.tvsDetail = (v) => (settings && settings.tvs && settings.tvs[v.immat]) || { applicable: false, total: 0 };
  // Évalue une liste de helpers (dans l'ordre ; chacun fait « FP.x = … »).
  const load = (names) => { for (const n of names) { const code = extract(n); (new Function('FP', code))(FP); } };
  return { FP, load };
}

// --- Mini framework d'assertions ---
let pass = 0, fail = 0; const fails = [];
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; fails.push(`❌ ${label}\n     attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
}
function ok(cond, label) { eq(!!cond, true, label); }

// ============================================================
//  TESTS
// ============================================================

// --- Helpers « source unique » (doivent déjà être verts) ---
{
  const { FP, load } = makeFP({});
  load(['estVendu', 'horsFlotte', 'normImmat']);
  eq(FP.estVendu({ statut: 'vendu' }), true, 'estVendu(vendu)');
  eq(FP.estVendu({ statut: 'Vendue' }), true, 'estVendu(Vendue)');
  eq(FP.estVendu({ statut: 'cédé' }), false, 'estVendu(cédé) = false (cédé ≠ vendu)');
  eq(FP.estVendu({ statut: 'actif' }), false, 'estVendu(actif)');
  eq(FP.horsFlotte({ statut: 'cédé' }), true, 'horsFlotte(cédé) = true');
  eq(FP.horsFlotte({ statut: 'restitué' }), true, 'horsFlotte(restitué) = true');
  eq(FP.horsFlotte({ statut: 'actif' }), false, 'horsFlotte(actif) = false');
  // normImmat : tirets, espaces, casse → identiques
  eq(FP.normImmat('HL-724-CD'), FP.normImmat('hl 724 cd'), 'normImmat tolère tirets/espaces/casse');
  eq(FP.normImmat('AB-123-CD'), 'AB123CD', 'normImmat(AB-123-CD) = AB123CD');
}

// --- M3 : contratCadreCoutAnnuel (pur) ---
{
  const { FP, load } = makeFP({});
  load(['contratCadreCoutAnnuel']);
  eq(FP.contratCadreCoutAnnuel({ montant: 100, periode: 'mois' }), 1200, 'contrat mensuel 100€ = 1200€/an');
  eq(FP.contratCadreCoutAnnuel({ montant: 1200, periode: 'an' }), 1200, 'contrat annuel 1200€ = 1200€/an');
  eq(FP.contratCadreCoutAnnuel({ montant: 0 }), 0, 'contrat 0€ = 0');
}

// --- M1 : réconciliation données serveur ⇄ file d'attente (anti « revenant ») ---
{
  const applyTo = extractMethod('applyTo(data, q)', ['data', 'q']);
  const data = { vehicules: [], amendes: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }], factures: [], conducteurs: [] };
  applyTo(data, [{ op: 'delete', table: 'amendes', id: 'a2' }]);
  eq(data.amendes.map(x => x.id), ['a1', 'a3'], 'M1 — suppression en file retirée des données serveur (pas de revenant)');
  const data2 = { amendes: [{ id: 'a1' }], vehicules: [], factures: [], conducteurs: [] };
  applyTo(data2, [{ op: 'insert', table: 'amendes', row: { id: 'a9' } }]);
  eq(data2.amendes.map(x => x.id), ['a1', 'a9'], 'M1 — ajout en file présent dans les données');
  const data3 = { amendes: [{ id: 'a1', statut: 'à payer' }], vehicules: [], factures: [], conducteurs: [] };
  applyTo(data3, [{ op: 'update', table: 'amendes', id: 'a1', fields: { statut: 'payée' } }]);
  eq(data3.amendes[0].statut, 'payée', 'M1 — édition en file appliquée');
}

// --- M4 : permis — la fiche suit le réglage docAlerteJours (comme les Alertes), plus de seuil figé ---
{
  const { FP, load } = makeFP({});
  FP.notifCfg = () => ({ ctJours: 90, docAlerteJours: 120 });
  // joursRestants est une méthode d'objet (pas FP.x=) → on la stub (minuit→minuit, comme la vraie).
  FP.joursRestants = (iso) => { const d = new Date(iso), n = new Date(); return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())) / 86400000); };
  load(['ECHEANCE_SEUILS', 'ECHEANCE_COULEUR', 'echeanceStatut']);
  const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  eq(FP.echeanceStatut(inDays(100), 'permis').statut, 'bientot', 'M4 — permis à 100j = « bientôt » (suit docAlerteJours=120), PAS « valide »');
  eq(FP.echeanceStatut(inDays(50), 'permis').statut, 'urgent', 'M4 — permis à 50j = « urgent » (docAlerteJours/2=60)');
  eq(FP.echeanceStatut(inDays(200), 'permis').statut, 'valide', 'M4 — permis à 200j = « valide »');
}

// --- M3 : contrats-cadres « abonnements » dans les totaux SANS double-compter ---
{
  const settings = { contratsCadre: [
    { type: 'telematique', montant: 100, periode: 'mois' },   // 1200/an — à compter
    { type: 'autre',       montant: 600, periode: 'an' },      // 600/an — à compter
    { type: 'assurance',   montant: 5000, periode: 'an' },     // déjà dans poste Assurance — NE PAS compter
    { type: 'maintenance', montant: 3000, periode: 'an' },     // déjà dans poste Entretien — NE PAS compter
    { type: 'carte-carburant', montant: 240, periode: 'an' },  // déjà dans Carburant — NE PAS compter
  ] };
  const { FP, load } = makeFP(settings);
  load(['contratsCadre', 'contratCadreCoutAnnuel', 'CONTRAT_CADRE_DEJA_COMPTE', 'contratsCadreAbonnementsAnnuel']);
  eq(FP.contratsCadreAbonnementsAnnuel(), 1800, 'M3 — abonnements = télématique 1200 + autre 600 = 1800 (exclut assurance/maintenance/carburant)');
}

// --- M2 : un véhicule « cédé » ne doit PLUS être facturé (assurance + TVS) ---
//   Ces tests encodent le comportement CORRECT. Sur le code actuel (filtre !estVendu),
//   un véhicule « cédé » est encore compté → ces tests ÉCHOUENT (= preuve du bug M2).
{
  const settings = { assurancePrimes: { 'AB123CD': 1200, 'CD456EF': 800 }, tvs: { 'AB123CD': { applicable: true, total: 300 } } };
  const { FP, load } = makeFP(settings);
  load(['estVendu', 'horsFlotte', 'assuranceAnnuelle', 'tvsAnnuelleFlotte']);
  const actif = { immat: 'CD456EF', statut: 'actif' };
  const cede = { immat: 'AB123CD', statut: 'cédé' };
  eq(FP.assuranceAnnuelle([actif, cede]), 800, 'M2 — assurance exclut le véhicule cédé (800, pas 2000)');
  eq(FP.tvsAnnuelleFlotte([cede]), 0, 'M2 — TVS exclut le véhicule cédé (0, pas 300)');
}

// --- MONTANT DÛ d'une amende (FP.montantDu) — SOURCE UNIQUE, jamais Math.max ---
//   Règle métier : majorée → montant MAJORÉ ; sinon montant (ou override « payée »). Un montantMajore
//   « parasite » présent alors que l'amende n'est PAS majorée ne doit JAMAIS être pris (bug vécu : 1875 €).
{
  const settings = { amendeMontantPaye: { 'p1': 30 } };
  const { FP, load } = makeFP(settings);
  load(['estPayee', 'montantDu']);
  eq(FP.montantDu(null), 0, 'montantDu(null) = 0');
  eq(FP.montantDu({ montant: 90 }), 90, 'montantDu — non majorée = montant (90)');
  eq(FP.montantDu({ montant: 90, majoree: true, montantMajore: 375 }), 375, 'montantDu — majorée = montant MAJORÉ (375)');
  eq(FP.montantDu({ montant: 90, majoree: false, montantMajore: 375 }), 90, 'montantDu — montantMajore ignoré si NON majorée (90, jamais le max)');
  eq(FP.montantDu({ montant: 45, montantMajore: 1875 }), 45, 'montantDu — jamais Math.max : montantMajore parasite 1875 écarté → 45 (bug vécu)');
  // override « montant réellement payé » (amende payée) : prioritaire sur le barème
  eq(FP.montantDu({ id: 'p1', statut: 'payée', montant: 90 }), 30, 'montantDu — amende payée : override amendeMontantPaye (30) prioritaire');
  eq(FP.montantDu({ id: 'zz', statut: 'payée', montant: 90, majoree: true, montantMajore: 375 }), 375, 'montantDu — payée sans override : retombe sur la règle majorée (375)');
}

// --- JOURS RESTANTS réel (FP.joursRestants, méthode d'objet) — minuit→minuit, DST sans décalage ---
//   On teste la VRAIE fonction extraite d'app.js (pas un stub). Propriété : pour tout décalage N de jours
//   calendaires (calculé en heure LOCALE, donc traversant les bascules d'heure d'été/hiver), le décompte
//   doit valoir EXACTEMENT N — aucun off-by-one de DST ou d'heure courante.
{
  const joursRestants = extractMethod('joursRestants(iso)', ['iso']);
  eq(joursRestants(null), null, 'joursRestants(null) = null');
  eq(joursRestants('—'), null, "joursRestants('—') = null");
  eq(joursRestants('pas une date'), null, 'joursRestants(invalide) = null');
  // Date-cible construite en heure LOCALE (arithmétique calendaire qui respecte les DST).
  const addDays = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  eq(joursRestants(addDays(0)), 0, 'joursRestants — même jour = 0');
  // Balayage > 1 an dans les deux sens : traverse au moins une bascule été→hiver ET hiver→été.
  let dstOk = true, firstBad = null;
  for (const n of [1, 10, 30, 90, 180, 181, 200, 365, 366, 400, -1, -5, -90, -200, -366]) {
    if (joursRestants(addDays(n)) !== n) { dstOk = false; if (firstBad === null) firstBad = n; }
  }
  ok(dstOk, 'joursRestants — décompte exact pour tout N (minuit→minuit, DST sans off-by-one)' + (firstBad !== null ? ` [1er écart à N=${firstBad}]` : ''));
}

// ============================================================
console.log(`\n  ${pass} réussis, ${fail} échoués`);
if (fail) { console.log('\n' + fails.join('\n') + '\n'); process.exit(1); }
console.log('✅ Tous les tests de calcul passent.\n');
