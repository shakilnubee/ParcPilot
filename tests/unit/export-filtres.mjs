#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Tests « ce que je filtre = ce que j'exporte » (Contrats → Leasing)
// ============================================================================
//  Régression visée : un filtre « par loueur » (ex. BPCE) était affiché dans le tableau mais
//  IGNORÉ par le centre Import/Export (export de TOUS les contrats). Cause racine : l'export lisait
//  le jeu COMPLET (leasingUnitsAll) sans appliquer le filtre.
//
//  Ce test garde deux choses :
//   1) COMPORTEMENT : la fonction d'interprétation unique `loueurFiltrePasse` (extraite telle quelle
//      de pages/contrats.html) renvoie le bon verdict pour tous les cas (BPCE, TEMSYS, « Leasing (LLD) »,
//      aucun résultat, etc.).
//   2) CÂBLAGE SOURCE UNIQUE : le tableau BPCE, le tableau LLD ET l'export utilisent bien
//      `loueurFiltrePasse`, et l'export applique AUSSI la recherche texte — pour que table et fichier
//      sortent EXACTEMENT le même ensemble.
//  Zéro dépendance. Usage : node tests/unit/export-filtres.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../pages/contrats.html', import.meta.url), 'utf8');

// --- Extrait la fonction d'interprétation unique, telle qu'écrite dans la page ---
const m = src.match(/function loueurFiltrePasse\(nomClair, estLLD\)\{[\s\S]*?\n  \}/);
if (!m) { console.error('❌ loueurFiltrePasse introuvable dans pages/contrats.html'); process.exit(1); }
const LOCALEASE_VAL = '__localease__';
// On fabrique la fonction en lui injectant l'état (leasingLoueurFilter) + la constante, comme dans la page.
function faireFiltre(leasingLoueurFilter) {
  return new Function('leasingLoueurFilter', 'LOCALEASE_VAL', m[0] + '\n  return loueurFiltrePasse;')(leasingLoueurFilter, LOCALEASE_VAL);
}

let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };

// Jeu d'unités de leasing réaliste (3 loueurs) :
//  - BPCE : 2 unités dérivées        (source 'bpce', loueurRaw 'BPCE')
//  - TEMSYS : 1 unité LLD nommée      (source 'lld',  loueurRaw 'TEMSYS')
//  - « Leasing (LLD) » : 1 unité LLD sans loueur nommé (source 'lld', loueurRaw '')
const UNITES = [
  { source: 'bpce', immat: 'HH-464-LQ', marque: 'BYD',    modele: 'SEAL U', chauffeur: 'Jocelyn', loueurRaw: 'BPCE' },
  { source: 'bpce', immat: 'HJ-181-RN', marque: 'NISSAN', modele: 'X-TRAIL', chauffeur: 'Daniel',  loueurRaw: 'BPCE' },
  { source: 'lld',  immat: 'AA-111-AA', marque: 'RENAULT', modele: 'CLIO',  chauffeur: 'Chloé',    loueurRaw: 'TEMSYS' },
  { source: 'lld',  immat: 'BB-222-BB', marque: 'PEUGEOT', modele: '208',   chauffeur: 'Karim',    loueurRaw: '' },
];
// Réimplémente le MÊME double filtre que leasingExportRows (loueur via loueurFiltrePasse + recherche texte),
// pour prouver le comportement bout-en-bout (les assertions de câblage ci-dessous garantissent que la page
// utilise bien cette logique et pas une copie divergente).
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function exporte(leasingLoueurFilter, recherche) {
  const passe = faireFiltre(leasingLoueurFilter);
  const q = norm(recherche).trim();
  return UNITES
    .filter(u => passe(u.loueurRaw, u.source === 'lld'))
    .filter(u => !q || norm(`${u.immat} ${u.marque} ${u.modele} ${u.chauffeur}`).includes(q));
}

