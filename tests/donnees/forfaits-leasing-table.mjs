#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Test des FORFAITS DE LEASING en table (fp_forfait_leasing_enregistrer / _archiver) — STAGING uniquement
// ============================================================================
//  Avec les deux comptes de test (TEST-A, TEST-B), exactement comme le fait l'application :
//    1) ENREGISTRER un forfait : contenu complet conservé, clé de plaque gardée telle quelle, plaque
//       normalisée calculée ; rejouer = aucun doublon ; modifier = la même ligne est mise à jour ;
//    2) un forfait illisible (pas un objet) est REFUSÉ et ne détruit rien ;
//    3) ISOLATION : TEST-B ne peut ni archiver, ni modifier, ni créer, ni lire les forfaits de TEST-A ;
//    4) un visiteur NON CONNECTÉ ne peut ni appeler les fonctions ni lire la table ;
//    5) ARCHIVER : le forfait disparaît de la liste active (rejeu sans effet).
//  Plaque de test « TT-… », archivée à la fin. ⚠️ Refuse de tourner contre la production.
//  Variables : STAGING_URL, STAGING_PUBLISHABLE_KEY, TEST_A_*/TEST_B_* (EMAIL, PASSWORD)
//  Code de sortie : 0 = OK, 1 = échec, 2 = test impossible.
// ============================================================================

const URL_ = (process.env.STAGING_URL || '').replace(/\/$/, '');
const KEY = process.env.STAGING_PUBLISHABLE_KEY || '';
const A = { nom: 'A', email: process.env.TEST_A_EMAIL, mdp: process.env.TEST_A_PASSWORD };
const B = { nom: 'B', email: process.env.TEST_B_EMAIL, mdp: process.env.TEST_B_PASSWORD };

if (!URL_ || !KEY || !A.email || !A.mdp || !B.email || !B.mdp) { console.log('⚠️  Variables manquantes : test impossible.'); process.exit(2); }
if (URL_.includes('tzjuptlzoywjeigmyfuj')) { console.log('⛔ Ce test écrit dans la base : jamais sur la production.'); process.exit(2); }

const echecs = [];
const ok = (m) => console.log('   ✅ ' + m);
const ko = (m) => { console.log('   ❌ ' + m); echecs.push(m); };

async function connexion(c) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: c.email, password: c.mdp }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`connexion du compte ${c.nom} impossible (HTTP ${r.status})`);
  return d.access_token;
}
function api(jeton) {
  const H = { apikey: KEY, 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) };
  return async (methode, chemin, corps) => {
    const r = await fetch(`${URL_}/rest/v1/${chemin}`, { method: methode, headers: H, body: corps ? JSON.stringify(corps) : undefined });
    const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
    return { status: r.status, ok: r.ok, data: d };
  };
}
const enregistrer = (req, societe, cle, f) => req('POST', 'rpc/fp_forfait_leasing_enregistrer', { p_societe: societe, p_cle: cle, p_forfait: f });
const archiver = (req, societe, cle) => req('POST', 'rpc/fp_forfait_leasing_archiver', { p_societe: societe, p_cle: cle });
const lire = async (req, societe, cle) => {
  const r = await req('GET', `lease_overrides?select=cle,forfait,immat_norm&societe=eq.${encodeURIComponent(societe)}&cle=eq.${encodeURIComponent(cle)}&deleted_at=is.null`);
  return Array.isArray(r.data) ? r.data : null;
};

const suffixe = Date.now().toString(36).toUpperCase().slice(-3);
const CLE = 'TT-' + suffixe + '-ZZ';
const F = { kmContrat: 60000, dureeMois: 36, debut: '2026-01-01', kmSupp: 0.0814, kmTolerance: null, loyer: 565.23 };

