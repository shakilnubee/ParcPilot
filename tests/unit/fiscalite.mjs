#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Tests du MOTEUR FISCAL (TVS/genre + périmètre AEN + bloc <fiscalite>)
// ============================================================================
//  Vérifie les helpers purs : genre fiscal réel (VP/VU/moto/inconnu), TVS (moto & VU non soumis),
//  TVA récupérable (VP/VU + nature), plafond + fraction non déductible d'amortissement (art. 39 CGI,
//  UNIQUEMENT les VP), coût employeur de l'AEN (cotisations, seulement si usage privé réel), et la
//  composition du TCO (4 lectures) avec statut de FIABILITÉ (« à compléter » au lieu d'un faux 0 €).
//  Les blocs testés sont extraits tels quels de app.js : <tvs> (genre + TVS), <aenperimetre>
//  (conducteur privé) et <fiscalite>. Les dépendances FP.* externes sont STUBÉES. Zéro réseau.
//  Usage : node tests/unit/fiscalite.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const grab = (nom) => {
  const m = src.match(new RegExp('/\\*<' + nom + '>\\*/([\\s\\S]*?)/\\*</' + nom + '>\\*/'));
  if (!m) { console.error('❌ Bloc <' + nom + '> introuvable dans app.js'); process.exit(1); }
  return m[1];
};
const FP = {};
// Stubs des dépendances externes (réglages vides → barèmes par défaut).
FP.settings = { get: () => ({}) };
FP.normImmat = (x) => String(x == null ? '' : x).toUpperCase().replace(/[^A-Z0-9]/g, '');
FP.horsFlotte = () => false;
// Ordre d'évaluation = dépendances d'abord (genre → TVS → périmètre AEN → fiscalité).
new Function('FP', grab('tvs'))(FP);
new Function('FP', grab('aenperimetre'))(FP);
new Function('FP', grab('fiscalite'))(FP);

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

console.log('\nGenre fiscal réel (VP / VU / moto / inconnu)');
test('genre carte grise VP → VP', () => assert.equal(FP.categorieFiscale({ genreFiscal: 'VP' }), 'VP'));
test('genre carte grise CTTE → VU', () => assert.equal(FP.categorieFiscale({ genreFiscal: 'CTTE' }), 'VU'));
test('genre carte grise MTT1 → moto', () => assert.equal(FP.categorieFiscale({ genreFiscal: 'MTT1' }), 'moto'));
test('Ducati « Citadine » (mal classée) → moto par la marque', () => assert.equal(FP.categorieFiscale({ categorie: 'Citadine', marque: 'Ducati' }), 'moto'));
test('segment Utilitaire → VU', () => assert.equal(FP.categorieFiscale({ categorie: 'Utilitaire' }), 'VU'));
test('segment Citadine → VP', () => assert.equal(FP.categorieFiscale({ categorie: 'Citadine', marque: 'Renault' }), 'VP'));
test('catégorie inconnue → inconnu', () => assert.equal(FP.categorieFiscale({ categorie: 'Chose', marque: 'Zèbre' }), 'inconnu'));

console.log('\nTVS — moto & utilitaire NON soumis');
test('Ducati (moto) → non soumise', () => assert.equal(FP.tvsDetail({ categorie: 'Citadine', marque: 'Ducati', co2: 151 }).applicable, false));
test('Utilitaire → non soumis', () => assert.equal(FP.tvsDetail({ categorie: 'Utilitaire', co2: 234 }).applicable, false));
test('VP essence 138 g → taxé (CO2 + polluant)', () => {
  const r = FP.tvsDetail({ categorie: 'Berline', marque: 'Peugeot', carburant: 'Essence', co2: 138 });
  assert.ok(r.applicable && r.total > 0 && !r.categorieAVerifier);
});
test('genre inconnu → taxé mais categorieAVerifier', () => {
  const r = FP.tvsDetail({ categorie: 'Chose', marque: 'Zèbre', carburant: 'Essence', co2: 120 });
  assert.ok(r.applicable && r.categorieAVerifier === true);
});

console.log('\nCatégorie VP / VU (FP.estUtilitaire)');
test('N1 = utilitaire', () => assert.equal(FP.estUtilitaire({ categorie: 'N1' }), true));
test('Utilitaire = utilitaire', () => assert.equal(FP.estUtilitaire({ categorie: 'Utilitaire' }), true));
test('Berline = tourisme (VP)', () => assert.equal(FP.estUtilitaire({ categorie: 'Berline', marque: 'Audi' }), false));
test('catégorie vide = non utilitaire', () => assert.equal(FP.estUtilitaire({}), false));

