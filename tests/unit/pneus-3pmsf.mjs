#!/usr/bin/env node
/* Détection 3PMSF depuis une facture de pneus (FP.pneus.detect3pmsf / detecterDepuisFacture, app.js).
 * On extrait le littéral `FP.pneus = { … }` (autonome) et on teste les VRAIES fonctions.
 * Règle testée : seul un marquage EXPLICITE confirme « Oui » ; « M+S » seul ou rien = « Non renseigné » (null).
 * node tests/unit/pneus-3pmsf.mjs
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const start = src.indexOf('FP.pneus = {');
assert.ok(start > 0, 'FP.pneus introuvable dans app.js');
const end = src.indexOf('\n};', start) + 3; // première fermeture d'objet en début de ligne
const block = src.slice(start, end);
const FP = {};
// eslint-disable-next-line no-new-func
new Function('FP', block)(FP);
const P = FP.pneus;

let ok = 0, ko = 0;
const t = (n, f) => { try { f(); ok++; console.log('  ✅ ' + n); } catch (e) { ko++; console.log('  ❌ ' + n + '\n     ' + (e.message || e)); } };

// ── detect3pmsf : marquage EXPLICITE = true ─────────────────────────────────────────────
t('« 3PMSF HOMOLOGATION NEIGE » → true (F-2026-627)', () => assert.equal(P.detect3pmsf('PNEU RENFORCE 3PMSF HOMOLOGATION NEIGE M+S BOUE ETNEIGE'), true));
t('« 3 P M S F » espacé → true', () => assert.equal(P.detect3pmsf('marquage 3 P M S F'), true));
t('« homologation neige » → true', () => assert.equal(P.detect3pmsf('pneu hiver homologation neige'), true));
t('« flocon montagne » (symbole 3 pics) → true', () => assert.equal(P.detect3pmsf('pictogramme flocon montagne'), true));

// ── M+S seul ou rien = null (jamais « Oui » par défaut, jamais inventé) ──────────────────
t('« M+S BOUE ETNEIGE » SEUL → null (pas assez)', () => assert.equal(P.detect3pmsf('M+S BOUE ETNEIGE'), null));
t('« M S » seul → null', () => assert.equal(P.detect3pmsf('PNEU 205/60 R16 M S'), null));
t('aucune mention → null', () => assert.equal(P.detect3pmsf('PNEU NEUF PREMIUM 205/60 R16'), null));
t('chaîne vide → null', () => assert.equal(P.detect3pmsf(''), null));

// ── mention explicite « non homologué neige » = false ───────────────────────────────────
t('« non homologué neige » → false', () => assert.equal(P.detect3pmsf('pneu été non homologué neige'), false));

// ── detecterDepuisFacture : parcours complet F-2026-627 ─────────────────────────────────
const f627 = {
  description: 'PNEU NEUF AVEC MONTAGE EQUILIBRAGE VALVE PREMIUM HANKOOK 205/60 R16 PNEU RENFORCE 3PMSF HOMOLOGATION NEIGE M+S BOUE ETNEIGE',
  fournisseur: 'CAR WORLD CONSULTING FRANCE', type: 'entretien'
};
t('F-2026-627 : estPneu=true, dim 205/60 R16, m3pmsf=true, marque Hankook', () => {
  const d = P.detecterDepuisFacture(f627);
  assert.equal(d.estPneu, true);
  assert.equal(d.dim, '205/60 R16');
  assert.equal(d.m3pmsf, true);
  assert.equal(d.marque, 'Hankook');
  assert.equal(d.plusieurs, false);
});
t('facture M+S seul : estPneu=true mais m3pmsf=null', () => {
  const d = P.detecterDepuisFacture({ description: 'PNEU HIVER 195/65 R15 M+S', type: 'entretien' });
  assert.equal(d.estPneu, true);
  assert.equal(d.m3pmsf, null);
});
t('facture sans pneu : estPneu=false', () => {
  const d = P.detecterDepuisFacture({ description: 'Révision + vidange + filtre', type: 'entretien' });
  assert.equal(d.estPneu, false);
});
t('type « pneus » sans libellé → estPneu=true', () => {
  const d = P.detecterDepuisFacture({ description: '', type: 'pneus' });
  assert.equal(d.estPneu, true);
});
t('plusieurs dimensions → plusieurs=true', () => {
  const d = P.detecterDepuisFacture({ description: 'PNEUS 205/60 R16 avant 225/45 R17 arrière', type: 'pneus' });
  assert.equal(d.plusieurs, true);
  assert.deepEqual(d.dims, ['205/60 R16', '225/45 R17']);
});

console.log(`\n${ko ? '❌' : '✅'} pneus-3pmsf : ${ok} ok, ${ko} ko\n`);
process.exit(ko ? 1 : 0);
