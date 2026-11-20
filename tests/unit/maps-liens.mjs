#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Tests des liens Google Maps SANS CLÉ (FP.mapsUrl / FP.lienItineraire)
// ============================================================================
//  Garantit que les liens « Itinéraire / Voir sur la carte » :
//   • utilisent le schéma officiel « Maps URLs » (dir/?api=1 / search/?api=1) ;
//   • ne contiennent JAMAIS de clé API (key=) ni d'appel serveur ;
//   • encodent correctement l'adresse (chaîne OU objet {rue,cp,ville,pays}) ;
//   • produisent un vrai <a target="_blank" rel="noopener"> (molette/Ctrl = nouvel onglet).
//  Le code est extrait tel quel de assets/js/app.js et exécuté avec un FP minimal.
//  Zéro dépendance. Usage : node tests/unit/maps-liens.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const m = src.match(/FP\._mapsAddr = function[\s\S]*?FP\.lienItineraire = function[\s\S]*?\n\};/);
if (!m) { console.error('❌ Bloc FP.mapsUrl / FP.lienItineraire introuvable dans app.js'); process.exit(1); }

// FP minimal : addr.compose (comme la vraie) + esc (identité suffisante pour les asserts).
const FP = { addr: { compose(p) { p = p || {}; const g = k => (p[k] == null ? '' : String(p[k])).trim(); const cpVille = [g('cp'), g('ville')].filter(Boolean).join(' '); return [g('rue'), cpVille, g('pays')].filter(Boolean).join(', '); } }, esc: s => String(s == null ? '' : s) };
new Function('FP', m[0])(FP);

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };

console.log('\nFP.mapsUrl — schéma officiel, sans clé');
test('itinéraire = dir/?api=1&destination= + adresse encodée', () => {
  const u = FP.mapsUrl.itineraire('12 rue de la Paix, 75002 Paris');
  assert.equal(u, 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('12 rue de la Paix, 75002 Paris'));
});
test('recherche = search/?api=1&query=', () => {
  assert.ok(FP.mapsUrl.recherche('Garage Dupont, 69003 Lyon').startsWith('https://www.google.com/maps/search/?api=1&query='));
});
test('accepte un objet adresse {rue,cp,ville,pays} (recomposé via FP.addr)', () => {
  const u = FP.mapsUrl.itineraire({ rue: '5 av. Foch', cp: '75116', ville: 'Paris', pays: 'France' });
  assert.ok(u.includes(encodeURIComponent('5 av. Foch, 75116 Paris, France')));
});
test('adresse vide → chaîne vide (pas de lien bancal)', () => {
  assert.equal(FP.mapsUrl.itineraire(''), '');
  assert.equal(FP.mapsUrl.itineraire(null), '');
  assert.equal(FP.mapsUrl.recherche('   '), '');
});
test('AUCUNE clé API dans les URLs (key= interdit)', () => {
  const u = FP.mapsUrl.itineraire('Nantes') + ' ' + FP.mapsUrl.recherche('Nantes');
  assert.ok(!/[?&]key=/.test(u), 'une URL Maps ne doit jamais porter de clé');
});
test('espaces multiples normalisés avant encodage', () => {
  const u = FP.mapsUrl.itineraire('  12   rue   Test  ');
  assert.ok(u.endsWith(encodeURIComponent('12 rue Test')));
});

console.log('\nFP.lienItineraire — vrai lien nouvel onglet');
test('retourne un <a target=_blank rel=noopener> avec la bonne URL', () => {
  const h = FP.lienItineraire('1 rue A, 75001 Paris');
  assert.match(h, /^<a href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/);
  assert.match(h, /target="_blank"/);
  assert.match(h, /rel="noopener noreferrer"/);
  assert.match(h, /Itinéraire/);
});
test('mode search (Voir sur la carte) via opts.search', () => {
  assert.match(FP.lienItineraire('Paris', { search: true, label: 'Voir sur la carte' }), /maps\/search\/\?api=1&query=/);
  assert.match(FP.lienItineraire('Paris', { search: true, label: 'Voir sur la carte' }), /Voir sur la carte/);
});
test('adresse vide → pas de lien (chaîne vide)', () => {
  assert.equal(FP.lienItineraire(''), '');
});

console.log('\nCâblage pages (source unique FP.lienItineraire)');
const ent = fs.readFileSync(new URL('../../pages/entretiens.html', import.meta.url), 'utf8');
const cond = fs.readFileSync(new URL('../../pages/conducteurs.html', import.meta.url), 'utf8');
test('entretiens : carnet garages → bouton Itinéraire si adresse', () => {
  assert.match(ent, /p\.adresse && window\.FP && FP\.lienItineraire/);
});
test('conducteurs : fiche → lien Itinéraire hors cellule éditable', () => {
  assert.match(cond, /FP\.lienItineraire\(s, \{ className:/);
});

console.log(`\n${ko ? '❌' : '✅'} maps-liens : ${ok} ok, ${ko} ko\n`);
process.exit(ko ? 1 : 0);
