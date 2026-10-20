#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Test des AFFECTATIONS en table (fp_affectations_remplacer) — STAGING uniquement
// ============================================================================
//  Avec les deux comptes de test (TEST-A, TEST-B), exactement comme le fait l'application :
//    1) REMPLACER les périodes d'un véhicule : ordre, dates, km, indicateurs et champs inconnus
//       conservés ; rejouer ne crée aucun doublon ;
//    2) une date illisible est REFUSÉE et ne détruit rien ;
//    3) ISOLATION : TEST-B ne peut ni effacer ni créer des périodes chez TEST-A, ni les lire ;
//    4) un visiteur NON CONNECTÉ ne peut ni appeler la fonction ni lire la table.
//  Véhicule de test « T-RPC-… », supprimé à la fin. ⚠️ Refuse de tourner contre la production.
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
const remplacer = (req, societe, veh, periodes) => req('POST', 'rpc/fp_affectations_remplacer', { p_societe: societe, p_veh_id: veh, p_periodes: periodes });
const lire = async (req, societe, veh) => {
  const r = await req('GET', `vehicle_assignments?select=ordre,conducteur,debut,fin,km_debut,km_fin,km_debut_manuel,km_fin_manuel,debut_manuel,extra&societe=eq.${encodeURIComponent(societe)}&veh_id=eq.${encodeURIComponent(veh)}&deleted_at=is.null&order=ordre`);
  return Array.isArray(r.data) ? r.data : null;
};

const VEH = 'T-RPC-' + Date.now().toString(36);
const P1 = { conducteur: 'Alice Test', debut: '2025-01-15', fin: '2026-05-31', kmDebut: 0, kmFin: 20000, kmFinManuel: true };
const P2 = { conducteur: 'Bruno Test', debut: '2026-06-01', fin: null, kmDebut: 20000, kmFin: null, debutManuel: true, note: 'champ libre' };

try {
  const ja = await connexion(A), jb = await connexion(B);
  const reqA = api(ja), reqB = api(jb), anon = api(null);

  console.log('\n1) Remplacer les périodes d\'un véhicule (compte A)');
  let r = await remplacer(reqA, 'TEST-A', VEH, [P1, P2]);
  if (!r.ok) ko(`appel refusé (HTTP ${r.status}) : ${JSON.stringify(r.data)}`);
  let l = await lire(reqA, 'TEST-A', VEH);
  const attendu = l && l.length === 2 && l[0].conducteur === 'Alice Test' && l[1].conducteur === 'Bruno Test'
    && l[0].km_debut === 0 && l[0].km_fin === 20000 && l[0].km_fin_manuel === true && l[0].fin === '2026-05-31'
    && l[1].fin === null && l[1].debut_manuel === true && l[1].extra && l[1].extra.note === 'champ libre';
  if (attendu) ok('2 périodes dans l\'ordre, km (0 compris), indicateurs et champ libre conservés'); else ko(`contenu inattendu : ${JSON.stringify(l)}`);
  await remplacer(reqA, 'TEST-A', VEH, [P1, P2]);
  l = await lire(reqA, 'TEST-A', VEH);
  if (l && l.length === 2) ok('rejoué : toujours 2 périodes (aucun doublon)'); else ko(`doublons après rejeu : ${l && l.length}`);
  await remplacer(reqA, 'TEST-A', VEH, [P2]);
  l = await lire(reqA, 'TEST-A', VEH);
  if (l && l.length === 1 && l[0].conducteur === 'Bruno Test' && l[0].ordre === 1) ok('suppression d\'une période : il en reste 1, renumérotée'); else ko(`attendu 1 période, lu : ${JSON.stringify(l)}`);

  console.log('\n2) Donnée invalide');
  r = await remplacer(reqA, 'TEST-A', VEH, [{ conducteur: 'X', debut: '20/10/2026' }]);
  l = await lire(reqA, 'TEST-A', VEH);
  if (!r.ok && l && l.length === 1 && l[0].conducteur === 'Bruno Test') ok('date illisible refusée, rien d\'effacé'); else ko(`date illisible acceptée ou données perdues (HTTP ${r.status}, ${JSON.stringify(l)})`);

  console.log('\n3) Isolation : le compte B tente de toucher aux affectations de TEST-A');
  r = await remplacer(reqB, 'TEST-A', VEH, []);
  l = await lire(reqA, 'TEST-A', VEH);
  if (l && l.length === 1) ok('effacement par B sans effet'); else ko('B a pu effacer les périodes de A');
  r = await remplacer(reqB, 'TEST-A', VEH + '-intrus', [P1]);
  l = await lire(reqA, 'TEST-A', VEH + '-intrus');
  if (!r.ok && l && l.length === 0) ok('création au nom de TEST-A refusée'); else ko(`B a pu créer une période chez A (HTTP ${r.status})`);
  l = await lire(reqB, 'TEST-A', VEH);
  if (l && l.length === 0) ok('lecture des périodes de A par B : rien de visible'); else ko('B voit les périodes de A');

  console.log('\n4) Visiteur non connecté');
  r = await remplacer(anon, 'TEST-A', VEH, []);
  l = await lire(reqA, 'TEST-A', VEH);
  if (!r.ok && l && l.length === 1) ok(`appel refusé (HTTP ${r.status})`); else ko(`un visiteur non connecté a pu appeler la fonction (HTTP ${r.status})`);
  r = await anon('GET', 'vehicle_assignments?select=id&limit=1');
  if (!r.ok || (Array.isArray(r.data) && r.data.length === 0)) ok('lecture de la table refusée'); else ko('un visiteur non connecté lit la table');

  await remplacer(reqA, 'TEST-A', VEH, []);
  l = await lire(reqA, 'TEST-A', VEH);
  if (l && l.length === 0) ok('nettoyage : véhicule de test supprimé'); else ko('nettoyage incomplet');
} catch (e) {
  console.log('⚠️  Test impossible : ' + (e.message || e));
  process.exit(2);
}

console.log(echecs.length ? `\n❌ ${echecs.length} échec(s).` : '\n✅ Affectations en table : remplacement, contrôles et isolation conformes.');
process.exit(echecs.length ? 1 : 0);
