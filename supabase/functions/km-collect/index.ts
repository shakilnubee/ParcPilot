// ============================================================================
//  Parc Pilot — Collecte du kilométrage par e-mail (fonction PUBLIQUE, protégée par TOKEN)
//
//  Le chauffeur reçoit un e-mail avec un lien personnel (km.html?t=<token>).
//  Cette fonction :
//    • GET  ?t=<token>      → renvoie les infos du véhicule (plaque, modèle, km connu)
//                             si le token est valide, non expiré, pas déjà utilisé.
//    • POST { t, km }       → enregistre le km : met à jour vehicules.km (si supérieur),
//                             marque la demande comme utilisée (km_recu + used_at).
//
//  ⚠️ Cette fonction est VOLONTAIREMENT publique (le chauffeur n'a pas de compte).
//     La sécurité = le TOKEN secret non devinable (une demande = un token à usage unique).
//     verify_jwt est désactivé pour cette fonction (voir supabase/config.toml).
//
//  Déploiement : automatique (GitHub Action deploy-edge-functions.yml au push sur main).
//    SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont injectés automatiquement.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    // no-store : la réponse contient des URLs SIGNÉES qui expirent → jamais de cache navigateur
    // (sinon un lien signé périmé donne une « erreur » au clic sur un document / la notice).
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function admin() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Charge une demande valide (token existant, non expiré). `used_at` non-null = déjà répondu.
async function loadReq(db: ReturnType<typeof createClient>, token: string) {
  const { data, error } = await db.from("km_requests").select("*").eq("token", token).maybeSingle();
  if (error) throw error;
  if (!data) return { err: "Lien invalide ou expiré." };
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return { err: "Ce lien a expiré. Demande un nouveau lien à ton gestionnaire de flotte." };
  }
  return { req: data };
}

// Charge un QR PERMANENT (collé dans le véhicule) : token → véhicule. Réutilisable (pas d'expiration).
async function loadQr(db: ReturnType<typeof createClient>, token: string) {
  const { data, error } = await db.from("km_qr").select("*").eq("token", token).maybeSingle();
  if (error) throw error;
  if (!data) return { err: "QR invalide. Demande à ton gestionnaire de flotte d'imprimer le bon QR." };
  // ⚠️ Véhicule SORTI de la flotte (vendu, cédé, hors service, restitué…) → QR DÉSACTIVÉ (aucun accès :
  // ni infos, ni relevé km, ni déclaration). « à vendre » reste ACTIF (l'onglet Vente sert à la revente).
  try {
    if (data.vehicule_id) {
      const { data: v } = await db.from("vehicules").select("statut").eq("id", data.vehicule_id).maybeSingle();
      const s = String((v && v.statut) || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
      const SORTI = ["vendu", "vendue", "cede", "cedee", "hors service", "hors-service", "hs", "archive", "archivee", "restitue", "restituee", "detruit", "detruite", "epave"];
      if (SORTI.indexOf(s) !== -1) return { err: "Ce véhicule n'est plus dans la flotte : ce QR a été désactivé." };
    }
  } catch { /* en cas de doute, on n'empêche pas l'accès */ }
  return { qr: data };
}

// km actuel connu d'un véhicule (colonne vehicules.km).
async function vehKm(db: ReturnType<typeof createClient>, vehiculeId: string | null) {
  if (!vehiculeId) return null;
  const { data: v } = await db.from("vehicules").select("km").eq("id", vehiculeId).maybeSingle();
  return v && v.km != null ? Number(v.km) : null;
}

// Date (AAAA-MM-JJ) du DERNIER relevé RÉELLEMENT reçu pour ce véhicule (mail ou QR, used_at non-null).
// Les anciens km connus (avant cette fonctionnalité) n'ont pas de relevé daté → renvoie null : la date
// n'apparaît donc qu'à partir du PROCHAIN relevé (demande explicite de l'utilisateur).
async function dernierReleveDate(db: ReturnType<typeof createClient>, vehiculeId: string | null) {
  if (!vehiculeId) return null;
  try {
    const { data } = await db.from("km_requests")
      .select("used_at")
      .eq("vehicule_id", vehiculeId)
      .not("used_at", "is", null)
      .order("used_at", { ascending: false })
      .limit(1);
    const r = Array.isArray(data) && data[0];
    return (r && r.used_at) ? String(r.used_at).slice(0, 10) : null;
  } catch { return null; }
}

// ---- PORTAIL CONDUCTEUR : données non personnelles d'un véhicule, servies à la page v.html ----
// Infos véhicule sûres (jamais de PII : pas de chauffeur, pas de VIN).
async function vehInfo(db: ReturnType<typeof createClient>, vehiculeId: string | null) {
  if (!vehiculeId) return null;
  const { data: v } = await db.from("vehicules")
    .select("marque,modele,carburant,co2,km,prochain_ct,date_mise_en_circulation,cg_url,cg_file_id,chauffeur,statut,couleur,boite,derniere_revision,km_dernier_releve")
    .eq("id", vehiculeId).maybeSingle();
  return v || null;
}

// Prochaine révision (date + km) — MÊME logique que FP.revisionInfo (app.js) pour un affichage cohérent :
//  • km : km de la dernière révision + intervalle si connu ; sinon prochain palier d'odomètre.
//  • date : dernière révision (ou mise en circulation à défaut) + intervalle en mois, avancée jusqu'à
//    une date FUTURE si aucune révision n'est encore enregistrée. Renvoie { date, km } (valeurs ou null).
function prochaineRevision(v: Record<string, unknown>, revKm: number, revMois: number, alerteKm: number, alerteJours: number) {
  const km = v.km != null ? Number(v.km) : 0;
  const today = new Date();
  const dRevStr = String(v.derniere_revision || "");
  const hasRev = !!(dRevStr && dRevStr !== "—" && !isNaN(new Date(dRevStr).getTime()));
  const mecStr = String(v.date_mise_en_circulation || "");
  const mec = mecStr && !isNaN(new Date(mecStr).getTime()) ? new Date(mecStr) : null;
  const kmRev = Number(v.km_dernier_releve) > 0 ? Number(v.km_dernier_releve) : null;
  let date: string | null = null;
  let joursRestant: number | null = null;
  const anchor = hasRev ? new Date(dRevStr) : mec;
  if (anchor && !isNaN(anchor.getTime())) {
    const d = new Date(anchor); d.setMonth(d.getMonth() + revMois);
    if (!hasRev) { let g = 0; while (d < today && g++ < 600) d.setMonth(d.getMonth() + revMois); }
    date = d.toISOString().slice(0, 10);
    joursRestant = Math.ceil((d.getTime() - today.getTime()) / 86400000);
  }
  let kmDue: number | null = null;
  let kmRestant: number | null = null;
  if (kmRev) { kmDue = kmRev + revKm; kmRestant = kmDue - km; }
  // PREMIÈRE révision jamais faite → cible FIXE = 1 intervalle (ex. 15 000 km), jamais un multiple
  // d'odomètre : un véhicule à 20 765 km sans révision enregistrée est EN RETARD sur sa 1ʳᵉ révision
  // (kmRestant négatif = rouge), au lieu d'afficher « 30 000 km ». MÊME logique que FP.revisionInfo (app.js).
  else if (!hasRev) { kmDue = revKm; kmRestant = kmDue - km; }
  else { kmDue = Math.ceil(km / revKm) * revKm; if (kmDue <= km) kmDue = km + revKm; kmRestant = kmDue - km; }
  // Niveau d'alerte — MÊME règle que FP.revisionInfo : dépassé = danger (rouge), proche = warn (orange).
  const lvlKm = kmRestant === null ? null : (kmRestant <= 0 ? "danger" : (kmRestant <= alerteKm ? "warn" : null));
  const lvlDt = joursRestant === null ? null : (joursRestant <= 0 ? "danger" : (joursRestant <= alerteJours ? "warn" : null));
  let niveau: string | null = null;
  if (lvlKm === "danger" || lvlDt === "danger") niveau = "danger";
  else if (lvlKm === "warn" || lvlDt === "warn") niveau = "warn";
  return { date, km: kmDue, niveau };
}

// Signe une URL Supabase Storage (bucket privé) pour qu'elle soit ouvrable depuis la page publique.
// Les URLs non-Storage (déjà publiques) sont renvoyées telles quelles.
async function signUrl(db: ReturnType<typeof createClient>, url: string) {
  const u = String(url || "");
  const m = u.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?]+)/);
  if (!m) return url;
  let path = m[2]; try { path = decodeURIComponent(path); } catch { /* garde */ }
  try {
    const { data } = await db.storage.from(m[1]).createSignedUrl(path, 86400); // 24 h : marge si la page reste ouverte
    return (data && data.signedUrl) ? data.signedUrl : url;
  } catch { return url; }
}

