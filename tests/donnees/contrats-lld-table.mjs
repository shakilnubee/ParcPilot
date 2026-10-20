#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Test des CONTRATS LLD en table (fp_contrat_lld_enregistrer / _archiver) — STAGING uniquement
// ============================================================================
//  Avec les deux comptes de test (TEST-A, TEST-B), exactement comme le fait l'application :
//    1) ENREGISTRER un contrat : contenu complet conservé, plaque extraite ; rejouer = aucun doublon ;
//       modifier = la même ligne est mise à jour ;
//    2) un contrat illisible (identifiant qui ne correspond pas) est REFUSÉ et ne détruit rien ;
//    3) ISOLATION : TEST-B ne peut ni archiver, ni modifier, ni créer, ni lire les contrats de TEST-A ;
//    4) un visiteur NON CONNECTÉ ne peut ni appeler les fonctions ni lire la table ;
//    5) ARCHIVER : le contrat disparaît de la liste active (rejeu sans effet).
//  Contrat de test « lld-test-… », archivé à la fin. ⚠️ Refuse de tourner contre la production.
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
const enregistrer = (req, societe, c, ordre) => req('POST', 'rpc/fp_contrat_lld_enregistrer', { p_societe: societe, p_id: c.id, p_ordre: ordre, p_contrat: c });
const archiver = (req, societe, id) => req('POST', 'rpc/fp_contrat_lld_archiver', { p_societe: societe, p_id: id });
const lire = async (req, societe, id) => {
  const r = await req('GET', `lease_contracts?select=contrat_id,ordre,contrat,immat&societe=eq.${encodeURIComponent(societe)}&contrat_id=eq.${encodeURIComponent(id)}&deleted_at=is.null`);
  return Array.isArray(r.data) ? r.data : null;
};

const ID = 'lld-test-' + Date.now().toString(36);
const C = { id: ID, immat: 'TT-123-TT', marque: 'Test', loyerTTC: 450.5, dureeMois: 36, debut: '2026-01-01', docs: [{ url: 'https://exemple.invalid/x.pdf', name: 'Contrat' }], avenants: [{ date: '2026-06-01', loyer: 470 }] };

try {
  const ja = await connexion(A), jb = await connexion(B);
  const reqA = api(ja), reqB = api(jb), anon = api(null);

  console.log('\n1) Enregistrer un contrat (compte A)');
  let r = await enregistrer(reqA, 'TEST-A', C, 0);
  if (!r.ok) ko(`appel refusé (HTTP ${r.status}) : ${JSON.stringify(r.data)}`);
  let l = await lire(reqA, 'TEST-A', ID);
  if (l && l.length === 1 && l[0].contrat.loyerTTC === 450.5 && Array.isArray(l[0].contrat.avenants) && l[0].contrat.avenants[0].loyer === 470 && Array.isArray(l[0].contrat.docs) && l[0].contrat.docs.length === 1) ok('contrat complet conservé (documents, avenants)'); else ko(`contenu inattendu : ${JSON.stringify(l)}`);
  if (l && l[0] && l[0].immat === 'TT-123-TT') ok('plaque extraite automatiquement'); else ko('plaque non extraite');
  await enregistrer(reqA, 'TEST-A', C, 0);
  l = await lire(reqA, 'TEST-A', ID);
  if (l && l.length === 1) ok('rejoué : toujours 1 contrat (aucun doublon)'); else ko(`doublons après rejeu : ${l && l.length}`);
  await enregistrer(reqA, 'TEST-A', { ...C, loyerTTC: 480 }, 3);
  l = await lire(reqA, 'TEST-A', ID);
  if (l && l.length === 1 && l[0].contrat.loyerTTC === 480 && l[0].ordre === 3) ok('modification : même ligne mise à jour (loyer, position)'); else ko(`modification inattendue : ${JSON.stringify(l)}`);

  console.log('\n2) Donnée invalide');
  r = await reqA('POST', 'rpc/fp_contrat_lld_enregistrer', { p_societe: 'TEST-A', p_id: ID, p_ordre: 0, p_contrat: { ...C, id: 'autre-id', loyerTTC: 1 } });
  l = await lire(reqA, 'TEST-A', ID);
  if (!r.ok && l && l.length === 1 && l[0].contrat.loyerTTC === 480) ok('identifiant incohérent refusé, rien de modifié'); else ko(`contrat incohérent accepté (HTTP ${r.status}, ${JSON.stringify(l)})`);

  console.log('\n3) Isolation : le compte B tente de toucher aux contrats de TEST-A');
  await archiver(reqB, 'TEST-A', ID);
  l = await lire(reqA, 'TEST-A', ID);
  if (l && l.length === 1) ok('archivage par B sans effet'); else ko('B a pu archiver le contrat de A');
  await enregistrer(reqB, 'TEST-A', { ...C, loyerTTC: 1 }, 0);
  l = await lire(reqA, 'TEST-A', ID);
  if (l && l.length === 1 && l[0].contrat.loyerTTC === 480) ok('modification par B sans effet'); else ko('B a pu modifier le contrat de A');
  r = await enregistrer(reqB, 'TEST-A', { ...C, id: ID + '-intrus' }, 0);
  l = await lire(reqA, 'TEST-A', ID + '-intrus');
  if (!r.ok && l && l.length === 0) ok('création au nom de TEST-A refusée'); else ko(`B a pu créer un contrat chez A (HTTP ${r.status})`);
  l = await lire(reqB, 'TEST-A', ID);
  if (l && l.length === 0) ok('lecture des contrats de A par B : rien de visible'); else ko('B voit les contrats de A');

  console.log('\n4) Visiteur non connecté');
  r = await archiver(anon, 'TEST-A', ID);
  l = await lire(reqA, 'TEST-A', ID);
  if (!r.ok && l && l.length === 1) ok(`appel refusé (HTTP ${r.status})`); else ko(`un visiteur non connecté a pu appeler la fonction (HTTP ${r.status})`);
  r = await anon('GET', 'lease_contracts?select=id&limit=1');
  if (!r.ok || (Array.isArray(r.data) && r.data.length === 0)) ok('lecture de la table refusée'); else ko('un visiteur non connecté lit la table');

  console.log('\n5) Archivage (compte A)');
  r = await archiver(reqA, 'TEST-A', ID);
  l = await lire(reqA, 'TEST-A', ID);
  if (r.ok && l && l.length === 0) ok('contrat archivé : plus dans la liste active'); else ko(`archivage inattendu (HTTP ${r.status}, ${JSON.stringify(l)})`);
  r = await archiver(reqA, 'TEST-A', ID);
  if (r.ok) ok('archivage rejoué : sans effet, sans erreur'); else ko(`rejeu de l'archivage en erreur (HTTP ${r.status})`);
} catch (e) {
  console.log('⚠️  Test impossible : ' + (e.message || e));
  process.exit(2);
}

console.log(echecs.length ? `\n❌ ${echecs.length} échec(s).` : '\n✅ Contrats LLD en table : enregistrement, contrôles, isolation et archivage conformes.');
process.exit(echecs.length ? 1 : 0);
