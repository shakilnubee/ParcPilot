// ============================================================================
//  Parc Pilot — Signature électronique INTÉGRÉE d'un état des lieux (fonction PUBLIQUE)
//
//  L'employé (et le signataire société) reçoivent un lien signer.html?t=<token>&who=<role>.
//    • GET  ?t&who   → infos du document (plaque, modèle, PDF à consulter, déjà signé ?)
//    • POST { action:'sign', t, who, nom, signature(dataURL PNG) }
//                    → enregistre la signature ; quand TOUT le monde a signé, reconstruit le
//                      PDF signé (pdf-lib) et le range dans les Documents du véhicule.
//
//  ⚠️ PUBLIQUE (l'employé n'a pas de compte). Sécurité = le TOKEN secret du lien.
//     verify_jwt est désactivé pour cette fonction (supabase/config.toml).
//
//  Déploiement : automatique (GitHub Action au push sur main).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
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
const BUCKET = "scans";
// ⚠️ CLOISONNEMENT DES FICHIERS PAR SOCIÉTÉ (17/10/2026) : tout fichier va dans
// « societes/<dossier-société>/… ». fpSlug DOIT rester identique à public.fp_slug (SQL) et FP.storageSlug (app.js).
function fpSlug(s: unknown): string { return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "societe"; }
function dossierSociete(societe: unknown): string { return "societes/" + fpSlug(societe || "PXP"); }

// Extrait {bucket, path} d'une URL Supabase Storage (public|sign|authenticated) → pour re-signer.
function storagePath(url: string): { bucket: string; path: string } | null {
  const m = String(url || "").match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?]+)/);
  if (!m) return null;
  let p = m[2]; try { p = decodeURIComponent(p); } catch { /* garde */ }
  return { bucket: m[1], path: p };
}
async function signedUrl(db: ReturnType<typeof createClient>, url: string, secs = 86400) {
  const r = storagePath(url); if (!r) return url;
  try { const { data } = await db.storage.from(r.bucket).createSignedUrl(r.path, secs); return (data && data.signedUrl) || url; } catch { return url; }
}
async function fetchBytes(db: ReturnType<typeof createClient>, url: string): Promise<Uint8Array | null> {
  try {
    const r = storagePath(url);
    if (r) { const dl = await db.storage.from(r.bucket).download(r.path); if (dl.data) return new Uint8Array(await dl.data.arrayBuffer()); }
    const res = await fetch(url); if (res.ok) return new Uint8Array(await res.arrayBuffer());
  } catch { /* rien */ }
  return null;
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
function genId(p: string) { return p + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }

// ─── Notification PUSH au(x) gestionnaire(s) de la société (best-effort) ───
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
    const body = JSON.stringify({ title: payload.title || "Parc Pilot", body: payload.body || "", url: payload.url || "./pages/vehicules.html", tag: payload.tag, icon: "./assets/icons/icon-192.png" });
    await Promise.all((data as Array<Record<string, string>>).map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body); }
      catch (e) { const c = e && (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) { try { await db.from("push_subscriptions").delete().eq("id", s.id); } catch { /* ignore */ } } }
    }));
  } catch { /* best-effort */ }
}

// ─── Envoi d'e-mail (Resend) pour RELAYER le lien au signataire SUIVANT (signature séquentielle).
//    L'app (client) rend et envoie le 1er e-mail ; quand ce signataire signe, c'est CETTE fonction
//    qui envoie l'e-mail PRÉ-RENDU (stocké dans le signataire) au suivant. Le `from` est calculé
//    côté serveur depuis la config de la société (mailExpediteur + domaine) — comme send-email —
//    avec repli sur le secret EMAIL_FROM. Ce n'est PAS un relais ouvert : l'e-mail et le
//    destinataire sont ceux déjà enregistrés dans edl_signatures (aucune donnée venue de la requête).
async function societeFrom(db: ReturnType<typeof createClient>, societe: string): Promise<{ from: string; replyTo: string }> {
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
    if (exp) {
      const dom = String(p.mailDomaineEnvoi || "").trim().replace(/^@/, "");
      const fromAddr = dom ? (exp.split("@")[0] + "@" + dom) : exp;
      let nom = String((d.societe && (d.societe as Record<string, unknown>).nom) || "").replace(/[<>"]/g, "").trim();
      if (/^parc\s*pilot$/i.test(nom)) nom = "";
      return { from: nom ? `${nom} <${fromAddr}>` : fromAddr, replyTo: exp };
    }
  } catch { /* repli EMAIL_FROM */ }
  return { from: envFrom, replyTo: "" };
}
async function sendSignEmail(db: ReturnType<typeof createClient>, societe: string, to: string, subject: string, html: string, text: string): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY"); if (!key || !to) return false;
  const { from, replyTo } = await societeFrom(db, societe);
  const payload: Record<string, unknown> = { from, to: [to], subject: subject || "État des lieux à signer" };
  if (html) payload.html = html; if (text) payload.text = text; if (replyTo) payload.reply_to = replyTo;
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return r.ok;
  } catch { return false; }
}

