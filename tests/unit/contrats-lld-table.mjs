#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Tests des CONTRATS LLD en table (FP.contratsLLDTable, assets/js/app.js)
// ============================================================================
//  Les contrats LLD vivent dans la table lease_contracts ; l'application les lit sous la forme
//  settings.localeaseContrats = [contrats]. Vérifie la conversion table → réglages (ordre, contrat
//  complet conservé), la prise en compte des écritures encore en file, et surtout le calcul de ce
//  qu'il faut ENVOYER après une modification : seulement les contrats changés, une suppression =
//  un archivage, rien d'envoyé quand rien n'a changé.
//  Le bloc testé est extrait tel quel de app.js (entre /*<contrats-lld-table>*/ et /*</contrats-lld-table>*/).
//  Zéro dépendance. Usage : node tests/unit/contrats-lld-table.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const m = src.match(/\/\*<contrats-lld-table>\*\/([\s\S]*?)\/\*<\/contrats-lld-table>\*\//);
if (!m) { console.error('❌ Bloc <contrats-lld-table> introuvable dans app.js'); process.exit(1); }
const FP = {};
new Function('FP', m[1])(FP);
const T = FP.contratsLLDTable;

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };
const A = { id: 'lld-a', immat: 'AA-111-AA', loyerTTC: 450, dureeMois: 36, debut: '2025-01-01', docs: [{ url: 'u1', name: 'Contrat' }] };
const B = { id: 'lld-b', immat: 'BB-222-BB', loyerTTC: 520, dureeMois: 48, debut: '2026-02-01', docs: [], avenants: [{ date: '2026-06-01', loyer: 540 }] };
const LIGNES = [
  { id: 8, contrat_id: 'lld-b', ordre: 1, contrat: B },
  { id: 7, contrat_id: 'lld-a', ordre: 0, contrat: A },
];
const copie = (x) => JSON.parse(JSON.stringify(x));

console.log('\nConversion table → réglages');
test('ordre enregistré respecté, contrat complet conservé (documents, avenants)', () => {
  const l = T.versListe(LIGNES);
  assert.deepEqual(l.map(c => c.id), ['lld-a', 'lld-b']);
  assert.deepEqual(l[1], B);
});
test('l\'identifiant vient de la colonne contrat_id', () => {
  assert.equal(T.versListe([{ id: 1, contrat_id: 'lld-x', ordre: 0, contrat: { immat: 'X' } }])[0].id, 'lld-x');
});
test('table vide → liste vide ; ligne illisible ignorée', () => {
  assert.deepEqual(T.versListe([]), []);
  assert.deepEqual(T.versListe([{ contrat_id: 'z', ordre: 0, contrat: null }, { contrat_id: 'y', contrat: [1] }]), []);
});

console.log('\nÉcritures encore en file d\'attente');
const rpcE = (soc, c, ordre) => ({ op: 'rpc', fn: T.FN_ENREGISTRER, args: { p_societe: soc, p_id: c.id, p_ordre: ordre, p_contrat: c } });
const rpcA = (soc, id) => ({ op: 'rpc', fn: T.FN_ARCHIVER, args: { p_societe: soc, p_id: id } });
test('modification pas encore envoyée → visible après rechargement', () => {
  const l = T.appliquerFile(T.versListe(LIGNES), [rpcE('PXP', { ...A, loyerTTC: 470 }, 0)], 'PXP');
  assert.equal(l[0].loyerTTC, 470); assert.equal(l.length, 2);
});
test('ajout pas encore envoyé → inséré à sa place', () => {
  const l = T.appliquerFile(T.versListe(LIGNES), [rpcE('PXP', { id: 'lld-c', immat: 'CC' }, 2)], 'PXP');
  assert.deepEqual(l.map(c => c.id), ['lld-a', 'lld-b', 'lld-c']);
});
test('suppression pas encore envoyée → ne revient pas', () => {
  const l = T.appliquerFile(T.versListe(LIGNES), [rpcA('PXP', 'lld-a')], 'PXP');
  assert.deepEqual(l.map(c => c.id), ['lld-b']);
});
test('écriture d\'une autre société ou d\'une autre donnée ignorée', () => {
  const q = [rpcA('AUTRE', 'lld-a'), { op: 'rpc', fn: 'fp_conges_remplacer', args: { p_societe: 'PXP', p_id: 'lld-a' } }];
  assert.equal(T.appliquerFile(T.versListe(LIGNES), q, 'PXP').length, 2);
});

console.log('\nCe qui est envoyé après une modification');
const ref = T.empreintes([A, B]);
test('rien de changé → rien envoyé', () => {
  assert.deepEqual(T.ecarts(ref, copie([A, B])), []);
});
test('un contrat modifié → seul ce contrat est envoyé', () => {
  const l = copie([A, B]); l[1].loyerTTC = 530;
  const e = T.ecarts(ref, l);
  assert.equal(e.length, 1); assert.equal(e[0].op, 'enregistrer'); assert.equal(e[0].id, 'lld-b'); assert.equal(e[0].contrat.loyerTTC, 530);
});
test('un contrat ajouté → envoyé avec sa position', () => {
  const e = T.ecarts(ref, copie([A, B, { id: 'lld-c', immat: 'CC' }]));
  assert.deepEqual(e.map(x => [x.op, x.id, x.ordre]), [['enregistrer', 'lld-c', 2]]);
});
test('un contrat supprimé → archivé (jamais effacé) ; les suivants gardent leur contenu', () => {
  const e = T.ecarts(ref, copie([B]));
  assert.ok(e.some(x => x.op === 'archiver' && x.id === 'lld-a'));
  assert.ok(e.every(x => x.op !== 'archiver' || x.id === 'lld-a'));
});
test('pas de référence (première seconde) → tout est envoyé, rien n\'est archivé', () => {
  const e = T.ecarts(null, copie([A, B]));
  assert.deepEqual(e.map(x => x.op), ['enregistrer', 'enregistrer']);
});
test('identifiant en double → une seule écriture (la dernière occurrence)', () => {
  const e = T.ecarts({}, [{ id: 'd', v: 1 }, { id: 'd', v: 2 }]);
  assert.equal(e.length, 1); assert.equal(e[0].contrat.v, 2);
});

console.log(`\n${ok} réussi(s), ${ko} échoué(s)`);
if (ko) process.exit(1);
console.log('✅ Contrats LLD : projection fidèle, seules les vraies modifications sont envoyées.');
