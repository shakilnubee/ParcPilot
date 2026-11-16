#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Test du CONDUCTEUR ACTUEL (FP.affectations.courante, assets/js/app.js)
// ============================================================================
//  Régression du bug « je change le conducteur mais ça revient à Dépôt » : quand l'historique
//  d'un véhicule contient PLUSIEURS périodes restées OUVERTES (séquelle du bug de duplication
//  « Dépôt »), courante() doit renvoyer l'affectation ouverte au DÉBUT LE PLUS RÉCENT (= la
//  dernière affectation réelle), et JAMAIS « la dernière du tableau » dont l'ordre varie après
//  un aller-retour serveur (ce qui faisait « revenir » le conducteur à Dépôt).
//  La méthode courante() est extraite TELLE QUELLE de app.js. Zéro dépendance.
//  Usage : node tests/unit/affectations-courante.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
// Extrait le corps de la méthode courante(vehId) { ... } (jusqu'à l'accolade-virgule fermante).
const m = src.match(/courante\(vehId\)\s*\{([\s\S]*?)\n\s{2}\},/);
if (!m) { console.error('❌ Méthode courante(vehId) introuvable dans app.js'); process.exit(1); }
const couranteBody = m[1];

// Mini-objet reproduisant l'interface utilisée par courante() : forVeh renvoie la liste fournie.
const A = {
  _list: [],
  forVeh() { return this._list.slice(); },
};
A.courante = new Function('vehId', couranteBody);

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };
const run = (list) => { A._list = list; return A.courante('V'); };

console.log('\nConducteur actuel — déterministe même avec un historique corrompu');

test('cas normal : une seule période ouverte → elle est renvoyée', () => {
  const c = run([{ conducteur: 'Alice', debut: '2026-01-01', fin: '2026-05-01' }, { conducteur: 'Bruno', debut: '2026-05-01', fin: null }]);
  assert.equal(c && c.conducteur, 'Bruno');
});

test('aucune période ouverte → null (véhicule sans conducteur)', () => {
  assert.equal(run([{ conducteur: 'Alice', debut: '2026-01-01', fin: '2026-05-01' }]), null);
});

test('historique vide → null', () => { assert.equal(run([]), null); });

test('2 périodes ouvertes, personne APRÈS le Dépôt résiduel → la personne (début récent) gagne', () => {
  const c = run([
    { conducteur: 'Dépôt', debut: '2026-03-01', fin: null },         // résiduel ouvert
    { conducteur: 'Marie Durand', debut: '2026-11-16', fin: null },  // affectation réelle
  ]);
  assert.equal(c && c.conducteur, 'Marie Durand');
});

test('2 périodes ouvertes, Dépôt résiduel placé EN DERNIER dans le tableau → la personne gagne quand même', () => {
  const c = run([
    { conducteur: 'Marie Durand', debut: '2026-11-16', fin: null },  // affectation réelle
    { conducteur: 'Dépôt', debut: '2026-03-01', fin: null },         // résiduel ouvert, en dernier
  ]);
  assert.equal(c && c.conducteur, 'Marie Durand', 'courante() ne doit PAS « revenir » au Dépôt résiduel');
});

test('à début égal : la dernière du tableau l\'emporte (tie-break stable, comme avant)', () => {
  const c = run([
    { conducteur: 'Première', debut: '2026-11-16', fin: null },
    { conducteur: 'Seconde', debut: '2026-11-16', fin: null },
  ]);
  assert.equal(c && c.conducteur, 'Seconde');
});

test('début vide (origine) ne bat jamais une période datée ouverte', () => {
  const c = run([
    { conducteur: 'Personne datée', debut: '2026-11-16', fin: null },
    { conducteur: 'Dépôt', debut: null, fin: null },
  ]);
  assert.equal(c && c.conducteur, 'Personne datée');
});

console.log(`\n${ko === 0 ? '✅' : '❌'} courante : ${ok}/${ok + ko} tests OK\n`);
process.exit(ko === 0 ? 0 : 1);
