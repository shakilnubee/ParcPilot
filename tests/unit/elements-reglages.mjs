#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Tests des ÉLÉMENTS DE RÉGLAGES en table générique (FP.elementsReglages, assets/js/app.js)
// ============================================================================
//  Les assurances (assureurs, assureur par plaque, échéances, primes, plaques ignorées) vivent dans la table
//  settings_items. Vérifie, pour les 3 formes (map, liste-id, ensemble) : conversion aller-retour fidèle,
//  écritures en file respectées, et surtout ce qui est ENVOYÉ après un enregistrement : seulement les éléments
//  changés, un retrait = un archivage, rien quand rien ne change (même si la base a réordonné les champs).
//  Le bloc testé est extrait tel quel de app.js (entre /*<elements-reglages>*/ et /*</elements-reglages>*/).
//  Zéro dépendance. Usage : node tests/unit/elements-reglages.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const m = src.match(/\/\*<elements-reglages>\*\/([\s\S]*?)\/\*<\/elements-reglages>\*\//);
if (!m) { console.error('❌ Bloc <elements-reglages> introuvable dans app.js'); process.exit(1); }
const FP = {};
new Function('FP', m[1])(FP);
const E = FP.elementsReglages;

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };
const copie = (x) => JSON.parse(JSON.stringify(x));
// Simule l'aller-retour par la base : jsonb réordonne les champs.
const viaBase = (forme, val) => {
  const els = E.elements(forme, val); let id = 0;
  const reord = (x) => Array.isArray(x) ? x.map(reord) : (x && typeof x === 'object') ? Object.fromEntries(Object.keys(x).sort().reverse().map(k => [k, reord(x[k])])) : x;
  return Object.keys(els).map(k => ({ id: ++id, cle: k, valeur: reord(els[k].v), ordre: els[k].o }));
};

const PRIMES = { 'HG-763-VP': { ht: 400, ttc: 480, assureur: 'a1' }, HJ285FL: { ttc: 520 } };
const ASSUREURS = [{ id: 'a1', nom: 'AXA', docs: [{ url: 'u' }] }, { id: 'a2', nom: 'Allianz' }];
const IGNORE = ['HH613KE', 'HF477XW'];

console.log('\nAller-retour réglages → table → réglages');
test('map (primes) : clés de plaque gardées telles quelles, valeurs complètes', () => {
  assert.deepEqual(E.depuisLignes('map', viaBase('map', PRIMES)), PRIMES);
});
test('liste-id (assureurs) : ordre et contenu conservés', () => {
  assert.deepEqual(E.depuisLignes('liste-id', viaBase('liste-id', ASSUREURS)), ASSUREURS);
});
test('ensemble (plaques ignorées) : conservé', () => {
  assert.deepEqual(E.depuisLignes('ensemble', viaBase('ensemble', IGNORE)).sort(), IGNORE.slice().sort());
});
test('map : valeur vide (null) ignorée ; liste-id : élément sans identifiant ignoré', () => {
  assert.deepEqual(Object.keys(E.elements('map', { A: null, B: 'x' })), ['B']);
  assert.deepEqual(Object.keys(E.elements('liste-id', [{ nom: 'sans id' }, { id: 'a3' }])), ['a3']);
});

