#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Test d'ISOLATION ENTRE SOCIÉTÉS (à lancer sur le STAGING)
// ============================================================================
//  Deux comptes de test, l'un rattaché à TEST-A, l'autre à TEST-B (profil
//  « admin » de sa société, jamais CEO). Pour chaque compte, on vérifie via
//  l'API REST — exactement comme le ferait un client malveillant :
//    1) LECTURE   : il ne voit QUE les lignes de sa société (ni l'autre
//                   société, ni les lignes sans société = « PXP ») ;
//    2) ÉCRITURE  : il ne peut ni MODIFIER, ni SUPPRIMER une ligne de l'autre
//                   société, ni CRÉER une ligne au nom de l'autre société ;
//    3) PROFIL    : il ne peut pas changer sa propre société ni devenir CEO.
//
//  ⚠️ Refuse de tourner contre la production. Les tentatives d'écriture visent
//  uniquement les lignes fictives du staging (préfixe « T- »).
//  Zéro dépendance (Node ≥ 18). Aucun secret dans le code : tout vient des
//  variables d'environnement (secrets GitHub en CI).
//
//  Variables : STAGING_URL, STAGING_PUBLISHABLE_KEY,
//              TEST_A_EMAIL, TEST_A_PASSWORD, TEST_B_EMAIL, TEST_B_PASSWORD
//  Données attendues : supabase/staging/seed-donnees-fictives.sql
//  Code de sortie : 0 = isolation OK, 1 = fuite détectée, 2 = test impossible.
// ============================================================================

const URL_ = (process.env.STAGING_URL || '').replace(/\/$/, '');
const KEY = process.env.STAGING_PUBLISHABLE_KEY || '';
const PROD_REF = 'tzjuptlzoywjeigmyfuj';

const COMPTES = [
  { nom: 'A', societe: 'TEST-A', autre: 'TEST-B', email: process.env.TEST_A_EMAIL, mdp: process.env.TEST_A_PASSWORD, vehAutre: 'T-B-V1' },
  { nom: 'B', societe: 'TEST-B', autre: 'TEST-A', email: process.env.TEST_B_EMAIL, mdp: process.env.TEST_B_PASSWORD, vehAutre: 'T-A-V1' },
];
// Tables métier isolées par la colonne `societe`.
const TABLES_SOCIETE = ['vehicules', 'conducteurs', 'amendes', 'factures', 'documents', 'emprunts', 'driver_absences',
  'total_conso', 'total_conso_tx', 'ulys_conso', 'km_qr', 'km_requests', 'qr_scans', 'declarations_conducteur',
  'edl_signatures', 'offres_achat', 'controle_findings', 'app_settings_history', 'audit_log', 'scans'];

if (!URL_ || !KEY || COMPTES.some(c => !c.email || !c.mdp)) {
  console.log('⚠️  Variables manquantes (STAGING_URL, STAGING_PUBLISHABLE_KEY, TEST_A_*/TEST_B_*) : test impossible.');
  process.exit(2);
}
if (URL_.includes(PROD_REF)) {
  console.log('⛔ Ce test écrit dans la base : il ne doit JAMAIS viser la production.');
  process.exit(2);
}

const echecs = [];
let impossibles = 0;
const ok = (msg) => console.log('   ✅ ' + msg);
const ko = (msg) => { console.log('   ❌ ' + msg); echecs.push(msg); };
const impossible = (msg) => { console.log('   ⚠️  ' + msg); impossibles++; };

async function connexion(c) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: c.email, password: c.mdp }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`connexion du compte ${c.nom} impossible (HTTP ${r.status})`);
  return { jeton: d.access_token, uid: d.user && d.user.id };
}