console.log('\nComportement du filtre loueur (source unique loueurFiltrePasse)');
test('1) Leasing filtré sur BPCE → seulement les 2 BPCE', () => {
  assert.deepEqual(exporte('BPCE', '').map(u => u.immat), ['HH-464-LQ', 'HJ-181-RN']);
});
test('2) Leasing filtré sur TEMSYS → seulement l\'unité TEMSYS', () => {
  assert.deepEqual(exporte('TEMSYS', '').map(u => u.immat), ['AA-111-AA']);
});
test('3) Leasing sans filtre (all) → tout', () => {
  assert.equal(exporte('all', '').length, 4);
});
test('4) « Leasing (LLD) » (bac sans loueur nommé) → seulement l\'unité LLD vide', () => {
  assert.deepEqual(exporte(LOCALEASE_VAL, '').map(u => u.immat), ['BB-222-BB']);
});
test('5) Loueur BPCE + recherche immatriculation → l\'intersection', () => {
  assert.deepEqual(exporte('BPCE', 'HJ-181').map(u => u.immat), ['HJ-181-RN']);
});
test('6) Loueur BPCE + recherche conducteur → l\'intersection', () => {
  assert.deepEqual(exporte('BPCE', 'jocelyn').map(u => u.immat), ['HH-464-LQ']);
});
test('7) Filtre ne retournant aucun résultat (loueur inexistant)', () => {
  assert.equal(exporte('INCONNU', '').length, 0);
});
test('8) BPCE ne tombe JAMAIS dans le bac « Leasing (LLD) »', () => {
  // Un filtre LOCALEASE_VAL ne doit remonter aucune unité dérivée BPCE, même à loueur vide.
  const passe = faireFiltre(LOCALEASE_VAL);
  assert.equal(passe('', false), false);     // unité BPCE à loueur vide
  assert.equal(passe('BPCE', false), false); // unité BPCE nommée
});

console.log('\nCâblage SOURCE UNIQUE (pages/contrats.html)');
test('tableau BPCE utilise loueurFiltrePasse', () => {
  assert.match(src, /\.filter\(\(\{ v \}\) => loueurFiltrePasse\(loueurNomOf\(v\), false\)\)/);
});
test('tableau LLD utilise loueurFiltrePasse', () => {
  assert.match(src, /matchLoueur = \(c\) => loueurFiltrePasse\(\(c\.loueur \|\| ''\)\.toString\(\)\.trim\(\), true\)/);
});
test('export filtre par loueurFiltrePasse(u.loueurRaw, …)', () => {
  assert.match(src, /leasingUnitsAll\(\)\s*\n\s*\.filter\(u => loueurFiltrePasse\(u\.loueurRaw, u\.source === 'lld'\)\)/);
});
test('export applique AUSSI la recherche texte (leasingSearch)', () => {
  // Le filtrage (loueur + recherche) est centralisé dans leasingUnitsVisibles(), consommé par leasingExportRows().
  assert.ok(/function leasingUnitsVisibles\(\)[\s\S]*?FP\.norm\(leasingSearch\)[\s\S]*?loueurFiltrePasse/.test(src), 'leasingUnitsVisibles doit filtrer par loueur + leasingSearch');
  assert.match(src, /function leasingExportRows\(\) \{ return leasingUnitsVisibles\(\)\.map\(leasingUnitToRow\); \}/);
});
test('chaque unité porte loueurRaw (BPCE + LLD)', () => {
  assert.match(src, /loueurRaw: \(FP\.loueurOf \? FP\.loueurOf\(v\) : ''\)/);
  assert.match(src, /loueurRaw: \(c\.loueur \|\| ''\)\.toString\(\)\.trim\(\)/);
});