console.log('\nPlafond d\'amortissement selon CO2');
test('10 g → 30 000 €', () => assert.equal(FP.amortPlafond(10), 30000));
test('42 g → 20 300 €', () => assert.equal(FP.amortPlafond(42), 20300));
test('138 g → 18 300 €', () => assert.equal(FP.amortPlafond(138), 18300));
test('200 g → 9 900 €', () => assert.equal(FP.amortPlafond(200), 9900));
test('CO2 inconnu → null', () => assert.equal(FP.amortPlafond(null), null));

console.log('\nTVA récupérable (TTC 120 → HT 100 + TVA 20)');
test('VP carburant → 80 % (récup 16, non récup 4)', () => {
  const r = FP.tvaDepense({ categorie: 'Berline', marque: 'Audi' }, 120, 'carburant');
  assert.ok(near(r.ht, 100) && near(r.tvaFacturee, 20) && near(r.recuperable, 16) && near(r.nonRecuperable, 4));
});
test('VU carburant → 100 % (récup 20)', () => {
  const r = FP.tvaDepense({ categorie: 'N1' }, 120, 'carburant');
  assert.ok(near(r.recuperable, 20) && near(r.nonRecuperable, 0));
});
test('VP achat → 0 % (rien de récupérable)', () => {
  const r = FP.tvaDepense({ categorie: 'Berline', marque: 'Audi' }, 120, 'achat');
  assert.ok(near(r.recuperable, 0) && near(r.nonRecuperable, 20));
});
test('électricité → 100 % quelle que soit la catégorie', () => {
  const r = FP.tvaDepense({ categorie: 'Berline', marque: 'Audi' }, 120, 'electricite');
  assert.ok(near(r.recuperable, 20));
});

console.log('\nAmortissement');
test('VP achat 42 000 € / CO2 138 → annuel 8 400, non déductible 4 740/an', () => {
  FP.estLeasing = () => false; FP.leasingCoutContrat = () => null;
  const a = FP.amortissement({ immat: 'AA-123-AA', valeurAchat: 42000, co2: 138, categorie: 'Berline', marque: 'Audi' });
  assert.equal(a.mode, 'achat'); assert.equal(a.genre, 'VP');
  assert.ok(near(a.annuel, 8400) && a.plafond === 18300 && near(a.nonDeductibleAnnuel, (42000 - 18300) / 5));
});
test('VU achat 50 310 € → AUCUN plafond, intégralement déductible (non déd. = 0)', () => {
  FP.estLeasing = () => false; FP.leasingCoutContrat = () => null;
  const a = FP.amortissement({ immat: 'GA-313-PK', valeurAchat: 50310, co2: 234, categorie: 'Utilitaire' });
  assert.equal(a.mode, 'achat'); assert.equal(a.genre, 'VU');
  assert.equal(a.plafond, null); assert.equal(a.nonDeductibleAnnuel, 0);
  assert.ok(near(a.annuel, 50310 / 5));
});
test('Moto achat 18 000 € → AUCUN plafond (non déd. = 0)', () => {
  FP.estLeasing = () => false; FP.leasingCoutContrat = () => null;
  const a = FP.amortissement({ immat: 'GZ-103-JN', valeurAchat: 18000, co2: 151, categorie: 'Citadine', marque: 'Ducati' });
  assert.equal(a.genre, 'moto'); assert.equal(a.nonDeductibleAnnuel, 0);
});
test('Achat prix inconnu → base null + raison', () => {
  FP.estLeasing = () => false; FP.leasingCoutContrat = () => null;
  const a = FP.amortissement({ immat: 'BB-1', co2: 100, categorie: 'Berline' });
  assert.equal(a.mode, 'achat'); assert.equal(a.base, null); assert.ok(a.reason);
});
test('Location VP (LLD) → loyer annuel, part non déd. null (à renseigner)', () => {
  FP.estLeasing = () => true; FP.leasingCoutContrat = () => ({ loyerMois: 540 });
  const a = FP.amortissement({ immat: 'CC-2', categorie: 'Berline', marque: 'BMW' });
  assert.equal(a.mode, 'location'); assert.ok(near(a.loyerAnnuel, 6480)); assert.equal(a.loyerNonDeductibleAnnuel, null);
});
test('Location VU → loyer intégralement déductible (non déd. = 0)', () => {
  FP.estLeasing = () => true; FP.leasingCoutContrat = () => ({ loyerMois: 400 });
  const a = FP.amortissement({ immat: 'DD-9', categorie: 'Utilitaire' });
  assert.equal(a.mode, 'location'); assert.equal(a.loyerNonDeductibleAnnuel, 0);
});

