#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Isolation des états des lieux par AFFECTATION (sécurité)
// ============================================================================
//  Fuite corrigée : dans le portail conducteur (v.html / km-collect), un nouveau conducteur voyait les
//  EDL (photos + PDF signés) de l'ANCIEN conducteur, car les EDL étaient rattachés au VÉHICULE SEUL.
//  Correctif : chaque EDL est ESTAMPILLÉ avec l'affectation en cours (meta.periode = {conducteurKey, debut})
//  à l'écriture (km-collect action 'edl' ET edl-sign), et la lecture (vehEdl) ne renvoie QUE les EDL de
//  l'affectation EN COURS (les non estampillés sont EXCLUS du portail — fail-closed).
//
//  Ce test (1) rejoue le scénario A→B→A avec la MÊME logique que les Edge Functions, et (2) verrouille
//  le câblage des deux fonctions serveur. Les Edge Functions (Deno/TS) ne tournent pas dans le CI node →
//  on réplique la logique pure + on vérifie la présence des gardes dans le source.
//  Usage : node tests/unit/edl-isolation.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

// --- Logique PURE répliquée À L'IDENTIQUE des Edge Functions -----------------
const _norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const edlPeriode = (aff) => aff ? { conducteurKey: _norm(aff.conducteur || ''), debut: String(aff.debut || '') } : null;
function pickAffectation(rows) {
  const withNom = (rows || []).filter(a => a && a.conducteur);
  if (!withNom.length) return null;
  const encours = withNom.filter(a => !a.fin);
  const pick = (encours.length ? encours : withNom)
    .sort((a, b) => String(b.debut || '').localeCompare(String(a.debut || '')) || (Number(b.ordre || 0) - Number(a.ordre || 0)))[0];
  return pick ? { conducteur: String(pick.conducteur || '').trim(), debut: String(pick.debut || '') } : null;
}
// vehEdl : ne renvoie que les docs dont meta.periode == période de l'affectation en cours.
function vehEdlFilter(docs, aff) {
  const per = edlPeriode(aff);
  if (!per) return [];
  return (docs || []).filter(d => {
    if (!d || !d.url) return false;
    const p = d.meta && d.meta.periode;
    if (!p) return false;
    return String(p.conducteurKey || '') === per.conducteurKey && String(p.debut || '') === per.debut;
  }).map(d => d.url);
}
// stamp d'un EDL créé MAINTENANT par le conducteur de l'affectation en cours.
const stamp = (aff, url) => ({ url, meta: { periode: edlPeriode(aff) } });

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };

console.log('\nScénario A → B → A (isolation par affectation)');
// Affectations du véhicule
const affA1 = { conducteur: 'Alice Martin', debut: '2026-01-01' };       // 1re affectation de A
const affB = { conducteur: 'Bob Durand', debut: '2026-06-01' };          // puis B
const affA2 = { conducteur: 'Alice Martin', debut: '2026-09-01' };       // retour à A (nouvelle affectation)

// Documents EDL en base (tels qu'ils seraient estampillés à l'écriture)
let docs = [
  { url: 'ancienne-photo-sans-meta.jpg', meta: {} },                      // vieux fichier NON estampillé
  stamp(affA1, 'A1-prise.jpg'), stamp(affA1, 'A1-resti.jpg'), stamp(affA1, 'A1-signe.pdf'),
];

test('B (nouveau) ne voit AUCUN fichier de A ni les anciens non estampillés', () => {
  const rows = [{ ...affA1, fin: '2026-06-01', ordre: 0 }, { ...affB, fin: null, ordre: 1 }];
  const cur = pickAffectation(rows);
  assert.deepEqual(cur, affB);                           // affectation en cours = B
  assert.deepEqual(vehEdlFilter(docs, cur), []);          // portail de B = VIDE
});

test('B ajoute ses EDL → il les voit ; ceux de A restent invisibles', () => {
  docs.push(stamp(affB, 'B-prise.jpg'), stamp(affB, 'B-signe.pdf'));
  const cur = affB;
  assert.deepEqual(vehEdlFilter(docs, cur), ['B-prise.jpg', 'B-signe.pdf']);
});

