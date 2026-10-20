// ============================================================================
//  Parc Pilot — Formulaire ACHETEUR d'un véhicule (fonction PUBLIQUE)
//
//  Le gestionnaire envoie à l'acheteur intéressé un lien offre-achat.html?t=<token>.
//    • GET  ?t        → infos du véhicule (marque, modèle, plaque, prix) pour l'affichage.
//    • POST { action:'submit', t, typeAcheteur, acheteur:{…} }
//                     → enregistre la demande (table offres_achat, statut 'recu') ;
//                       prévient le(s) gestionnaire(s) (push + e-mail).
//
//  ⚠️ PUBLIQUE (l'acheteur n'a pas de compte). Sécurité = le TOKEN secret du lien.
//     verify_jwt est désactivé pour cette fonction (supabase/config.toml).
//
//  Déploiement : automatique (GitHub Action au push sur main).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function admin() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
function genId(p: string) { return p + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
function clean(v: unknown, max = 200): string { return String(v == null ? "" : v).replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max); }
function esc(s: string) { return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c)); }

// ─── Champs ACHETEUR autorisés (anti-injection : on ne garde QUE ces clés, chacune bornée) ───
const ACHETEUR_FIELDS: Array<[string, number]> = [
  ["nom", 120], ["nomUsage", 120], ["prenom", 120], ["dateNaissance", 40], ["lieuNaissance", 160], ["sexe", 20],
  ["adrNumero", 40], ["adrTypeVoie", 60], ["adrNomVoie", 200], ["adrComplement", 200], ["codePostal", 20], ["ville", 120], ["pays", 80],
  ["telephone", 40], ["email", 160],
  ["raisonSociale", 200], ["siren", 40], ["repNom", 120], ["repPrenom", 120], ["qualite", 120],
];
function sanitizeAcheteur(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, max] of ACHETEUR_FIELDS) { const val = clean(raw && raw[k], max); if (val) out[k] = val; }
  return out;
}

// ─── Notification PUSH au(x) gestionnaire(s) de la société (best-effort, comme edl-sign) ───
let _vapid: boolean | null = null;
function vapidReady(): boolean {
  if (_vapid !== null) return _vapid;
  const pub = Deno.env.get("VAPID_PUBLIC_KEY") || "", priv = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const subj = Deno.env.get("VAPID_SUBJECT") || "mailto:contact@parc-pilot.fr";
  if (!pub || !priv) { _vapid = false; return false; }
  try { webpush.setVapidDetails(subj, pub, priv); _vapid = true; } catch { _vapid = false; }
  return _vapid;
}
async function sendPush(db: ReturnType<typeof createClient>, societe: string, payload: { title: string; body: string; url?: string; tag?: string }) {
  try {
    if (!vapidReady()) return;
    const { data } = await db.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("societe", societe || "PXP");
    if (!Array.isArray(data) || !data.length) return;
    const body = JSON.stringify({ title: payload.title || "Parc Pilot", body: payload.body || "", url: payload.url || "./pages/contrats.html?ctab=archive", tag: payload.tag, icon: "./assets/icons/icon-192.png" });
    await Promise.all((data as Array<Record<string, string>>).map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body); }
      catch (e) { const c = e && (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) { try { await db.from("push_subscriptions").delete().eq("id", s.id); } catch { /* ignore */ } } }
    }));
  } catch { /* best-effort */ }
}