// Conducteur (prénom / nom / poste) rattaché au véhicule, retrouvé par le nom « chauffeur » du véhicule.
function _norm(s: string) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, ""); }
async function vehConducteur(db: ReturnType<typeof createClient>, chauffeur: string, societe: string) {
  const name = String(chauffeur || "").trim();
  if (!name || name === "—") return null;
  const rows = ((await db.from("conducteurs").select("prenom,nom,poste,name,key,tel").eq("societe", societe || "PXP")).data || []) as Record<string, unknown>[];
  const key = _norm(name);
  // 1) Correspondance sur le NOM COMPLET (prénom+nom OU champ `name`).
  let hit = rows.find((c) => _norm(String(c.prenom || "") + String(c.nom || "")) === key || _norm(String(c.name || "")) === key);
  // 2) Repli : le champ `chauffeur` du véhicule est SOUVENT juste le PRÉNOM (ex. « Shakil ») alors que la
  //    fiche conducteur porte le nom complet (« Shakil Nubeebaccus ») → l'égalité stricte échouait et le
  //    poste n'apparaissait pas. On retrouve alors le conducteur par son prénom (1er mot du chauffeur).
  if (!hit) {
    const first = _norm((name.split(/\s+/)[0]) || name);
    if (first) {
      hit = rows.find((c) => _norm(String(c.prenom || "")) === first)
         || rows.find((c) => { const f = _norm(String(c.prenom || "") + String(c.nom || "")) || _norm(String(c.name || "")); return !!f && f.indexOf(first) === 0; });
    }
  }
  if (!hit) return { prenom: name.split(" ")[0] || name, nom: name.split(" ").slice(1).join(" "), poste: "", name, key: "" };
  // Un conducteur peut n'avoir que `name` (prénom/nom vides) → on dérive prénom/nom du nom complet,
  // sinon le portail n'affichait AUCUN nom (bandeau conducteur absent).
  let prenom = String(hit.prenom || ""), nom = String(hit.nom || "");
  const full = String(hit.name || "").trim();
  if (!prenom && !nom && full) { const parts = full.split(/\s+/); prenom = parts[0] || ""; nom = parts.slice(1).join(" "); }
  return { prenom, nom, poste: String(hit.poste || ""), name: full || (prenom + " " + nom).trim(), key: String(hit.key || ""), tel: String(hit.tel || "") };
}

// ⚠️ Masses en service (champ G, kg) lues sur les cartes grises de la flotte — MÊME source que
// `FP.MASSE_CG` dans assets/js/app.js (la fiche véhicule). Sert au badge « stationnement Paris » du
// portail pour qu'il affiche EXACTEMENT le même verdict que la fiche. ⚠️ À garder en phase avec app.js.
const MASSE_CG: Record<string, number> = {
  "GC-885-LB": 2395, "GT-565-XR": 1885, "GD-056-CR": 2040, "GE-349-FZ": 2040, "HG-763-VP": 1825,
  "GR-745-LR": 1012, "FF-304-GL": 2215, "FF-777-XK": 2139, "GP-795-YL": 1505, "GW-075-EZ": 1505,
  "GW-087-EZ": 1505, "GW-173-JV": 1505, "FJ-607-QH": 1505, "FZ-301-YZ": 1505, "GY-860-FG": 1815,
  "GP-333-QJ": 1505, "HH-464-LQ": 2015, "GT-818-LC": 1710, "HB-844-DE": 2015, "HB-733-DE": 2015,
  "GA-313-PK": 2990, "FR-141-MP": 1760, "GA-333-PZ": 1639, "FS-224-PB": 1390, "FZ-501-YZ": 1416,
  "HH-458-LQ": 2015, "GR-585-HP": 1358, "GR-302-HP": 1358, "HF-477-XW": 1650, "HJ-804-VM": 2117,
  "GH-994-AR": 1395, "ET-095-LV": 1621, "ED-160-TZ": 1758, "FT-338-AJ": 1395, "GE-948-WY": 1446,
  "GR-019-ZG": 1358, "GR-467-HP": 1358, "HE-739-WP": 1505, "GP-232-WF": 1505, "HJ-285-FL": 1625,
  "HJ-181-RN": 1782, "HG-709-CH": 2015, "HF-749-VD": 1265, "HH-613-KE": 2015, "GM-548-QA": 1395,
};

// Amendes DU CONDUCTEUR (pour le portail « Mes amendes ») : montant + n° d'avis + date + motif,
// SANS PDF ni pièce jointe. Rattachées par le prénom/nom du conducteur (normalisé). Le montant renvoyé
// est le montant DÛ (majoré si l'amende est marquée majorée, sinon le montant courant).
async function vehAmendes(db: ReturnType<typeof createClient>, societe: string, conducteur: Record<string, unknown> | null) {
  if (!conducteur) return [];
  const soc = societe || "PXP";
  const { data } = await db.from("amendes").select("*").eq("societe", soc);
  if (!Array.isArray(data)) return [];
  // ⚠️ CONFIDENTIALITÉ (PII) — on ne rattache une amende à CE conducteur que si le lien est CERTAIN :
  //   • correspondance COMPLÈTE prénom + nom (ou name) → sûr, même si un homonyme de prénom existe ;
  //   • correspondance sur le PRÉNOM SEUL → uniquement si ce prénom est UNIQUE dans la société (sinon on
  //     ne peut pas trancher entre deux personnes du même prénom → on n'affiche RIEN plutôt que de fuiter).
  const firstOf = (s: string) => _norm(String(s || "").split(/\s+/)[0]);
  const fullKey = _norm(String(conducteur.prenom || "") + String(conducteur.nom || ""));
  const nameKey = _norm(String(conducteur.name || ""));
  const firstKey = firstOf(String(conducteur.prenom || conducteur.name || ""));
  const hasNom = !!_norm(String(conducteur.nom || "")) || (!!nameKey && nameKey !== firstKey);
  // Prénoms partagés par ≥ 2 conducteurs de la société → un prénom seul ne suffit pas à identifier.
  const { data: conds } = await db.from("conducteurs").select("prenom,nom,name").eq("societe", soc);
  const firstCount: Record<string, number> = {};
  for (const c of ((conds || []) as Record<string, unknown>[])) {
    const f = firstOf(String(c.prenom || c.name || ""));
    if (f) firstCount[f] = (firstCount[f] || 0) + 1;
  }
  const firstShared = (firstCount[firstKey] || 0) > 1;
  const out: Array<Record<string, unknown>> = [];
  for (const a of data as Array<Record<string, unknown>>) {
    const ap = _norm(String(a.prenom || ""));
    if (!ap) continue;
    let mine = false;
    if (hasNom && ((fullKey && ap === fullKey) || (nameKey && ap === nameKey))) mine = true; // prénom + nom = certain
    else if (firstKey && ap === firstKey) mine = !firstShared;                               // prénom seul → seulement si unique
    if (!mine) continue;
    const majoree = a.majoree === true || a.majoree === "true";
    const montant = (majoree && a.montant_majore != null && a.montant_majore !== "") ? Number(a.montant_majore) : (Number(a.montant) || 0);
    const pts = Number(a.points);
    out.push({ numeroAvis: String(a.numero_avis || ""), montant: isFinite(montant) ? montant : 0, date: String(a.date || ""), motif: String(a.motif || ""), statut: String(a.statut || ""), points: (isFinite(pts) && pts > 0) ? Math.round(pts) : 0 });
  }
  // Tri : amendes NON PAYÉES d'abord, puis le reste — et dans chaque groupe, de la + récente à la + ancienne.
  // « payée » (statut normalisé commençant par « pay ») = payée ; « à payer » → « apayer » (n'y matche pas).
  const isPaid = (s: unknown) => /^pay/.test(_norm(String(s || "")));
  out.sort((x, y) => {
    const px = isPaid(x.statut) ? 1 : 0, py = isPaid(y.statut) ? 1 : 0;
    if (px !== py) return px - py;
    return String(y.date).localeCompare(String(x.date));
  });
  return out;
}

