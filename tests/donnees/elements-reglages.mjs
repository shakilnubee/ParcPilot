#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Test des ÉLÉMENTS DE RÉGLAGES en table générique (fp_element_enregistrer / _archiver) — STAGING uniquement
// ============================================================================
//  Avec les deux comptes de test (TEST-A, TEST-B), exactement comme le fait l'application :
//    1) ENREGISTRER une prime, un assureur, une plaque ignorée, une tâche, un rappel coché, un suivi de sinistre et un dossier : valeur complète conservée, clé gardée
//       telle quelle ; rejouer = aucun doublon ; modifier = la même ligne est mise à jour ;
//    2) collection hors liste, ou valeur manquante : REFUSÉ, rien de modifié ;
//    3) ISOLATION : TEST-B ne peut ni archiver, ni modifier, ni créer, ni lire les éléments de TEST-A ;
//    4) un visiteur NON CONNECTÉ ne peut ni appeler les fonctions ni lire la table ;
//    5) ARCHIVER : l'élément disparaît de la liste active (rejeu sans effet).
//  Éléments de test (clé « TT-… »), archivés à la fin. ⚠️ Refuse de tourner contre la production.
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
const enregistrer = (req, societe, col, cle, valeur, ordre) => req('POST', 'rpc/fp_element_enregistrer', { p_societe: societe, p_collection: col, p_cle: cle, p_valeur: valeur, p_ordre: ordre || 0 });
const archiver = (req, societe, col, cle) => req('POST', 'rpc/fp_element_archiver', { p_societe: societe, p_collection: col, p_cle: cle });
const lire = async (req, societe, col, cle) => {
  const r = await req('GET', `settings_items?select=collection,cle,valeur,ordre&societe=eq.${encodeURIComponent(societe)}&collection=eq.${encodeURIComponent(col)}&cle=eq.${encodeURIComponent(cle)}&deleted_at=is.null`);
  return Array.isArray(r.data) ? r.data : null;
};

const CLE = 'TT-' + Date.now().toString(36).toUpperCase().slice(-3) + '-ZZ';
const PRIME = { ht: 400, ttc: 480, assureur: 'a-test', note: null };
const ASSUREUR = { id: CLE, nom: 'Assureur test', docs: [{ url: 'https://exemple.invalid/a.pdf', name: 'Contrat' }] };

