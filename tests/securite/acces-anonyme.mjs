#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Test de sécurité : que voit un VISITEUR ANONYME ?
// ============================================================================
//  Rôle : prouver qu'avec la seule clé PUBLIQUE (celle qui est dans le code du
//  site), un inconnu non connecté ne peut lire AUCUNE donnée :
//    1) aucune ligne des tables (API REST) ;
//    2) aucun fichier du stockage (liste des buckets / des dossiers).
//
//  100 % LECTURE : n'écrit rien, ne télécharge aucun fichier, n'affiche aucun
//  nom de fichier ni aucune donnée (seulement des comptages).
//  Zéro dépendance (Node ≥ 18).
//
//  Usage :  node tests/securite/acces-anonyme.mjs
//  Variables optionnelles (pour viser un projet staging) :
//    SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
//  Code de sortie : 0 = aucune fuite, 1 = fuite détectée, 2 = test impossible.
// ============================================================================

const URL_ = process.env.SUPABASE_URL || 'https://tzjuptlzoywjeigmyfuj.supabase.co';
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_KC3TZ1zda-ja-0wkyjHUlg_aKohD6tq';

// Tables de l'application (une table absente = simplement ignorée).
const TABLES = [
  'vehicules', 'amendes', 'factures', 'conducteurs', 'documents', 'emprunts',
  'total_conso', 'total_conso_tx', 'ulys_conso', 'app_settings', 'app_settings_history',
  'audit_log', 'profiles', 'controle_findings', 'declarations_conducteur', 'driver_absences', 'vehicle_assignments', 'lease_contracts', 'lease_overrides', 'settings_items',
  'edl_signatures', 'km_qr', 'km_requests', 'messages', 'offres_achat', 'prospects',
  'push_log', 'push_subscriptions', 'qr_scans', 'scans',
];
// Buckets et dossiers sensibles connus (préfixes du bucket « scans »).
const BUCKETS = ['scans'];
const DOSSIERS = ['', 'permis/', 'cartes-grises/', 'avis/', 'documents/', 'contrats-leasing/',
  'etat-des-lieux/', 'sinistres/', 'factures/', 'justificatifs/', 'declarations/', 'edl-signatures/'];

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const fuites = [];
let erreurs = 0;

async function testTable(t) {
  try {
    const r = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: KEY } });
    if (r.status === 404) return '—  absente';
    const d = await r.json().catch(() => null);
    if (r.ok && Array.isArray(d) && d.length > 0) { fuites.push(`table ${t} : des lignes sont lisibles sans connexion`); return '❌ LISIBLE'; }
    if (r.ok && Array.isArray(d)) return '✅ 0 ligne';
    if (r.status === 401 || r.status === 403) return `✅ refusé (${r.status})`;
    erreurs++; return `⚠️  réponse inattendue (${r.status})`;
  } catch (e) { erreurs++; return `⚠️  erreur réseau (${e.message})`; }
}

async function testDossier(bucket, prefix) {
  try {
    const r = await fetch(`${URL_}/storage/v1/object/list/${bucket}`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000 }),
    });
    const d = await r.json().catch(() => null);
    if (r.ok && Array.isArray(d) && d.length > 0) {
      const fichiers = d.filter(e => e && e.id).length, dossiers = d.length - fichiers;
      fuites.push(`stockage ${bucket}/${prefix || '(racine)'} : ${fichiers} fichier(s) et ${dossiers} dossier(s) listables sans connexion`);
      return `❌ LISTABLE (${fichiers} fichiers, ${dossiers} dossiers)`;
    }
    if (r.ok && Array.isArray(d)) return '✅ rien de visible';
    if (r.status === 400 || r.status === 401 || r.status === 403 || r.status === 404) return `✅ refusé (${r.status})`;
    erreurs++; return `⚠️  réponse inattendue (${r.status})`;
  } catch (e) { erreurs++; return `⚠️  erreur réseau (${e.message})`; }
}

async function testListeBuckets() {
  try {
    const r = await fetch(`${URL_}/storage/v1/bucket`, { headers: H });
    const d = await r.json().catch(() => null);
    if (r.ok && Array.isArray(d) && d.length > 0) { fuites.push(`liste des buckets visible sans connexion (${d.length})`); return `❌ ${d.length} bucket(s) visibles`; }
    return '✅ rien de visible';
  } catch (e) { erreurs++; return `⚠️  erreur réseau (${e.message})`; }
}

console.log(`\nTest d'accès ANONYME — ${URL_}\n`);
console.log('1) Tables (API REST)');
for (const t of TABLES) console.log(`   ${t.padEnd(26)} ${await testTable(t)}`);
console.log('\n2) Stockage');
console.log(`   ${'liste des buckets'.padEnd(26)} ${await testListeBuckets()}`);
for (const b of BUCKETS) for (const p of DOSSIERS) console.log(`   ${(b + '/' + p).padEnd(26)} ${await testDossier(b, p)}`);

console.log('');
if (fuites.length) {
  console.log(`❌ ${fuites.length} FUITE(S) DÉTECTÉE(S) :`);
  fuites.forEach(f => console.log('   • ' + f));
  process.exit(1);
}
if (erreurs) { console.log(`⚠️  Test incomplet : ${erreurs} vérification(s) impossible(s).`); process.exit(2); }
console.log('✅ Aucune donnée accessible sans connexion.');
