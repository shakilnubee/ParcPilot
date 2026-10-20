#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Tests de la RESTAURATION d'une version des réglages (FP.restauration, assets/js/app.js)
// ============================================================================
//  Les congés, affectations et contrats LLD vivent en tables : restaurer une version des réglages doit
//  les remettre aussi en base. Règle, élément par élément : un élément présent dans la version reprend sa
//  valeur ; un élément créé depuis est CONSERVÉ ; une liste vide n'efface rien ; rien n'est supprimé.
//  Le bloc testé est extrait tel quel de app.js (entre /*<restauration-tables>*/ et /*</restauration-tables>*/).
//  Zéro dépendance. Usage : node tests/unit/restauration-tables.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const m = src.match(/\/\*<restauration-tables>\*\/([\s\S]*?)\/\*<\/restauration-tables>\*\//);
if (!m) { console.error('❌ Bloc <restauration-tables> introuvable dans app.js'); process.exit(1); }
const FP = {};
new Function('FP', m[1])(FP);
const R = FP.restauration;

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };
const C1 = { debut: '2026-07-01', fin: '2026-07-15', motif: 'Congés' };
const C2 = { debut: '2026-09-01', fin: '2026-09-05', motif: '' };

console.log('\nCongés / affectations (par clé)');
test('congé perdu depuis la version → il revient', () => {
  const r = R.parCle({ alice: [C2] }, { alice: [C1, C2] });
  assert.deepEqual(r.valeur.alice, [C1, C2]); assert.deepEqual(r.changes, ['alice']);
});
test('conducteur ajouté depuis la version → conservé', () => {
  const r = R.parCle({ alice: [C1], bruno: [C2] }, { alice: [C1] });
  assert.deepEqual(r.valeur.bruno, [C2]); assert.deepEqual(r.changes, []);
});
test('identique → rien à envoyer', () => {
  assert.deepEqual(R.parCle({ alice: [C1] }, { alice: [C1] }).changes, []);
});
test('liste vide dans la version → n\'efface rien', () => {
  const r = R.parCle({ alice: [C1] }, { alice: [] });
  assert.deepEqual(r.valeur.alice, [C1]); assert.deepEqual(r.changes, []);
});
test('nettoyage appliqué avant comparaison (élément illisible retiré)', () => {
  const norm = l => l.filter(x => x && x.debut && x.fin);
  const r = R.parCle({}, { alice: [C1, { debut: '' }] }, norm);
  assert.deepEqual(r.valeur.alice, [C1]);
  assert.deepEqual(R.parCle({}, { alice: [{ debut: '' }] }, norm).changes, []);
});
test('version sans la donnée (ancienne) → tout est conservé', () => {
  const r = R.parCle({ alice: [C1] }, undefined);
  assert.deepEqual(r.valeur, { alice: [C1] }); assert.deepEqual(r.changes, []);
});
test('la version n\'est pas modifiée (copie)', () => {
  const v = { alice: [{ ...C1 }] }; const r = R.parCle({}, v); r.valeur.alice[0].motif = 'x';
  assert.equal(v.alice[0].motif, 'Congés');
});

test('même contenu écrit autrement (ordre des champs, indicateur à false) → rien à envoyer', () => {
  const table = { veh: [{ conducteur: 'X', debut: '2026-01-01', fin: null, kmDebut: 10, kmFin: null }] };
  const copie = { veh: [{ kmFinManuel: false, kmFin: null, kmDebut: 10, fin: null, debut: '2026-01-01', conducteur: 'X' }] };
  assert.deepEqual(R.parCle(table, copie).changes, []);
});
test('une vraie différence reste détectée (indicateur passé à vrai)', () => {
  const r = R.parCle({ veh: [{ conducteur: 'X', kmFin: 5 }] }, { veh: [{ conducteur: 'X', kmFin: 5, kmFinManuel: true }] });
  assert.deepEqual(r.changes, ['veh']);
});
test('forfaits de leasing (objets) : forfait modifié revient, forfait créé depuis conservé, objet vide n\'efface rien', () => {
  const r = R.parCle({ 'HG-763-VP': { loyer: 999 }, 'HJ-285-FL': { loyer: 300 } }, { 'HG-763-VP': { loyer: 410 }, 'HH-613-KE': {} });
  assert.equal(r.valeur['HG-763-VP'].loyer, 410); assert.equal(r.valeur['HJ-285-FL'].loyer, 300);
  assert.ok(!('HH-613-KE' in r.valeur)); assert.deepEqual(r.changes, ['HG-763-VP']);
});
console.log('\nContrats LLD (par identifiant)');
const A = { id: 'a', loyerTTC: 400 }, B = { id: 'b', loyerTTC: 500 };
test('contrat supprimé depuis la version → il revient', () => {
  const r = R.parId([B], [A, B]);
  assert.deepEqual(r.valeur.map(c => c.id), ['b', 'a']); assert.deepEqual(r.changes, ['a']);
});
test('contrat modifié depuis la version → reprend la valeur de la version', () => {
  const r = R.parId([{ id: 'a', loyerTTC: 999 }], [A]);
  assert.equal(r.valeur[0].loyerTTC, 400); assert.deepEqual(r.changes, ['a']);
});
test('contrat créé depuis la version → conservé', () => {
  const r = R.parId([A, { id: 'c' }], [A]);
  assert.deepEqual(r.valeur.map(c => c.id), ['a', 'c']); assert.deepEqual(r.changes, []);
});
test('contrat identique mais champs dans un autre ordre (relu de la base) → rien à envoyer', () => {
  assert.deepEqual(R.parId([{ loyerTTC: 400, id: 'a' }], [A]).changes, []);
});
test('contrat sans identifiant dans la version → ignoré et compté', () => {
  const r = R.parId([A], [{ loyerTTC: 1 }]);
  assert.equal(r.valeur.length, 1); assert.equal(r.ignores, 1);
});

console.log(`\n${ok} réussi(s), ${ko} échoué(s)`);
if (ko) process.exit(1);
console.log('✅ Restauration : les éléments de la version reviennent, rien de plus récent n\'est supprimé.');