type Signer = { role: string; nom?: string; email?: string; signed?: boolean; signedAt?: string; ip?: string; sigUrl?: string; ordre?: number; notified?: boolean; sigToken?: string; mailSubject?: string; mailHtml?: string; mailText?: string; refused?: boolean; refusMotif?: string; refusedAt?: string };

// Résout le signataire à partir du jeton reçu dans l'URL, de façon SÛRE :
//  1) jeton PROPRE au signataire (sigToken, liens récents) → identifie le signataire ET son rôle sans se
//     fier au paramètre `who` (falsifiable) → on ne peut plus signer « à la place » de l'autre partie ;
//  2) repli : jeton du DOCUMENT (anciens liens) → on retombe sur le paramètre `who`.
// Renvoie { row, me, who } ou null. `who` = rôle RÉEL retenu (à utiliser partout au lieu du param d'URL).
async function resolveSigner(db: ReturnType<typeof createClient>, t: string, whoParam: string) {
  if (!t) return null;
  // Cas 1 : sigToken (préfixe « sg- »). On cherche la ligne dont un signataire porte ce jeton.
  if (t.indexOf("sg-") === 0) {
    const { data: rows } = await db.from("edl_signatures").select("*").order("created_at", { ascending: false }).limit(2000);
    for (const r of ((rows || []) as Array<Record<string, unknown>>)) {
      const signers = (Array.isArray(r.signataires) ? r.signataires : []) as Signer[];
      const me = signers.find((s) => s.sigToken && s.sigToken === t);
      if (me) return { row: r, me, who: me.role };
    }
    return null;
  }
  // Cas 2 : jeton du document (compat) → who vient de l'URL.
  const { data: byDoc } = await db.from("edl_signatures").select("*").eq("token", t).maybeSingle();
  if (byDoc) {
    const signers = (Array.isArray(byDoc.signataires) ? byDoc.signataires : []) as Signer[];
    const me = signers.find((s) => s.role === whoParam) || null;
    return { row: byDoc, me, who: whoParam };
  }
  return null;
}

