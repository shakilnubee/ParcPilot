#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Tests de la FILE D'ÉCRITURE (FP.persist.flush, assets/js/app.js)
// ============================================================================
//  La file garde chaque écriture tant qu'elle n'est pas confirmée par la base. Pendant un renvoi
//  (flush), la file peut changer : nouvel enregistrement, écriture plus récente qui en remplace une
//  ancienne. Vérifie qu'aucun élément ajouté pendant l'envoi n'est perdu, et qu'une version périmée
//  (remplacée entre-temps) n'est jamais renvoyée par-dessus la récente.
//  Le bloc testé est extrait tel quel de app.js (entre /*<persist-file>*/ et /*</persist-file>*/).
//  Zéro dépendance. Usage : node tests/unit/persist-file.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const m = src.match(/\/\*<persist-file>\*\/([\s\S]*?)\/\*<\/persist-file>\*\//);
if (!m) { console.error('❌ Bloc <persist-file> introuvable dans app.js'); process.exit(1); }

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
console.error = () => {};

// Base simulée : chaque appel RPC attend qu'on le libère (pour agir PENDANT l'envoi).
function nouveauFP() {
  store.clear();
  const FP = { activeSociete: () => 'PXP' };
  const envois = [];
  const attente = [];
  FP.supabase = { rpc: (fn, args) => new Promise((res) => { envois.push(args.v); attente.push(res); }) };
  FP.db = { upsert: async () => ({ error: null }), update: async () => ({ error: null }), delete: async () => ({ error: null }) };
  new Function('FP', m[1])(FP);
  const P = FP.persist;
  const libere = async (err) => { while (!attente.length) await new Promise(r => setTimeout(r, 0)); attente.shift()({ error: err || null }); await new Promise(r => setTimeout(r, 0)); };
  const file = () => P._loadQ().map(it => it.args && it.args.v);
  return { FP, P, envois, libere, file };
}
const it_ = (v, remplace) => ({ op: 'rpc', fn: 'f', args: { v }, table: 't', remplace: remplace || null });

let ok = 0, ko = 0;
const test = async (nom, fn) => { try { await fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };

console.log('\nRenvoi de la file (flush)');
await test('envoi réussi → retiré de la file ; échec → reste en file, avec le nombre d\'essais', async () => {
  const { P, libere, file } = nouveauFP();
  P._enqueue(it_('A')); P._enqueue(it_('B'));
  const f = P.flush(); await libere(); await libere({ message: 'Failed to fetch' }); await f;
  assert.deepEqual(file(), ['B']);
  assert.equal(P._loadQ()[0].tries, 1);
});
await test('élément ajouté PENDANT l\'envoi → conservé (n\'est plus effacé sans avoir été envoyé)', async () => {
  const { P, libere, file } = nouveauFP();
  P._enqueue(it_('A'));
  const f = P.flush();
  P._enqueue(it_('C'));            // enregistrement fait pendant que A part (son propre envoi n'a pas abouti)
  await libere(); await f;
  assert.deepEqual(file(), ['C']);
});
await test('écriture plus récente de même clé pendant l\'envoi → l\'ancienne n\'est pas renvoyée par-dessus', async () => {
  const { P, envois, libere, file } = nouveauFP();
  P._enqueue(it_('B')); P._enqueue(it_('ancien', 'k'));
  const f = P.flush();
  // Pendant l'envoi de B, l'utilisateur modifie la même donnée : « ancien » est remplacé par « récent ».
  const w = P.rpc('f', { v: 'récent' }, { table: 't', remplace: 'k' });
  await libere();                  // B
  await libere({ message: 'Failed to fetch' });   // « récent » (son propre envoi échoue : il doit rester en file)
  await f; await w;
  assert.ok(!envois.includes('ancien'), 'la version périmée a été renvoyée : ' + envois.join(', '));
  assert.deepEqual(file(), ['récent']);
});
await test('élément déjà envoyé ailleurs pendant le flush → pas renvoyé une deuxième fois', async () => {
  const { P, envois, libere, file } = nouveauFP();
  P._enqueue(it_('B')); const uid = P._enqueue(it_('A'));
  const f = P.flush();
  P._removeUid(uid);               // ex. confirmé par un autre onglet
  await libere(); await f;
  assert.deepEqual(envois, ['B']);
  assert.deepEqual(file(), []);
});
await test('échec définitif non retenté automatiquement, retenté au clic (force)', async () => {
  const { P, envois, libere, file } = nouveauFP();
  P._enqueue(Object.assign(it_('X'), { failed: true }));
  await P.flush(); assert.deepEqual(envois, []); assert.deepEqual(file(), ['X']);
  const f = P.flush({ force: true }); await libere(); await f;
  assert.deepEqual(file(), []);
});
await test('ancienne file sans identifiant → traitée sans perte', async () => {
  const { P, libere, file } = nouveauFP();
  localStorage.setItem('fp_pending_writes_pxp', JSON.stringify([it_('A'), it_('B')]));
  const f = P.flush(); await libere(); await libere({ message: 'Failed to fetch' }); await f;
  assert.deepEqual(file(), ['B']);
});

console.log(`\n${ok} réussi(s), ${ko} échoué(s)`);
if (ko) process.exit(1);
console.log('✅ File d\'écriture : rien de perdu pendant un renvoi, aucune version périmée renvoyée.');