try {
  const ja = await connexion(A), jb = await connexion(B);
  const reqA = api(ja), reqB = api(jb), anon = api(null);

  console.log('\n1) Enregistrer un forfait (compte A)');
  let r = await enregistrer(reqA, 'TEST-A', CLE, F);
  if (!r.ok) ko(`appel refusé (HTTP ${r.status}) : ${JSON.stringify(r.data)}`);
  let l = await lire(reqA, 'TEST-A', CLE);
  if (l && l.length === 1 && l[0].forfait.loyer === 565.23 && l[0].forfait.kmContrat === 60000 && 'kmTolerance' in l[0].forfait) ok('forfait complet conservé (valeurs nulles comprises)'); else ko(`contenu inattendu : ${JSON.stringify(l)}`);
  if (l && l[0] && l[0].cle === CLE && l[0].immat_norm === CLE.replace(/-/g, '')) ok('clé gardée telle quelle, plaque normalisée calculée'); else ko('clé ou plaque normalisée inattendue');
  await enregistrer(reqA, 'TEST-A', CLE, F);
  l = await lire(reqA, 'TEST-A', CLE);
  if (l && l.length === 1) ok('rejoué : toujours 1 forfait (aucun doublon)'); else ko(`doublons après rejeu : ${l && l.length}`);
  await enregistrer(reqA, 'TEST-A', CLE, { ...F, loyer: 580 });
  l = await lire(reqA, 'TEST-A', CLE);
  if (l && l.length === 1 && l[0].forfait.loyer === 580) ok('modification : même ligne mise à jour'); else ko(`modification inattendue : ${JSON.stringify(l)}`);

  console.log('\n2) Donnée invalide');
  r = await reqA('POST', 'rpc/fp_forfait_leasing_enregistrer', { p_societe: 'TEST-A', p_cle: CLE, p_forfait: [1, 2] });
  l = await lire(reqA, 'TEST-A', CLE);
  if (!r.ok && l && l.length === 1 && l[0].forfait.loyer === 580) ok('forfait illisible refusé, rien de modifié'); else ko(`forfait illisible accepté (HTTP ${r.status}, ${JSON.stringify(l)})`);

  console.log('\n3) Isolation : le compte B tente de toucher aux forfaits de TEST-A');
  await archiver(reqB, 'TEST-A', CLE);
  l = await lire(reqA, 'TEST-A', CLE);
  if (l && l.length === 1) ok('archivage par B sans effet'); else ko('B a pu archiver le forfait de A');
  await enregistrer(reqB, 'TEST-A', CLE, { loyer: 1 });
  l = await lire(reqA, 'TEST-A', CLE);
  if (l && l.length === 1 && l[0].forfait.loyer === 580) ok('modification par B sans effet'); else ko('B a pu modifier le forfait de A');
  r = await enregistrer(reqB, 'TEST-A', CLE + 'X', F);
  l = await lire(reqA, 'TEST-A', CLE + 'X');
  if (!r.ok && l && l.length === 0) ok('création au nom de TEST-A refusée'); else ko(`B a pu créer un forfait chez A (HTTP ${r.status})`);
  l = await lire(reqB, 'TEST-A', CLE);
  if (l && l.length === 0) ok('lecture des forfaits de A par B : rien de visible'); else ko('B voit les forfaits de A');

  console.log('\n4) Visiteur non connecté');
  r = await archiver(anon, 'TEST-A', CLE);
  l = await lire(reqA, 'TEST-A', CLE);
  if (!r.ok && l && l.length === 1) ok(`appel refusé (HTTP ${r.status})`); else ko(`un visiteur non connecté a pu appeler la fonction (HTTP ${r.status})`);
  r = await anon('GET', 'lease_overrides?select=id&limit=1');
  if (!r.ok || (Array.isArray(r.data) && r.data.length === 0)) ok('lecture de la table refusée'); else ko('un visiteur non connecté lit la table');

  console.log('\n5) Archivage (compte A)');
  r = await archiver(reqA, 'TEST-A', CLE);
  l = await lire(reqA, 'TEST-A', CLE);
  if (r.ok && l && l.length === 0) ok('forfait archivé : plus dans la liste active'); else ko(`archivage inattendu (HTTP ${r.status}, ${JSON.stringify(l)})`);
  r = await archiver(reqA, 'TEST-A', CLE);
  if (r.ok) ok('archivage rejoué : sans effet, sans erreur'); else ko(`rejeu de l'archivage en erreur (HTTP ${r.status})`);
} catch (e) {
  console.log('⚠️  Test impossible : ' + (e.message || e));
  process.exit(2);
}

console.log(echecs.length ? `\n❌ ${echecs.length} échec(s).` : '\n✅ Forfaits de leasing en table : enregistrement, contrôles, isolation et archivage conformes.');
process.exit(echecs.length ? 1 : 0);