// Reconstruit le PDF signé : appose chaque signature (image PNG) sur SON champ (points, origine
// haut-gauche → pdf-lib origine bas-gauche), avec le nom + la date sous la signature.
async function buildSignedPdf(db: ReturnType<typeof createClient>, row: Record<string, unknown>, signers: Signer[]): Promise<Uint8Array | null> {
  try {
    const base = await fetchBytes(db, String(row.pdf_url || "")); if (!base) return null;
    const pdf = await PDFDocument.load(base);
    const pages = pdf.getPages();
    let font; try { font = await pdf.embedFont(StandardFonts.Helvetica); } catch { font = undefined; }
    const ink = rgb(0.14, 0.18, 0.29);
    const frDate = (iso?: string) => { const d = String(iso || "").slice(0, 10); const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); return m ? `${m[3]}/${m[2]}/${m[1]}` : d; };
    for (const s of signers) {
      if (!s.sigUrl || s.signed !== true) continue;
      const field = (s.role === "societe" ? row.field_societe : row.field_employe) as Record<string, number> | null;
      if (!field || !field.page) continue;
      const page = pages[Math.max(0, Math.round(Number(field.page)) - 1)]; if (!page) continue;
      const ph = page.getHeight();
      const sigBytes = await fetchBytes(db, s.sigUrl);
      if (sigBytes) {
        let img; try { img = await pdf.embedPng(sigBytes); } catch { img = null; }
        if (img) {
          const boxW = Number(field.width) || 170, boxH = Number(field.height) || 40;
          const iw = img.width, ih = img.height, sc = Math.min(boxW / iw, boxH / ih);
          const w = iw * sc, h = ih * sc;
          const x = Number(field.x) || 40, yTop = Number(field.y) || 700;
          page.drawImage(img, { x, y: ph - yTop - h, width: w, height: h }); // HAUT de l'image à yTop
        }
      }
      // DATE (alignée sur « Date : ») + E-MAIL du signataire (juste en dessous), à une taille lisible.
      // Coordonnées calculées à la génération du PDF (app.js) → l'edge ne fait que dessiner.
      if (font) {
        try {
          if (field.dateY) page.drawText(frDate(s.signedAt), { x: Number(field.dateX) || 40, y: ph - Number(field.dateY), size: 9.5, font, color: ink });
          if (field.emailY && s.email) page.drawText("Signé par " + String(s.email), { x: Number(field.emailX) || 40, y: ph - Number(field.emailY), size: 8, font, color: rgb(0.42, 0.47, 0.55) });
        } catch { /* texte best-effort */ }
      }
    }
    return await pdf.save();
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const db = admin();
  if (!db) return json({ error: "Service indisponible (configuration serveur)." }, 500);

  try {
    // ---- GET : le signataire ouvre son lien → infos du document + sa signature déjà faite ? ----
    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = url.searchParams.get("t") || "";
      const whoParam = (url.searchParams.get("who") || "employe") === "societe" ? "societe" : "employe";
      if (!token) return json({ error: "Lien incomplet." }, 400);
      const found = await resolveSigner(db, token, whoParam);
      if (!found || !found.row) return json({ error: "Lien de signature invalide ou expiré." }, 404);
      const row = found.row; const who = found.who; const me = found.me;
      if (!me) return json({ error: "Aucun signataire correspondant à ce lien." }, 404);
      const pdfView = await signedUrl(db, String(row.statut === "signe" && row.signed_pdf_url ? row.signed_pdf_url : row.pdf_url));
      return json({
        ok: true, plaque: row.plaque || "", modele: row.modele || "", employe: row.employe || "",
        sens: row.sens || "remise", date: row.date || "", societe: row.societe || "",
        role: who, nom: me.nom || "", alreadySigned: me.signed === true, statut: row.statut || "en_attente",
        pdfUrl: pdfView,
      });
    }

    // ---- POST : le signataire envoie sa signature (image) ----
    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try { body = await req.json(); } catch { return json({ error: "Requête invalide." }, 400); }

      // ---- REFUS : le signataire refuse de signer (motif OBLIGATOIRE) → annule la demande (plus de relance) ----
      if (String(body.action || "") === "refuse") {
        const token = String(body.t || "").trim();
        const whoParam = String(body.who || "employe") === "societe" ? "societe" : "employe";
        const motif = String(body.motif || "").trim();
        if (!token) return json({ error: "Lien incomplet." }, 400);
        if (!motif) return json({ error: "Merci d'indiquer le motif du refus." }, 400);
        const found = await resolveSigner(db, token, whoParam);
        if (!found || !found.row) return json({ error: "Lien invalide ou expiré." }, 404);
        const row = found.row; const who = found.who; const me = found.me;
        const docToken = String(row.token || token);
        if (!me) return json({ error: "Signataire introuvable." }, 404);
        if (row.statut === "signe") return json({ error: "Ce document est déjà signé, il ne peut plus être refusé." }, 409);
        const signers = (Array.isArray(row.signataires) ? row.signataires : []) as Signer[];
        const meRef = signers.find((s) => s.role === who) || me;
        meRef.refused = true; meRef.refusMotif = motif.slice(0, 1000); meRef.refusedAt = new Date().toISOString();
        meRef.ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "";
        if (String(body.nom || "").trim()) meRef.nom = String(body.nom).trim();
        // Statut = 'refuse' → la demande sort des « en attente » (plus aucune relance côté app).
        await db.from("edl_signatures").update({ signataires: signers, statut: "refuse" }).eq("token", docToken);
        // Notifie le(s) gestionnaire(s) : refus + motif (push).
        await sendPush(db, String(row.societe || "PXP"), {
          title: "❌ État des lieux refusé",
          body: (row.plaque || "Véhicule") + " — " + (meRef.nom || "un signataire") + " a refusé de signer. Motif : " + motif.slice(0, 140),
          url: "./pages/vehicules.html?immat=" + encodeURIComponent(String(row.plaque || "")),
          tag: "edlrefuse-" + docToken,
        });
        return json({ ok: true, refused: true, statut: "refuse" });
      }

      if (String(body.action || "") !== "sign") return json({ error: "Action inconnue." }, 400);
      const token = String(body.t || "").trim();
      const whoParam = String(body.who || "employe") === "societe" ? "societe" : "employe";
      const sigData = String(body.signature || "");
      const nom = String(body.nom || "").trim();
      if (!token) return json({ error: "Lien incomplet." }, 400);
      const m = /^data:image\/png;base64,(.+)$/.exec(sigData);
      if (!m) return json({ error: "Signature manquante — dessine ta signature puis valide." }, 400);

      const found = await resolveSigner(db, token, whoParam);
      if (!found || !found.row) return json({ error: "Lien invalide ou expiré." }, 404);
      const row = found.row; const who = found.who; const me = found.me;
      const docToken = String(row.token || token); // jeton du DOCUMENT (pour l'update + les chemins de stockage)
      if (!me) return json({ error: "Signataire introuvable." }, 404);
      const signers = (Array.isArray(row.signataires) ? row.signataires : []) as Signer[];
      if (row.statut === "refuse") return json({ error: "Cette demande de signature a été refusée et annulée." }, 409);
      if (me.signed === true) return json({ ok: true, deja: true, statut: row.statut || "en_attente" });

      // ORDRE DE SIGNATURE (séquentiel) : un signataire ne peut signer QUE si tous ceux d'ordre
      // INFÉRIEUR ont déjà signé (le gestionnaire de flotte d'abord, puis le salarié). Rétro-compatible :
      // si aucun ordre n'est défini (anciens envois « tous en même temps »), aucune contrainte.
      const myOrdre = Number(me.ordre) || 0;
      if (myOrdre > 0) {
        const attente = signers.find((s) => s.email && (Number(s.ordre) || 0) < myOrdre && s.signed !== true);
        if (attente) return json({ error: "En attente de la signature du gestionnaire de flotte. Tu recevras un e-mail dès que ce sera à ton tour de signer." }, 409);
      }

      // Enregistre l'image de la signature (bucket public "scans").
      let sigUrl = "";
      try {
        const bytes = b64ToBytes(m[1]);
        if (bytes.length > 4_000_000) return json({ error: "Signature trop volumineuse." }, 400);
        const path = dossierSociete(row.societe) + "/edl-signatures/" + docToken + "/" + who + "-" + Date.now().toString(36) + ".png";
        const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: "image/png", upsert: true });
        if (!up.error) { const pub = db.storage.from(BUCKET).getPublicUrl(path); sigUrl = (pub && pub.data && pub.data.publicUrl) || ""; }
      } catch { /* best-effort */ }
      if (!sigUrl) return json({ error: "Échec de l'enregistrement de la signature. Réessaie." }, 500);

      me.signed = true; me.signedAt = new Date().toISOString();
      me.ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "";
      me.sigUrl = sigUrl; if (nom) me.nom = nom;

      // Tout le monde a-t-il signé ? (signataires ayant un e-mail = requis)
      const required = signers.filter((s) => s.email);
      const allSigned = required.length > 0 && required.every((s) => s.signed === true);
      let statut = row.statut || "en_attente";
      let signedPdfUrl = row.signed_pdf_url || null;

      if (allSigned) {
        statut = "signe";
        // Reconstruit le PDF signé + le range dans les Documents du véhicule.
        const signedBytes = await buildSignedPdf(db, row, signers);
        if (signedBytes) {
          try {
            const path = dossierSociete(row.societe) + "/documents/etat-des-lieux-signe-" + docToken + ".pdf";
            const up = await db.storage.from(BUCKET).upload(path, signedBytes, { contentType: "application/pdf", upsert: true });
            if (!up.error) {
              const { data: su } = await db.storage.from(BUCKET).createSignedUrl(path, 315360000); // ~10 ans
              signedPdfUrl = (su && su.signedUrl) || db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
            }
          } catch { /* upload best-effort */ }
          if (signedPdfUrl && row.vehicule_id) {
            try {
              await db.from("documents").insert({
                id: genId("D"), vehicule_id: row.vehicule_id, type: "etat-des-lieux",
                label: "État des lieux " + (row.sens === "restitution" ? "restitution" : "remise") + " — signé " + String(row.date || "").slice(0, 10),
                url: signedPdfUrl, societe: row.societe || "PXP",
              });
            } catch (e) { console.error("[edl-sign] documents insert échec (PDF signé récupérable via edl_signatures.signed_pdf_url)", e); }
          }
        }
      }

      // SIGNATURE SÉQUENTIELLE : dès que ce signataire a signé, on notifie AUTOMATIQUEMENT le
      // signataire SUIVANT (ordre supérieur) en lui envoyant son e-mail PRÉ-RENDU (stocké à la
      // création). notified=true est persisté (via l'update ci-dessous) pour ne jamais ré-envoyer.
      // Rétro-compat : si le suivant n'a pas d'e-mail pré-rendu (anciens envois « tous à la fois »),
      // on ne fait rien (il a déjà reçu son lien).
      let relayedTo = "";
      if (!allSigned) {
        const next = signers
          .filter((s) => s.email && s.signed !== true)
          .sort((a, b) => (Number(a.ordre) || 0) - (Number(b.ordre) || 0))[0];
        if (next && next.notified !== true && next.mailHtml) {
          const okMail = await sendSignEmail(db, String(row.societe || "PXP"), String(next.email), String(next.mailSubject || ""), String(next.mailHtml || ""), String(next.mailText || ""));
          if (okMail) { next.notified = true; relayedTo = next.role === "employe" ? "salarié" : (next.nom || "signataire suivant"); }
        }
      }

      // ⚠️ On VÉRIFIE l'erreur (supabase-js ne jette pas) : si cet enregistrement d'état échoue, ne JAMAIS
      // répondre « signé » (sinon le signataire est re-sollicité au rechargement, sa signature perdue). 0-perte ③.
      const { error: sigUpdErr } = await db.from("edl_signatures").update({ signataires: signers, statut, signed_pdf_url: signedPdfUrl }).eq("token", docToken);
      if (sigUpdErr) return json({ error: "Échec de l'enregistrement de la signature. Réessaie.", code: "sign_save" }, 500);

      // Notifie le(s) gestionnaire(s) de la société : signature reçue, transmission au suivant, ou COMPLET.
      const nbSigned = required.filter((s) => s.signed).length;
      const reste = required.length - nbSigned;
      const pushPayload = allSigned
        ? { title: "✅ État des lieux signé", body: (row.plaque || "Véhicule") + " — document entièrement signé par tous les signataires.", url: "./pages/vehicules.html?immat=" + encodeURIComponent(String(row.plaque || "")), tag: "edlsign-" + docToken }
        : relayedTo
          ? { title: "✍️ Signé — transmis au " + relayedTo, body: (row.plaque || "Véhicule") + " — " + (me.nom || "le gestionnaire") + " a signé. Le lien vient d'être envoyé au " + relayedTo + " pour sa signature.", url: "./pages/vehicules.html?immat=" + encodeURIComponent(String(row.plaque || "")), tag: "edlsign-" + docToken }
          : { title: "✍️ Signature reçue", body: (row.plaque || "Véhicule") + " — " + (me.nom || "un signataire") + " a signé. Il reste " + reste + " signature(s).", url: "./pages/vehicules.html?immat=" + encodeURIComponent(String(row.plaque || "")), tag: "edlsign-" + docToken };
      await sendPush(db, String(row.societe || "PXP"), pushPayload);

      // COMPLET → envoie à TOUS les signataires l'état des lieux SIGNÉ (PDF en pièce jointe), beau message.
      if (allSigned && signedPdfUrl) {
        const plaque = String(row.plaque || "Véhicule"), modele = String(row.modele || "");
        const dateStr = String(row.date || "").slice(0, 10).split("-").reverse().join("/");
        const sensTxt = row.sens === "restitution" ? "restitution" : "remise";
        const { from, replyTo } = await societeFrom(db, String(row.societe || "PXP"));
        const key = Deno.env.get("RESEND_API_KEY");
        const ppLogo = '<span style="display:inline-block;vertical-align:middle;line-height:0;margin-right:9px">'
          + '<span style="display:block;width:17px;height:4px;background:#F8A24A;border-radius:3px"></span>'
          + '<span style="display:block;width:26px;height:4px;background:#F97316;border-radius:3px;margin-top:3px"></span>'
          + '<span style="display:block;width:11px;height:4px;background:#F97316;border-radius:3px;margin-top:3px"></span>'
          + '</span>'
          + '<span style="font-weight:900;font-style:italic;font-size:16px;color:#ffffff;vertical-align:middle">Parc</span>'
          + '<span style="vertical-align:middle">&#160;</span>'
          + '<span style="font-weight:900;font-style:italic;font-size:16px;color:#F97316;vertical-align:middle">Pilot</span>';
        const mailDoc = (inner: string) => '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">'
          + '<meta name="viewport" content="width=device-width,initial-scale=1">'
          + '<meta name="color-scheme" content="only light"><meta name="supported-color-schemes" content="only light">'
          + '</head><body style="margin:0;padding:0;background:#EEF2F7;color:#0F1E3D">' + inner + '</body></html>';
        const html = mailDoc(`<div style="font-family:Inter,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;color:#0F1E3D">
  <div style="background-color:#0B1220;background-image:linear-gradient(135deg,#0B1220,#1E293B);color:#ffffff;padding:22px 24px;border-radius:14px 14px 0 0">
    <div>${ppLogo}</div>
    <div style="font-size:20px;font-weight:800;font-style:italic;margin-top:16px;line-height:1.25;color:#ffffff">✅ État des lieux signé</div>
  </div>
  <div style="border:1px solid #E7EBF0;border-top:none;padding:22px;color:#0F1E3D">
    <p style="margin:0 0 16px;line-height:1.55">Bonjour,</p>
    <p style="margin:0 0 16px;line-height:1.55">L'état des lieux (${sensTxt}) du véhicule a été <b>signé par toutes les parties</b>. Tu en trouveras la <b>version signée en pièce jointe</b>, à conserver.</p>
    <div style="background:#f8fafc;border-radius:10px;padding:11px 14px;margin:14px 0;font-size:13px;color:#334155">🚗 <b>${modele}</b> · ${plaque}${dateStr ? " · " + dateStr : ""}</div>
    <p style="text-align:center;margin:22px 0"><a href="${signedPdfUrl}" style="display:inline-block;background:#0B1220;color:#ffffff;padding:14px 30px;border-radius:10px;text-decoration:none;font-weight:800;font-size:15px">⬇️ Télécharger l'état des lieux signé</a></p>
  </div>
  <div style="background-color:#0B1220;padding:18px 22px;border-radius:0 0 14px 14px;text-align:center">
    <div>${ppLogo}</div>
  </div>
</div>`);
        if (key) {
          const dest = Array.from(new Set(required.map((s) => String(s.email || "")).filter(Boolean)));
          for (const to of dest) {
            const payload: Record<string, unknown> = { from, to: [to], subject: "État des lieux signé (" + plaque + ")", html, text: "L'état des lieux signé du véhicule " + plaque + " est disponible : " + signedPdfUrl, attachments: [{ filename: "Etat-des-lieux-signe-" + plaque + ".pdf", path: signedPdfUrl }] };
            if (replyTo) payload.reply_to = replyTo;
            try { await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) }); } catch { /* best-effort */ }
          }
        }
      }

      // signedUrlOut : lien de téléchargement direct dès que TOUT est signé (bouton sur signer.html).
      let signedUrlOut = "";
      if (allSigned && signedPdfUrl) { try { signedUrlOut = await signedUrl(db, String(signedPdfUrl)); } catch { signedUrlOut = String(signedPdfUrl); } }
      return json({ ok: true, statut, allSigned, signedPdfUrl: signedUrlOut });
    }

    return json({ error: "Méthode non autorisée." }, 405);
  } catch (e) {
    return json({ error: (e && (e as Error).message) || "Erreur serveur." }, 500);
  }
});
