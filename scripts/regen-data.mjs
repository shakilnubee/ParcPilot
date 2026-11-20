#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Régénère assets/js/data.js (instantané de SECOURS hors-ligne) depuis des dumps
// JSON des 4 tables de production (vehicules, amendes, factures, conducteurs).
//
// ⚠️ DÉPÔT PUBLIC → ZÉRO donnée personnelle. Ce script :
//   1) mappe les colonnes snake_case → camelCase (MÊME règle que FP.db / supabase-client.js),
//   2) STRIPPE toute l'identité (RGPD) — conducteurs par LISTE BLANCHE (le plus sûr),
//   3) écrit `window.FP_DATA = {…}`.
//
// Usage : node scripts/regen-data.mjs [dossier_dumps]
//   dossier_dumps (défaut: /tmp/pp-regen) contient vehicules.json / amendes.json /
//   factures.json / conducteurs.json (chacun = tableau JSON de lignes snake_case).
//
// Lancé par .github/workflows/regen-data.yml (lecture prod via le secret PROD_DB_URL,
// psql → JSON → ce script → PR). Testable en local avec des fichiers JSON factices.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] || '/tmp/pp-regen';
const OUT = join(process.cwd(), 'assets/js/data.js');

// — Mapping snake→camel : overrides IDENTIQUES à supabase-client.js (SNAKE_TO_CAMEL_OVERRIDES) —
const OVERRIDES = {
  montant_ht: 'montantHT', montant_tva: 'montantTVA', montant_ttc: 'montantTTC',
  changer_cg: 'changerCG', prochain_ct: 'prochainCT', date_dernier_ct: 'dateDernierCT',
  note_pneus: 'autonomie', type_pneus: 'version',
};
const snakeToCamel = (k) => OVERRIDES[k] || k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const toCamel = (row) => { const o = {}; for (const [k, v] of Object.entries(row || {})) o[snakeToCamel(k)] = v; return o; };

// — Champs à SUPPRIMER (PII sensible) et à VIDER (identité) sur les tables NON-conducteur —
const DROP = ['email', 'adresse', 'dateNaissance', 'tel', 'telephone',
  'permisNumero', 'permisType', 'permisObtention', 'permisExpiration', 'permisUrl', 'permisFileId', 'vin'];
const EMPTY = ['nom', 'prenom', 'name', 'poste', 'chauffeur', 'conducteur'];

function stripRow(camel) {
  const o = { ...camel };
  for (const k of DROP) delete o[k];
  for (const k of EMPTY) if (k in o) o[k] = '';
  return o;
}

// — Conducteurs : LISTE BLANCHE stricte (aucune PII ne peut fuiter même si une colonne apparaît) —
// On garde uniquement : key (ANONYMISÉE c1,c2…), societe, masque, manuel. name/nom/prenom/poste vidés, note=null.
function stripConducteur(camel, i) {
  return {
    key: 'c' + (i + 1),
    name: '', nom: '', prenom: '', poste: '', note: null,
    masque: !!camel.masque,
    manuel: (camel.manuel === undefined ? true : !!camel.manuel),
    societe: camel.societe != null ? camel.societe : null,
  };
}

function load(table) {
  const p = join(DIR, table + '.json');
  if (!existsSync(p)) throw new Error('Dump manquant : ' + p);
  let raw = readFileSync(p, 'utf8').trim();
  if (!raw) return [];
  let arr;
  try { arr = JSON.parse(raw); } catch (e) { throw new Error('JSON invalide pour ' + table + ' : ' + e.message); }
  if (!Array.isArray(arr)) throw new Error(table + '.json n\'est pas un tableau');
  return arr;
}

const vehicules = load('vehicules').map(toCamel).map(stripRow);
const amendes = load('amendes').map(toCamel).map(stripRow);
const factures = load('factures').map(toCamel).map(stripRow);
const conducteurs = load('conducteurs').map(toCamel).map(stripConducteur);

const data = { vehicules, amendes, factures, conducteurs };

const d = new Date().toISOString().slice(0, 10);
const header = '// Parc Pilot — données de SECOURS (fallback hors-ligne)\n'
  + '// ⚠️ Régénéré le ' + d + ' via l\'Action GitHub « Régénérer data.js » depuis la prod (strip RGPD). NE PAS éditer à la main.\n';
writeFileSync(OUT, header + 'window.FP_DATA = ' + JSON.stringify(data) + ';\n', 'utf8');

console.log('✅ data.js régénéré : '
  + vehicules.length + ' véhicules · ' + amendes.length + ' amendes · '
  + factures.length + ' factures · ' + conducteurs.length + ' conducteurs.');

// — Garde RGPD locale (même esprit que check-bugs) : aucune valeur PII non vide ne doit subsister —
const out = readFileSync(OUT, 'utf8');
const re = /"(email|adresse|dateNaissance|tel|telephone|nom|prenom|name|poste|permisNumero|permisType|permisObtention|permisExpiration|permisUrl|permisFileId|chauffeur|conducteur|vin)":"[^"]+"/g;
const hits = (out.match(re) || []);
if (hits.length) {
  console.error('❌ RGPD : ' + hits.length + ' valeur(s) personnelle(s) NON vidée(s) — ex. ' + hits[0].slice(0, 60));
  process.exit(1);
}
console.log('✅ RGPD : aucune donnée personnelle dans data.js.');