// Podium des amendes (portail « Mes amendes ») : TOP 5 des conducteurs par NOMBRE d'amendes,
// du PLUS au MOINS (le n°1 = celui qui a le plus d'amendes). ⚠️ CONFIDENTIALITÉ : on n'expose QUE le
// PRÉNOM (jamais le nom complet, ni le montant, ni les points) — juste l'ordre du classement.
async function amendesPodium(db: ReturnType<typeof createClient>, societe: string) {
  try {
    const soc = societe || "PXP";
    const _norm = (s: string) => String(s || "").trim();
    const counts: Record<string, number> = {};
    // Comptage des amendes par prénom (1er mot). On ne liste QUE les conducteurs ayant au moins 1 amende.
    const { data: ams } = await db.from("amendes").select("prenom").eq("societe", soc);
    for (const a of ((ams || []) as Record<string, unknown>[])) {
      const p = _norm(String(a.prenom || "")).split(/\s+/)[0];
      if (!p) continue;
      counts[p] = (counts[p] || 0) + 1;
    }
    const arr = Object.keys(counts).map((prenom) => ({ prenom, n: counts[prenom] }));
    arr.sort((x, y) => y.n - x.n || x.prenom.localeCompare(y.prenom, "fr")); // le PLUS d'amendes en tête
    const top = arr.slice(0, 5); // TOP 5 (comme le tableau de bord)
    // Prénom + rang dense (même nombre d'amendes = même rang). Le compte n'est PAS exposé.
    let rank = 0, prevN = -1;
    return top.map((x, i) => { if (x.n !== prevN) { rank = i + 1; prevN = x.n; } return { prenom: x.prenom, rang: rank }; });
  } catch { return []; }
}

// Conducteur ACTUEL du véhicule : le champ `chauffeur` du véhicule, sinon l'affectation EN COURS
// (settings.affectations[vehId] = [{conducteur, debut, fin}]) — sinon un véhicule affecté via
// l'historique mais sans champ chauffeur n'affichait pas de nom sur le portail.
async function chauffeurActuel(db: ReturnType<typeof createClient>, vehiculeId: string | null, societe: string, vehChauffeur: string) {
  const direct = String(vehChauffeur || "").trim();
  if (direct && direct !== "—") return direct;
  if (!vehiculeId) return "";
  try {
    const { data } = await db.from("app_settings").select("data").eq("id", societe || "PXP").maybeSingle();
    const s = (data && data.data && typeof data.data === "object") ? data.data as Record<string, unknown> : {};
    const affAll = (s.affectations && typeof s.affectations === "object") ? s.affectations as Record<string, unknown> : {};
    const aff = affAll[vehiculeId];
    if (!Array.isArray(aff) || !aff.length) return "";
    const withNom = (aff as Record<string, unknown>[]).filter((a) => a && a.conducteur);
    const encours = withNom.filter((a) => !a.fin);
    const pick = (encours.length ? encours : withNom)
      .sort((a, b) => String(b.debut || "").localeCompare(String(a.debut || "")))[0];
    return pick ? String(pick.conducteur || "").trim() : "";
  } catch { return ""; }
}

// Langue d'un conducteur (par son nom + société) via la carte app_settings.condLangues. 'fr' par défaut.
async function condLangueDe(db: ReturnType<typeof createClient>, societe: string, chauffeur: string) {
  const name = String(chauffeur || "").trim();
  if (!name || name === "—") return "fr";
  const soc = societe || "PXP";
  const [{ data: st }, { data: cs }] = await Promise.all([
    db.from("app_settings").select("data").eq("id", soc).maybeSingle(),
    db.from("conducteurs").select("key,prenom,nom,name").eq("societe", soc),
  ]);
  const map = (st && st.data && (st.data as Record<string, unknown>).condLangues && typeof (st.data as Record<string, unknown>).condLangues === "object")
    ? (st.data as Record<string, Record<string, unknown>>).condLangues : {};
  const key = _norm(name);
  const hit = (cs || []).find((c: Record<string, unknown>) => _norm(String(c.prenom || "") + String(c.nom || "")) === key || _norm(String(c.name || "")) === key);
  const ck = hit && (hit as Record<string, unknown>).key;
  const lv = ck ? String((map as Record<string, unknown>)[ck as string] || "").toLowerCase() : "";
  return (lv === "en" || lv === "english" || lv === "anglais") ? "en" : "fr";
}

// Documents consultables du véhicule (carte grise + mémo + autres), depuis la table `documents`
// et le champ carte grise du véhicule. On ne renvoie que { label, url }.
async function vehDocs(db: ReturnType<typeof createClient>, vehiculeId: string | null, veh: Record<string, unknown> | null) {
  const out: { label: string; url: string; type: string }[] = [];
  const seen = new Set<string>();
  // ⚠️ RÈGLE : plus jamais de Google Drive — on n'expose QUE des documents hébergés sur la
  //    plateforme (Supabase Storage). Tout lien Drive est ignoré (à réimporter sur le site).
  const isDrive = (u: string) => /drive\.google|docs\.google/i.test(u);
  const push = (label: string, url: string, type: string) => {
    const u = String(url || "").trim();
    if (!u || seen.has(u) || isDrive(u)) return;
    seen.add(u); out.push({ label: label || "Document", url: u, type: type || "autre" });
  };
  // Carte grise portée par le véhicule (champ direct, hébergé plateforme). cg_file_id (Drive) ignoré.
  if (veh && veh.cg_url) push("Carte grise", String(veh.cg_url), "carte-grise");
  if (!vehiculeId) return out;
  // ⚠️ Le conducteur ne voit QUE la carte grise et la carte mémo (pas de PV, contrat, facture,
  //    code de cession, « autre »… — docs internes réservés au gestionnaire).
  const ALLOWED_PORTAL = new Set(["carte-grise", "memo"]);
  const { data } = await db.from("documents").select("type,label,url").eq("vehicule_id", vehiculeId);
  for (const d of (data || [])) {
    if (!d || !d.url) continue;
    if (!ALLOWED_PORTAL.has(String(d.type || ""))) continue;
    push(String(d.label || ""), String(d.url), String(d.type || "autre"));
  }
  return out;
}

// Photos « état des lieux » du véhicule. Le SENS est stocké dans `label` ('Entrée'/'Sortie'),
// il n'y a pas de colonne dédiée (même convention que la fiche véhicule).
async function vehEdl(db: ReturnType<typeof createClient>, vehiculeId: string | null) {
  if (!vehiculeId) return [];
  const { data } = await db.from("documents").select("label,url").eq("vehicule_id", vehiculeId).eq("type", "etat-des-lieux");
  return (data || []).filter((d: Record<string, unknown>) => d && d.url)
    .map((d: Record<string, unknown>) => {
      const lbl = String(d.label || "").toLowerCase();
      const sens = lbl.startsWith("sort") ? "restitution" : "prise";
      return { url: String(d.url), sens };
    });
}

