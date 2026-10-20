// ============================================================================
//  Parc Pilot — Fonction d'envoi d'e-mails (Resend)
//  ⚠️ La clé Resend N'EST PAS ici : elle est lue depuis un SECRET Supabase
//     (RESEND_API_KEY). Rien de secret dans ce fichier → il peut rester public.
//
//  Déploiement (une fois) :
//    1. Supabase → Edge Functions → « Deploy a new function » → nom : send-email
//       → colle ce fichier.
//    2. Supabase → Project Settings → Edge Functions → Secrets :
//         RESEND_API_KEY = <ta clé Resend>
//         EMAIL_FROM     = Parc Pilot <shakil.nubee@projectxparis.fr>
//       (EMAIL_FROM : mets d'abord "Parc Pilot <onboarding@resend.dev>" pour tester,
//        puis ton adresse @projectxparis.fr une fois le domaine vérifié sur Resend.)
//
//  Le site appelle cette fonction (utilisateur connecté requis) → elle envoie le mail.
// ============================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  // Point de contrôle PUBLIC (lecture seule) : permet de vérifier QUELLE version est déployée
  // (utile pour confirmer que la transmission des en-têtes de fil de discussion est active).
  // Ne renvoie AUCUN secret et n'envoie AUCUN e-mail.
  if (req.method === "GET") return json({ ok: true, version: "headers-v2", supportsThreadingHeaders: true });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  // ⚠️ SÉCURITÉ : seul un utilisateur CONNECTÉ peut envoyer un e-mail (sinon un tiers pourrait
  // envoyer des mails « au nom de » la société). On valide le jeton auprès de Supabase.
  // (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY sont injectés automatiquement.)
  const SUPA = Deno.env.get("SUPABASE_URL"); const ANON = Deno.env.get("SUPABASE_ANON_KEY");
  let callerId = "";
  {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Non connecté." }, 401);
    // ⚠️ FAIL-CLOSED : si l'environnement ne permet pas de valider le jeton, on REFUSE (comme scan-doc).
    // Sinon un déploiement où ces variables manquent transformerait la fonction en relais d'envoi ouvert.
    if (!SUPA || !ANON) return json({ error: "Non autorisé (validation impossible)." }, 401);
    try {
      const u = await fetch(`${SUPA}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON } });
      if (!u.ok) return json({ error: "Session expirée — reconnecte-toi." }, 401);
      const uj = await u.json().catch(() => null);
      callerId = (uj && (uj.id || (uj.user && uj.user.id))) || "";
    } catch (_) { return json({ error: "Non autorisé." }, 401); }
  }

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    return json({ error: "RESEND_API_KEY absent — ajoute-le dans Supabase → Settings → Edge Functions → Secrets." }, 500);
  }
  // ⚠️ Repli d'expéditeur sur un domaine VÉRIFIÉ dans Resend (seul projectxparis.fr l'est aujourd'hui) :
  // l'adresse de test onboarding@resend.dev ne peut écrire QU'au titulaire du compte Resend. N'affecte
  // QUE les envois sans `from` de société explicite (les amendes/EDL passent déjà leur adresse scopée).
  let envFrom = Deno.env.get("EMAIL_FROM") || "";
  if (!envFrom || /resend\.dev/i.test(envFrom)) envFrom = "Parc Pilot <noreply@projectxparis.fr>";

  let msg: Record<string, unknown>;
  try {
    msg = await req.json();
  } catch {
    return json({ error: "Corps JSON invalide" }, 400);
  }

  // ⚠️ SCOPING SERVEUR DU FROM (anti-usurpation inter-sociétés) : un compte NON-CEO ne peut envoyer
  // QUE depuis l'adresse d'envoi de SA société — déterminée CÔTÉ SERVEUR (profiles + app_settings),
  // jamais depuis le payload (qu'un appel forgé pourrait mettre à l'adresse d'une autre société). Le
  // CEO garde un `from` libre : il agit légitimement au nom de toutes les sociétés. Fidèle au calcul
  // du client (mailExpediteur + domaine d'envoi vérifié + nom société) → invisible pour un envoi
  // légitime, il ne corrige qu'un `from` étranger. Repli sûr : config absente → EMAIL_FROM.
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // ⚠️ FAIL-CLOSED : on ne fait confiance au `from` du PAYLOAD que pour un CEO *prouvé* (profiles.is_admin).
  // Dans TOUS les autres cas — non-CEO, clé service absente, ou lecture profiles/app_settings qui échoue —
  // on IMPOSE l'adresse scopée de la société (sinon EMAIL_FROM), jamais le `from` du navigateur. Avant, un
  // échec de lecture laissait passer le `from` du payload → usurpation possible (ex. « au nom de » PXP).
  let provenCEO = false, scopedFrom = "", scopedReply = "";
  if (callerId && SERVICE) {
    try {
      const rest = (path: string) => fetch(`${SUPA}/rest/v1/${path}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const profRows = await rest(`profiles?id=eq.${encodeURIComponent(callerId)}&select=is_admin,role,societe`);
      const me = Array.isArray(profRows) ? profRows[0] : null;
      if (me && me.is_admin) {
        provenCEO = true; // source de vérité = profiles (jamais user_metadata)
      } else {
        const soc = (me && me.societe) || "";
        if (soc) {
          const setRows = await rest(`app_settings?id=eq.${encodeURIComponent(String(soc))}&select=data`);
          const data = (Array.isArray(setRows) && setRows[0] && setRows[0].data) || {};
          const p = (data.profil && typeof data.profil === "object") ? data.profil : {};
          const exp = String(p.mailExpediteur || "").trim();
          if (exp) {
            const dom = String(p.mailDomaineEnvoi || "").trim().replace(/^@/, "");
            const fromAddr = dom ? (exp.split("@")[0] + "@" + dom) : exp;
            let nom = (data.societe && data.societe.nom) || "";
            nom = String(nom).replace(/[<>"]/g, "").trim();
            if (/^parc\s*pilot$/i.test(nom)) nom = "";
            scopedFrom = nom ? `${nom} <${fromAddr}>` : fromAddr;
            scopedReply = exp;
          }
        }
      }
    } catch (_) { provenCEO = false; /* lecture impossible → on reste fail-closed (non prouvé CEO) */ }
  }
  // Tant que l'appelant n'est pas prouvé CEO, on écrase le from du payload par l'adresse scopée (ou "" → EMAIL_FROM).
  if (!provenCEO) {
    msg.from = scopedFrom || "";
    if (scopedReply && !msg.replyTo) msg.replyTo = scopedReply;
  }

  // Expéditeur : si le site fournit `from` (adresse de la société), on l'utilise ; sinon le
  // secret EMAIL_FROM. ⚠️ Resend n'accepte que les adresses d'un domaine VÉRIFIÉ dans Resend.
  const from = (msg.from && String(msg.from).trim()) ? String(msg.from).trim() : envFrom;

  const to = msg.to;
  const subject = msg.subject;
  if (!to || !subject || (!msg.html && !msg.text)) {
    return json({ error: "Champs requis : to, subject, et html ou text." }, 400);
  }

  const toList = (v: unknown) =>
    Array.isArray(v) ? v : String(v).split(",").map((s) => s.trim()).filter(Boolean);

  const payload: Record<string, unknown> = {
    from,
    to: toList(to),
    subject: String(subject),
  };
  if (msg.cc) payload.cc = toList(msg.cc);
  if (msg.html) payload.html = String(msg.html);
  if (msg.text) payload.text = String(msg.text);
  if (msg.replyTo) payload.reply_to = String(msg.replyTo);
  // En-têtes personnalisés (fil de discussion : Message-ID / In-Reply-To / References →
  // une relance d'amende arrive DANS LE MÊME FIL que le 1er e-mail). Transmis tels quels à Resend.
  if (msg.headers && typeof msg.headers === "object" && !Array.isArray(msg.headers)) {
    const h: Record<string, string> = {};
    for (const [k, v] of Object.entries(msg.headers as Record<string, unknown>)) {
      if (v != null && String(v).trim()) h[String(k)] = String(v);
    }
    if (Object.keys(h).length) payload.headers = h;
  }
  // Pièces jointes : chaque entrée = { filename, path } (URL distante que Resend télécharge)
  // OU { filename, content } (contenu base64). On transmet tel quel à Resend.
  if (Array.isArray(msg.attachments) && msg.attachments.length) {
    payload.attachments = (msg.attachments as Array<Record<string, unknown>>)
      .filter((a) => a && (a.path || a.content) && a.filename)
      .map((a) => {
        const o: Record<string, unknown> = { filename: String(a.filename) };
        if (a.path) o.path = String(a.path);
        if (a.content) o.content = String(a.content);
        if (a.content_type) o.content_type = String(a.content_type);
        return o;
      });
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: data?.message || "Échec de l'envoi Resend", detail: data }, r.status);
    return json({ ok: true, id: data?.id });
  } catch (e) {
    return json({ error: "Erreur réseau vers Resend : " + String(e) }, 502);
  }
});
