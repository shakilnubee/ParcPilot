#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Isolation des états des lieux par AFFECTATION (sécurité)
// ============================================================================
//  Fuite corrigée : dans le portail conducteur (v.html / km-collect), un nouveau conducteur voyait les
//  EDL (photos + PDF signés) de l'ANCIEN conducteur, car les EDL étaient rattachés au VÉHICULE SEUL.
//  Correctif isolation : la lecture (vehEdl) ne renvoie QUE les EDL de l'affectation EN COURS.
//
//  Correctif régression (23/11) : un EDL ajouté par un GESTIONNAIRE depuis la fiche n'est PAS estampillé
//  (meta.periode) — il est rattaché par la DATE du libellé + le sens (comme FP.edlHisto). vehEdl acceptait
//  à tort uniquement meta.periode → ces fichiers (ex. la remise de Farah) disparaissaient du portail.
//  Nouvelle règle vehEdl : un EDL appartient à l'affectation en cours si
//    (1) meta.periode == {conducteurKey, debut} de l'affectation (dépôt conducteur), OU
//    (2) sa DATE + son SENS l'y rattachent (réplique de FP.edlHisto.appartientSens, règle de borne partagée).
//  Un fichier sans date exploitable et sans meta.periode reste EXCLU (fail-closed « incertain »).
//
//  Ce test (1) rejoue A→B→A (estampillé) ET le scénario Farah/Nawelle (gestionnaire, par date), avec la
//  MÊME logique que les Edge Functions, et (2) verrouille le câblage serveur. Les Edge Functions (Deno/TS)
//  ne tournent pas dans le CI node → on réplique la logique pure + on vérifie les gardes dans le source.
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
  return pick ? { conducteur: String(pick.conducteur || '').trim(), debut: String(pick.debut || ''), fin: String(pick.fin || '') } : null;
}
// Rattachement par date + sens (réplique FP.edlHisto) ------------------------
const _edlSens = (label) => /sort|resti/i.test(String(label || '')) ? 'restitution' : 'remise';
function _edlDate(label, createdAt) {
  const lab = String(label || '');
  const iso = lab.match(/(\d{4}-\d{2}-\d{2})/); if (iso) return iso[1];
  const fr = lab.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/); if (fr) return fr[3] + '-' + fr[2] + '-' + fr[1];
  const s = String(createdAt || ''); return s ? s.slice(0, 10) : '';
}
function _edlDansPeriode(date, deb, fin) {
  if (!date) return false;
  if (deb && date < deb) return false;
  if (fin && date > fin) return false;
  return true;
}
function _edlAppartientSens(date, sens, deb, fin) {
  const dd = String(date || '').slice(0, 10);
  if (!_edlDansPeriode(dd, deb, fin)) return false;
  const isResti = /resti|sort/i.test(String(sens || ''));
  if (isResti && deb && dd === deb && dd !== fin) return false;
  if (!isResti && fin && dd === fin && dd !== deb) return false;
  return true;
}
// vehEdl : meta.periode == affectation en cours OU rattachement par date/sens (gestionnaire).
function vehEdlFilter(docs, aff) {
  const per = edlPeriode(aff);
  if (!per) return [];
  const deb = String((aff && aff.debut) || '').slice(0, 10);
  const fin = String((aff && aff.fin) || '').slice(0, 10);
  return (docs || []).filter(d => {
    if (!d || !d.url) return false;
    const p = d.meta && d.meta.periode;
    if (p) return String(p.conducteurKey || '') === per.conducteurKey && String(p.debut || '') === per.debut;
    return _edlAppartientSens(_edlDate(d.label || '', d.created_at || null), _edlSens(d.label || ''), deb, fin);
  }).map(d => d.url);
}
// stamp d'un EDL créé MAINTENANT par le conducteur de l'affectation en cours.
const stamp = (aff, url) => ({ url, meta: { periode: edlPeriode(aff) } });

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };

console.log('\nScénario A → B → A (isolation par affectation, dépôt conducteur estampillé)');
const affA1 = { conducteur: 'Alice Martin', debut: '2026-01-01', fin: '2026-06-01' };
const affB = { conducteur: 'Bob Durand', debut: '2026-06-01', fin: '' };
const affA2 = { conducteur: 'Alice Martin', debut: '2026-09-01', fin: '' };

let docs = [
  { url: 'ancienne-photo-sans-meta.jpg', label: 'État des lieux', meta: {} },  // vieux fichier NON estampillé, sans date
  stamp(affA1, 'A1-prise.jpg'), stamp(affA1, 'A1-resti.jpg'), stamp(affA1, 'A1-signe.pdf'),
];

