// ============================================================================
//  Parc Pilot — IMPORT AUTOMATIQUE QUOTIDIEN des factures Ulys + ALERTE E-MAIL
//
//  Problème résolu : jusqu'ici, les factures Ulys ne s'importaient QUE si on ouvrait
//  l'onglet « Contrôle → Ulys » dans l'app (synchro discrète à l'ouverture). Si personne
//  n'ouvrait l'onglet, rien n'entrait et AUCUNE alerte ne partait (la notification était
//  une notif « locale » navigateur, pas un e-mail). Résultat : on apprenait la nouvelle
//  facture par le mail d'Ulys, pas par Parc Pilot.
//
//  Cette fonction tourne CÔTÉ SERVEUR, 1×/jour (tâche planifiée pg_cron) :
//    1) elle appelle l'API Ulys (getinvoices) avec le jeton secret ;
//    2) elle insère dans la table `factures` les factures ABSENTES (anti-doublon par
//       n° de facture) — en-têtes HT / TVA / TTC, fournisseur « Ulys » → onglet Ulys ;
//    3) s'il y a du nouveau, elle envoie un E-MAIL d'alerte au gestionnaire (comme le
//       fait Ulys), avec la liste des factures importées.
//
//  ⚠️ Le DÉTAIL par conducteur (transaction par transaction) reste rempli par l'app à la
//     prochaine ouverture de l'onglet Ulys (FP.ulysApi.importConsoRecent, idempotent) :
//     il nécessite le parseur CSV côté client — on ne le duplique pas ici. Les EN-TÊTES
//     (le plus important : la facture existe + ses montants) entrent bien tout seuls.
//
//  DÉCLENCHEMENT : 1×/jour par pg_cron → net.http_post (voir supabase/ulys-daily-setup.sql).
//    Peut aussi être lancée à la main par un CEO (JWT) avec body {"dryRun": true} pour
//    voir ce qui SERAIT importé sans rien écrire ni envoyer.
//
//  SÉCURITÉ : verify_jwt=false (voir config.toml). L'appel doit fournir l'en-tête
//    x-cron-secret == ULYS_DAILY_SECRET **OU** == KM_RELANCE_SECRET (réutilisable, pour
//    n'avoir qu'un seul secret cron à gérer), OU un JWT de CEO (is_admin) pour un test. Sinon 401.
//
//  SECRETS (Supabase → Edge Functions → Secrets) :
//    ULYS_BEARER / ULYS_INITIATOR = déjà utilisés par `ulys-sync` (jeton API Ulys).
//    ULYS_BASE      = (option) URL de base Ulys. Défaut = PRODUCTION.
//    ULYS_SOCIETE   = (option) société propriétaire du compte Ulys. Défaut « PXP ».
//    ULYS_DAILY_SECRET = secret de la tâche cron (ou réutilise KM_RELANCE_SECRET).
//    ULYS_ALERT_TO  = (option) destinataire(s) de l'alerte, séparés par des virgules.
//                     Si absent → on prend l'expéditeur + la copie de la société (réglages).
//    RESEND_API_KEY / EMAIL_FROM = déjà présents (utilisés par send-email).
//
//  Vérifier la config (sans secret) : GET sur l'URL de la fonction → renvoie des booléens
//    (clé Ulys présente ? secret cron présent ? Resend présent ?), AUCUNE valeur secrète.
//
//  Déploiement : automatique (GitHub Action deploy-edge-functions.yml au push sur main).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PROD_BASE = "https://ulys-api-partner.vinci-autoroutes.com";

