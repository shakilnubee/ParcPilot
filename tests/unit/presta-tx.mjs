#!/usr/bin/env node
/* FP.presta.ecrireTx (app.js) : écriture des transactions d'un relevé prestataire → total_conso_tx.
 * Vérifie : ids DÉTERMINISTES (idempotence = pas de doublon au ré-import), « À identifier » si carte
 * non reconnue, facnum = n° de facture, champs produit/montant/litres conservés.
 * node tests/unit/presta-tx.mjs
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const app = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const start = app.indexOf('FP.presta.ecrireTx = async function');
assert.ok(start > 0, 'FP.presta.ecrireTx introuvable');
const end = app.indexOf('\n};', start) + 3;
const block = app.slice(start, end);

let ok = 0, ko = 0;
const t = (n, f) => { try { f(); ok++; console.log('  ✅ ' + n); } catch (e) { ko++; console.log('  ❌ ' + n + '\n     ' + (e.message || e)); } };

// Stub FP : collecte les upserts total_conso_tx (pas de réseau).
function makeFP() {
  const rows = [];
  const FP = {
    _rows: rows,
    persist: { upsert: (table, r) => { if (table === 'total_conso_tx') rows.push(r); } },
    prestataireById: () => null,          // pas de prestataire résolu → conducteur = nom lu, sinon « À identifier »
    prestataires: () => [],
    _condParNumero: () => null,
    refreshDataCache: () => {},
  };
  // eslint-disable-next-line no-new-func
  new Function('FP', 'FP.presta = FP.presta || {};\n' + block)(FP);
  return { FP, rows };
}

const TX = [
  { carte: '704310.0115104357', montantTtc: 53.13, dateTx: '2026-11-15', produit: 'EURO 95 (SUPER)', conducteur: 'MEGANE', litres: 32 },
  { carte: '999999.9999999999', montantTtc: 10, dateTx: '2026-11-13', produit: 'SUPER' },  // carte inconnue, pas de conducteur
];

await (async () => {
  const { FP, rows } = makeFP();
  const res = await FP.presta.ecrireTx('26/656273356/001', TX, { fournisseur: 'DKV EURO SERVICE GmbH + Co. KG', prestaId: 'dkv', type: 'carburant' });
  t('2 lignes écrites, aucune en échec', () => { assert.equal(res.ok, 2); assert.equal(res.ko, 0); assert.equal(rows.length, 2); });
  t('id DÉTERMINISTE sur n° normalisé + index', () => { assert.equal(rows[0].id, 'PTX-26656273356001-0'); assert.equal(rows[1].id, 'PTX-26656273356001-1'); });
  t('facnum = n° de facture (brut)', () => { assert.equal(rows[0].facnum, '26/656273356/001'); });
  t('conducteur lu conservé', () => { assert.equal(rows[0].conducteur, 'MEGANE'); });
  t('carte non reconnue → « À identifier » (ligne conservée)', () => { assert.equal(rows[1].conducteur, 'À identifier'); });
  t('produit / montant / litres conservés', () => { assert.equal(rows[0].produit, 'EURO 95 (SUPER)'); assert.equal(rows[0].montantTtc, 53.13); assert.equal(rows[0].litres, 32); assert.equal(rows[0].categorie, 'carburant'); });

  // Idempotence : ré-import → MÊMES ids (upsert écrase, pas de doublon).
  const { FP: FP2, rows: rows2 } = makeFP();
  await FP2.presta.ecrireTx('26/656273356/001', TX, { prestaId: 'dkv' });
  await FP2.presta.ecrireTx('26/656273356/001', TX, { prestaId: 'dkv' });
  const ids = rows2.map(r => r.id);
  t('ré-import : ids identiques (idempotent, pas de doublon en base)', () => { assert.deepEqual(ids.slice(0, 2), ['PTX-26656273356001-0', 'PTX-26656273356001-1']); assert.deepEqual(ids.slice(2, 4), ['PTX-26656273356001-0', 'PTX-26656273356001-1']); });

  // Garde : rien à écrire.
  const { FP: FP3 } = makeFP();
  const r0 = await FP3.presta.ecrireTx('', TX, {});
  const r1 = await FP3.presta.ecrireTx('X', [], {});
  t('garde : n° vide ou tx vide → 0 ligne', () => { assert.equal(r0.n, 0); assert.equal(r1.n, 0); });

  console.log(`\n${ko ? '❌' : '✅'} presta-tx : ${ok} ok, ${ko} ko\n`);
  process.exit(ko ? 1 : 0);
})();