test('B (nouveau) ne voit AUCUN fichier de A ni les anciens non estampillés', () => {
  const rows = [{ ...affA1 }, { ...affB, fin: null, ordre: 1 }];
  const cur = pickAffectation(rows);
  assert.deepEqual(cur, affB);
  assert.deepEqual(vehEdlFilter(docs, cur), []);
});
test('B ajoute ses EDL → il les voit ; ceux de A restent invisibles', () => {
  docs.push(stamp(affB, 'B-prise.jpg'), stamp(affB, 'B-signe.pdf'));
  assert.deepEqual(vehEdlFilter(docs, affB), ['B-prise.jpg', 'B-signe.pdf']);
});
test('A (pendant que B a le véhicule) ne verrait que SON affectation — pas celle de B', () => {
  assert.deepEqual(vehEdlFilter(docs, affA1), ['A1-prise.jpg', 'A1-resti.jpg', 'A1-signe.pdf']);
  assert.ok(!vehEdlFilter(docs, affA1).some(u => u.startsWith('B-')));
});
test('retour à A (nouvelle affectation) : ses NOUVEAUX EDL, pas les anciens de A1', () => {
  docs.push(stamp(affA2, 'A2-prise.jpg'));
  const rows = [{ ...affA1 }, { ...affB, fin: '2026-09-01', ordre: 1 }, { ...affA2, ordre: 2 }];
  const cur = pickAffectation(rows);
  assert.deepEqual(cur, affA2);
  assert.deepEqual(vehEdlFilter(docs, cur), ['A2-prise.jpg']);
});
test('aucune affectation connue → portail vide (fail-closed)', () => {
  assert.deepEqual(vehEdlFilter(docs, null), []);
  assert.deepEqual(vehEdlFilter(docs, pickAffectation([])), []);
});
test('clé insensible à la casse/accents/espaces (même _norm que le serveur)', () => {
  const st = stamp({ conducteur: 'Élodie  DÜ-Pont', debut: '2026-02-02' }, 'x.jpg');
  assert.deepEqual(vehEdlFilter([st], { conducteur: 'elodie du pont', debut: '2026-02-02', fin: '' }), ['x.jpg']);
});

console.log('\nScénario Farah / Nawelle (EDL ajoutés par un gestionnaire, rattachés par DATE — régression 23/11)');
const affNawelle = { conducteur: 'Nawelle K', debut: '2025-10-24', fin: '2026-11-19' };
const affFarah = { conducteur: 'Farah Hadjar', debut: '2026-11-19', fin: '' };  // en cours
const mgrDocs = [
  { url: 'nawelle-remise.jpg', label: 'État des lieux — remise — 2025-10-24', meta: {} },
  { url: 'nawelle-resti.jpg', label: 'État des lieux — restitution — 2026-11-19', meta: {} },  // borne = début Farah
  { url: 'farah-remise-1.jpg', label: 'État des lieux — remise — 2026-11-19', meta: {} },
  { url: 'farah-remise-2.jpg', label: 'État des lieux — remise — 2026-11-19', meta: {} },
  { url: 'farah-signe.pdf', label: 'État des lieux — remise — 2026-11-19', meta: {} },
  { url: 'incertain-sans-date.jpg', label: 'État des lieux', meta: {} },  // ni date ni meta → exclu
];
test('Farah voit sa remise gestionnaire (datée = son début), PAS la restitution de Nawelle (borne)', () => {
  const got = vehEdlFilter(mgrDocs, affFarah);
  assert.ok(got.includes('farah-remise-1.jpg') && got.includes('farah-remise-2.jpg') && got.includes('farah-signe.pdf'), 'les 3 fichiers de Farah doivent apparaître');
  assert.ok(!got.includes('nawelle-resti.jpg'), 'restitution de Nawelle datée au début de Farah = exclue (borne partagée)');
  assert.ok(!got.includes('nawelle-remise.jpg'), 'remise de Nawelle (hors période) = exclue');
  assert.ok(!got.includes('incertain-sans-date.jpg'), 'sans date ni meta → exclu (fail-closed)');
});
test('Nawelle (son affectation) voit sa remise ET sa restitution, aucun fichier de Farah', () => {
  const got = vehEdlFilter(mgrDocs, affNawelle);
  assert.ok(got.includes('nawelle-remise.jpg') && got.includes('nawelle-resti.jpg'), 'Nawelle voit ses 2 EDL');
  assert.ok(!got.some(u => u.startsWith('farah-')), 'aucun fichier de Farah chez Nawelle');
});
test('une remise datée à la FIN d\'une période part au conducteur suivant (jamais au courant)', () => {
  // remise datée 2026-11-19 = début Farah = fin Nawelle → ne doit PAS apparaître chez Nawelle
  const got = vehEdlFilter(mgrDocs, affNawelle);
  assert.ok(!got.includes('farah-remise-1.jpg'));
});
test('un EDL estampillé (meta.periode) reste prioritaire même sans date dans le libellé', () => {
  const mixed = [stamp(affFarah, 'farah-depot-conducteur.jpg'), { url: 'autre.jpg', label: 'État des lieux', meta: {} }];
  assert.deepEqual(vehEdlFilter(mixed, affFarah), ['farah-depot-conducteur.jpg']);
});

console.log('\nCâblage serveur (km-collect + edl-sign)');
const km = fs.readFileSync(new URL('../../supabase/functions/km-collect/index.ts', import.meta.url), 'utf8');
const sign = fs.readFileSync(new URL('../../supabase/functions/edl-sign/index.ts', import.meta.url), 'utf8');
test('km-collect : vehEdl prend l\'affectation en cours (avec fin) et reste fail-closed', () => {
  assert.match(km, /async function vehEdl\([^)]*aff: \{ conducteur: string; debut: string; fin: string \} \| null\)/);
  assert.match(km, /const per = edlPeriode\(aff\);\s*\n\s*if \(!per\) return \[\];/);
});
test('km-collect : estampille (meta.periode) prioritaire PUIS rattachement par date/sens', () => {
  assert.match(km, /if \(p\) return String\(p\.conducteurKey \|\| ""\) === per\.conducteurKey/);
  assert.match(km, /_edlAppartientSens\(date, sens, deb, fin\)/);
  assert.match(km, /function _edlAppartientSens\(/);
  assert.match(km, /function _edlDate\(/);
});
test('km-collect : la galerie de VENTE utilise toutes les photos (sans filtre affectation)', () => {
  assert.match(km, /async function vehEdlPhotosToutes\(/);
  assert.match(km, /const edl = await vehEdlPhotosToutes\(db, v\.id as string\);/);
});
test('km-collect : dépôt conducteur estampillé + portail câblé sur l\'affectation en cours', () => {
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
