// ============================================================================
//  Parc Pilot — Lecture de la boîte Gmail connectée (Option B, Lot 2a : socle de LECTURE)
// ============================================================================
//  Lit les NOUVEAUX e-mails de la boîte connectée à une société (via le jeton de
//  rafraîchissement stocké par gmail-oauth), repère les VRAIS PDF joints (jamais un
//  simple lien Drive — on ne lit que les pièces jointes, pas les liens du corps), et
//  renvoie de quoi afficher une boîte « à trier » : expéditeur, objet, date, extrait,
//  et la liste des PDF joints. Une action séparée renvoie le contenu d'une pièce jointe
//  pour l'aperçu. ⚠️ Lot 2a = LECTURE + LISTE uniquement : aucun import de facture ici
//  (ça, c'est le Lot 3, via FP.scanIA + anti-doublon FP.dupe).
//
//  ⚠️ SÉCURITÉ (identique à gmail-oauth) :
//   • Scope Gmail = LECTURE SEULE (gmail.readonly). On ne modifie jamais la boîte.
//   • Le secret client et le jeton de rafraîchissement restent CÔTÉ SERVEUR.
//   • JWT obligatoire + rôle CEO/Admin (via profiles) ; scoping par société.
//   • Le jeton vit dans la table PRIVÉE gmail_connexions (service_role).
//
//  DORMANT : si les secrets OAuth sont absents → configured:false, aucun appel Google.
//
//  Actions (POST { action }):
//   • 'list'       { since?, max? } → { ok, configured, connected, messages:[…] }
//        since = borne basse (ISO ou 'YYYY/MM/DD') ; défaut = date de connexion de la
//        boîte (gmail_connexions.created_at) → « à partir de l'activation », pas de rattrapage.
//   • 'attachment' { messageId, attachmentId } → { ok, filename, mimeType, dataB64 }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { T } from "../_shared/triage.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

function profileToAcces(p: { is_admin?: boolean; role?: string } | null) {
  if (!p) return "";
  if (p.is_admin) return "ceo";
  return p.role === "gestionnaire" ? "gestionnaire" : "admin";
}

// ---- Parseur PUR d'un message Gmail (format=full) → forme Parc Pilot (testable) ----
type Pdf = { filename: string; attachmentId: string; size: number };
type Parsed = { id: string; threadId: string; from: string; fromEmail: string; subject: string; date: string; snippet: string; pdfs: Pdf[]; hasPdf: boolean };

function headerOf(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  const h = (headers || []).find((x) => (x.name || "").toLowerCase() === name.toLowerCase());
  return (h && h.value) ? String(h.value) : "";
}
function emailOf(from: string): string {
  const m = /<([^>]+)>/.exec(from || "");
  if (m) return m[1].trim();
  const m2 = /([^\s<>]+@[^\s<>]+)/.exec(from || "");
  return m2 ? m2[1].trim() : "";
}
// Parcourt récursivement les parts à la recherche de VRAIES pièces jointes PDF
// (mimeType application/pdf OU nom de fichier .pdf) portant un body.attachmentId.
// Un lien Google Drive est dans le CORPS du message (text/html), pas une part avec
// attachmentId → il est naturellement ignoré ici.
function collectPdfs(payload: any, out: Pdf[]): void {
  if (!payload || typeof payload !== "object") return;
  const fn = String(payload.filename || "");
  const mt = String(payload.mimeType || "");
  const attId = payload.body && payload.body.attachmentId ? String(payload.body.attachmentId) : "";
  const isPdf = mt === "application/pdf" || /\.pdf$/i.test(fn);
  if (attId && fn && isPdf) {
    out.push({ filename: fn, attachmentId: attId, size: Number((payload.body && payload.body.size) || 0) });
  }
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const p of parts) collectPdfs(p, out);
}
export function parseGmailMessage(msg: any): Parsed {
  const payload = (msg && msg.payload) || {};
  const headers = payload.headers || [];
  const from = headerOf(headers, "From");
  const pdfs: Pdf[] = [];
  collectPdfs(payload, pdfs);
  return {
    id: String((msg && msg.id) || ""),
    threadId: String((msg && msg.threadId) || ""),
    from,
    fromEmail: emailOf(from),
    subject: headerOf(headers, "Subject"),
    date: headerOf(headers, "Date"),
    snippet: String((msg && msg.snippet) || ""),
    pdfs,
    hasPdf: pdfs.length > 0,
  };
}

