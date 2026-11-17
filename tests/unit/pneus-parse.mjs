#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Test du helper PNEUMATIQUES (FP.pneus, assets/js/app.js)
// ============================================================================
//  Vérifie les fonctions PURES de parsing/normalisation/recomposition des dimensions avant-arrière :
//  - normDim      : normalise une dimension libre → « 245/45 R19 » (jamais inventer si non reconnu)
//  - parseCombined: « … (av) / … (arr) » OU dimension unique → { meme, av:{dim}, ar:{dim} }
//  - toCombined   : recompose la chaîne héritée depuis l'état structuré
//  L'objet FP.pneus est extrait TEL QUEL de app.js (stub FP minimal). Zéro dépendance réseau/Supabase.
//  Usage : node tests/unit/pneus-parse.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const m = src.match(/FP\.pneus = \{[\s\S]*?\n\};/);
if (!m) { console.error('❌ FP.pneus introuvable dans app.js'); process.exit(1); }
const FP = {};
// eslint-disable-next-line no-new-func
new Function('FP', m[0])(FP);

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };

test('normDim : minuscule + espaces → forme canonique', () => {
  assert.equal(FP.pneus.normDim('245/45 r19'), '245/45 R19');
  assert.equal(FP.pneus.normDim('205/55R16'), '205/55 R16');
  assert.equal(FP.pneus.normDim(' 275/40  Z  18 '), '275/40 Z18');
});
test('normDim : non reconnu → gardé tel quel (jamais inventé)', () => {
  assert.equal(FP.pneus.normDim('à vérifier'), 'à vérifier');
  assert.equal(FP.pneus.normDim(''), '');
});
test('parseCombined : av/arr distincts', () => {
  const p = FP.pneus.parseCombined('245/45 R19 (av) / 275/40 R19 (arr)');
  assert.equal(p.meme, false);
  assert.equal(p.av.dim, '245/45 R19');
  assert.equal(p.ar.dim, '275/40 R19');
});
test('parseCombined : ordre inversé (arr avant av) correctement associé', () => {
  const p = FP.pneus.parseCombined('275/40 R19 (arr) / 245/45 R19 (av)');
  assert.equal(p.av.dim, '245/45 R19');
  assert.equal(p.ar.dim, '275/40 R19');
});
test('parseCombined : dimension unique → meme=true, av=ar', () => {
  const p = FP.pneus.parseCombined('205/55 R16');
  assert.equal(p.meme, true);
  assert.equal(p.av.dim, '205/55 R16');
  assert.equal(p.ar.dim, '205/55 R16');
});
test('parseCombined : av=arr identiques → meme=true', () => {
  const p = FP.pneus.parseCombined('245/45 R19 (av) / 245/45 R19 (arr)');
  assert.equal(p.meme, true);
});
test('parseCombined : vide → av/ar vides, meme=true', () => {
  const p = FP.pneus.parseCombined('');
  assert.equal(p.av.dim, '');
  assert.equal(p.ar.dim, '');
  assert.equal(p.meme, true);
});
test('toCombined : av/arr distincts → chaîne (av) / (arr)', () => {
  assert.equal(FP.pneus.toCombined({ meme: false, av: { dim: '245/45 R19' }, ar: { dim: '275/40 R19' } }), '245/45 R19 (av) / 275/40 R19 (arr)');
});
test('toCombined : même dimension → une seule valeur', () => {
  assert.equal(FP.pneus.toCombined({ meme: true, av: { dim: '205/55 R16' }, ar: { dim: '205/55 R16' } }), '205/55 R16');
});
test('aller-retour : parse puis toCombined conserve le sens', () => {
  const p = FP.pneus.parseCombined('245/45 R19 (av) / 275/40 R19 (arr)');
  assert.equal(FP.pneus.toCombined(p), '245/45 R19 (av) / 275/40 R19 (arr)');
});

console.log(ko === 0 ? `\n✅ pneus : ${ok}/${ok} tests OK` : `\n❌ pneus : ${ko} échec(s) sur ${ok + ko}`);
process.exit(ko === 0 ? 0 : 1);