try {
  const ja = await connexion(A), jb = await connexion(B);
  const reqA = api(ja), reqB = api(jb), anon = api(null);

  console.log('\n1) Enregistrer (compte A)');
  let r = await enregistrer(reqA, 'TEST-A', 'assurancePrimes', CLE, PRIME, 0);
  if (!r.ok) ko(`appel refusé (HTTP ${r.status}) : ${JSON.stringify(r.data)}`);
  let l = await lire(reqA, 'TEST-A', 'assurancePrimes', CLE);
  if (l && l.length === 1 && l[0].valeur.ttc === 480 && 'note' in l[0].valeur && l[0].cle === CLE) ok('prime : valeur complète conservée, clé gardée telle quelle'); else ko(`contenu inattendu : ${JSON.stringify(l)}`);
  await enregistrer(reqA, 'TEST-A', 'assurancePrimes', CLE, PRIME, 0);
  l = await lire(reqA, 'TEST-A', 'assurancePrimes', CLE);
  if (l && l.length === 1) ok('rejoué : toujours 1 élément (aucun doublon)'); else ko(`doublons après rejeu : ${l && l.length}`);
  await enregistrer(reqA, 'TEST-A', 'assurancePrimes', CLE, { ...PRIME, ttc: 500 }, 0);
  l = await lire(reqA, 'TEST-A', 'assurancePrimes', CLE);
  if (l && l.length === 1 && l[0].valeur.ttc === 500) ok('modification : même ligne mise à jour'); else ko(`modification inattendue : ${JSON.stringify(l)}`);
  await enregistrer(reqA, 'TEST-A', 'assureurs', CLE, ASSUREUR, 2);
  l = await lire(reqA, 'TEST-A', 'assureurs', CLE);
  if (l && l.length === 1 && l[0].ordre === 2 && l[0].valeur.docs.length === 1) ok('assureur : contenu et position conservés'); else ko(`assureur inattendu : ${JSON.stringify(l)}`);
  await enregistrer(reqA, 'TEST-A', 'assuranceIgnore', CLE, true, 0);
  l = await lire(reqA, 'TEST-A', 'assuranceIgnore', CLE);
  if (l && l.length === 1 && l[0].valeur === true) ok('plaque ignorée enregistrée'); else ko(`plaque ignorée inattendue : ${JSON.stringify(l)}`);

  const TACHE = { id: CLE, titre: 'Tâche de test', echeance: '2026-11-01', vehId: 'V-TEST', fait: false };
  await enregistrer(reqA, 'TEST-A', 'taches', CLE, TACHE, 0);
  l = await lire(reqA, 'TEST-A', 'taches', CLE);
  if (l && l.length === 1 && l[0].valeur.titre === 'Tâche de test' && l[0].valeur.fait === false) ok('tâche : contenu conservé (valeur « faux » comprise)'); else ko(`tâche inattendue : ${JSON.stringify(l)}`);
  await enregistrer(reqA, 'TEST-A', 'rappelsFaits', CLE, { '2026-10': '2026-10-20' }, 0);
  l = await lire(reqA, 'TEST-A', 'rappelsFaits', CLE);
  if (l && l.length === 1 && l[0].valeur['2026-10'] === '2026-10-20') ok('rappel coché : valeur imbriquée conservée'); else ko(`rappel coché inattendu : ${JSON.stringify(l)}`);

  await enregistrer(reqA, 'TEST-A', 'sinistreAssurance', CLE, { dateCloture: '2026-09-17', franchise: 300, rembourse: false }, 0);
  l = await lire(reqA, 'TEST-A', 'sinistreAssurance', CLE);
  if (l && l.length === 1 && l[0].valeur.franchise === 300 && l[0].valeur.rembourse === false) ok('suivi d\'assurance d\'un sinistre : contenu conservé'); else ko(`sinistre inattendu : ${JSON.stringify(l)}`);
  await enregistrer(reqA, 'TEST-A', 'sinistreDossiers', CLE, true, 7);
  l = await lire(reqA, 'TEST-A', 'sinistreDossiers', CLE);
  if (l && l.length === 1 && l[0].ordre === 7) ok('dossier de sinistre : position conservée'); else ko(`dossier inattendu : ${JSON.stringify(l)}`);

  console.log('\n2) Données refusées');
  r = await enregistrer(reqA, 'TEST-A', 'collectionInconnue', CLE, { x: 1 }, 0);
  l = await lire(reqA, 'TEST-A', 'collectionInconnue', CLE);
  if (!r.ok && l && l.length === 0) ok('collection hors liste refusée'); else ko(`collection hors liste acceptée (HTTP ${r.status})`);
  r = await reqA('POST', 'rpc/fp_element_enregistrer', { p_societe: 'TEST-A', p_collection: 'assurancePrimes', p_cle: CLE, p_valeur: null, p_ordre: 0 });
  l = await lire(reqA, 'TEST-A', 'assurancePrimes', CLE);
  if (!r.ok && l && l.length === 1 && l[0].valeur.ttc === 500) ok('valeur manquante refusée, rien de modifié'); else ko(`valeur manquante acceptée (HTTP ${r.status}, ${JSON.stringify(l)})`);

  console.log('\n3) Isolation : le compte B tente de toucher aux éléments de TEST-A');
  await archiver(reqB, 'TEST-A', 'assurancePrimes', CLE);
  l = await lire(reqA, 'TEST-A', 'assurancePrimes', CLE);
  if (l && l.length === 1) ok('archivage par B sans effet'); else ko('B a pu archiver un élément de A');
  await enregistrer(reqB, 'TEST-A', 'assurancePrimes', CLE, { ttc: 1 }, 0);
  l = await lire(reqA, 'TEST-A', 'assurancePrimes', CLE);
  if (l && l.length === 1 && l[0].valeur.ttc === 500) ok('modification par B sans effet'); else ko('B a pu modifier un élément de A');
  r = await enregistrer(reqB, 'TEST-A', 'assurancePrimes', CLE + 'X', PRIME, 0);
  l = await lire(reqA, 'TEST-A', 'assurancePrimes', CLE + 'X');
  if (!r.ok && l && l.length === 0) ok('création au nom de TEST-A refusée'); else ko(`B a pu créer un élément chez A (HTTP ${r.status})`);
  l = await lire(reqB, 'TEST-A', 'assurancePrimes', CLE);
  if (l && l.length === 0) ok('lecture des éléments de A par B : rien de visible'); else ko('B voit les éléments de A');

  console.log('\n4) Visiteur non connecté');
  r = await archiver(anon, 'TEST-A', 'assurancePrimes', CLE);
  l = await lire(reqA, 'TEST-A', 'assurancePrimes', CLE);
  if (!r.ok && l && l.length === 1) ok(`appel refusé (HTTP ${r.status})`); else ko(`un visiteur non connecté a pu appeler la fonction (HTTP ${r.status})`);
  r = await anon('GET', 'settings_items?select=id&limit=1');
  if (!r.ok || (Array.isArray(r.data) && r.data.length === 0)) ok('lecture de la table refusée'); else ko('un visiteur non connecté lit la table');

  console.log('\n5) Archivage (compte A)');
  let toutOk = true;
  for (const col of ['assurancePrimes', 'assureurs', 'assuranceIgnore', 'taches', 'rappelsFaits', 'sinistreAssurance', 'sinistreDossiers']) {
    r = await archiver(reqA, 'TEST-A', col, CLE);
    l = await lire(reqA, 'TEST-A', col, CLE);
    if (!(r.ok && l && l.length === 0)) toutOk = false;
  }
  if (toutOk) ok('éléments archivés : plus dans la liste active'); else ko('archivage incomplet');
  r = await archiver(reqA, 'TEST-A', 'assurancePrimes', CLE);
  if (r.ok) ok('archivage rejoué : sans effet, sans erreur'); else ko(`rejeu de l'archivage en erreur (HTTP ${r.status})`);
} catch (e) {
  console.log('⚠️  Test impossible : ' + (e.message || e));
  process.exit(2);
}

console.log(echecs.length ? `\n❌ ${echecs.length} échec(s).` : '\n✅ Éléments de réglages en table : enregistrement, contrôles, isolation et archivage conformes.');
process.exit(echecs.length ? 1 : 0);