// ---- Échange refresh_token → access_token (lecture seule) ----
async function accessTokenFrom(refresh: string, clientId: string, clientSecret: string): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const d = await r.json().catch(() => null) as Record<string, unknown> | null;
  if (!r.ok || !d || !d.access_token) throw new Error("Jeton Google invalide ou révoqué — reconnecte la boîte.");
  return String(d.access_token);
}

// 'since' (ISO ou YYYY/MM/DD) → 'after:<unix>' pour la requête Gmail.
function sinceToQuery(since: string): string {
  let ms = Date.parse(since);
  if (isNaN(ms)) { const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(since || ""); if (m) ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`); }
  const unix = isNaN(ms) ? Math.floor((Date.now() - 7 * 864e5) / 1000) : Math.floor(ms / 1000);
  return `after:${unix}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  const SUPA = Deno.env.get("SUPABASE_URL");
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPA || !SERVICE) return json({ error: "Configuration serveur incomplète." }, 500);
  const CLIENT_ID = (Deno.env.get("GMAIL_OAUTH_CLIENT_ID") || "").trim();
  const CLIENT_SECRET = (Deno.env.get("GMAIL_OAUTH_CLIENT_SECRET") || "").trim();
  const configured = !!(CLIENT_ID && CLIENT_SECRET);

  const admin = createClient(SUPA, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Non connecté." }, 401);
  const { data: { user: caller } } = await admin.auth.getUser(token);
  if (!caller) return json({ error: "Session expirée — reconnecte-toi." }, 401);
  const { data: me } = await admin.from("profiles").select("is_admin,role,societe").eq("id", caller.id).maybeSingle();
  const acces = profileToAcces(me);
  const isCEO = acces === "ceo";
  const isAdmin = acces === "admin";
  if (!isCEO && !isAdmin) return json({ error: "Accès refusé : réservé au CEO et aux administrateurs." }, 403);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = String((body as Record<string, unknown>).action || "list");
  const societe = isCEO
    ? String((body as Record<string, unknown>).societe || me?.societe || "").trim()
    : String(me?.societe || "").trim();
  if (!societe) return json({ error: "Société introuvable pour cette action." }, 400);

  if (!configured) return json({ ok: true, configured: false, connected: false, messages: [], error: "Intégration Gmail non configurée (secrets absents)." });

  // Connexion de la société (jeton + date de connexion = borne basse par défaut).
  const { data: conx } = await admin.from("gmail_connexions").select("refresh_token,email,created_at").eq("societe", societe).maybeSingle();
  if (!conx || !conx.refresh_token) return json({ ok: true, configured: true, connected: false, messages: [], error: "Aucune boîte Gmail connectée pour cette société." });

  let access: string;
  try { access = await accessTokenFrom(String(conx.refresh_token), CLIENT_ID, CLIENT_SECRET); }
  catch (e) { return json({ ok: false, configured: true, connected: true, error: String((e as Error).message || e) }, 502); }

  const gfetch = (url: string) => fetch(url, { headers: { Authorization: `Bearer ${access}` } });

  // ---- attachment : contenu d'une pièce jointe (pour l'aperçu) ----
  if (action === "attachment") {
    const messageId = String((body as Record<string, unknown>).messageId || "").trim();
    const attachmentId = String((body as Record<string, unknown>).attachmentId || "").trim();
    if (!messageId || !attachmentId) return json({ error: "messageId et attachmentId requis." }, 400);
    const r = await gfetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
    const d = await r.json().catch(() => null) as Record<string, unknown> | null;
    if (!r.ok || !d || !d.data) return json({ error: "Pièce jointe introuvable." }, 404);
    // Gmail renvoie en base64url → on repasse en base64 standard pour un Blob côté client.
    const b64 = String(d.data).replace(/-/g, "+").replace(/_/g, "/");
    return json({ ok: true, mimeType: "application/pdf", dataB64: b64 });
  }

  // ---- labels : liste des libellés de la boîte (pour le sélecteur « libellé surveillé ») ----
  //  Ne renvoie que les libellés UTILISATEUR (on écarte les libellés système CATEGORY_*, INBOX…).
  if (action === "labels") {
    const r = await gfetch("https://gmail.googleapis.com/gmail/v1/users/me/labels");
    const d = await r.json().catch(() => null) as Record<string, unknown> | null;
    if (!r.ok || !d) return json({ ok: false, configured: true, connected: true, error: "Lecture des libellés refusée." }, 502);
    const raw = Array.isArray(d.labels) ? d.labels as Array<Record<string, unknown>> : [];
    const labels = raw
      .filter((l) => String(l.type || "user") === "user")
      .map((l) => ({ id: String(l.id || ""), name: String(l.name || "") }))
      .filter((l) => l.id && l.name)
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return json({ ok: true, configured: true, connected: true, email: conx.email || null, labels });
  }

  // ---- test : APERÇU des mails qui correspondraient au réglage (source + raison). N'ÉCRIT RIEN,
  //      ne crée aucune facture, ne joint aucun document, ne touche aucun dossier (lecture seule). ----
  if (action === "test") {
    const labelName = String((body as Record<string, unknown>).labelName || "").trim();
    const labelId = String((body as Record<string, unknown>).labelId || "").trim();
    const max = Math.min(Math.max(Number((body as Record<string, unknown>).max || 8) || 8, 1), 15);
    // Fenêtre récente (60 j) indépendante de la date de connexion → montre « quelques mails récents ».
    const sinceUnix = Math.floor((Date.now() - 60 * 864e5) / 1000);
    const q = T.gmailQuery({ sinceUnix, labelName });
    const lr = await gfetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(q)}`);
    const ld = await lr.json().catch(() => null) as Record<string, unknown> | null;
    if (!lr.ok || !ld) return json({ ok: false, configured: true, connected: true, error: "Recherche Gmail refusée (le libellé existe-t-il encore ?)." }, 502);
    const ids: string[] = Array.isArray(ld.messages) ? (ld.messages as Array<{ id: string }>).map((m) => m.id) : [];
    // Contexte flotte (plaques + n° d'avis) pour une raison pertinente — scopé à la société de l'appelant.
    const [{ data: vehs }, { data: ams }, { data: conds }] = await Promise.all([
      admin.from("vehicules").select("immat").eq("societe", societe),
      admin.from("amendes").select("numero_avis").eq("societe", societe),
      admin.from("conducteurs").select("email").eq("societe", societe),
    ]);
    const knownSenders = (conds || [])
      .map((c2: Record<string, unknown>) => String(c2.email || "").toLowerCase().trim())
      .filter((e: string) => e.indexOf("@") > 0);
    const ctx = {
      vehicules: (vehs || []).map((v: Record<string, unknown>) => ({ immat: v.immat })),
      amendes: (ams || []).map((a: Record<string, unknown>) => ({ numeroAvis: a.numero_avis })),
      sinistres: [] as unknown[], knownSenders, watchLabelId: labelId || null,
    };
    const apercu: Array<Record<string, unknown>> = [];
    for (const id of ids) {
      const mr = await gfetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
      if (!mr.ok) continue;
      const mj = await mr.json().catch(() => null);
      if (!mj) continue;
      const p = parseGmailMessage(mj);
      const labels = Array.isArray(mj.labelIds) ? mj.labelIds : [];
      const dec = T.classify({ ...p, labels }, ctx);
      apercu.push({
        id: p.id, from: p.fromEmail || p.from, subject: p.subject || "(sans objet)", date: p.date,
        source: T.sourceDe(labels, labelId), retenu: dec.action !== "ignore",
        domaine: dec.domaine, raison: dec.motif || "", hasPdf: p.hasPdf,
      });
    }
    return json({ ok: true, configured: true, connected: true, email: conx.email || null, query: q, count: apercu.length, apercu });
  }

  // ---- list : nouveaux messages depuis 'since' (défaut = date de connexion) ----
  if (action === "list") {
    const since = String((body as Record<string, unknown>).since || conx.created_at || "").trim();
    const max = Math.min(Math.max(Number((body as Record<string, unknown>).max || 40) || 40, 1), 80);
    const q = `in:inbox ${sinceToQuery(since)}`;
    const lr = await gfetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(q)}`);
    const ld = await lr.json().catch(() => null) as Record<string, unknown> | null;
    if (!lr.ok || !ld) return json({ ok: false, configured: true, connected: true, error: "Lecture Gmail refusée." }, 502);
    const ids: string[] = Array.isArray(ld.messages) ? (ld.messages as Array<{ id: string }>).map((m) => m.id) : [];
    const messages: Parsed[] = [];
    // Détail de chaque message (métadonnées + parts). Séquentiel et borné pour rester léger.
    for (const id of ids) {
      const mr = await gfetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
      if (!mr.ok) continue;
      const mj = await mr.json().catch(() => null);
      if (mj) messages.push(parseGmailMessage(mj));
    }
    return json({ ok: true, configured: true, connected: true, email: conx.email || null, since, messages });
  }

  return json({ error: "Action inconnue : " + action }, 400);
});
