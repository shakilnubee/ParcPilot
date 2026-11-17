#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Test du NOMMAGE AUTO des documents (FP.nomFichierDoc, app.js)
// ============================================================================
//  Vérifie la construction du nom de fichier métier (sans extension) à partir du TYPE + des métadonnées
//  DÉJÀ connues (jamais inventées), et l'assainissement des caractères interdits. Fonctions PURES extraites
//  de app.js (stub FP minimal : immatFmt). Zéro dépendance réseau/Supabase.
//  Usage : node tests/unit/nom-fichier-doc.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const m = src.match(/FP\.sanitizeFilename = function[\s\S]*?return FP\.sanitizeFilename\(name\);\n\};/);
if (!m) { console.error('❌ Bloc FP.sanitizeFilename…nomFichierDoc introuvable dans app.js'); process.exit(1); }
const FP = { immatFmt: (s) => String(s) };   // dans les tests on passe l'immat déjà formatée
// eslint-disable-next-line no-new-func
new Function('FP', m[0] + '\nFP.sanitizeFilename=FP.sanitizeFilename;FP.extDoc=FP.extDoc;FP._pnDateFichier=FP._pnDateFichier;FP.nomFichierDoc=FP.nomFichierDoc;')(FP);

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };

test('sanitizeFilename : retire les caractères interdits', () => {
  assert.equal(FP.sanitizeFilename('a/b:c*?"<>|d'), 'a b c d');
  assert.equal(FP.sanitizeFilename('  CARTE  GRISE  '), 'CARTE GRISE');
  assert.equal(FP.sanitizeFilename('fin.'), 'fin');
  assert.equal(FP.sanitizeFilename(''), 'document');
});
test('carte grise → CARTE GRISE <immat>', () => {
  assert.equal(FP.nomFichierDoc('carte-grise', { immat: 'HB-733-DE' }), 'CARTE GRISE HB-733-DE');
});
test('contrôle technique → + date (JJ-MM-AAAA)', () => {
  assert.equal(FP.nomFichierDoc('controle-technique', { immat: 'HB-733-DE', date: '2025-12-04' }), 'CONTROLE TECHNIQUE HB-733-DE - 04-12-2025');
});
test('facture avec immat + numéro', () => {
  assert.equal(FP.nomFichierDoc('facture', { immat: 'HB-733-DE', numero: 'F123' }), 'FACTURE HB-733-DE - F123');
});
test('devis → + fournisseur', () => {
  assert.equal(FP.nomFichierDoc('devis', { immat: 'HB-733-DE', fournisseur: 'Garage Dupont' }), 'DEVIS HB-733-DE - Garage Dupont');
});
test('contrat leasing', () => {
  assert.equal(FP.nomFichierDoc('contrat', { immat: 'HB-733-DE' }), 'CONTRAT LEASING HB-733-DE');
});
test('assurance', () => {
  assert.equal(FP.nomFichierDoc('assurance', { immat: 'HB-733-DE' }), 'ATTESTATION ASSURANCE HB-733-DE');
});
test('EDL entrée / sortie selon le sens', () => {
  assert.equal(FP.nomFichierDoc('etat-des-lieux', { immat: 'HB-733-DE', date: '2025-12-04', sens: 'sortie' }), 'EDL SORTIE HB-733-DE - 04-12-2025');
  assert.equal(FP.nomFichierDoc('etat-des-lieux', { immat: 'HB-733-DE', sens: 'remise' }), 'EDL ENTREE HB-733-DE');
});
test('courrier assurance → + date', () => {
  assert.equal(FP.nomFichierDoc('courrier', { immat: 'HB-733-DE', date: '2025-01-02' }), 'COURRIER ASSURANCE HB-733-DE - 02-01-2025');
});
test('facture entretien (ctx.entretien)', () => {
  assert.equal(FP.nomFichierDoc('facture', { immat: 'HB-733-DE', date: '2025-12-04', entretien: true }), 'FACTURE ENTRETIEN HB-733-DE - 04-12-2025');
});
test('facture SANS immat (multi-véhicules) → fournisseur + n° + date, jamais une immat inventée', () => {
  const n = FP.nomFichierDoc('facture', { fournisseur: 'Euromaster', numero: 'F9', date: '2025-01-02' });
  assert.equal(n, 'FACTURE - Euromaster - F9 - 02-01-2025');
  assert.ok(!/[A-Z]{2}-\d{3}-[A-Z]{2}/.test(n));
});
test('type inconnu → DOCUMENT + immat (nom générique sûr)', () => {
  assert.equal(FP.nomFichierDoc('zzz', { immat: 'HB-733-DE' }), 'DOCUMENT HB-733-DE');
});

console.log(ko === 0 ? `\n✅ nom-fichier-doc : ${ok}/${ok} tests OK` : `\n❌ nom-fichier-doc : ${ko} échec(s) sur ${ok + ko}`);
process.exit(ko === 0 ? 0 : 1);