test('A (pendant que B a le véhicule) ne verrait que SON affectation — pas celle de B', () => {
  // (cas théorique : A n'a plus le portail en cours, mais si on filtre sur A1, il ne voit que A1, jamais B)
  assert.deepEqual(vehEdlFilter(docs, affA1), ['A1-prise.jpg', 'A1-resti.jpg', 'A1-signe.pdf']);
  assert.ok(!vehEdlFilter(docs, affA1).some(u => u.startsWith('B-')), 'A ne doit jamais voir les fichiers de B');
});

test('retour à A (nouvelle affectation) : ses NOUVEAUX EDL, pas les anciens de A1', () => {
  docs.push(stamp(affA2, 'A2-prise.jpg'));
  const rows = [{ ...affA1, fin: '2026-06-01', ordre: 0 }, { ...affB, fin: '2026-09-01', ordre: 1 }, { ...affA2, fin: null, ordre: 2 }];
  const cur = pickAffectation(rows);
  assert.deepEqual(cur, affA2);
  assert.deepEqual(vehEdlFilter(docs, cur), ['A2-prise.jpg']);   // pas A1-*, pas B-*
});

test('aucune affectation connue → portail vide (fail-closed)', () => {
  assert.deepEqual(vehEdlFilter(docs, null), []);
  assert.deepEqual(vehEdlFilter(docs, pickAffectation([])), []);
});

test('clé insensible à la casse/accents/espaces (même _norm que le serveur)', () => {
  const stampé = stamp({ conducteur: 'Élodie  DÜ-Pont', debut: '2026-02-02' }, 'x.jpg');
  const cur = { conducteur: 'elodie du pont', debut: '2026-02-02' };
  assert.deepEqual(vehEdlFilter([stampé], cur), ['x.jpg']);
});

console.log('\nCâblage serveur (km-collect + edl-sign)');
const km = fs.readFileSync(new URL('../../supabase/functions/km-collect/index.ts', import.meta.url), 'utf8');
const sign = fs.readFileSync(new URL('../../supabase/functions/edl-sign/index.ts', import.meta.url), 'utf8');
test('km-collect : vehEdl filtre par affectation (fail-closed si pas de période)', () => {
  assert.match(km, /async function vehEdl\([^)]*aff: \{ conducteur: string; debut: string \} \| null\)/);
  assert.match(km, /const per = edlPeriode\(aff\);\s*\n\s*if \(!per\) return \[\];/);
  assert.match(km, /if \(!p\) return false;/);   // non estampillé exclu
});
test('km-collect : EDL conducteur estampillé + portail câblé sur l\'affectation en cours', () => {
  assert.match(km, /meta: perEdl \? \{ periode: perEdl \} : \{\}/);
  assert.match(km, /const affEnCours = await currentAffectation\(db, qr\.vehicule_id, qr\.societe \|\| "PXP"\);/);
  assert.match(km, /vehEdl\(db, qr\.vehicule_id, affEnCours\)/);
});
test('edl-sign : PDF signé estampillé avec l\'affectation en cours', () => {
  assert.match(sign, /const perSign = edlPeriode\(await currentAffectation\(db, String\(row\.vehicule_id\), String\(row\.societe \|\| "PXP"\)\)\)/);
  assert.match(sign, /meta: perSign \? \{ periode: perSign \} : \{\}/);
});
test('_norm identique côté km-collect et edl-sign (clés compatibles)', () => {
  const re = /function _norm\(s: string\) \{ return String\(s \|\| ""\)\.toLowerCase\(\)\.normalize\("NFD"\)\.replace\(\/\[̀-ͯ\]\/g, ""\)\.replace\(\/\[\^a-z0-9\]\/g, ""\); \}/;
  assert.match(km, re); assert.match(sign, re);
});

console.log(`\n${ko ? '❌' : '✅'} edl-isolation : ${ok} ok, ${ko} ko\n`);
process.exit(ko ? 1 : 0);
