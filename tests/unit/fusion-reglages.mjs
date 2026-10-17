#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Tests de la FUSION DES RÉGLAGES (FP._fusion, assets/js/app.js)
// ============================================================================
//  Vérifie qu'une écriture de réglages restée en file d'attente (page quittée pendant l'envoi,
//  hors-ligne…) ne peut JAMAIS vider la ligne de la société, et que les modifications faites sur
//  un AUTRE appareil sont respectées (pas de « données qui reviennent »).
//  Le bloc testé est extrait tel quel de app.js (entre /*<fusion-reglages>*/ et /*</fusion-reglages>*/).
//  Zéro dépendance. Usage : node tests/unit/fusion-reglages.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const m = src.match(/\/\*<fusion-reglages>\*\/([\s\S]*?)\/\*<\/fusion-reglages>\*\//);
if (!m) { console.error('❌ Bloc <fusion-reglages> introuvable dans app.js'); process.exit(1); }
const FP = {};
new Function('FP', m[1])(FP);
const F = FP._fusion;

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };
const clone = (x) => JSON.parse(JSON.stringify(x));

// Ligne serveur réaliste (extrait) : réglages de la société avec leurs données de travail.
const SERVEUR = {
  profil: { nom: 'PXP', mailExpediteur: 'contact@exemple.test', logoUrl: 'https://x/logo.png' },
  societe: { nom: 'Société X' },
  navOrder: ['vehicules', 'amendes'],
  condConges: { alice: [{ debut: '2026-10-01', fin: '2026-10-10' }], bruno: [{ debut: '2026-11-01', fin: '2026-11-05' }] },
  affectations: { 'V-1': [{ conducteur: 'alice', debut: '2026-01-01', kmDebut: 12000 }] },
  loueurs: [{ nom: 'Loueur A' }, { nom: 'Loueur B' }],
  contratsCadre: [{ id: 'c1', nom: 'Carburant' }, { id: 'c2', nom: 'Péage' }],
  kmMajDates: { 'AB-123-CD': '2026-10-01' },
};
for (let i = 0; i < 70; i++) SERVEUR['cle' + i] = i;   // → ~78 clés, comme la vraie ligne
// Réglages PAR DÉFAUT d'un navigateur au cache vide (cas vécu le 17/10/2026).
const DEFAUTS = { profil: {}, societe: { nom: 'Parc Pilot' }, navOrder: [], groupes: { siege: { label: 'Siège' } }, darkMode: false, kmMajDates: { 'AB-123-CD': '2026-10-17' } };

console.log('\nRejeu d\'une écriture restée en file');

test('cas vécu : copie par défaut sans information de fusion → ne vide RIEN', () => {
  const r = F.rejouer(clone(SERVEUR), { row: { id: 'PXP', data: clone(DEFAUTS) } });
  for (const k of Object.keys(SERVEUR)) assert.ok(k in r, `clé « ${k} » perdue`);
  assert.deepEqual(r.profil, SERVEUR.profil, 'profil écrasé');
  assert.deepEqual(r.societe, SERVEUR.societe, 'nom de société écrasé');
  assert.deepEqual(r.navOrder, SERVEUR.navOrder, 'menu écrasé');
  assert.deepEqual(r.condConges, SERVEUR.condConges, 'congés modifiés');
  assert.deepEqual(r.kmMajDates, SERVEUR.kmMajDates, 'valeur serveur écrasée par la copie');
  assert.ok('groupes' in r && 'darkMode' in r, 'les trous ne sont pas comblés');
});

test('écriture « gapfill » → le serveur gagne sur toute valeur existante', () => {
  const r = F.rejouer(clone(SERVEUR), { row: { data: { navOrder: [], nouvelleCle: 1 } }, fusion: { mode: 'gapfill' } });
  assert.deepEqual(r.navOrder, SERVEUR.navOrder);
  assert.equal(r.nouvelleCle, 1);
});

test('écriture « delta » → seule la clé modifiée est appliquée', () => {
  const data = { ...clone(DEFAUTS), kmMajDates: { 'AB-123-CD': '2026-10-17' } };
  const r = F.rejouer(clone(SERVEUR), { row: { data }, fusion: { mode: 'delta', cles: ['kmMajDates'], coll: [], bases: {} } });
  assert.equal(r.kmMajDates['AB-123-CD'], '2026-10-17');
  assert.deepEqual(r.profil, SERVEUR.profil);
  assert.deepEqual(r.navOrder, SERVEUR.navOrder);
  assert.equal(Object.keys(r).length, Object.keys(SERVEUR).length);
});