function api(jeton) {
  const H = { apikey: KEY, Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' };
  return async (methode, chemin, corps, prefer) => {
    const r = await fetch(`${URL_}/rest/v1/${chemin}`, {
      method: methode, headers: { ...H, ...(prefer ? { Prefer: prefer } : {}) },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    const texte = await r.text();
    let d = null; try { d = texte ? JSON.parse(texte) : null; } catch (e) { d = texte; }
    return { status: r.status, ok: r.ok, data: d };
  };
}

async function testerCompte(c) {
  console.log(`\nCompte ${c.nom} (société ${c.societe})`);
  const { jeton, uid } = await connexion(c);
  const req = api(jeton);

  // 1) LECTURE — tables à colonne `societe`
  for (const t of TABLES_SOCIETE) {
    const r = await req('GET', `${t}?select=*&limit=1000`);
    if (r.status === 404) continue;                                   // table absente : ignorée
    if (!r.ok || !Array.isArray(r.data)) { impossible(`${t} : lecture impossible (HTTP ${r.status})`); continue; }
    const etrangeres = r.data.filter(l => (l.societe == null ? 'PXP' : l.societe) !== c.societe);
    if (etrangeres.length) ko(`${t} : ${etrangeres.length} ligne(s) d'une autre société visibles`);
    else ok(`${t} : ${r.data.length} ligne(s), toutes de ${c.societe}`);
  }
  // app_settings : une ligne par société (id = société)
  {
    const r = await req('GET', 'app_settings?select=id');
    const autres = (Array.isArray(r.data) ? r.data : []).filter(l => l.id !== c.societe);
    if (!r.ok) impossible(`app_settings : lecture impossible (HTTP ${r.status})`);
    else if (autres.length) ko(`app_settings : ${autres.length} ligne(s) d'une autre société visibles`);
    else ok('app_settings : uniquement sa propre ligne');
  }
  // profiles : uniquement son propre profil
  {
    const r = await req('GET', 'profiles?select=id,societe,is_admin');
    const autres = (Array.isArray(r.data) ? r.data : []).filter(l => l.id !== uid);
    if (!r.ok) impossible(`profiles : lecture impossible (HTTP ${r.status})`);
    else if (autres.length) ko(`profiles : ${autres.length} profil(s) d'autres comptes visibles`);
    else ok('profiles : uniquement son propre profil');
  }

  // 2) ÉCRITURE chez l'autre société (doit toucher 0 ligne ou être refusée)
  {
    const r = await req('PATCH', `vehicules?id=eq.${c.vehAutre}`, { statut: 'intrusion-test' }, 'return=representation');
    if (r.ok && Array.isArray(r.data) && r.data.length) ko(`vehicules : a pu MODIFIER le véhicule ${c.vehAutre} de ${c.autre}`);
    else ok(`vehicules : modification d'un véhicule de ${c.autre} refusée`);
  }
  {
    const r = await req('DELETE', `vehicules?id=eq.${c.vehAutre}`, null, 'return=representation');
    if (r.ok && Array.isArray(r.data) && r.data.length) ko(`vehicules : a pu SUPPRIMER le véhicule ${c.vehAutre} de ${c.autre}`);
    else ok(`vehicules : suppression d'un véhicule de ${c.autre} refusée`);
  }
  {
    const id = `T-INTRUS-${c.nom}-${Date.now()}`;
    const r = await req('POST', 'vehicules', { id, immat: 'XX-000-XX', societe: c.autre }, 'return=representation');
    if (r.ok) { ko(`vehicules : a pu CRÉER un véhicule au nom de ${c.autre}`); await req('DELETE', `vehicules?id=eq.${id}`); }
    else ok(`vehicules : création au nom de ${c.autre} refusée`);
  }
  {
    const r = await req('PATCH', `app_settings?id=eq.${c.autre}`, { data: { intrusion: true } }, 'return=representation');
    if (r.ok && Array.isArray(r.data) && r.data.length) ko(`app_settings : a pu MODIFIER les réglages de ${c.autre}`);
    else ok(`app_settings : modification des réglages de ${c.autre} refusée`);
  }

  // 3) PROFIL : ne peut ni changer de société ni devenir CEO
  {
    const r = await req('PATCH', `profiles?id=eq.${uid}`, { societe: c.autre, is_admin: true }, 'return=representation');
    if (r.ok && Array.isArray(r.data) && r.data.length) ko('profiles : a pu modifier son propre profil (société / CEO)');
    else ok('profiles : impossible de changer de société ou de devenir CEO');
  }
}

console.log(`\nTest d'isolation entre sociétés — ${URL_}`);
for (const c of COMPTES) {
  try { await testerCompte(c); }
  catch (e) { impossible(e.message); }
}
console.log('');
if (echecs.length) {
  console.log(`❌ ${echecs.length} FUITE(S) D'ISOLATION :`);
  echecs.forEach(f => console.log('   • ' + f));
  process.exit(1);
}
if (impossibles) { console.log(`⚠️  Test incomplet : ${impossibles} vérification(s) impossible(s).`); process.exit(2); }
console.log('✅ Isolation entre sociétés respectée (lecture, écriture, profil).');
