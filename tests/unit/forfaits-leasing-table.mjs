#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Tests des FORFAITS DE LEASING en table (FP.forfaitsLeasingTable, assets/js/app.js)
// ============================================================================
//  Les forfaits de leasing par plaque vivent dans la table lease_overrides ; l'application les lit sous la
//  forme settings.leasingContrats = { clé de plaque: forfait }. Vérifie la conversion table → réglages
//  (clé de plaque gardée TELLE QUELLE, forfait complet) et la prise en compte des écritures encore en file.
//  Le bloc testé est extrait tel quel de app.js (entre /*<forfaits-leasing-table>*/ et /*</forfaits-leasing-table>*/).
//  Zéro dépendance. Usage : node tests/unit/forfaits-leasing-table.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const m = src.match(/\/\*<forfaits-leasing-table>\*\/([\s\S]*?)\/\*<\/forfaits-leasing-table>\*\//);
if (!m) { console.error('❌ Bloc <forfaits-leasing-table> introuvable dans app.js'); process.exit(1); }
const FP = {};
new Function('FP', m[1])(FP);
const T = FP.forfaitsLeasingTable;

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };
const F1 = { kmContrat: 60000, dureeMois: 36, debut: '2025-12-24', kmSupp: 0.0814, kmTolerance: null, loyer: 565.23 };
const LIGNES = [
  { id: 1, cle: 'HH-613-KE', forfait: F1 },
  { id: 2, cle: 'HG763VP', forfait: { loyer: 410 } },
];
const rpcE = (soc, cle, f) => ({ op: 'rpc', fn: T.FN_ENREGISTRER, args: { p_societe: soc, p_cle: cle, p_forfait: f } });
const rpcA = (soc, cle) => ({ op: 'rpc', fn: T.FN_ARCHIVER, args: { p_societe: soc, p_cle: cle } });

console.log('\nConversion table → réglages');
test('clé de plaque gardée telle qu\'enregistrée (avec ou sans tirets)', () => {
  assert.deepEqual(Object.keys(T.versMap(LIGNES)).sort(), ['HG763VP', 'HH-613-KE']);
});
test('forfait complet conservé (valeurs nulles comprises)', () => {
  assert.deepEqual(T.versMap(LIGNES)['HH-613-KE'], F1);
});
test('table vide → aucun forfait ; ligne illisible ignorée', () => {
  assert.deepEqual(T.versMap([]), {});
  assert.deepEqual(T.versMap([{ cle: 'X', forfait: null }, { cle: '', forfait: {} }, { cle: 'Y', forfait: [1] }]), {});
});

console.log('\nÉcritures encore en file d\'attente');
test('forfait modifié pas encore envoyé → visible après rechargement', () => {
  const r = T.appliquerFile(T.versMap(LIGNES), [rpcE('PXP', 'HG763VP', { loyer: 420 })], 'PXP');
  assert.equal(r.HG763VP.loyer, 420); assert.equal(Object.keys(r).length, 2);
});
test('forfait retiré pas encore envoyé → ne revient pas', () => {
  const r = T.appliquerFile(T.versMap(LIGNES), [rpcA('PXP', 'HG763VP')], 'PXP');
  assert.deepEqual(Object.keys(r), ['HH-613-KE']);
});
test('consolidation (nouvelle clé + ancienne archivée) rejouée dans l\'ordre', () => {
  const r = T.appliquerFile(T.versMap(LIGNES), [rpcE('PXP', 'HG-763-VP', { loyer: 410, kmContrat: 75000 }), rpcA('PXP', 'HG763VP')], 'PXP');
  assert.deepEqual(Object.keys(r).sort(), ['HG-763-VP', 'HH-613-KE']);
});
test('écriture d\'une autre société ou d\'une autre donnée ignorée', () => {
  const q = [rpcA('AUTRE', 'HG763VP'), { op: 'rpc', fn: 'fp_conges_remplacer', args: { p_societe: 'PXP', p_cle: 'HG763VP' } }];
  assert.equal(Object.keys(T.appliquerFile(T.versMap(LIGNES), q, 'PXP')).length, 2);
});
test('la file n\'est pas modifiée par la projection (copie)', () => {
  const f = { loyer: 1 }; const r = T.appliquerFile({}, [rpcE('PXP', 'Z', f)], 'PXP'); r.Z.loyer = 2;
  assert.equal(f.loyer, 1);
});

console.log(`\n${ok} réussi(s), ${ko} échoué(s)`);
if (ko) process.exit(1);
console.log('✅ Forfaits de leasing : projection fidèle, écritures en attente respectées.');