// ─── E-mail de notification au(x) gestionnaire(s) (from calculé depuis la config société, comme send-email) ───
async function societeConfig(db: ReturnType<typeof createClient>, societe: string): Promise<{ from: string; replyTo: string; to: string[]; nomSoc: string }> {
  // ⚠️ Repli sur un domaine VÉRIFIÉ dans Resend (seul projectxparis.fr l'est aujourd'hui) : l'adresse de
  // test onboarding@resend.dev ne peut écrire QU'au titulaire du compte → échec vers un destinataire tiers.
  // N'affecte QUE le repli (une société avec mailExpediteur configuré garde son adresse scopée ci-dessous).
  let envFrom = Deno.env.get("EMAIL_FROM") || "";
  if (!envFrom || /resend\.dev/i.test(envFrom)) envFrom = "Parc Pilot <noreply@projectxparis.fr>";
  try {
    const { data } = await db.from("app_settings").select("data").eq("id", String(societe || "PXP")).maybeSingle();
    const d = (data && (data as { data?: Record<string, unknown> }).data) || {};
    const p = (d.profil && typeof d.profil === "object") ? d.profil as Record<string, unknown> : {};
    const exp = String(p.mailExpediteur || "").trim();
    const copie = String(p.mailCopie || "").trim();
    const to = Array.from(new Set([exp, copie].filter(Boolean)));
    let nomSoc = String((d.societe && (d.societe as Record<string, unknown>).nom) || "").replace(/[<>"]/g, "").trim();
    if (/^parc\s*pilot$/i.test(nomSoc)) nomSoc = "";
    if (exp) {
      const dom = String(p.mailDomaineEnvoi || "").trim().replace(/^@/, "");
      const fromAddr = dom ? (exp.split("@")[0] + "@" + dom) : exp;
      return { from: nomSoc ? `${nomSoc} <${fromAddr}>` : fromAddr, replyTo: exp, to, nomSoc };
    }
    return { from: envFrom, replyTo: "", to, nomSoc };
  } catch { return { from: envFrom, replyTo: "", to: [], nomSoc: "" }; }
}
async function notifyEmail(db: ReturnType<typeof createClient>, societe: string, row: Record<string, unknown>, ach: Record<string, string>, typeAcheteur: string) {
  const key = Deno.env.get("RESEND_API_KEY"); if (!key) return;
  const cfg = await societeConfig(db, societe);
  if (!cfg.to.length) return;
  const plaque = esc(String(row.plaque || "Véhicule"));
  const vehLbl = esc([row.marque, row.modele].filter(Boolean).join(" ")) || "—";
  const isSoc = typeAcheteur === "societe";
  const nomAcheteur = isSoc
    ? (ach.raisonSociale || [ach.repPrenom, ach.repNom].filter(Boolean).join(" ") || "une société")
    : ([ach.prenom, ach.nom].filter(Boolean).join(" ") || "un particulier");
  const lignes: string[] = [];
  const add = (lbl: string, val?: string) => { if (val) lignes.push(`<tr><td style="padding:3px 10px 3px 0;color:#64748b;white-space:nowrap">${esc(lbl)}</td><td style="padding:3px 0;font-weight:600">${esc(val)}</td></tr>`); };
  add("Type", isSoc ? "Société" : "Particulier");
  if (isSoc) { add("Raison sociale", ach.raisonSociale); add("SIREN", ach.siren); add("Représentant", [ach.repPrenom, ach.repNom].filter(Boolean).join(" ")); add("Qualité", ach.qualite); }
  else { add("Nom", ach.nom); add("Nom d'usage", ach.nomUsage); add("Prénom", ach.prenom); add("Né(e) le", ach.dateNaissance); add("À", ach.lieuNaissance); add("Sexe", ach.sexe); }
  const adr = [ach.adrNumero, ach.adrTypeVoie, ach.adrNomVoie].filter(Boolean).join(" ");
  add("Adresse", [adr, ach.adrComplement, [ach.codePostal, ach.ville].filter(Boolean).join(" "), ach.pays].filter(Boolean).join(", "));
  add("Téléphone", ach.telephone); add("E-mail", ach.email);
  const ppLogo = '<span style="font-weight:900;font-style:italic;font-size:16px;color:#ffffff">Parc</span>'
    + '<span>&#160;</span><span style="font-weight:900;font-style:italic;font-size:16px;color:#F97316">Pilot</span>';
  const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="color-scheme" content="only light"><meta name="supported-color-schemes" content="only light"></head>'
    + '<body style="margin:0;padding:0;background:#EEF2F7;color:#0F1E3D">'
    + '<div style="font-family:Inter,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto">'
    + '<div style="background-color:#0B1220;background-image:linear-gradient(135deg,#0B1220,#1E293B);color:#fff;padding:20px 22px;border-radius:14px 14px 0 0">'
    + '<div>' + ppLogo + '</div>'
    + '<div style="font-size:19px;font-weight:800;font-style:italic;margin-top:14px">🧾 Nouvelle demande d\'achat</div></div>'
    + '<div style="border:1px solid #E7EBF0;border-top:none;padding:20px;border-radius:0 0 14px 14px">'
    + '<p style="margin:0 0 14px;line-height:1.55"><b>' + esc(nomAcheteur) + '</b> a rempli le formulaire acheteur pour :</p>'
    + '<div style="background:#f8fafc;border-radius:10px;padding:11px 14px;margin:0 0 14px;font-size:13px;color:#334155">🚗 <b>' + vehLbl + '</b> · ' + plaque + '</div>'
    + '<table style="font-size:13px;line-height:1.4;border-collapse:collapse">' + lignes.join("") + '</table>'
    + '<p style="margin:16px 0 0;font-size:12px;color:#64748b">Retrouve cette demande dans <b>Parc Pilot → Contrats → Archive</b>.</p>'
    + '</div></div></body></html>';
  const subject = "Demande d'achat — " + String(row.plaque || "véhicule") + " (" + (isSoc ? "société" : "particulier") + ")";
  const payload: Record<string, unknown> = { from: cfg.from, to: cfg.to, subject, html, text: nomAcheteur + " a rempli le formulaire acheteur pour " + String(row.plaque || "") + ". Détail dans Parc Pilot → Contrats → Archive." };
  if (cfg.replyTo) payload.reply_to = cfg.replyTo;
  try { await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) }); } catch { /* best-effort */ }
}

