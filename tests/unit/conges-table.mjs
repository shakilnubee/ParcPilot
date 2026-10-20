#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Tests de la PROJECTION DES CONGÉS (FP.congesTable, assets/js/app.js)
// ============================================================================
//  Les congés vivent dans la table driver_absences ; l'application les lit sous la forme
//  settings.condConges. Vérifie la conversion table → réglages, et que les modifications
//  encore en file d'attente (pas encore envoyées) sont bien visibles après un rechargement :
//  ni congé « disparu », ni congé supprimé qui « revient », ni mélange entre sociétés.
//  Le bloc testé est extrait tel quel de app.js (entre /*<conges-table>*/ et /*</conges-table>*/).
//  Zéro dépendance. Usage : node tests/unit/conges-table.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const m = src.match(/\/\*<conges-table>\*\/([\s\S]*?)\/\*<\/conges-table>\*\//);
if (!m) { console.error('❌ Bloc <conges-table> introuvable dans app.js'); process.exit(1); }
const FP = {};
new Function('FP', m[1])(FP);
const T = FP.congesTable;

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };
const rpc = (fn, args) => ({ op: 'rpc', fn, args, table: 'driver_absences' });

const LIGNES = [
  { cond_key: 'alice', debut: '2026-11-10', fin: '2026-11-12', motif: 'RTT' },
  { cond_key: 'alice', debut: '2026-10-01', fin: '2026-10-05', motif: null },
  { cond_key: 'bruno', debut: '2026-12-20', fin: '2026-12-31', motif: '' },
];

console.log('\nConversion table → réglages');
test('regroupe par conducteur, trie par date, motif vide par défaut', () => {
  assert.deepEqual(T.versMap(LIGNES), {
    alice: [{ debut: '2026-10-01', fin: '2026-10-05', motif: '' }, { debut: '2026-11-10', fin: '2026-11-12', motif: 'RTT' }],
    bruno: [{ debut: '2026-12-20', fin: '2026-12-31', motif: '' }],
  });
});
test('ignore les lignes incomplètes, table vide → aucun congé', () => {
  assert.deepEqual(T.versMap([{ cond_key: 'x', debut: '2026-01-01' }, null]), {});
  assert.deepEqual(T.versMap([]), {});
});
test('nettoyer : dates tronquées au jour (même règle que la saisie)', () => {
  assert.deepEqual(T.nettoyer([{ debut: '2026-01-02T00:00:00', fin: '2026-01-03', motif: 'x' }]), [{ debut: '2026-01-02', fin: '2026-01-03', motif: 'x' }]);
});

console.log('\nÉcritures encore en file d\'attente');
test('congé ajouté puis page rechargée avant l\'envoi → toujours visible', () => {
  const q = [rpc(T.FN_REMPLACER, { p_societe: 'PXP', p_cond_key: 'bruno', p_conges: [{ debut: '2026-12-20', fin: '2026-12-31' }, { debut: '2027-01-02', fin: '2027-01-03' }] })];
  const r = T.appliquerFile(T.versMap(LIGNES), q, 'PXP');
  assert.equal(r.bruno.length, 2);
  assert.equal(r.alice.length, 2);
});
test('tous les congés d\'un conducteur supprimés, pas encore envoyé → ne reviennent pas', () => {
  const q = [rpc(T.FN_REMPLACER, { p_societe: 'PXP', p_cond_key: 'alice', p_conges: [] })];
  const r = T.appliquerFile(T.versMap(LIGNES), q, 'PXP');
  assert.ok(!('alice' in r));
  assert.ok('bruno' in r);
});
test('écriture d\'une AUTRE société ignorée', () => {
  const q = [rpc(T.FN_REMPLACER, { p_societe: 'AUTRE', p_cond_key: 'alice', p_conges: [] })];
  assert.equal(T.appliquerFile(T.versMap(LIGNES), q, 'PXP').alice.length, 2);
});
test('autres écritures en file (réglages, véhicules) ignorées', () => {
  const q = [{ op: 'upsert', table: 'app_settings', row: { id: 'PXP', data: { condConges: {} } } }, { op: 'delete', table: 'vehicules', id: 'V-1' }];
  assert.deepEqual(T.appliquerFile(T.versMap(LIGNES), q, 'PXP'), T.versMap(LIGNES));
});
test('renommage en file : les congés suivent la nouvelle clé', () => {
  const q = [rpc(T.FN_RENOMMER, { p_societe: 'PXP', p_ancienne: 'alice', p_nouvelle: 'alice-martin' })];
  const r = T.appliquerFile(T.versMap(LIGNES), q, 'PXP');
  assert.ok(!('alice' in r));
  assert.equal(r['alice-martin'].length, 2);
});
test('renommage vers une clé qui a déjà des congés → ceux de la nouvelle clé sont gardés (comme le serveur)', () => {
  const q = [rpc(T.FN_RENOMMER, { p_societe: 'PXP', p_ancienne: 'alice', p_nouvelle: 'bruno' })];
  const r = T.appliquerFile(T.versMap(LIGNES), q, 'PXP');
  assert.ok(!('alice' in r));
  assert.equal(r.bruno.length, 1);
});
test('écritures appliquées dans l\'ordre (la dernière gagne)', () => {
  const q = [
    rpc(T.FN_REMPLACER, { p_societe: 'PXP', p_cond_key: 'bruno', p_conges: [] }),
    rpc(T.FN_REMPLACER, { p_societe: 'PXP', p_cond_key: 'bruno', p_conges: [{ debut: '2027-05-01', fin: '2027-05-02' }] }),
  ];
  assert.deepEqual(T.appliquerFile(T.versMap(LIGNES), q, 'PXP').bruno, [{ debut: '2027-05-01', fin: '2027-05-02', motif: '' }]);
});

console.log(`\n${ok} réussi(s), ${ko} échoué(s)`);
if (ko) process.exit(1);
console.log('✅ Projection des congés : conversion exacte, écritures en attente respectées, sociétés séparées.');