// Liste des véhicules « à vendre » de LA MÊME société (rubrique « Véhicules à vendre » du portail QR).
// Isolation : on ne garde que la société du QR scanné (convention societe || "PXP", comme km-relance).
// Chaque item = plaque, marque/modèle, prix, 1re photo (signée) + jeton pour ouvrir son annonce.
async function ventesListe(db: ReturnType<typeof createClient>, socRaw: string | null) {
  const soc = String(socRaw || "PXP");
  const { data: vs } = await db.from("vehicules")
    .select("id,immat,marque,modele,carburant,boite,couleur,km,date_mise_en_circulation,statut,societe")
    .ilike("statut", "%vendre%");   // « à vendre » (et variantes) — exclut « vendu » (pas de « vendre »)
  const list = (Array.isArray(vs) ? vs : []).filter((v: Record<string, unknown>) => String(v.societe || "PXP") === soc);
  const out: Array<Record<string, unknown>> = [];
  for (const v of list) {
    // Toutes les photos (états des lieux, signées) → l'annonce s'affiche EN LIGNE côté portail (avec retour).
    let photos: string[] = [];
    try {
      const edl = await vehEdl(db, v.id as string);
      const imgs = (Array.isArray(edl) ? edl : []).filter((e) => /^data:image\//i.test(e.url) || /\.(jpe?g|png|gif|webp|heic|bmp|avif)(\?|$)/i.test(e.url));
      photos = await Promise.all(imgs.map((e) => signUrl(db, e.url)));
    } catch { /* pas de photo */ }
    out.push({
      plaque: v.immat || "", marque: v.marque || "", modele: v.modele || "",
      carburant: v.carburant || "", boite: v.boite || "", couleur: v.couleur || "",
      km: v.km != null ? Number(v.km) : null,
      dateMiseEnCirculation: v.date_mise_en_circulation || "",
      photos,   // ⚠️ pas de prix ici : réservé à l'app Parc Pilot (jamais exposé côté public)
    });
  }
  return out;
}

// Config PORTAIL par société : lue dans app_settings (id = société). Assureur/police + assistance + notice.
// ⚠️ MULTI-ASSUREURS : si la société a plusieurs assureurs (s.assureurs) et que le véhicule (plaque) est
// rattaché à l'un d'eux (s.assureurVeh), on renvoie l'assureur / n° d'assistance / notice DE CET ASSUREUR
// (même logique que FP.assureurOf / FP.assistanceOf / FP.noticeOf côté client), avec repli sur la config
// globale (assuranceContrat + portail) — pour que le conducteur voie l'assistance de SON véhicule.
async function portalConfig(db: ReturnType<typeof createClient>, societe: string, plaque = "") {
  const soc = societe || "PXP";
  const { data } = await db.from("app_settings").select("data").eq("id", soc).maybeSingle();
  const s = (data && data.data && typeof data.data === "object") ? data.data as Record<string, unknown> : {};
  const p = (s.portail && typeof s.portail === "object") ? s.portail as Record<string, unknown> : {};
  const ass = (s.assuranceContrat && typeof s.assuranceContrat === "object") ? s.assuranceContrat as Record<string, unknown> : {};
  const prof = (s.profil && typeof s.profil === "object") ? s.profil as Record<string, unknown> : {};
  const socObj = (s.societe && typeof s.societe === "object") ? s.societe as Record<string, unknown> : {};
  // Défauts globaux (rétro-compat) — PXP : valeurs historiques (comme FP.assuranceContrat côté client).
  const defAssureur = String(ass.assureur || (soc === "PXP" ? "SWISSLIFE" : "")).trim();
  const defPolice = String(ass.police || (soc === "PXP" ? "011165247/0599" : "")).trim();
  const gAssist = String(p.assistanceNumero || "").trim();
  const gNotice = String(p.assistanceNotice || "").trim();
  // Assureur DU véhicule (rattachement par plaque) → prime sur le défaut global.
  const assureursArr = Array.isArray(s.assureurs)
    ? (s.assureurs as Array<Record<string, unknown>>).filter((a) => a && (a.nom || a.police)) : [];
  const assVehMap = (s.assureurVeh && typeof s.assureurVeh === "object") ? s.assureurVeh as Record<string, unknown> : {};
  let picked: Record<string, unknown> | null = null;
  if (assureursArr.length) {
    const k = _norm(plaque);
    let id: string | null = null;
    for (const key in assVehMap) { if (_norm(key) === k) { id = String(assVehMap[key]); break; } }
    picked = (id ? assureursArr.find((a, i) => String(a.id || ("a" + (i + 1))) === id) || null : null) || assureursArr[0] || null;
  }
  const assureur = (picked && String(picked.nom || "").trim()) || defAssureur;
  const police = (picked && String(picked.police || "").trim()) || defPolice;
  return {
    assureur, police,
    assistanceNumero: (picked && String(picked.assistance || "").trim()) || gAssist,
    assistanceNotice: (picked && String(picked.notice || "").trim()) || gNotice,
    constatUrl: String(p.constatUrl || "").trim(),
    // Téléphone de contact affiché sur l'annonce de vente (QR vente). Réglable dans Paramètres → Société.
    // Défaut PXP historique (même logique que defAssureur/defPolice) ; les autres sociétés partent vide.
    venteTel: String(p.venteTel || (soc === "PXP" ? "0661779753" : "")).trim(),
    reglesTexte: String(p.reglesTexte || "").trim(),
    reglesLien: String(p.reglesLien || "").trim(),
    logo: String(prof.logoDataUrl || "").trim(),          // logo société (data URL) pour l'en-tête du portail
    societeNom: String(socObj.nom || "").trim(),
    // Carte des langues par conducteur (clé conducteur → 'fr'/'en') — sert à afficher le portail
    // dans la langue du conducteur. Consommée côté serveur puis retirée avant l'envoi au client.
    condLangues: (s.condLangues && typeof s.condLangues === "object") ? s.condLangues as Record<string, unknown> : {},
  };
}

// Upload de photos envoyées en base64 (data URL) par le conducteur → bucket public "scans".
// ⚠️ Le cap (20) DOIT rester ALIGNÉ sur EDL_MAX_PHOTOS côté client (v.html) — sinon le serveur
//    jetterait EN SILENCE les photos au-delà (bug vécu : cap serveur 8 qui annulait la hausse client).
// Renvoie AUSSI le nb reçu (`sent`) et le nb réellement enregistré (`saved`) via l'objet retourné,
// pour que le client puisse PRÉVENIR l'utilisateur si des photos n'ont pas pu être enregistrées.
const PHOTO_CAP = 20;
const PHOTO_MAX_BYTES = 12_000_000;   // 12 Mo/fichier (le repli HEIC brut du client peut être lourd)
// ⚠️ CLOISONNEMENT DES FICHIERS PAR SOCIÉTÉ (17/10/2026) : tout fichier va dans
// « societes/<dossier-société>/… ». fpSlug DOIT rester identique à public.fp_slug (SQL) et FP.storageSlug (app.js).
function fpSlug(s: unknown): string { return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "societe"; }
function dossierSociete(societe: unknown): string { return "societes/" + fpSlug(societe || "PXP"); }

async function uploadPhotosDetail(db: ReturnType<typeof createClient>, photos: unknown, folder: string): Promise<{ urls: string[]; sent: number; saved: number; dropped: number }> {
  const urls: string[] = [];
  if (!Array.isArray(photos)) return { urls, sent: 0, saved: 0, dropped: 0 };
  const sent = photos.length;
  let i = 0;
  for (const raw of photos.slice(0, PHOTO_CAP)) {
    const s = String(raw || "");
    const m = s.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) continue;
    const mime = m[1] || "image/jpeg";
    const ext = mime.includes("png") ? "png" : (mime.includes("webp") ? "webp" : (mime.includes("pdf") ? "pdf" : (mime.includes("heic") || mime.includes("heif") ? "heic" : "jpg")));
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)); } catch { continue; }
    if (bytes.length > PHOTO_MAX_BYTES) continue;         // garde-fou taille par fichier
    const path = folder + "/" + Date.now().toString(36) + "-" + (i++) + "-" + Math.round(bytes.length % 99991) + "." + ext;
    const up = await db.storage.from("scans").upload(path, bytes, { contentType: mime, upsert: false });
    if (up.error) continue;
    const pub = db.storage.from("scans").getPublicUrl(path);
    if (pub && pub.data && pub.data.publicUrl) urls.push(pub.data.publicUrl);
  }
  return { urls, sent, saved: urls.length, dropped: Math.max(0, sent - urls.length) };
}

