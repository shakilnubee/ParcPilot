#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Tests de la PROJECTION DES AFFECTATIONS (FP.affectationsTable, assets/js/app.js)
// ============================================================================
//  Les affectations véhicule ↔ conducteur vivent dans la table vehicle_assignments ; l'application
//  les lit sous la forme settings.affectations = { vehId: [périodes] }. Vérifie la conversion
//  table → réglages (ORDRE conservé : l'écran modifie une période par sa position), la conservation
//  des champs inconnus, et la prise en compte des écritures encore en file d'attente.
//  Le bloc testé est extrait tel quel de app.js (entre /*<affectations-table>*/ et /*</affectations-table>*/).
//  Zéro dépendance. Usage : node tests/unit/affectations-table.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const m = src.match(/\/\*<affectations-table>\*\/([\s\S]*?)\/\*<\/affectations-table>\*\//);
if (!m) { console.error('❌ Bloc <affectations-table> introuvable dans app.js'); process.exit(1); }
const FP = {};
new Function('FP', m[1])(FP);
const T = FP.affectationsTable;

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };
const rpc = (args) => ({ op: 'rpc', fn: T.FN_REMPLACER, args, table: 'vehicle_assignments' });

const LIGNES = [
  { id: 12, veh_id: 'V-2', ordre: 1, conducteur: 'Chloé', debut: '2026-03-01', fin: null, km_debut: 1500, km_fin: null, km_debut_manuel: true, km_fin_manuel: false, debut_manuel: false, extra: {} },
  { id: 11, veh_id: 'V-1', ordre: 2, conducteur: 'Bruno', debut: '2026-06-01', fin: null, km_debut: 20000, km_fin: null, km_debut_manuel: false, km_fin_manuel: false, debut_manuel: true, extra: { note: 'clé sous le pare-soleil' } },
  { id: 10, veh_id: 'V-1', ordre: 1, conducteur: 'Alice', debut: '2025-01-15', fin: '2026-05-31', km_debut: 0, km_fin: 20000, km_debut_manuel: false, km_fin_manuel: true, debut_manuel: false, extra: {} },
];

console.log('\nConversion table → réglages');
test('ordre enregistré respecté (pas l\'ordre des identifiants)', () => {
  const r = T.versMap(LIGNES);
  assert.deepEqual(r['V-1'].map(a => a.conducteur), ['Alice', 'Bruno']);
});
test('période complète : dates, km (0 compris), indicateurs « manuel » seulement s\'ils sont vrais', () => {
  const a = T.versMap(LIGNES)['V-1'][0];
  assert.deepEqual(a, { conducteur: 'Alice', debut: '2025-01-15', fin: '2026-05-31', kmDebut: 0, kmFin: 20000, kmFinManuel: true });
});
test('période en cours : fin = null, km de fin = null', () => {
  const a = T.versMap(LIGNES)['V-2'][0];
  assert.equal(a.fin, null); assert.equal(a.kmFin, null); assert.equal(a.kmDebutManuel, true);
});
test('champs inconnus conservés (colonne extra)', () => {
  assert.equal(T.versMap(LIGNES)['V-1'][1].note, 'clé sous le pare-soleil');
  assert.equal(T.versMap(LIGNES)['V-1'][1].debutManuel, true);
});
test('dates renvoyées au format jour (AAAA-MM-JJ)', () => {
  assert.equal(T.versPeriode({ conducteur: 'X', debut: '2026-01-02T00:00:00+00:00', fin: null }).debut, '2026-01-02');
});
test('table vide → aucune affectation ; ligne sans conducteur ignorée', () => {
  assert.deepEqual(T.versMap([]), {});
  assert.deepEqual(T.versMap([{ veh_id: 'V-9', ordre: 1, conducteur: '' }]), {});
});

console.log('\nÉcritures encore en file d\'attente');
test('changement de conducteur pas encore envoyé → visible après rechargement', () => {
  const liste = [{ conducteur: 'Chloé', debut: '2026-03-01', fin: '2026-10-20' }, { conducteur: 'David', debut: '2026-10-20', fin: null, kmDebut: 3000 }];
  const r = T.appliquerFile(T.versMap(LIGNES), [rpc({ p_societe: 'PXP', p_veh_id: 'V-2', p_periodes: liste })], 'PXP');
  assert.deepEqual(r['V-2'].map(a => a.conducteur), ['Chloé', 'David']);
  assert.equal(r['V-1'].length, 2);
});
test('historique d\'un véhicule vidé, pas encore envoyé → ne revient pas', () => {
  const r = T.appliquerFile(T.versMap(LIGNES), [rpc({ p_societe: 'PXP', p_veh_id: 'V-1', p_periodes: [] })], 'PXP');
  assert.ok(!('V-1' in r)); assert.ok('V-2' in r);
});
test('écriture d\'une autre société ou d\'une autre donnée ignorée', () => {
  const q = [rpc({ p_societe: 'AUTRE', p_veh_id: 'V-1', p_periodes: [] }), { op: 'rpc', fn: 'fp_conges_remplacer', args: { p_societe: 'PXP', p_cond_key: 'x', p_conges: [] } }];
  assert.equal(T.appliquerFile(T.versMap(LIGNES), q, 'PXP')['V-1'].length, 2);
});
test('la file n\'est pas modifiée par la projection (copie)', () => {
  const liste = [{ conducteur: 'Eve', debut: null, fin: null }];
  const r = T.appliquerFile({}, [rpc({ p_societe: 'PXP', p_veh_id: 'V-3', p_periodes: liste })], 'PXP');
  r['V-3'][0].conducteur = 'modifié';
  assert.equal(liste[0].conducteur, 'Eve');
});

console.log(`\n${ok} réussi(s), ${ko} échoué(s)`);
if (ko) process.exit(1);
console.log('✅ Projection des affectations : ordre et champs conservés, écritures en attente respectées.');