test('« delta » sur une collection : un congé supprimé ici est supprimé, le reste suit le serveur', () => {
  const base = clone(SERVEUR.condConges);
  const serveur = clone(SERVEUR); serveur.condConges.claire = [{ debut: '2026-12-01', fin: '2026-12-02' }];   // ajouté ailleurs
  const data = { condConges: { alice: base.alice } };   // ce poste a supprimé « bruno »
  const r = F.rejouer(serveur, { row: { data }, fusion: { mode: 'delta', cles: ['condConges'], coll: ['condConges'], bases: { condConges: base } } });
  assert.ok(!('bruno' in r.condConges), 'suppression non appliquée');
  assert.ok('claire' in r.condConges, 'ajout d\'un autre appareil perdu');
  assert.ok('alice' in r.condConges);
});

test('« delta » ne peut jamais vider entièrement une collection', () => {
  const r = F.rejouer(clone(SERVEUR), { row: { data: { condConges: {} } }, fusion: { mode: 'delta', cles: ['condConges'], coll: ['condConges'], bases: { condConges: clone(SERVEUR.condConges) } } });
  assert.deepEqual(r.condConges, SERVEUR.condConges);
});

test('ligne absente côté serveur → création avec la copie', () => {
  const r = F.rejouer(null, { row: { data: { a: 1 } } });
  assert.deepEqual(r, { a: 1 });
});

console.log('\nFusion multi-appareils (scénario B de l\'audit : « l\'élément supprimé qui ressuscite »)');

test('tableau à id : supprimé sur un autre appareil, non touché ici → reste supprimé', () => {
  const base = [{ id: 'c1', nom: 'Carburant' }, { id: 'c2', nom: 'Péage' }];
  const serveur = [{ id: 'c2', nom: 'Péage' }];                                   // c1 supprimé ailleurs
  const ici = [{ id: 'c1', nom: 'Carburant' }, { id: 'c2', nom: 'Péage (modifié)' }];   // ici : c2 modifié seulement
  const r = F.mergeArr(serveur, ici, base);
  assert.deepEqual(r.map(t => t.id), ['c2']);
  assert.equal(r[0].nom, 'Péage (modifié)');
});

test('tableau à id : modifié sur un autre appareil, non touché ici → version de l\'autre appareil gardée', () => {
  const base = [{ id: 'c1', nom: 'A' }, { id: 'c2', nom: 'B' }];
  const serveur = [{ id: 'c1', nom: 'A (autre appareil)' }, { id: 'c2', nom: 'B' }];
  const ici = [{ id: 'c1', nom: 'A' }, { id: 'c2', nom: 'B (ici)' }];
  const r = F.mergeArr(serveur, ici, base);
  assert.equal(r.find(t => t.id === 'c1').nom, 'A (autre appareil)');
  assert.equal(r.find(t => t.id === 'c2').nom, 'B (ici)');
});

test('tableau sans id : retiré ailleurs, non touché ici → reste retiré ; ajout ici conservé', () => {
  const r = F.mergeArr(['x'], ['x', 'y', 'z'], ['x', 'y']);
  assert.deepEqual(r.sort(), ['x', 'z']);
});

test('map : entrée supprimée ailleurs, non touchée ici → ne ressuscite pas (même vide)', () => {
  const base = { 'V-1': { date: '2026-10-20', motif: 'Révision' }, 'V-2': { date: '2026-10-21', motif: 'Pneus' } };
  const serveur = { 'V-2': { date: '2026-10-21', motif: 'Pneus' } };            // V-1 supprimé ailleurs
  const ici = { 'V-1': { date: '2026-10-20', motif: 'Révision' }, 'V-2': { date: '2026-10-22', motif: 'Pneus' } };
  const r = F.mergeMap(serveur, ici, base);
  assert.ok(!('V-1' in r), 'entrée ressuscitée');
  assert.equal(r['V-2'].date, '2026-10-22');
});

test('map : suppression faite ici honorée, ajout d\'un autre appareil préservé', () => {
  const r = F.mergeMap({ a: 1, b: 2, c: 3 }, { a: 1 }, { a: 1, b: 2 });
  assert.deepEqual(r, { a: 1, c: 3 });
});

console.log(`\n${ok} réussi(s), ${ko} échoué(s)`);
if (ko) process.exit(1);
console.log('✅ Fusion des réglages : aucun vidage possible, modifications des autres appareils respectées.');