console.log('\nCe qui est envoyé après un enregistrement');
test('rien de changé → rien envoyé, même si la base a réordonné les champs', () => {
  const ref = E.empreintes('map', E.depuisLignes('map', viaBase('map', PRIMES)));
  assert.deepEqual(E.ecarts('map', ref, copie(PRIMES)), []);
  const refA = E.empreintes('liste-id', E.depuisLignes('liste-id', viaBase('liste-id', ASSUREURS)));
  assert.deepEqual(E.ecarts('liste-id', refA, copie(ASSUREURS)), []);
});
test('une prime modifiée → seule cette prime est envoyée', () => {
  const ref = E.empreintes('map', PRIMES), v = copie(PRIMES); v.HJ285FL.ttc = 530;
  const e = E.ecarts('map', ref, v);
  assert.equal(e.length, 1); assert.equal(e[0].op, 'enregistrer'); assert.equal(e[0].cle, 'HJ285FL'); assert.equal(e[0].valeur.ttc, 530);
});
test('rattachement déplacé d\'un format de plaque à l\'autre → ancien archivé, nouveau enregistré', () => {
  const ref = E.empreintes('map', { HG763VP: 'a1' });
  const e = E.ecarts('map', ref, { 'HG-763-VP': 'a1' });
  assert.deepEqual(e.map(x => [x.op, x.cle]).sort(), [['archiver', 'HG763VP'], ['enregistrer', 'HG-763-VP']]);
});
test('un assureur retiré → archivé (jamais effacé)', () => {
  const e = E.ecarts('liste-id', E.empreintes('liste-id', ASSUREURS), copie([ASSUREURS[0]]));
  assert.deepEqual(e.map(x => [x.op, x.cle]), [['archiver', 'a2']]);
});
test('plaques ignorées réinitialisées → toutes archivées', () => {
  const e = E.ecarts('ensemble', E.empreintes('ensemble', IGNORE), []);
  assert.deepEqual(e.map(x => x.op), ['archiver', 'archiver']);
});

console.log('\nÉcritures encore en file d\'attente');
const rpcE = (soc, c, k, v, o) => ({ op: 'rpc', fn: E.FN_ENREGISTRER, args: { p_societe: soc, p_collection: c, p_cle: k, p_valeur: v, p_ordre: o || 0 } });
const rpcA = (soc, c, k) => ({ op: 'rpc', fn: E.FN_ARCHIVER, args: { p_societe: soc, p_collection: c, p_cle: k } });
test('prime modifiée pas encore envoyée → visible après rechargement', () => {
  const v = E.appliquerFile('assurancePrimes', 'map', copie(PRIMES), [rpcE('PXP', 'assurancePrimes', 'HJ285FL', { ttc: 999 })], 'PXP');
  assert.equal(v.HJ285FL.ttc, 999);
});
test('assureur retiré pas encore envoyé → ne revient pas', () => {
  const v = E.appliquerFile('assureurs', 'liste-id', copie(ASSUREURS), [rpcA('PXP', 'assureurs', 'a1')], 'PXP');
  assert.deepEqual(v.map(a => a.id), ['a2']);
});
test('écriture d\'une autre société ou d\'une autre collection ignorée', () => {
  const q = [rpcA('AUTRE', 'assurancePrimes', 'HJ285FL'), rpcA('PXP', 'assureurVeh', 'HJ285FL')];
  assert.equal(Object.keys(E.appliquerFile('assurancePrimes', 'map', copie(PRIMES), q, 'PXP')).length, 2);
});

console.log('\nBranchement sur l\'enregistrement des réglages');
const envoyes = [];
FP.persist = { rpc: (fn, args) => envoyes.push([fn, args.p_collection, args.p_cle]) };
FP._condSocForDb = () => 'PXP';
test('enregistrement avant la lecture de la table → la version d\'avant sert de référence', () => {
  envoyes.length = 0; E._ref = {};
  E.apresSauvegarde({ assurancePrimes: { ...copie(PRIMES), NEW1: { ttc: 1 } } }, { assurancePrimes: copie(PRIMES) });
  assert.deepEqual(envoyes, [[E.FN_ENREGISTRER, 'assurancePrimes', 'NEW1']]);
});
test('collection absente de l\'enregistrement → rien archivé', () => {
  envoyes.length = 0;
  E.apresSauvegarde({ autreReglage: 1 }, null);
  assert.deepEqual(envoyes, []);
});
test('ni lecture ni version d\'avant → aucune écriture (pas de référence), référence posée pour la suite', () => {
  envoyes.length = 0; E._ref = {};
  E.apresSauvegarde({ assureurs: copie(ASSUREURS) }, null);
  assert.deepEqual(envoyes, []);
  E.apresSauvegarde({ assureurs: [ASSUREURS[0]] }, null);
  assert.deepEqual(envoyes, [[E.FN_ARCHIVER, 'assureurs', 'a2']]);
});

console.log(`\n${ok} réussi(s), ${ko} échoué(s)`);
if (ko) process.exit(1);
console.log('✅ Éléments de réglages : aller-retour fidèle, seules les vraies modifications sont envoyées.');
