// ============================================================================
//  Parc Pilot — RÉSERVATION DE VÉHICULES (fonction PUBLIQUE)
//
//  Le gestionnaire partage un lien reserver.html?t=<token-société>. Les collègues (sans compte) :
//    • GET  ?t&debut&fin  → société + véhicules RÉSERVABLES et DISPONIBLES sur le créneau.
//    • POST {action:'submit', t, vehiculeId, debut, fin, nom, email, tel, motif}
//                          → re-vérifie la dispo CÔTÉ SERVEUR (anti double-réservation concurrente),
//                            insère la demande (reservations, statut 'en_attente'), prévient le
//                            gestionnaire (push + e-mail) et confirme la réception au demandeur.
//
//  ⚠️ PUBLIQUE (pas de compte). Sécurité = le TOKEN société secret du lien + service_role côté serveur
//     (l'anonyme n'écrit JAMAIS en direct dans la table — pas de policy anon). verify_jwt désactivé
//     (supabase/config.toml). La disponibilité fait AUTORITÉ ici, pas dans le navigateur.
//
//  Déploiement : automatique (GitHub Action au push sur main). Table reservations requise (migration).
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
function ts(x: unknown): number | null { const d = new Date(String(x || "")); const t = d.getTime(); return isNaN(t) ? null : t; }
function statutNorm(s: unknown): string { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim(); }
const HORS = ["vendu", "vendue", "cede", "cédé", "cedee", "cédée", "hors service", "hors-service", "hs", "archive", "archivé", "archivée", "restitue", "restitué", "restituee", "restituée"];

// Résout le token société → { societe, settings } (scan app_settings.data.reservationToken).
async function resoudreToken(db: ReturnType<typeof createClient>, token: string): Promise<{ societe: string; data: Record<string, unknown> } | null> {
  if (!token) return null;
  try {
    const { data } = await db.from("app_settings").select("id,data");
    const rows = Array.isArray(data) ? data : [];
    for (const r of rows as Array<{ id: string; data?: Record<string, unknown> }>) {
      const d = (r && r.data) || {};
      if (String(d.reservationToken || "") && String(d.reservationToken) === token) return { societe: String(r.id), data: d };
    }
  } catch { /* ignore */ }
  return null;
}

// Véhicules RÉSERVABLES d'une société (config settings.reservablesCfg = { vehicules:[ids], groupes:[clés] }).
// Par défaut (config absente) → AUCUN (activation volontaire requise, consigne).
function reservableIds(data: Record<string, unknown>, vehs: Array<Record<string, unknown>>): Set<string> {
  const cfg = (data.reservablesCfg && typeof data.reservablesCfg === "object") ? data.reservablesCfg as Record<string, unknown> : {};
  const ids = new Set<string>();
  const vehIds = Array.isArray(cfg.vehicules) ? cfg.vehicules.map(String) : [];
  const grps = Array.isArray(cfg.groupes) ? cfg.groupes.map(String) : [];
  vehIds.forEach((id) => ids.add(id));
  if (grps.length) {
    for (const v of vehs) {
      const vg = Array.isArray(v.groupes) ? (v.groupes as unknown[]).map(String) : [];
      if (vg.some((g) => grps.includes(g))) ids.add(String(v.id));
    }
  }
  return ids;
}

// Un véhicule est-il libre sur [d0,f0] ? (statut OK + non immobilisé + aucun chevauchement de réservation active)
function vehiculeLibre(v: Record<string, unknown>, data: Record<string, unknown>, resas: Array<Record<string, unknown>>, vehId: string, d0: number, f0: number): boolean {
  const st = statutNorm(v.statut);
  if (HORS.includes(st) || st === "entretien" || st === "sinistre") return false;
  try {
    const imm = (data.vehImmobilise && typeof data.vehImmobilise === "object") ? (data.vehImmobilise as Record<string, { since?: string; leveLe?: string }>)[vehId] : null;
    if (imm && imm.since && !imm.leveLe) return false;
  } catch { /* ignore */ }
  for (const r of resas) {
    if (String(r.vehicule_id || "") !== vehId) continue;
    if (r.deleted_at) continue;
    const s = statutNorm(r.statut);
    if (s === "refusee" || s === "annulee" || s === "terminee") continue;   // ces statuts ne bloquent pas
    const rd = ts(r.debut), rf = ts(r.fin);
    if (rd == null || rf == null) continue;
    if (d0 < rf && f0 > rd) return false;   // chevauchement
  }
  return true;
}

