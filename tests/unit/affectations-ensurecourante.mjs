#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Test : une LECTURE ne crée JAMAIS de période pour un EMPLACEMENT
//  (FP.affectations.ensureCourante, assets/js/app.js)
// ============================================================================
//  Régression du bug HJ-804-VM : ensureCourante, appelée à CHAQUE rendu, créait une période
//  « Dépôt » quand le véhicule n'avait pas de période ouverte → empilement de doublons « Dépôt »
//  le même jour (5 périodes vides). Un EMPLACEMENT (Dépôt/Siège/Navette) ne doit JAMAIS déclencher
//  de création de période (ce n'est pas un conducteur). Un vrai conducteur (personne), lui, garde
//  sa période de suivi auto. La méthode est extraite TELLE QUELLE de app.js. Zéro dépendance.
//  Usage : node tests/unit/affectations-ensurecourante.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const m = src.match(/ensureCourante\(veh\)\s*\{([\s\S]*?)\n\s{2}\},/);
if (!m) { console.error('❌ Méthode ensureCourante(veh) introuvable dans app.js'); process.exit(1); }
const body = m[1];

// FP.estEmplacement réel (mêmes règles que l'app) pour que le test soit fidèle.
global.FP = {
  EMPLACEMENTS: [{ cle: 'depot', label: 'Dépôt' }, { cle: 'siege', label: 'Siège' }, { cle: 'navette', label: 'Navette' }],
  estEmplacement: (x) => {
    const n = (x == null ? '' : String(x)).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!n) return '';
    const premier = n.split(/[\s\-]+/)[0];
    const f = global.FP.EMPLACEMENTS.find(e => e.cle === premier);
    return f ? f.cle : '';
  },
};

const ensureCourante = new Function('veh', body);

// Mini-moteur : `this` fournit l'interface utilisée par ensureCourante. addEntry enregistre les appels.
function makeThis(periods) {
  const created = [];
  return {
    created,
    _norm(n) { return (n == null ? '' : String(n)).trim(); },
    forVeh() { return periods.slice(); },
    courante() { const o = periods.filter(x => !x.fin); return o.length ? o[o.length - 1] : null; },
    _autoOk() { return true; },
    _sinceCourante() { return null; },
    _remise() { return { km: null, date: null }; },
    addEntry(vehId, nom, debut, fin, kmD, kmF, opts) { created.push({ nom, debut, opts }); periods.push({ conducteur: nom, debut, fin: null }); },
  };
}

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };

console.log('\nUne lecture ne crée jamais de période pour un emplacement');

test('Dépôt + aucune période ouverte → AUCUNE création', () => {
  const t = makeThis([{ conducteur: 'Dépôt', debut: '2026-01-01', fin: '2026-06-01' }]);
  ensureCourante.call(t, { id: 'V1', chauffeur: 'Dépôt' });
  assert.equal(t.created.length, 0, 'ensureCourante ne doit créer aucune période pour « Dépôt »');
});

test('Siège (emplacement avec suffixe) → AUCUNE création', () => {
  const t = makeThis([]);
  ensureCourante.call(t, { id: 'V2', chauffeur: 'Siège PXP' });
  assert.equal(t.created.length, 0);
});

test('Vrai conducteur sans période ouverte → UNE création (comportement conservé)', () => {
  const t = makeThis([]);
  ensureCourante.call(t, { id: 'V3', chauffeur: 'Marie Durand' });
  assert.equal(t.created.length, 1, 'une personne garde sa période de suivi auto');
  assert.equal(t.created[0].nom, 'Marie Durand');
});

test('Vrai conducteur AVEC période déjà ouverte → AUCUNE création (idempotent)', () => {
  const t = makeThis([{ conducteur: 'Marie Durand', debut: '2026-11-01', fin: null }]);
  ensureCourante.call(t, { id: 'V4', chauffeur: 'Marie Durand' });
  assert.equal(t.created.length, 0);
});

test('Sans chauffeur (—) → AUCUNE création', () => {
  const t = makeThis([]);
  ensureCourante.call(t, { id: 'V5', chauffeur: '—' });
  assert.equal(t.created.length, 0);
});

console.log(`\n${ko === 0 ? '✅' : '❌'} ensureCourante : ${ok}/${ok + ko} tests OK\n`);
process.exit(ko === 0 ? 0 : 1);