console.log('\nCâblage SOURCE UNIQUE (pages/conducteurs.html)');
const cond = fs.readFileSync(new URL('../../pages/conducteurs.html', import.meta.url), 'utf8');
test('helper visibleDrivers() applique recherche + pastilles (vue cartes)', () => {
  assert.match(cond, /function visibleDrivers\(\)\s*\{[\s\S]*?state\.search[\s\S]*?state\.view === 'cards'[\s\S]*?state\.cardFilter/);
});
test('la grille (renderGrid) lit visibleDrivers()', () => {
  assert.match(cond, /function renderGrid\(\)\s*\{\s*\n\s*const filtered = visibleDrivers\(\);/);
});
test('export CSV (getRows) lit visibleDrivers()', () => {
  assert.match(cond, /getRows: \(\) => visibleDrivers\(\)\.map\(d =>/);
});
test('relevé PDF/Excel (releve) lit visibleDrivers()', () => {
  assert.match(cond, /rows: visibleDrivers\(\) \}\)/);
});

console.log('\nCentre export — « Filtres repris » + « Exporter tout » (assets/js/app.js)');
const app = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
test('exportCenter : rowsAll() bascule sur cur.allRows quand showAll', () => {
  assert.match(app, /showAll && typeof cur\.allRows === 'function'\) \? cur\.allRows\(\)/);
});
test('exportCenter : renderReprise() affiche le bandeau Filtres repris', () => {
  assert.match(app, /function renderReprise\(curCount\)/);
  assert.match(app, /Filtres repris/);
});
test('makeExportMenu : transmet activeFilters + allRows au centre', () => {
  assert.match(app, /cfg\.activeFilters = opts\.activeFilters; cfg\.allRows = opts\.allRows;/);
});
test('contrats : passe activeFilters (Loueur/Recherche) + allRows au centre', () => {
  assert.match(src, /activeFilters: \(\) => \{\s*\n\s*if \(activeCtab\(\) !== 'leasing'\) return \[\];/);
  assert.match(src, /allRows: \(\) => \(activeCtab\(\) === 'leasing'\) \? leasingUnitsAll\(\)\.map\(leasingUnitToRow\)/);
});
test('conducteurs : passe activeFilters (Recherche/Filtre) + allRows au centre', () => {
  assert.match(cond, /activeFilters: \(\) => \{[\s\S]*?state\.search[\s\S]*?state\.cardFilter/);
  assert.match(cond, /allRows: \(\) => \(drivers \|\| \[\]\)\.slice\(\)/);
});

const veh = fs.readFileSync(new URL('../../pages/vehicules.html', import.meta.url), 'utf8');
test('véhicules : le relevé/export PDF (vehFicheConfig) lit la LISTE FILTRÉE, jamais le groupe brut', () => {
  // Périmètre = sélection si cochée, sinon filtered() (qui applique loueur/détention/proprio/pays/etc.).
  assert.match(veh, /else \{ const bits = activeFilterSummary\(\); list = filtered\(\); label =/);
  // Garde-fou : ne JAMAIS retomber sur le filtre « groupe » brut dans vehFicheConfig.
  const fn = veh.match(/function vehFicheConfig\(\)[\s\S]*?\n  \}/);
  assert.ok(fn, 'vehFicheConfig introuvable');
  assert.ok(!/FP\.vehGroupes\(v\)\.includes\(grp\)/.test(fn[0]), 'vehFicheConfig ne doit plus filtrer par groupe brut');
});
test('véhicules : export bloqué + message quand aucun résultat', () => {
  assert.match(veh, /if \(!cfg\.rows \|\| !cfg\.rows\.length\) \{ if \(FP\.toast\) FP\.toast\('Aucun résultat à exporter/);
});
test('véhicules : Excel/CSV et relevé PDF partagent la même source filtrée', () => {
  assert.match(veh, /getRows: \(\) => filtered\(\)/);
  assert.match(veh, /releve: vehFicheConfig/);
});

const emp = fs.readFileSync(new URL('../../pages/emprunts.html', import.meta.url), 'utf8');
test('emprunts : l\'export CSV (injectDataIO) lit la liste FILTRÉE, pas tout le cache', () => {
  // injectDataIO rend son propre bouton export → doit exporter filteredEmprunts(), jamais le cache complet.
  assert.match(emp, /getRows: \(\) => filteredEmprunts\(\),\s*\/\/ ⚠️ exporter la LISTE FILTRÉE/);
  const io = emp.match(/FP\.injectDataIO\(\{[\s\S]*?getRows:[^\n]*\n/);
  assert.ok(io && !/getRows: \(\) => cache\b/.test(io[0]), 'injectDataIO ne doit plus exporter cache brut');
  // Le centre d'export (makeExportMenu) utilise déjà filteredEmprunts via releve.
  assert.match(emp, /releve: \(\) => \(\{ key: 'emprunts'[\s\S]*?rows: filteredEmprunts\(\)/);
});

console.log(`\n${ko ? '❌' : '✅'} export-filtres : ${ok} ok, ${ko} ko\n`);
process.exit(ko ? 1 : 0);