// Résout la ligne 'lien' d'un token (le véhicule concerné par le formulaire).
async function lienRow(db: ReturnType<typeof createClient>, token: string): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  const { data } = await db.from("offres_achat").select("*").eq("token", token).eq("statut", "lien").limit(1).maybeSingle();
  if (data) return data as Record<string, unknown>;
  // Repli : n'importe quelle ligne portant ce token (si la ligne 'lien' a été archivée) → on récupère le véhicule.
  const { data: any2 } = await db.from("offres_achat").select("*").eq("token", token).order("created_at", { ascending: true }).limit(1).maybeSingle();
  return (any2 as Record<string, unknown>) || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const db = admin();
  if (!db) return json({ error: "Service indisponible (configuration serveur)." }, 500);

  try {
    // ---- GET : l'acheteur ouvre son lien → infos du véhicule à afficher ----
    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = clean(url.searchParams.get("t") || "", 120);
      if (!token) return json({ error: "Lien incomplet." }, 400);
      const row = await lienRow(db, token);
      if (!row) return json({ error: "Lien invalide ou expiré." }, 404);
      let nomSoc = "";
      try { const cfg = await societeConfig(db, String(row.societe || "PXP")); nomSoc = cfg.nomSoc; } catch { /* ignore */ }
      return json({ ok: true, plaque: row.plaque || "", marque: row.marque || "", modele: row.modele || "", prix: row.prix || null, societe: nomSoc });
    }

    // ---- POST : l'acheteur envoie le formulaire ----
    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try { body = await req.json(); } catch { return json({ error: "Requête invalide." }, 400); }
      if (String(body.action || "") !== "submit") return json({ error: "Action inconnue." }, 400);
      const token = clean(body.t, 120);
      const typeAcheteur = String(body.typeAcheteur || "") === "societe" ? "societe" : "particulier";
      if (!token) return json({ error: "Lien incomplet." }, 400);
      const row = await lienRow(db, token);
      if (!row) return json({ error: "Lien invalide ou expiré." }, 404);

      const ach = sanitizeAcheteur((body.acheteur && typeof body.acheteur === "object") ? body.acheteur as Record<string, unknown> : {});
      // Validation minimale : une identité est nécessaire.
      const hasIdentity = typeAcheteur === "societe"
        ? !!(ach.raisonSociale || ach.repNom)
        : !!(ach.nom || ach.prenom);
      if (!hasIdentity) return json({ error: "Merci de renseigner au moins votre nom." }, 400);

      const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "";
      const rec = {
        id: genId("OF"),
        token,
        vehicule_id: row.vehicule_id || null,
        plaque: row.plaque || null,
        marque: row.marque || null,
        modele: row.modele || null,
        prix: row.prix != null ? row.prix : null,
        societe: row.societe || "PXP",
        type_acheteur: typeAcheteur,
        acheteur: ach,
        statut: "recu",
        ip,
        received_at: new Date().toISOString(),
      };
      const ins = await db.from("offres_achat").insert(rec);
      if (ins.error) return json({ error: "Échec de l'enregistrement. Réessaie." }, 500);

      const who = typeAcheteur === "societe" ? (ach.raisonSociale || [ach.repPrenom, ach.repNom].filter(Boolean).join(" ") || "une société") : ([ach.prenom, ach.nom].filter(Boolean).join(" ") || "un particulier");
      // Notifie le(s) gestionnaire(s) : push + e-mail (best-effort, non bloquant pour l'acheteur).
      await sendPush(db, String(row.societe || "PXP"), {
        title: "🧾 Nouvelle demande d'achat",
        body: (row.plaque || "Véhicule") + " — " + who + " a rempli le formulaire acheteur.",
        url: "./pages/contrats.html?ctab=archive",
        tag: "offre-" + rec.id,
      });
      try { await notifyEmail(db, String(row.societe || "PXP"), row, ach, typeAcheteur); } catch { /* best-effort */ }

      return json({ ok: true });
    }

    return json({ error: "Méthode non autorisée." }, 405);
  } catch (e) {
    return json({ error: (e && (e as Error).message) || "Erreur serveur." }, 500);
  }
});