// Appel GET vers l'API Ulys (mêmes en-têtes que ulys-sync). Renvoie { ok, status, data|error }.
async function ulysGet(path: string) {
  const bearer = (Deno.env.get("ULYS_BEARER") || "").trim();
  const initiator = (Deno.env.get("ULYS_INITIATOR") || "").trim();
  const base = (Deno.env.get("ULYS_BASE") || PROD_BASE).replace(/\/+$/, "");
  if (!bearer || !initiator) return { ok: false, status: 500, error: "Configuration Ulys incomplète (ULYS_BEARER / ULYS_INITIATOR)." };
  let res: Response;
  try {
    res = await fetch(base + path, { method: "GET", headers: { "Authorization": `Bearer ${bearer}`, "x-initiator": initiator, "Accept": "application/json" } });
  } catch (e) { return { ok: false, status: 502, error: "Impossible de joindre Ulys : " + (e instanceof Error ? e.message : String(e)) }; }
  if (res.status === 429) return { ok: false, status: 429, error: "Limite d'appels Ulys atteinte pour aujourd'hui." };
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) return { ok: false, status: res.status, error: (data && typeof data === "object" ? JSON.stringify(data) : String(data || "")) || `Erreur Ulys (${res.status}).` };
  return { ok: true, status: 200, data };
}

