#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Tests des FONDATIONS FISCALES (bloc <fiscalite> de app.js)
// ============================================================================
//  Vérifie les helpers purs : TVA récupérable (VP/VU + nature), plafond + fraction non déductible
//  d'amortissement (art. 39 CGI), coût employeur de l'AEN (cotisations), et la composition du TCO
//  (4 lectures). Le bloc testé est extrait tel quel de app.js (entre /*<fiscalite>*/ et /*</fiscalite>*/).
//  Les dépendances FP.* externes (settings, aenDetail, tvsDetail, coutExploitAnnee…) sont STUBÉES.
//  Zéro dépendance réseau. Usage : node tests/unit/fiscalite.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const m = src.match(/\/\*<fiscalite>\*\/([\s\S]*?)\/\*<\/fiscalite>\*\//);
if (!m) { console.error('❌ Bloc <fiscalite> introuvable dans app.js'); process.exit(1); }
const FP = {};
new Function('FP', m[1])(FP);

// Stubs des dépendances externes (réglages vides → barèmes par défaut).
FP.settings = { get: () => ({}) };
FP.normImmat = (x) => String(x == null ? '' : x).toUpperCase().replace(/[^A-Z0-9]/g, '');

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

console.log('\nCatégorie VP / VU');
test('N1 = utilitaire', () => assert.equal(FP.estUtilitaire({ categorie: 'N1' }), true));
test('Utilitaire = utilitaire', () => assert.equal(FP.estUtilitaire({ categorie: 'Utilitaire' }), true));
test('M1 = tourisme (VP)', () => assert.equal(FP.estUtilitaire({ categorie: 'M1' }), false));
test('catégorie vide = VP', () => assert.equal(FP.estUtilitaire({}), false));

console.log('\nPlafond d\'amortissement selon CO2');
test('10 g → 30 000 €', () => assert.equal(FP.amortPlafond(10), 30000));
test('42 g → 20 300 €', () => assert.equal(FP.amortPlafond(42), 20300));
test('138 g → 18 300 €', () => assert.equal(FP.amortPlafond(138), 18300));
test('200 g → 9 900 €', () => assert.equal(FP.amortPlafond(200), 9900));
test('CO2 inconnu → null', () => assert.equal(FP.amortPlafond(null), null));

console.log('\nTVA récupérable (TTC 120 → HT 100 + TVA 20)');
test('VP carburant → 80 % (récup 16, non récup 4)', () => {
  const r = FP.tvaDepense({ categorie: 'M1' }, 120, 'carburant');
  assert.ok(near(r.ht, 100) && near(r.tvaFacturee, 20) && near(r.recuperable, 16) && near(r.nonRecuperable, 4));
});
test('VU carburant → 100 % (récup 20)', () => {
  const r = FP.tvaDepense({ categorie: 'N1' }, 120, 'carburant');
  assert.ok(near(r.recuperable, 20) && near(r.nonRecuperable, 0));
});
test('VP achat → 0 % (rien de récupérable)', () => {
  const r = FP.tvaDepense({ categorie: 'M1' }, 120, 'achat');
  assert.ok(near(r.recuperable, 0) && near(r.nonRecuperable, 20));
});
test('électricité → 100 % quelle que soit la catégorie', () => {
  const r = FP.tvaDepense({ categorie: 'M1' }, 120, 'electricite');
  assert.ok(near(r.recuperable, 20));
});

console.log('\nAmortissement');
test('Achat 42 000 € / CO2 138 → annuel 8 400, non déductible 4 740/an', () => {
  FP.estLeasing = () => false; FP.leasingCoutContrat = () => null;
  const a = FP.amortissement({ immat: 'AA-123-AA', valeurAchat: 42000, co2: 138, categorie: 'M1' });
  assert.equal(a.mode, 'achat');
  assert.ok(near(a.annuel, 8400) && a.plafond === 18300 && near(a.nonDeductibleAnnuel, (42000 - 18300) / 5));
});
test('Achat prix inconnu → base null + raison', () => {
  FP.estLeasing = () => false; FP.leasingCoutContrat = () => null;
  const a = FP.amortissement({ immat: 'BB-1', co2: 100, categorie: 'M1' });
  assert.equal(a.mode, 'achat'); assert.equal(a.base, null); assert.ok(a.reason);
});
test('Location (LLD) → pas d\'amortissement, loyer annuel, non déductible null (à renseigner)', () => {
  FP.estLeasing = () => true; FP.leasingCoutContrat = () => ({ loyerMois: 540 });
  const a = FP.amortissement({ immat: 'CC-2', categorie: 'M1' });
  assert.equal(a.mode, 'location'); assert.ok(near(a.loyerAnnuel, 6480)); assert.equal(a.loyerNonDeductibleAnnuel, null);
});

console.log('\nCoût employeur de l\'AEN');
test('AEN 1 200 €/an → cotisations 504 €/an (42 %)', () => {
  FP.aenDetail = () => ({ applicable: true, netAnnuel: 1200, netMensuel: 100 });
  const e = FP.aenCoutEmployeur({});
  assert.ok(e.applicable && near(e.cotisationsAnnuelles, 504) && near(e.aenAnnuel, 1200));
});
test('Pas d\'AEN → coût employeur 0', () => {
  FP.aenDetail = () => null;
  const e = FP.aenCoutEmployeur({});
  assert.equal(e.applicable, false); assert.equal(e.cotisationsAnnuelles, 0);
});

console.log('\nTCO (4 lectures) — achat 42 000, CO2 138, exploit 3 000, taxe 303, AEN 1 200');
test('composantes + lectures cohérentes, sans double compte', () => {
  FP.estLeasing = () => false; FP.leasingCoutContrat = () => null;
  FP.coutExploitAnnee = () => 3000;
  FP.tvsDetail = () => ({ applicable: true, total: 303 });
  FP.aenDetail = () => ({ applicable: true, netAnnuel: 1200, netMensuel: 100 });
  const t = FP.tco({ immat: 'DD-3', valeurAchat: 42000, co2: 138, categorie: 'M1' }, { annee: 2026, factures: [] });
  assert.equal(t.mode, 'achat');
  assert.ok(near(t.composantes.amortAnnuel, 8400) && near(t.composantes.taxes, 303) && near(t.composantes.cotisationsAEN, 504));
  assert.ok(near(t.tresorerie, 3000 + 0 + 303 + 504));           // 3 807
  assert.ok(near(t.comptable, 3000 + 8400 + 303 + 504));         // 12 207
  assert.ok(near(t.fiscal.nonDeductible, (42000 - 18300) / 5));  // 4 740
  assert.ok(near(t.fiscal.deductible, 12207 - 4740));            // 7 467
  assert.ok(near(t.fiscal.effetISEstime, (12207 - 4740) * 0.25));// 1 866,75
  assert.ok(near(t.economique, 12207));
});

console.log('\n' + (ko === 0 ? '✅ TOUS LES TESTS PASSENT' : '❌ ' + ko + ' ÉCHEC(S)') + ' (' + ok + ' ok)');
process.exit(ko === 0 ? 0 : 1);
