#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Test des CONGÉS en table (fonctions fp_conges_*) — STAGING uniquement
// ============================================================================
//  Vérifie, avec les deux comptes de test (TEST-A, TEST-B) et exactement comme le fait
//  l'application :
//    1) REMPLACER les congés d'un conducteur (fp_conges_remplacer) : le résultat en table
//       est exactement la liste envoyée, sans doublon, même rejouée ;
//    2) RENOMMER un conducteur (fp_conges_renommer) : les congés suivent la nouvelle clé ;
//    3) ISOLATION : TEST-B ne peut ni effacer ni créer des congés de TEST-A ;
//    4) un visiteur NON CONNECTÉ ne peut pas appeler ces fonctions.
//  Les lignes de test (clé « t-rpc-… ») sont supprimées à la fin.
//  ⚠️ Refuse de tourner contre la production. Zéro dépendance (Node ≥ 18).
//  Variables : STAGING_URL, STAGING_PUBLISHABLE_KEY, TEST_A_*/TEST_B_* (EMAIL, PASSWORD)
//  Code de sortie : 0 = OK, 1 = échec, 2 = test impossible.
// ============================================================================

const URL_ = (process.env.STAGING_URL || '').replace(/\/$/, '');
const KEY = process.env.STAGING_PUBLISHABLE_KEY || '';
const A = { nom: 'A', societe: 'TEST-A', email: process.env.TEST_A_EMAIL, mdp: process.env.TEST_A_PASSWORD };
const B = { nom: 'B', societe: 'TEST-B', email: process.env.TEST_B_EMAIL, mdp: process.env.TEST_B_PASSWORD };

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
const remplacer = (req, societe, cle, conges) => req('POST', 'rpc/fp_conges_remplacer', { p_societe: societe, p_cond_key: cle, p_conges: conges });
const renommer = (req, societe, ancienne, nouvelle) => req('POST', 'rpc/fp_conges_renommer', { p_societe: societe, p_ancienne: ancienne, p_nouvelle: nouvelle });
const lire = async (req, societe, cle) => {
  const r = await req('GET', `driver_absences?select=cond_key,debut,fin,motif&societe=eq.${encodeURIComponent(societe)}&cond_key=eq.${encodeURIComponent(cle)}&order=debut`);
  return Array.isArray(r.data) ? r.data : null;
};

const CLE = 't-rpc-' + Date.now().toString(36), CLE2 = CLE + '-renomme';
const C1 = { debut: '2030-01-10', fin: '2030-01-15', motif: 'test 1' };
const C2 = { debut: '2030-02-01', fin: '2030-02-03', motif: '' };

try {
  const ja = await connexion(A), jb = await connexion(B);
  const reqA = api(ja), reqB = api(jb), anon = api(null);

  console.log('\n1) Remplacer les congés d\'un conducteur (compte A)');
  let r = await remplacer(reqA, 'TEST-A', CLE, [C2, C1]);
  if (!r.ok) ko(`appel refusé (HTTP ${r.status}) : ${JSON.stringify(r.data)}`);
  let l = await lire(reqA, 'TEST-A', CLE);
  if (l && l.length === 2 && l[0].debut === C1.debut && l[1].debut === C2.debut && l[0].motif === 'test 1') ok('2 congés enregistrés, triés');
  else ko(`attendu 2 congés, lu : ${JSON.stringify(l)}`);
  await remplacer(reqA, 'TEST-A', CLE, [C2, C1]);
  l = await lire(reqA, 'TEST-A', CLE);
  if (l && l.length === 2) ok('rejoué une 2ᵉ fois : toujours 2 congés (aucun doublon)'); else ko(`doublons après rejeu : ${l && l.length}`);
  await remplacer(reqA, 'TEST-A', CLE, [C1]);
  l = await lire(reqA, 'TEST-A', CLE);
  if (l && l.length === 1 && l[0].debut === C1.debut) ok('suppression d\'un congé : il en reste exactement 1'); else ko(`attendu 1 congé, lu : ${JSON.stringify(l)}`);
  r = await remplacer(reqA, 'TEST-A', CLE, { pas: 'une liste' });
  if (!r.ok) ok('donnée invalide refusée'); else ko('une donnée qui n\'est pas une liste a été acceptée');

  console.log('\n2) Isolation : le compte B tente de toucher aux congés de TEST-A');
  r = await remplacer(reqB, 'TEST-A', CLE, []);
  l = await lire(reqA, 'TEST-A', CLE);
  if (l && l.length === 1) ok('effacement par B sans effet'); else ko(`B a pu effacer les congés de A (reste ${l && l.length})`);
  r = await remplacer(reqB, 'TEST-A', CLE + '-intrus', [C1]);
  l = await lire(reqA, 'TEST-A', CLE + '-intrus');
  if (!r.ok && l && l.length === 0) ok('création au nom de TEST-A refusée'); else ko(`B a pu créer un congé chez A (HTTP ${r.status}, ${l && l.length} ligne(s))`);
  r = await renommer(reqB, 'TEST-A', CLE, CLE + '-vol');
  l = await lire(reqA, 'TEST-A', CLE);
  if (l && l.length === 1) ok('renommage par B sans effet'); else ko('B a pu renommer un conducteur de A');

  console.log('\n3) Renommer le conducteur (compte A)');
  r = await renommer(reqA, 'TEST-A', CLE, CLE2);
  const avant = await lire(reqA, 'TEST-A', CLE), apres = await lire(reqA, 'TEST-A', CLE2);
  if (r.ok && avant && avant.length === 0 && apres && apres.length === 1) ok('les congés suivent la nouvelle clé'); else ko(`renommage incorrect (ancienne : ${avant && avant.length}, nouvelle : ${apres && apres.length})`);

  console.log('\n4) Visiteur non connecté');
  r = await remplacer(anon, 'TEST-A', CLE2, []);
  l = await lire(reqA, 'TEST-A', CLE2);
  if (!r.ok && l && l.length === 1) ok(`appel refusé (HTTP ${r.status})`); else ko(`un visiteur non connecté a pu appeler la fonction (HTTP ${r.status})`);

  // Nettoyage
  await remplacer(reqA, 'TEST-A', CLE2, []); await remplacer(reqA, 'TEST-A', CLE, []);
  l = await lire(reqA, 'TEST-A', CLE2);
  if (l && l.length === 0) ok('nettoyage : lignes de test supprimées'); else ko('nettoyage incomplet');
} catch (e) {
  console.log('⚠️  Test impossible : ' + (e.message || e));
  process.exit(2);
}

console.log(echecs.length ? `\n❌ ${echecs.length} échec(s).` : '\n✅ Congés en table : remplacement, renommage et isolation conformes.');
process.exit(echecs.length ? 1 : 0);