console.log('\nCoût employeur de l\'AEN — seulement si USAGE PRIVÉ réel');
test('VP avec conducteur : AEN 1 200 €/an → cotisations 504 €/an (42 %)', () => {
  FP.aenDetail = () => ({ applicable: true, netAnnuel: 1200, netMensuel: 100 });
  const e = FP.aenCoutEmployeur({ categorie: 'Berline', marque: 'Audi', chauffeur: 'Jean Martin' });
  assert.ok(e.applicable && near(e.cotisationsAnnuelles, 504) && near(e.aenAnnuel, 1200));
});
test('SANS conducteur (pool/parc) → pas d\'AEN (coût employeur 0)', () => {
  FP.aenDetail = () => ({ applicable: true, netAnnuel: 1200, netMensuel: 100 });
  const e = FP.aenCoutEmployeur({ categorie: 'Berline', marque: 'Audi', chauffeur: '' });
  assert.equal(e.applicable, false); assert.equal(e.cotisationsAnnuelles, 0);
});
test('Utilitaire même avec conducteur → pas d\'AEN par défaut (usage pro)', () => {
  FP.aenDetail = () => ({ applicable: true, netAnnuel: 1200, netMensuel: 100 });
  const e = FP.aenCoutEmployeur({ categorie: 'Utilitaire', chauffeur: 'Paul Durand' });
  assert.equal(e.applicable, false); assert.equal(e.cotisationsAnnuelles, 0);
});

console.log('\nTCO — fiabilité (jamais un faux « 0 € »)');
test('VP achat 42 000 : composantes cohérentes, fiabilité = estimé', () => {
  FP.estLeasing = () => false; FP.leasingCoutContrat = () => null;
  FP.coutExploitAnnee = () => 3000;
  FP.aenDetail = () => ({ applicable: true, netAnnuel: 1200, netMensuel: 100 });
  const t = FP.tco({ immat: 'DD-3', valeurAchat: 42000, co2: 138, categorie: 'Berline', marque: 'Audi', chauffeur: 'Jean Martin' }, { annee: 2026, factures: [] });
  assert.equal(t.mode, 'achat'); assert.equal(t.genre, 'VP'); assert.equal(t.aCompleter, false); assert.equal(t.fiabilite, 'estime');
  assert.ok(near(t.composantes.amortAnnuel, 8400) && near(t.composantes.cotisationsAEN, 504));
  assert.ok(near(t.fiscal.nonDeductible, (42000 - 18300) / 5));
  assert.ok(near(t.economique, 3000 + 8400 + t.composantes.taxes + 504));
});
test('prix d\'achat inconnu (0) → fiabilité « à compléter », pas un TCO certain', () => {
  FP.estLeasing = () => false; FP.leasingCoutContrat = () => null;
  FP.coutExploitAnnee = () => 0;
  FP.aenDetail = () => null;
  const t = FP.tco({ immat: 'EQA-1', valeurAchat: 0, carburant: 'Electrique', categorie: 'SUV', marque: 'Mercedes', chauffeur: '' }, { annee: 2026, factures: [] });
  assert.equal(t.aCompleter, true); assert.equal(t.fiabilite, 'a_completer');
  assert.ok(Array.isArray(t.manques) && t.manques.indexOf("prix d'achat") >= 0);
});
test('non déductible JAMAIS ajouté au TCO économique', () => {
  FP.estLeasing = () => false; FP.leasingCoutContrat = () => null;
  FP.coutExploitAnnee = () => 0;
  FP.aenDetail = () => null;
  // VP très cher : grosse part non déductible, mais économique = amort + taxes (pas la non-déd. en plus).
  const t = FP.tco({ immat: 'TAY-1', valeurAchat: 169000, carburant: 'Electrique', categorie: 'Berline', marque: 'Porsche', chauffeur: '' }, { annee: 2026, factures: [] });
  assert.ok(near(t.economique, t.composantes.amortAnnuel + t.composantes.taxes));
  assert.ok(t.fiscal.nonDeductible > 0); // la part non déd. existe mais reste HORS du coût économique
});

console.log('\n' + (ko === 0 ? '✅ TOUS LES TESTS PASSENT' : '❌ ' + ko + ' ÉCHEC(S)') + ' (' + ok + ' ok)');
process.exit(ko === 0 ? 0 : 1);