// ── E-mail d'alerte (branded sobre, schéma clair forcé — comme km-relance / send-email) ──
function mailDoc(inner: string): string {
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="color-scheme" content="only light"><meta name="supported-color-schemes" content="only light">'
    + '</head><body style="margin:0;padding:0;background:#EEF2F7;color:#0F1E3D">' + inner + '</body></html>';
}
function ppLogoMail(): string {
  return '<span style="display:inline-block;vertical-align:middle;line-height:0;margin-right:9px">'
    + '<span style="display:block;width:17px;height:4px;background:#F8A24A;border-radius:3px"></span>'
    + '<span style="display:block;width:26px;height:4px;background:#F97316;border-radius:3px;margin-top:3px"></span>'
    + '<span style="display:block;width:11px;height:4px;background:#F97316;border-radius:3px;margin-top:3px"></span>'
    + '</span>'
    + '<span style="font-weight:900;font-style:italic;font-size:16px;color:#ffffff;vertical-align:middle">Parc</span>'
    + '<span style="vertical-align:middle">&#160;</span>'
    + '<span style="font-weight:900;font-style:italic;font-size:16px;color:#F97316;vertical-align:middle">Pilot</span>';
}
function euro(n: number): string {
  try { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(n) || 0); } catch { return (Number(n) || 0).toFixed(2) + " €"; }
}
function buildAlertMail(opts: { nomSoc: string; logoUrl: string; link: string; rows: Array<{ date: string; num: string; ttc: number; type: string }> }) {
  const { nomSoc, logoUrl, link, rows } = opts;
  const n = rows.length;
  const total = rows.reduce((s, r) => s + (Number(r.ttc) || 0), 0);
  const subject = n + " nouvelle" + (n > 1 ? "s" : "") + " facture" + (n > 1 ? "s" : "") + " Ulys (télépéage)";
  const head = logoUrl
    ? '<img src="' + esc(logoUrl) + '" alt="' + esc(nomSoc || "Logo") + '" style="max-height:40px;max-width:180px;object-fit:contain;background:#fff;border-radius:8px;padding:5px 8px;display:block">'
    : (nomSoc ? '<span style="font-weight:900;font-size:17px;color:#fff">' + esc(nomSoc) + '</span>' : ppLogoMail());
  const lignes = rows.map((r) => {
    const d = String(r.date || "").slice(0, 10).split("-").reverse().join("/");
    const lib = r.type === "ELEC" ? "Recharge élec." : "Péages";
    return '<tr>'
      + '<td style="padding:8px 10px;border-bottom:1px solid #EEF2F7;font-size:13px;white-space:nowrap">' + esc(d) + '</td>'
      + '<td style="padding:8px 10px;border-bottom:1px solid #EEF2F7;font-size:13px">' + esc(r.num) + '<div style="color:#94A3B8;font-size:11px">' + lib + '</div></td>'
      + '<td style="padding:8px 10px;border-bottom:1px solid #EEF2F7;font-size:13px;font-weight:700;text-align:right;white-space:nowrap">' + esc(euro(r.ttc)) + '</td>'
      + '</tr>';
  }).join("");
  const html = ''
    + '<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0F1E3D">'
    + '<div style="background-color:#0B1220;background-image:linear-gradient(135deg,#0B1220,#1E293B);color:#fff;padding:20px 24px;border-radius:16px 16px 0 0">'
    + '<div>' + head + '</div>'
    + '<div style="font-size:19px;font-weight:800;font-style:italic;margin-top:14px;color:#fff">🛣️ ' + n + ' nouvelle' + (n > 1 ? "s" : "") + ' facture' + (n > 1 ? "s" : "") + ' Ulys</div>'
    + '</div>'
    + '<div style="border:1px solid #E7EBF0;border-top:none;padding:20px 24px">'
    + '<p style="margin:0 0 14px;line-height:1.55;font-size:14px">' + (n > 1 ? "Elles ont" : "Elle a") + ' été importée' + (n > 1 ? "s" : "") + ' automatiquement dans <b>Parc&nbsp;Pilot</b> (onglet Factures → Ulys) via la connexion à ton compte VINCI Autoroutes.</p>'
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #EEF2F7;border-radius:10px;overflow:hidden">'
    + '<tr style="background:#F8FAFC"><th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748B;text-transform:uppercase">Date</th><th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748B;text-transform:uppercase">N° de facture</th><th style="padding:8px 10px;text-align:right;font-size:11px;color:#64748B;text-transform:uppercase">TTC</th></tr>'
    + lignes
    + '<tr style="background:#F8FAFC"><td colspan="2" style="padding:10px;font-weight:800;font-size:13px">Total</td><td style="padding:10px;font-weight:800;font-size:13px;text-align:right;white-space:nowrap">' + esc(euro(total)) + '</td></tr>'
    + '</table>'
    + '<p style="margin:16px 0 0;font-size:12px;color:#64748B;line-height:1.5">💡 Le <b>détail par conducteur</b> (trajet par trajet) se complète automatiquement à ta prochaine ouverture de l\'onglet <b>Contrôle → Ulys</b>.</p>'
    + '<p style="text-align:center;margin:22px 0 6px">'
    + '<a href="' + esc(link) + '" style="display:inline-block;background-color:#0B1220;background-image:linear-gradient(135deg,#0B1220,#1E293B);color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-weight:800;font-size:15px">Voir les factures →</a>'
    + '</p>'
    + '</div>'
    + '<div style="background-color:#0B1220;padding:18px 22px;border-radius:0 0 14px 14px;text-align:center"><div>' + ppLogoMail() + '</div></div>'
    + '</div>';
  const text = subject + "\n\n" + rows.map((r) => (String(r.date || "").slice(0, 10) + " · " + r.num + " · " + euro(r.ttc))).join("\n") + "\n\nTotal : " + euro(total) + "\n\n" + link;
  return { subject, html: mailDoc(html), text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── Point de contrôle PUBLIC (GET) : dit juste SI la config est présente (booléens, aucune valeur). ──
  if (req.method === "GET") {
    return json({
      ok: true,
      ulysConfigured: !!(Deno.env.get("ULYS_BEARER") || "").trim() && !!(Deno.env.get("ULYS_INITIATOR") || "").trim(),
      cronSecretSet: !!(Deno.env.get("ULYS_DAILY_SECRET") || "").trim() || !!(Deno.env.get("KM_RELANCE_SECRET") || "").trim(),
      resendSet: !!(Deno.env.get("RESEND_API_KEY") || "").trim(),
      emailFromSet: !!(Deno.env.get("EMAIL_FROM") || "").trim(),
      alertToSet: !!(Deno.env.get("ULYS_ALERT_TO") || "").trim(),
      societe: (Deno.env.get("ULYS_SOCIETE") || "PXP").trim(),
      base: (Deno.env.get("ULYS_BASE") || PROD_BASE),
    });
  }
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  const SUPA = Deno.env.get("SUPABASE_URL");
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPA || !SERVICE) return json({ error: "Configuration serveur incomplète." }, 500);

  // ── Authentification : secret cron (ULYS_DAILY_SECRET ou KM_RELANCE_SECRET) OU JWT de CEO. ──
  const SECRET1 = (Deno.env.get("ULYS_DAILY_SECRET") || "").trim();
  const SECRET2 = (Deno.env.get("KM_RELANCE_SECRET") || "").trim();
  const provided = (req.headers.get("x-cron-secret") || "").trim();
  let authed = false;
  if (provided && ((SECRET1 && provided === SECRET1) || (SECRET2 && provided === SECRET2))) authed = true;
  if (!authed) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (token && ANON) {
      try {
        const u = await fetch(`${SUPA}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON } });
        if (u.ok) {
          const uj = await u.json().catch(() => null);
          const id = (uj && (uj.id || (uj.user && uj.user.id))) || "";
          if (id) {
            const pr = await fetch(`${SUPA}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=is_admin`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
            if (Array.isArray(pr) && pr[0] && pr[0].is_admin) authed = true;
          }
        }
      } catch (_) { /* ignore */ }
    }
  }
  if (!authed) return json({ error: "Non autorisé." }, 401);

  let body: { dryRun?: boolean } = {};
  try { body = await req.json(); } catch { /* body vide = ok */ }
  const dryRun = !!body.dryRun;

  const owner = (Deno.env.get("ULYS_SOCIETE") || "PXP").trim();
  const RESEND_KEY = (Deno.env.get("RESEND_API_KEY") || "").trim();
  // ⚠️ Repli sur un domaine VÉRIFIÉ dans Resend (seul projectxparis.fr l'est aujourd'hui) : l'adresse de
  // test onboarding@resend.dev ne peut écrire QU'au titulaire du compte → échec vers un destinataire tiers.
  // N'affecte QUE le repli (une société avec mailExpediteur configuré garde son adresse scopée ci-dessous).
  let envFrom = Deno.env.get("EMAIL_FROM") || "";
  if (!envFrom || /resend\.dev/i.test(envFrom)) envFrom = "Parc Pilot <noreply@projectxparis.fr>";
  const BASE = "https://parc-pilot.fr";

  const admin = createClient(SUPA, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1) Factures Ulys côté API.
  const inv = await ulysGet("/api/invoices/getinvoices/");
  if (!inv.ok) return json({ error: inv.error }, inv.status || 502);
  const invList = Array.isArray(inv.data) ? inv.data as any[] : [];

  // 2) N° de factures DÉJÀ en base pour la société propriétaire (anti-doublon). PXP inclut les lignes
  //    sans étiquette société (rétro-compatibilité, comme filterSociete côté client).
  const isPXP = owner.toUpperCase() === "PXP";
  const existQuery = isPXP ? "factures?select=numero_facture&or=(societe.eq.PXP,societe.is.null)" : `factures?select=numero_facture&societe=eq.${encodeURIComponent(owner)}`;
  const existRows = await fetch(`${SUPA}/rest/v1/${existQuery}&limit=100000`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const have = new Set((Array.isArray(existRows) ? existRows : []).map((f: any) => String(f.numero_facture || "").toUpperCase()).filter(Boolean));

  // 3) Insertion des nouvelles (en-têtes). Colonnes snake_case (mapping identique à FP.db).
  const added: Array<{ date: string; num: string; ttc: number; type: string }> = [];
  let skipped = 0;
  for (const i of invList) {
    const idn = String(i.invoiceId || "").toUpperCase();
    if (!idn || have.has(idn)) { skipped++; continue; }
    const isElec = i.invoiceType === "ELEC";
    const row = {
      id: "ULYS-" + i.invoiceId,
      societe: owner,
      date: String(i.invoiceDate || "").slice(0, 10) || null,
      fournisseur: "Ulys",
      numero_facture: i.invoiceId,
      montant_ht: Number(i.vatExcludedTotal) || 0,
      montant_tva: Number(i.vatAmount) || 0,
      montant_ttc: Number(i.vatIncludedTotal) || 0,
      description: isElec ? "Recharge électrique Ulys" : "Péages Ulys (télépéage)",
      type: "ulys",
    };
    if (dryRun) { added.push({ date: row.date || "", num: row.numero_facture, ttc: row.montant_ttc, type: i.invoiceType || "TLP" }); have.add(idn); continue; }
    const { error } = await admin.from("factures").upsert(row, { onConflict: "id" });
    if (error) { skipped++; continue; }
    added.push({ date: row.date || "", num: row.numero_facture, ttc: row.montant_ttc, type: i.invoiceType || "TLP" });
    have.add(idn);
  }

  // 4) Alerte e-mail si du nouveau.
  let emailed = false, mailError = "", recipients: string[] = [];
  if (added.length > 0) {
    // Destinataires : ULYS_ALERT_TO (secret), sinon expéditeur + copie de la société (réglages).
    const alertTo = (Deno.env.get("ULYS_ALERT_TO") || "").split(",").map((s) => s.trim()).filter(Boolean);
    let profil: any = {}, societeCfg: any = {};
    try {
      const setRows = await fetch(`${SUPA}/rest/v1/app_settings?id=eq.${encodeURIComponent(owner)}&select=data`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
      const data = (Array.isArray(setRows) && setRows[0] && setRows[0].data) || {};
      profil = (data.profil && typeof data.profil === "object") ? data.profil : {};
      societeCfg = (data.societe && typeof data.societe === "object") ? data.societe : {};
    } catch (_) { /* repli sur ULYS_ALERT_TO / EMAIL_FROM */ }
    const fromCfg = [String(profil.mailExpediteur || "").trim(), String(profil.mailCopie || "").trim()].filter(Boolean);
    recipients = [...new Set((alertTo.length ? alertTo : fromCfg).map((x) => x.toLowerCase()))];

    // Expéditeur scopé société (mirror send-email / km-relance), repli neutre plateforme EMAIL_FROM.
    let from = envFrom, replyTo = "";
    const exp = String(profil.mailExpediteur || "").trim();
    if (exp) {
      const dom = String(profil.mailDomaineEnvoi || "").trim().replace(/^@/, "");
      const fromAddr = dom ? (exp.split("@")[0] + "@" + dom) : exp;
      let nom = String(societeCfg.nom || "").replace(/[<>"]/g, "").trim();
      if (/^parc\s*pilot$/i.test(nom)) nom = "";
      from = nom ? `${nom} <${fromAddr}>` : fromAddr;
      replyTo = exp;
    }
    const logoUrl = /^https?:\/\//.test(String(profil.logoUrl || "")) ? String(profil.logoUrl) : "";
    const nomSoc = String(societeCfg.nom || "").trim();
    const mail = buildAlertMail({ nomSoc, logoUrl, link: BASE + "/pages/factures.html", rows: added });

    if (dryRun) {
      // rien envoyé — on renvoie juste à qui ça PARTIRAIT.
    } else if (!RESEND_KEY) {
      mailError = "RESEND_API_KEY absent.";
    } else if (!recipients.length) {
      mailError = "Aucun destinataire (configure ULYS_ALERT_TO ou l'e-mail d'envoi de la société).";
    } else {
      const payload: Record<string, unknown> = { from, to: recipients, subject: mail.subject, html: mail.html, text: mail.text };
      if (replyTo) payload.reply_to = replyTo;
      try {
        const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (r.ok) emailed = true;
        else mailError = (await r.text().catch(() => "")).slice(0, 200);
      } catch (e) { mailError = String(e).slice(0, 200); }
    }
  }

  return json({ ok: true, dryRun, societe: owner, added: added.length, skipped, imported: added, emailed, recipients, mailError });
});
