#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Passerelle Google Maps (Lot 2b) : garde-fous sécurité/correction
// ============================================================================
//  Impossible d'appeler Google dans le CI → on VERROUILLE par lecture de fichiers :
//  clé serveur jamais exposée, quota réservé AVANT l'appel Google, dormance sans clé,
//  jeton obligatoire, et helpers client dormants tant que la clé n'est pas posée.
//  Usage : node tests/unit/google-maps.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const fn = fs.readFileSync(new URL('../../supabase/functions/google-maps/index.ts', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');

let ok = 0, ko = 0;
const test = (nom, f) => { try { f(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };

console.log('\nEdge Function google-maps (clé serveur, quota AVANT appel, dormance)');
test('clé lue en SECRET serveur (jamais en dur)', () => {
  assert.match(fn, /Deno\.env\.get\("GOOGLE_MAPS_API_KEY"\)/);
  assert.ok(!/AIza[0-9A-Za-z_-]{10}/.test(fn), 'aucune clé Google en dur');
});
test('jeton utilisateur obligatoire (fail-closed)', () => {
  assert.match(fn, /Non connecté/);
  assert.match(fn, /auth\/v1\/user/);
});
test('DORMANT sans clé : ping→configured:false, pas d\'appel Google', () => {
  assert.match(fn, /if \(action === "ping"\) return json\(\{ ok: true, configured: !!KEY \}\)/);
  assert.match(fn, /if \(!KEY\) return json\(\{ ok: true, configured: false/);
});
test('quota RÉSERVÉ avant l\'appel Google (consume puis garde autorise)', () => {
  assert.match(fn, /rpc\/fp_quota_consommer/);
  assert.match(fn, /p_plafond: PLAFONDS\[apiKind\]/);
  assert.match(fn, /if \(!quota\.autorise\)/);
});
test('société résolue depuis profiles (jamais user_metadata)', () => {
  assert.match(fn, /rest\/v1\/profiles\?id=eq\.\$\{encodeURIComponent\(callerId\)\}&select=societe/);
});
test('appel Google Geocoding + Places avec la clé serveur', () => {
  assert.match(fn, /maps\.googleapis\.com\/maps\/api\/geocode\/json/);
  assert.match(fn, /places\.googleapis\.com\/v1\/places:autocomplete/);
  assert.match(fn, /"X-Goog-Api-Key": KEY/);
});
test('tolérant si la table de quota est absente en prod', () => {
  assert.match(fn, /Quota non initialisé/);
});

console.log('\nClient FP.geo + autocomplétion dormante');
test('FP.geo (ping/geocode/autocomplete) via la passerelle google-maps', () => {
  assert.match(app, /FP\.geo = \{/);
  assert.match(app, /invoke\('google-maps', \{ body \}\)/);
  assert.match(app, /async geocode\(q\)/);
  assert.match(app, /async autocomplete\(q, pays\)/);
});
test('FP.adresseAutocomplete dormant si non configuré', () => {
  assert.match(app, /FP\.adresseAutocomplete = function/);
  assert.match(app, /r\.configured === false/);
});
test('aucun appel Google direct depuis le navigateur', () => {
  assert.ok(!/maps\.googleapis\.com|places\.googleapis\.com/.test(app), 'le client ne doit JAMAIS appeler Google en direct (tout passe par la passerelle)');
});

console.log(`\n${ko ? '❌' : '✅'} google-maps : ${ok} ok, ${ko} ko\n`);
process.exit(ko ? 1 : 0);