function genId(prefix: string) {
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// ─── NOTIFICATIONS PUSH (Web Push / VAPID) ───────────────────────────────────
// Envoie une notification push à TOUS les appareils abonnés de la société (les
// gestionnaires qui ont activé les notifs), quand un chauffeur soumet quelque chose
// via son QR (relevé km, déclaration, question, état des lieux) — même appli fermée.
//
// ⚠️ La clé PRIVÉE VAPID vit UNIQUEMENT dans les secrets de l'Edge Function
//    (VAPID_PRIVATE_KEY), jamais dans le repo. Best-effort : si les clés ne sont pas
//    configurées ou l'envoi échoue, la soumission du chauffeur réussit quand même.
let _vapidReady: boolean | null = null;
function vapidReady(): boolean {
  if (_vapidReady !== null) return _vapidReady;
  const pub = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const priv = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const subj = Deno.env.get("VAPID_SUBJECT") || "mailto:contact@parc-pilot.fr";
  if (!pub || !priv) { _vapidReady = false; return false; }
  try { webpush.setVapidDetails(subj, pub, priv); _vapidReady = true; }
  catch { _vapidReady = false; }
  return _vapidReady;
}

// Journalise un SCAN du QR véhicule (ouverture du portail / page km) + notifie le gestionnaire.
// Anti-spam : n'enregistre RIEN (et ne notifie pas) si le même véhicule a été scanné dans les
// 20 dernières minutes (une même personne qui navigue = un seul scan). Best-effort : n'empêche
// jamais l'ouverture du portail si la table qr_scans n'existe pas encore.
async function logScan(
  db: ReturnType<typeof createClient>,
  qr: Record<string, unknown>,
  mode: string,
  userAgent: string,
) {
  try {
    const vehId = qr.vehicule_id ? String(qr.vehicule_id) : null;
    if (!vehId) return;
    const since = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // fenêtre anti-spam : 20 min
    const { data: recent } = await db.from("qr_scans")
      .select("id").eq("vehicule_id", vehId).gte("scanned_at", since).limit(1);
    if (Array.isArray(recent) && recent.length) return; // déjà scanné très récemment → on ignore
    const soc = qr.societe ? String(qr.societe) : "PXP";
    const ins = await db.from("qr_scans").insert({
      vehicule_id: vehId, plaque: qr.plaque ? String(qr.plaque) : "", societe: soc,
      mode: mode || "portail", user_agent: (userAgent || "").slice(0, 300),
    });
    if (ins.error) return; // table absente / RLS : on n'insiste pas (portail ouvert quand même)
    await sendPush(db, soc, {
      title: "👀 QR véhicule scanné",
      body: `${qr.plaque || "Véhicule"} — quelqu'un vient d'ouvrir le portail du véhicule.`,
      url: "./pages/vehicules.html" + (qr.plaque ? ("?immat=" + encodeURIComponent(String(qr.plaque))) : ""),
      tag: "scan-" + vehId,
    });
  } catch { /* best-effort : le scan/portail marche même sans journal */ }
}

async function sendPush(
  db: ReturnType<typeof createClient>,
  societe: string,
  payload: { title: string; body: string; url?: string; tag?: string },
) {
  try {
    if (!vapidReady()) return;
    const soc = societe || "PXP";
    const { data } = await db.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("societe", soc);
    if (!Array.isArray(data) || !data.length) return;
    const body = JSON.stringify({
      title: payload.title || "Parc Pilot",
      body: payload.body || "",
      url: payload.url || "./pages/notifications.html",
      tag: payload.tag || undefined,
      icon: "./assets/icons/icon-192.png",
    });
    await Promise.all((data as Array<Record<string, string>>).map(async (s) => {
      const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        await webpush.sendNotification(sub, body);
      } catch (e) {
        // 404/410 = abonnement expiré (appareil désinstallé / permission retirée) → on le supprime.
        const code = e && (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          try { await db.from("push_subscriptions").delete().eq("id", s.id); } catch { /* ignore */ }
        }
      }
    }));
  } catch { /* push best-effort : ne bloque jamais la soumission du chauffeur */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const db = admin();
  if (!db) return json({ error: "Service indisponible (configuration serveur)." }, 500);

  try {
    // ---- GET : le chauffeur ouvre son lien/QR → on lui montre SON véhicule (plaque verrouillée) ----
    if (req.method === "GET") {
      const url = new URL(req.url);
      const qtok = url.searchParams.get("q") || "";   // QR permanent (collé dans la voiture)
      const token = url.searchParams.get("t") || "";  // lien e-mail à usage unique
      const vtok = url.searchParams.get("vt") || "";  // QR « Véhicules à vendre » (jeton par société)

      // QR « Véhicules à vendre » dédié (par société) : résout la société via son jeton stocké dans
      // app_settings.data.ventesToken, puis renvoie la liste + le contact (venteTel). Aucun véhicule requis.
      if (vtok) {
        const { data: rows } = await db.from("app_settings").select("id,data");
        let soc = "";
        for (const r of ((rows || []) as Array<Record<string, unknown>>)) {
          const d = (r && r.data && typeof r.data === "object") ? r.data as Record<string, unknown> : {};
          if (d && d.ventesToken && String(d.ventesToken) === vtok) { soc = String(r.id); break; }
        }
        if (!soc) return json({ error: "Lien invalide." }, 404);
        const ventes = await ventesListe(db, soc);
        const portail = await portalConfig(db, soc, "");
        delete (portail as Record<string, unknown>).condLangues;
        return json({ ok: true, mode: "ventesliste", societe: soc, ventes, portail });
      }

      if (qtok) {
        const { qr, err } = await loadQr(db, qtok);
        if (err) return json({ error: err }, 404);
        // Rubrique « Véhicules à vendre » (portail QR) : liste des véhicules à vendre de la MÊME société.
        if (url.searchParams.get("ventes") === "1") {
          const ventes = await ventesListe(db, qr.societe || "PXP");
          return json({ ok: true, ventes });
        }
        const kmConnu = await vehKm(db, qr.vehicule_id);
        const kmDate = await dernierReleveDate(db, qr.vehicule_id);
        const base = { ok: true, mode: "qr", plaque: qr.plaque || "", chauffeur: "", societe: qr.societe || "", kmConnu, kmDate, deja: false, kmRecu: null };
        // Journalise le SCAN du QR (quand + quel véhicule) + notifie le gestionnaire. Anti-spam 20 min.
        // Mode selon la page qui appelle : portail complet (v.html, full=1) vs page relevé km.
        const scanMode = url.searchParams.get("full") === "1" ? "portail" : "km";
        // ⚠️ FAUX SCANS : un lien v.html partagé/collé quelque part (SMS, e-mail, messagerie) est PRÉ-CHARGÉ
        // par des ROBOTS d'aperçu / antivirus / navigateurs (facebookexternalhit, WhatsApp, Slackbot,
        // Googlebot, Sec-Purpose: prefetch…) → ça déclenchait une notif « QR scanné » alors que PERSONNE
        // n'a scanné. On sert quand même la page, mais on NE journalise/NE notifie PAS ces requêtes.
        const _ua = req.headers.get("user-agent") || "";
        const _purpose = (req.headers.get("sec-purpose") || req.headers.get("purpose") || req.headers.get("x-purpose") || req.headers.get("x-moz") || "").toLowerCase();
        const _isBot = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|slackbot|twitterbot|linkedinbot|telegrambot|discordbot|bingbot|googlebot|applebot|yandex|baiduspider|skypeuripreview|inspectiontool|headlesschrome|phantomjs|curl|wget|python-requests|go-http|axios|okhttp|libwww|httpclient/i.test(_ua);
        const _isPrefetch = /prefetch|preview/.test(_purpose);
        if (!_isBot && !_isPrefetch) {
          await logScan(db, qr, scanMode, _ua);
        }
        // `full=1` (portail v.html) : on joint infos véhicule + documents + EDL + config société.
        if (url.searchParams.get("full") === "1") {
          const veh = await vehInfo(db, qr.vehicule_id);
          // Nom du conducteur : champ `chauffeur` du véhicule, sinon l'affectation en cours (historique).
          const chauffeurNom = await chauffeurActuel(db, qr.vehicule_id, qr.societe || "PXP", veh ? String(veh.chauffeur || "") : "");
          const [docs0, edl0, portal, conducteur] = await Promise.all([
            vehDocs(db, qr.vehicule_id, veh),
            vehEdl(db, qr.vehicule_id),
            portalConfig(db, qr.societe || "PXP", qr.plaque || ""),
            vehConducteur(db, chauffeurNom, qr.societe || "PXP"),
          ]);
          // Bucket privé → on SIGNE les URLs pour qu'elles s'ouvrent depuis la page publique.
          const docs = await Promise.all(docs0.map(async (d) => ({ ...d, url: await signUrl(db, d.url) })));
          const edl = await Promise.all(edl0.map(async (e) => ({ ...e, url: await signUrl(db, e.url) })));
          if (portal.assistanceNotice) portal.assistanceNotice = await signUrl(db, portal.assistanceNotice);
          // Masse en service (champ G) pour le stationnement Paris — MÊME ordre de source que la fonction
          // vehMasse() de la fiche véhicule : (1) réglage société vehMasse[vehId] ; (2) table MASSE_CG
          // (= FP.masseCG, cartes grises de la flotte) ; (3) repli par modèle. → verdict identique à la fiche.
          let masseKg: number | null = null;
          let revKm = 15000, revMois = 12;          // défauts alignés sur FP.notifCfg (app.js)
          let revAlerteKm = 1000, revAlerteJours = 30; // seuils d'alerte révision (proche → orange)
          try {
            const { data: setRow } = await db.from("app_settings").select("data").eq("id", qr.societe || "PXP").maybeSingle();
            const sd = (setRow && setRow.data) as Record<string, unknown> | undefined;
            const vm = (sd && sd.vehMasse) as Record<string, unknown> | undefined;
            const raw = vm && qr.vehicule_id ? vm[qr.vehicule_id] : null;
            if (raw != null && raw !== "") masseKg = Number(raw);
            // Intervalle + seuils d'alerte de révision PAR SOCIÉTÉ (Paramètres → seuils) → même échéance que l'app.
            const notif = (sd && sd.notif) as Record<string, unknown> | undefined;
            if (notif) {
              if (notif.revKm != null && notif.revKm !== "") revKm = Number(notif.revKm) || revKm;
              if (notif.revMois != null && notif.revMois !== "") revMois = Number(notif.revMois) || revMois;
              if (notif.revAlerteKm != null && notif.revAlerteKm !== "") revAlerteKm = Number(notif.revAlerteKm) || revAlerteKm;
              if (notif.revAlerteJours != null && notif.revAlerteJours !== "") revAlerteJours = Number(notif.revAlerteJours) || revAlerteJours;
            }
          } catch (_) { /* pas de masse / config réglée → défauts */ }
          // Table MASSE_CG = masses relevées sur les cartes grises de la flotte PXP → repli réservé à PXP
          // (les autres sociétés renseignent leur masse via vehMasse, prioritaire ci-dessus).
          if (masseKg == null && (qr.societe || "PXP") === "PXP") { const k = String(qr.plaque || "").toUpperCase().trim(); if (MASSE_CG[k] != null) masseKg = MASSE_CG[k]; }
          if (masseKg == null && veh) {
            const mod = String(veh.modele || "").toUpperCase();
            const KNOWN: Record<string, number> = { "SEAL U": 2102, "ATTO 3": 1750 };
            for (const k in KNOWN) { if (mod.includes(k)) { masseKg = KNOWN[k]; break; } }
          }
          const rev = veh ? prochaineRevision(veh as Record<string, unknown>, revKm, revMois, revAlerteKm, revAlerteJours) : { date: null, km: null, niveau: null };
          const info = veh ? {
            marque: veh.marque || "", modele: veh.modele || "", carburant: veh.carburant || "",
            co2: veh.co2 != null && veh.co2 !== "" ? Number(veh.co2) : null,
            masse: masseKg,
            km: veh.km != null ? Number(veh.km) : null,
            prochainCT: veh.prochain_ct || "", dateMiseEnCirculation: veh.date_mise_en_circulation || "",
            // Prochaine révision (rappel côté conducteur pour anticiper) — date + km d'échéance.
            prochaineRevisionDate: rev.date || "", prochaineRevisionKm: rev.km != null ? rev.km : null,
            prochaineRevisionNiveau: rev.niveau || "",   // '' | 'warn' (orange) | 'danger' (rouge)
            // Vente (onglet « À vendre » du portail) : statut + specs de base. ⚠️ JAMAIS le prix côté
            // public — le prix reste réservé à l'app Parc Pilot (derrière connexion).
            statut: veh.statut || "", couleur: veh.couleur || "", boite: veh.boite || "",
          } : null;
          // Langue du conducteur (carte condLangues côté société) → le portail s'affiche dans SA langue
          // (6 langues supportées par v.html : fr/en/es/it/de/zh). Les e-mails, eux, restent FR/EN.
          const langMap = (portal as Record<string, unknown>).condLangues as Record<string, unknown> || {};
          const ck = conducteur && (conducteur as Record<string, unknown>).key;
          const lv = ck ? String(langMap[ck as string] || "").toLowerCase() : "";
          const langue = ["fr", "en", "es", "it", "de", "zh"].includes(lv) ? lv
            : (lv === "english" || lv === "anglais") ? "en" : "fr";
          delete (portal as Record<string, unknown>).condLangues;   // pas besoin de l'exposer au client
          const conducteur2 = conducteur ? { ...conducteur, langue } : { langue };
          // Amendes du conducteur (montant + n° d'avis) pour l'onglet « Mes amendes » du portail (sans PDF).
          const amendes = await vehAmendes(db, qr.societe || "PXP", conducteur as Record<string, unknown> | null);
          // Podium des amendes (prénom + rang seulement) — classement de la flotte, affiché en tête de l'onglet.
          const podium = await amendesPodium(db, qr.societe || "PXP");
          // ⚠️ La page v.html lit `portail` (français) → on émet cette clé (pas `portal`).
          return json({ ...base, veh: info, docs, edl, portail: portal, conducteur: conducteur2, amendes, podium, langue });
        }
        return json(base);
      }

      if (!token) return json({ error: "Lien incomplet." }, 400);
      const { req: r, err } = await loadReq(db, token);
      if (err) return json({ error: err }, 404);
      // ⚠️ TOUJOURS À JOUR : on montre le km LIVE de la fiche véhicule (comme le QR permanent), pour
      // refléter les corrections manuelles / relevés reçus APRÈS l'envoi du mail. Repli sur km_avant
      // (valeur figée à l'envoi) uniquement si la fiche n'a pas de km.
      let kmConnu = await vehKm(db, r.vehicule_id);
      if (kmConnu == null || kmConnu === "") kmConnu = r.km_avant;
      const langue = await condLangueDe(db, r.societe || "PXP", r.chauffeur || "");  // e-mail dans la langue du conducteur
      const kmDate = await dernierReleveDate(db, r.vehicule_id);
      return json({
        ok: true, mode: "mail",
        plaque: r.plaque || "", chauffeur: r.chauffeur || "", societe: r.societe || "",
        kmConnu: kmConnu != null ? Number(kmConnu) : null, kmDate,
        deja: !!r.used_at, kmRecu: r.km_recu != null ? Number(r.km_recu) : null, langue,
      });
    }

    // ---- POST : le chauffeur envoie son km / une déclaration / des photos de restitution ----
    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try { body = await req.json(); } catch { return json({ error: "Requête invalide." }, 400); }
      const action = String(body.action || "").trim();

      // === Déclaration de sinistre / problème (formulaire du portail) ===
      if (action === "declaration") {
        const qtok0 = String(body.q || "").trim();
        if (!qtok0) return json({ error: "QR incomplet." }, 400);
        const { qr, err } = await loadQr(db, qtok0);
        if (err) return json({ error: err }, 404);
        const type = String(body.type || "sinistre").trim() === "probleme" ? "probleme" : "sinistre";
        const description = String(body.description || "").trim();
        if (!description) return json({ error: "Décris brièvement ce qui s'est passé." }, 400);
        const _up = await uploadPhotosDetail(db, body.photos, dossierSociete(qr.societe) + "/declarations/" + (qr.plaque || "veh"));
        const photos = _up.urls;
        const rec = {
          id: genId("dc"), vehicule_id: qr.vehicule_id, plaque: qr.plaque || "", societe: qr.societe || "PXP",
          type, date_incident: String(body.dateIncident || "").slice(0, 120), lieu: String(body.lieu || "").slice(0, 240),
          description: description.slice(0, 4000), tiers: String(body.tiers || "").slice(0, 600),
          blesses: String(body.blesses || "").slice(0, 240), photos, statut: "nouveau",
        };
        const ins = await db.from("declarations_conducteur").insert(rec);
        if (ins.error) return json({ error: "Échec de l'enregistrement. Réessaie." }, 500);
        await sendPush(db, qr.societe || "PXP", {
          title: type === "probleme" ? "⚠️ Problème signalé" : "🚨 Sinistre déclaré",
          body: `${qr.plaque || "Véhicule"} — un conducteur vient de faire une déclaration.`,
          url: "./pages/sinistres.html", tag: "decl-" + (qr.vehicule_id || ""),
        });
        return json({ ok: true, type, photos: photos.length, saved: _up.saved, sent: _up.sent, dropped: _up.dropped });
      }

      // === Le conducteur CONSULTE ses déclarations (toutes natures) de CE véhicule + leur statut ===
      if (action === "myDeclarations") {
        const qtok0 = String(body.q || "").trim();
        if (!qtok0) return json({ error: "QR incomplet." }, 400);
        const { qr, err } = await loadQr(db, qtok0);
        if (err) return json({ error: err }, 404);
        const { data } = await db.from("declarations_conducteur")
          .select("id,type,date_incident,lieu,description,tiers,blesses,photos,statut,created_at,reponse,reponse_at")
          .eq("vehicule_id", qr.vehicule_id)
          .order("created_at", { ascending: false })
          .limit(30);
        const list = (data || []).map((d: Record<string, unknown>) => ({
          id: String(d.id || ""), type: String(d.type || "sinistre"),
          date: String(d.date_incident || "") || (d.created_at ? String(d.created_at).slice(0, 10) : ""),
          lieu: String(d.lieu || ""), description: String(d.description || ""),
          tiers: String(d.tiers || ""), blesses: String(d.blesses || ""),
          photos: Array.isArray(d.photos) ? d.photos.length : 0,
          statut: String(d.statut || "nouveau"), createdAt: String(d.created_at || ""),
          editable: String(d.statut || "nouveau") === "nouveau",
          // Réponse écrite du gestionnaire (facultative) — affichée dans « Mes signalements ».
          reponse: String(d.reponse || ""), reponseAt: String(d.reponse_at || ""),
        }));
        return json({ ok: true, declarations: list });
      }

      // === Le conducteur MODIFIE sa déclaration — UNIQUEMENT tant qu'elle n'a pas été prise en compte ===
      if (action === "editDeclaration") {
        const qtok0 = String(body.q || "").trim();
        if (!qtok0) return json({ error: "QR incomplet." }, 400);
        const { qr, err } = await loadQr(db, qtok0);
        if (err) return json({ error: err }, 404);
        const id = String(body.id || "").trim();
        if (!id) return json({ error: "Déclaration introuvable." }, 400);
        const { data: cur } = await db.from("declarations_conducteur").select("id,vehicule_id,statut").eq("id", id).maybeSingle();
        if (!cur || cur.vehicule_id !== qr.vehicule_id) return json({ error: "Déclaration introuvable." }, 404);
        if (String(cur.statut || "nouveau") !== "nouveau") return json({ error: "Cette déclaration a déjà été prise en compte par ton gestionnaire — tu ne peux plus la modifier." }, 409);
        const patch: Record<string, unknown> = {};
        if (typeof body.description === "string") { const d = String(body.description).trim(); if (!d) return json({ error: "La description ne peut pas être vide." }, 400); patch.description = d.slice(0, 4000); }
        if (typeof body.lieu === "string") patch.lieu = String(body.lieu).slice(0, 240);
        if (typeof body.dateIncident === "string") patch.date_incident = String(body.dateIncident).slice(0, 120);
        if (typeof body.tiers === "string") patch.tiers = String(body.tiers).slice(0, 600);
        if (typeof body.blesses === "string") patch.blesses = String(body.blesses).slice(0, 240);
        if (!Object.keys(patch).length) return json({ error: "Rien à modifier." }, 400);
        const up = await db.from("declarations_conducteur").update(patch).eq("id", id);
        if (up.error) return json({ error: "Échec de la modification. Réessaie." }, 500);
        return json({ ok: true });
      }

      // === État des lieux : photos de restitution envoyées par le conducteur ===
      if (action === "edl") {
        const qtok0 = String(body.q || "").trim();
        if (!qtok0) return json({ error: "QR incomplet." }, 400);
        const { qr, err } = await loadQr(db, qtok0);
        if (err) return json({ error: err }, 404);
        const sens = String(body.sens || "restitution").trim() === "prise" ? "prise" : "restitution";
        const _up = await uploadPhotosDetail(db, body.photos, dossierSociete(qr.societe) + "/etat-des-lieux/" + (qr.plaque || "veh"));
        const photos = _up.urls;
        if (!photos.length) return json({ error: "Ajoute au moins une photo." }, 400);
        // Le sens vit dans `label` ('Entrée'/'Sortie') — même convention que la fiche véhicule.
        const label = sens === "restitution" ? "Sortie" : "Entrée";
        const rows = photos.map((u) => ({
          id: genId("D"), vehicule_id: qr.vehicule_id, type: "etat-des-lieux",
          label, url: u, societe: qr.societe || "PXP",
        }));
        const ins = await db.from("documents").insert(rows);
        if (ins.error) return json({ error: "Échec de l'envoi des photos. Réessaie." }, 500);
        // Kilométrage au compteur saisi par le conducteur (optionnel) : on le range dans l'HISTORIQUE du
        // véhicule (même stockage que l'état des lieux du gestionnaire : app_settings.inspections[vehId]),
        // et on remonte le km COURANT du véhicule s'il est plus élevé (jamais vers le bas). → la frise
        // chronologique affiche « État des lieux · Entrée/Sortie — <km> km » automatiquement.
        const kmEdl = Math.round(Number(body.km));
        const kmValid = Number.isFinite(kmEdl) && kmEdl > 0 && kmEdl <= 3000000;
        if (kmValid) {
          try {
            const kmRef = await vehKm(db, qr.vehicule_id);
            if (kmRef == null || kmEdl > kmRef) await db.from("vehicules").update({ km: kmEdl }).eq("id", qr.vehicule_id);
          } catch (_e) { /* maj km best-effort */ }
        }
        // Inspection datée (frise véhicule) — créée pour CHAQUE envoi conducteur (avec ou sans km).
        // La fusion « delta » côté client (rev) préserve cet ajout serveur lors des sauvegardes suivantes.
        try {
          const soc = qr.societe || "PXP";
          const cur = await db.from("app_settings").select("data").eq("id", soc).maybeSingle();
          const d = (cur.data && cur.data.data && typeof cur.data.data === "object") ? cur.data.data : {};
          d.inspections = (d.inspections && typeof d.inspections === "object") ? d.inspections : {};
          const rec = {
            id: "INS" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            date: new Date().toISOString().slice(0, 10),
            sens: label, km: kmValid ? kmEdl : null, items: {},
            note: "Envoyé par le conducteur (portail QR)", source: "portail",
          };
          const prev = Array.isArray(d.inspections[qr.vehicule_id]) ? d.inspections[qr.vehicule_id] : [];
          d.inspections[qr.vehicule_id] = [rec, ...prev];
          await db.from("app_settings").upsert({ id: soc, data: d });
        } catch (_e) { /* l'historique est best-effort : l'envoi des photos réussit quand même */ }
        // Notifie le gestionnaire : on enregistre AUSSI une « demande conducteur » (type 'etat_lieux',
        // statut 'nouveau') dans declarations_conducteur → même badge + alerte + inbox que les sinistres.
        // Aucune donnée dupliquée côté fiche : les photos restent dans `documents` (section État des lieux),
        // cette ligne ne sert qu'à alerter (mêmes URLs, réutilisées pour l'aperçu). Best-effort.
        try {
          const kmTxt = kmValid ? ` · ${kmEdl.toLocaleString("fr-FR")} km` : "";
          await db.from("declarations_conducteur").insert({
            id: genId("dc"), vehicule_id: qr.vehicule_id, plaque: qr.plaque || "", societe: qr.societe || "PXP",
            type: "etat_lieux",
            // Date du jour (comme un sinistre via date_incident) → l'inbox/alerte affiche une date, pas un vide.
            date_incident: new Date().toISOString().slice(0, 10),
            description: `${photos.length} photo(s) d'état des lieux — ${label === "Sortie" ? "restitution" : "prise en main"}${kmTxt}`,
            photos, statut: "nouveau",
          });
        } catch (_e) { /* la table d'alerte peut manquer : l'envoi des photos réussit quand même */ }
        await sendPush(db, qr.societe || "PXP", {
          title: "📸 État des lieux reçu",
          body: `${qr.plaque || "Véhicule"} — ${photos.length} photo(s) · ${label === "Sortie" ? "restitution" : "prise en main"}${kmValid ? ` · ${kmEdl.toLocaleString("fr-FR")} km` : ""}.`,
          url: "./pages/notifications.html?tab=alertes", tag: "edl-" + (qr.vehicule_id || ""),
        });
        return json({ ok: true, sens, photos: photos.length, saved: _up.saved, sent: _up.sent, dropped: _up.dropped, km: kmValid ? kmEdl : null });
      }

      // === Question / demande du conducteur (portail QR) ===
      // Le conducteur pose une question libre → on l'enregistre comme « demande conducteur »
      // (type 'question', statut 'nouveau') → même badge + alerte + inbox que les sinistres.
      if (action === "question") {
        const qtok0 = String(body.q || "").trim();
        if (!qtok0) return json({ error: "QR incomplet." }, 400);
        const { qr, err } = await loadQr(db, qtok0);
        if (err) return json({ error: err }, 404);
        const question = String(body.description || "").trim();
        if (!question) return json({ error: "Écris ta question." }, 400);
        const _up = await uploadPhotosDetail(db, body.photos, dossierSociete(qr.societe) + "/questions/" + (qr.plaque || "veh"));
        const photos = _up.urls;
        const ins = await db.from("declarations_conducteur").insert({
          id: genId("dc"), vehicule_id: qr.vehicule_id, plaque: qr.plaque || "", societe: qr.societe || "PXP",
          type: "question",
          date_incident: new Date().toISOString().slice(0, 10),
          description: question.slice(0, 4000), photos, statut: "nouveau",
        });
        if (ins.error) return json({ error: "Échec de l'envoi. Réessaie." }, 500);
        await sendPush(db, qr.societe || "PXP", {
          title: "❓ Question d'un conducteur",
          body: `${qr.plaque || "Véhicule"} — ${question.slice(0, 90)}`,
          url: "./pages/notifications.html?tab=alertes", tag: "question-" + (qr.vehicule_id || ""),
        });
        return json({ ok: true, type: "question", photos: photos.length, saved: _up.saved, sent: _up.sent, dropped: _up.dropped });
      }

      const qtok = String(body.q || "").trim();
      const token = String(body.t || "").trim();
      const km = Math.round(Number(body.km));
      if (!qtok && !token) return json({ error: "Lien incomplet." }, 400);
      if (!Number.isFinite(km) || km <= 0 || km > 3000000) {
        return json({ error: "Kilométrage invalide. Saisis un nombre (ex. 45 000)." }, 400);
      }

      // Résout le véhicule concerné selon le mode (QR permanent ou lien e-mail).
      let vehiculeId: string | null = null, plaque = "", societe = "", chauffeur = "", kmRef: number | null = null;
      if (qtok) {
        const { qr, err } = await loadQr(db, qtok);
        if (err) return json({ error: err }, 404);
        vehiculeId = qr.vehicule_id; plaque = qr.plaque || ""; societe = qr.societe || "";
        kmRef = await vehKm(db, vehiculeId);
      } else {
        const { req: r, err } = await loadReq(db, token);
        if (err) return json({ error: err }, 404);
        vehiculeId = r.vehicule_id; plaque = r.plaque || ""; societe = r.societe || ""; chauffeur = r.chauffeur || "";
        kmRef = r.km_avant != null ? Number(r.km_avant) : await vehKm(db, vehiculeId);
      }

      // Refuse un km ABERRANT (inférieur au km déjà connu) pour ne pas corrompre la fiche.
      if (kmRef != null && km < kmRef - 100) {
        return json({ error: `Le kilométrage saisi (${km}) est inférieur au dernier relevé connu (${kmRef}). Vérifie ton compteur.` }, 400);
      }

      // 1) Met à jour la fiche véhicule (seulement si le km reçu est supérieur au km actuel).
      if (vehiculeId) {
        const cur = (await vehKm(db, vehiculeId)) || 0;
        if (km > cur) await db.from("vehicules").update({ km }).eq("id", vehiculeId);
      }

      // 2) Journalise le relevé.
      const now = new Date().toISOString();
      if (qtok) {
        // QR permanent : chaque scan = une NOUVELLE ligne de relevé (historique par période).
        await db.from("km_requests").insert({
          token: "qr-" + crypto.randomUUID(), vehicule_id: vehiculeId, plaque, societe,
          chauffeur, km_avant: kmRef, km_recu: km, used_at: now, source: "qr",
        });
        // Notifie le gestionnaire : un relevé km SPONTANÉ (portail QR) crée une « demande conducteur »
        // (type 'km', statut 'nouveau') → même badge + alerte + inbox que les sinistres. Best-effort :
        // si la table manque, le relevé km reste enregistré dans km_requests.
        try {
          await db.from("declarations_conducteur").insert({
            id: genId("dc"), vehicule_id: vehiculeId, plaque: plaque || "", societe: societe || "PXP",
            type: "km",
            date_incident: now.slice(0, 10),
            description: `Relevé kilométrique : ${km.toLocaleString("fr-FR")} km`,
            photos: [], statut: "nouveau",
          });
        } catch (_e) { /* l'alerte est best-effort */ }
        await sendPush(db, societe || "PXP", {
          title: "🛣️ Nouveau relevé km",
          body: `${plaque || "Véhicule"} — ${km.toLocaleString("fr-FR")} km relevés par le conducteur.`,
          url: "./pages/vehicules.html" + (plaque ? ("?immat=" + encodeURIComponent(String(plaque))) : ""), tag: "km-" + (vehiculeId || ""),
        });
      } else {
        // Lien e-mail : marque la demande comme répondue (idempotent).
        await db.from("km_requests").update({ km_recu: km, used_at: now }).eq("token", token);
      }

      return json({ ok: true, plaque, km });
    }

    return json({ error: "Méthode non autorisée." }, 405);
  } catch (e) {
    return json({ error: (e && (e as Error).message) || "Erreur serveur." }, 500);
  }
});