// ─── Push + e-mail au(x) gestionnaire(s) (repris de offre-achat) ───
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
    const body = JSON.stringify({ title: payload.title || "Parc Pilot", body: payload.body || "", url: payload.url || "./pages/emprunts.html", tag: payload.tag, icon: "./assets/icons/icon-192.png" });
    await Promise.all((data as Array<Record<string, string>>).map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body); }
      catch (e) { const c = e && (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) { try { await db.from("push_subscriptions").delete().eq("id", s.id); } catch { /* ignore */ } } }
    }));
  } catch { /* best-effort */ }
}
async function societeConfig(db: ReturnType<typeof createClient>, societe: string, data: Record<string, unknown>): Promise<{ from: string; replyTo: string; to: string[]; nomSoc: string }> {
  let envFrom = Deno.env.get("EMAIL_FROM") || "";
  if (!envFrom || /resend\.dev/i.test(envFrom)) envFrom = "Parc Pilot <noreply@projectxparis.fr>";
  const p = (data.profil && typeof data.profil === "object") ? data.profil as Record<string, unknown> : {};
  const exp = String(p.mailExpediteur || "").trim();
  const copie = String(p.mailCopie || "").trim();
  const to = Array.from(new Set([exp, copie].filter(Boolean)));
  let nomSoc = String((data.societe && (data.societe as Record<string, unknown>).nom) || "").replace(/[<>"]/g, "").trim();
  if (/^parc\s*pilot$/i.test(nomSoc)) nomSoc = "";
  if (exp) {
    const dom = String(p.mailDomaineEnvoi || "").trim().replace(/^@/, "");
    const fromAddr = dom ? (exp.split("@")[0] + "@" + dom) : exp;
    return { from: nomSoc ? `${nomSoc} <${fromAddr}>` : fromAddr, replyTo: exp, to, nomSoc };
  }
  return { from: envFrom, replyTo: "", to, nomSoc };
}
async function sendEmail(key: string, from: string, to: string[], subject: string, html: string, text: string, replyTo?: string) {
  if (!key || !to.length) return;
  const payload: Record<string, unknown> = { from, to, subject, html, text };
  if (replyTo) payload.reply_to = replyTo;
  try { await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) }); } catch { /* best-effort */ }
}
function mailWrap(titre: string, corps: string): string {
  const ppLogo = '<span style="font-weight:900;font-style:italic;font-size:16px;color:#ffffff">Parc</span><span>&#160;</span><span style="font-weight:900;font-style:italic;font-size:16px;color:#F97316">Pilot</span>';
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="color-scheme" content="only light"><meta name="supported-color-schemes" content="only light"></head>'
    + '<body style="margin:0;padding:0;background:#EEF2F7;color:#0F1E3D">'
    + '<div style="font-family:Inter,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto">'
    + '<div style="background-color:#0B1220;background-image:linear-gradient(135deg,#0B1220,#1E293B);color:#fff;padding:20px 22px;border-radius:14px 14px 0 0">'
    + '<div>' + ppLogo + '</div><div style="font-size:19px;font-weight:800;font-style:italic;margin-top:14px">' + titre + '</div></div>'
    + '<div style="height:4px;background:#F97316;line-height:4px;font-size:0">&nbsp;</div>'
    + '<div style="border:1px solid #E7EBF0;border-top:none;padding:20px;border-radius:0 0 14px 14px">' + corps + '</div></div></body></html>';
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const db = admin();
  if (!db) return json({ error: "Service indisponible (configuration serveur)." }, 500);

  try {
    // ---------- GET : société + véhicules réservables disponibles sur le créneau ----------
    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = clean(url.searchParams.get("t") || "", 120);
      const ctx = await resoudreToken(db, token);
      if (!ctx) return json({ error: "Lien de réservation invalide ou désactivé." }, 404);
      const cfg = await societeConfig(db, ctx.societe, ctx.data);
      const d0 = ts(url.searchParams.get("debut")), f0 = ts(url.searchParams.get("fin"));

      const { data: vehsRaw } = await db.from("vehicules").select("id,immat,marque,modele,categorie,carburant,photo_url,groupes,statut").eq("societe", ctx.societe);
      const vehs = Array.isArray(vehsRaw) ? vehsRaw as Array<Record<string, unknown>> : [];
      const okIds = reservableIds(ctx.data, vehs);
      let resas: Array<Record<string, unknown>> = [];
      if (d0 != null && f0 != null) { const { data: r } = await db.from("reservations").select("vehicule_id,debut,fin,statut,deleted_at").eq("societe", ctx.societe); resas = Array.isArray(r) ? r as Array<Record<string, unknown>> : []; }

      const list = vehs.filter((v) => okIds.has(String(v.id)))
        .filter((v) => (d0 != null && f0 != null) ? vehiculeLibre(v, ctx.data, resas, String(v.id), d0, f0) : !HORS.includes(statutNorm(v.statut)))
        .map((v) => ({ id: v.id, immat: v.immat || "", marque: v.marque || "", modele: v.modele || "", categorie: v.categorie || "", carburant: v.carburant || "", photoUrl: v.photo_url || "" }));
      return json({ ok: true, societe: cfg.nomSoc || "", vehicules: list, total: okIds.size });
    }

    // ---------- POST : demande de réservation ----------
    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try { body = await req.json(); } catch { return json({ error: "Requête invalide." }, 400); }
      if (String(body.action || "") !== "submit") return json({ error: "Action inconnue." }, 400);
      const token = clean(body.t, 120);
      const ctx = await resoudreToken(db, token);
      if (!ctx) return json({ error: "Lien invalide ou désactivé." }, 404);

      const vehId = clean(body.vehiculeId, 80);
      const d0 = ts(body.debut), f0 = ts(body.fin);
      const nom = clean(body.nom, 120), email = clean(body.email, 160), tel = clean(body.tel, 40), motif = clean(body.motif, 400);
      if (!vehId || d0 == null || f0 == null) return json({ error: "Créneau ou véhicule manquant." }, 400);
      if (f0 <= d0) return json({ error: "La fin doit être après le début." }, 400);
      if (!nom || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Nom et e-mail professionnel valides requis." }, 400);

      // Véhicule de CETTE société, réservable, et LIBRE (autorité serveur, anti-concurrence).
      const { data: vehsRaw } = await db.from("vehicules").select("id,immat,marque,modele,groupes,statut").eq("societe", ctx.societe);
      const vehs = Array.isArray(vehsRaw) ? vehsRaw as Array<Record<string, unknown>> : [];
      const veh = vehs.find((v) => String(v.id) === vehId);
      if (!veh || !reservableIds(ctx.data, vehs).has(vehId)) return json({ error: "Ce véhicule n'est pas proposé à la réservation." }, 400);
      const { data: r } = await db.from("reservations").select("vehicule_id,debut,fin,statut,deleted_at").eq("societe", ctx.societe);
      const resas = Array.isArray(r) ? r as Array<Record<string, unknown>> : [];
      if (!vehiculeLibre(veh, ctx.data, resas, vehId, d0, f0)) return json({ error: "Désolé, ce véhicule vient d'être pris sur ce créneau. Choisis un autre créneau ou véhicule." }, 409);

      const rec = {
        id: genId("RES"), societe: ctx.societe, vehicule_id: vehId, immat: String(veh.immat || ""),
        demandeur_nom: nom, demandeur_email: email, demandeur_tel: tel, motif,
        debut: new Date(d0).toISOString(), fin: new Date(f0).toISOString(),
        statut: "en_attente", verifie: false, source: "public",
      };
      const ins = await db.from("reservations").insert(rec);
      if (ins.error) return json({ error: "Échec de l'enregistrement. Réessaie." }, 500);

      const vehLbl = [veh.marque, veh.modele].filter(Boolean).join(" ") || String(veh.immat || "le véhicule");
      const per = new Date(d0).toLocaleString("fr-FR") + " → " + new Date(f0).toLocaleString("fr-FR");
      // Notifie le(s) gestionnaire(s)
      await sendPush(db, ctx.societe, { title: "🚗 Nouvelle demande de réservation", body: nom + " — " + vehLbl + " (" + per + ")", url: "./pages/emprunts.html", tag: "resa-" + rec.id });
      const key = Deno.env.get("RESEND_API_KEY") || "";
      const cfg = await societeConfig(db, ctx.societe, ctx.data);
      if (cfg.to.length) {
        const corps = '<p style="margin:0 0 12px;line-height:1.55"><b>' + esc(nom) + '</b> demande à réserver :</p>'
          + '<div style="background:#f8fafc;border-radius:10px;padding:11px 14px;margin:0 0 12px;font-size:13px;color:#334155">🚗 <b>' + esc(vehLbl) + '</b> · ' + esc(String(veh.immat || "")) + '<br>📅 ' + esc(per) + (motif ? '<br>📝 ' + esc(motif) : '') + '</div>'
          + '<p style="margin:0 0 4px;font-size:13px">Contact : ' + esc(email) + (tel ? ' · ' + esc(tel) : '') + '</p>'
          + '<p style="margin:14px 0 0;font-size:12px;color:#64748b">À valider dans <b>Parc Pilot → Emprunt véhicule → Réservations</b>.</p>';
        await sendEmail(key, cfg.from, cfg.to, "Demande de réservation — " + vehLbl, mailWrap("🚗 Demande de réservation", corps), nom + " demande à réserver " + vehLbl + " (" + per + "). À valider dans Parc Pilot.", cfg.replyTo || email);
      }
      // Confirme la réception au demandeur (à son e-mail pro → trace d'identité).
      if (key) {
        const corpsD = '<p style="margin:0 0 12px;line-height:1.55">Bonjour ' + esc(nom.split(" ")[0] || "") + ',</p>'
          + '<p style="margin:0 0 12px;line-height:1.55">Ta demande de réservation a bien été reçue :</p>'
          + '<div style="background:#f8fafc;border-radius:10px;padding:11px 14px;margin:0 0 12px;font-size:13px;color:#334155">🚗 <b>' + esc(vehLbl) + '</b><br>📅 ' + esc(per) + '</div>'
          + '<p style="margin:0;line-height:1.55">Elle est <b>en attente de validation</b> par le gestionnaire. Tu recevras une confirmation dès qu\'elle est acceptée.</p>';
        await sendEmail(key, cfg.from, [email], "Votre demande de réservation — " + vehLbl, mailWrap("🚗 Demande reçue", corpsD), "Ta demande de réservation de " + vehLbl + " (" + per + ") est en attente de validation.", cfg.replyTo || "");
      }
      return json({ ok: true });
    }

    return json({ error: "Méthode non autorisée." }, 405);
  } catch (e) {
    return json({ error: (e && (e as Error).message) || "Erreur serveur." }, 500);
  }
});
