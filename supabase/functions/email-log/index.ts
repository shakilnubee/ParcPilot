// ============================================================================
//  Parc Pilot — Journal des envois (lecture seule des e-mails envoyés via Resend)
//  ⚠️ AUCUN secret ici : la clé Resend est lue depuis le SECRET Supabase RESEND_API_KEY
//     (le même que send-email). Ce fichier peut rester public.
//
//  Rôle : renvoie la liste des DERNIERS e-mails réellement partis de la plateforme
//  (destinataire, objet, statut de remise, date) pour que le CEO puisse VÉRIFIER
//  lui-même, depuis l'app, qu'un rappel / une amende / un accès a bien été envoyé.
//
//  Sécurité : réservé au CEO (profil role='ceo'). Le journal montre TOUS les envois
//  de la plateforme (toutes sociétés confondues) → seul le super-admin peut le lire.
//  Validation du jeton côté serveur (fail-closed), comme send-email.
//
//  Déploiement : automatique à la fusion sur main (deploy-edge-functions.yml).
//  Secret requis : RESEND_API_KEY (déjà présent pour send-email).
// ============================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  const SUPA = Deno.env.get("SUPABASE_URL");
  const ANON = Deno.env.get("SUPABASE_ANON_KEY");
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  // 1) Jeton utilisateur obligatoire (fail-closed : si on ne peut pas valider, on refuse).
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Non connecté." }, 401);
  if (!SUPA || !ANON || !SERVICE) return json({ error: "Non autorisé (validation impossible)." }, 401);

  let callerId = "";
  try {
    const u = await fetch(`${SUPA}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON } });
    if (!u.ok) return json({ error: "Session expirée — reconnecte-toi." }, 401);
    const uj = await u.json().catch(() => null);
    callerId = (uj && (uj.id || (uj.user && uj.user.id))) || "";
  } catch (_) { return json({ error: "Non autorisé." }, 401); }
  if (!callerId) return json({ error: "Non autorisé." }, 401);

  // 2) Réservé au CEO : la source de vérité du rôle est la table profiles (jamais user_metadata).
  try {
    const pr = await fetch(
      `${SUPA}/rest/v1/profiles?id=eq.${encodeURIComponent(callerId)}&select=role,is_admin`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
    );
    const rows = pr.ok ? (await pr.json().catch(() => [])) : [];
    const prof = Array.isArray(rows) ? rows[0] : null;
    const role = String((prof && prof.role) || "").toLowerCase();
    if (role !== "ceo") return json({ error: "Réservé au CEO." }, 403);
  } catch (_) { return json({ error: "Vérification du rôle impossible." }, 403); }

  // 3) Liste Resend (lecture seule). limit 1..100.
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ error: "RESEND_API_KEY absent — ajoute-le dans Supabase → Settings → Edge Functions → Secrets." }, 500);

  let limit = 100, after = "", before = "";
  try {
    const url = new URL(req.url);
    limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") || "100", 10) || 100));
    after = (url.searchParams.get("after") || "").trim();
    before = (url.searchParams.get("before") || "").trim();
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      if (b && b.limit) limit = Math.max(1, Math.min(100, parseInt(String(b.limit), 10) || 100));
      if (b && b.after) after = String(b.after);
      if (b && b.before) before = String(b.before);
    }
  } catch (_) { /* valeurs par défaut */ }

  let qs = `limit=${limit}`;
  if (after) qs += `&after=${encodeURIComponent(after)}`;
  else if (before) qs += `&before=${encodeURIComponent(before)}`;

  try {
    const r = await fetch(`https://api.resend.com/emails?${qs}`, {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) return json({ error: (d && (d.message || d.error)) || ("Erreur Resend (HTTP " + r.status + ")") }, 502);
    const toList = (v: unknown) => Array.isArray(v) ? v.join(", ") : String(v || "");
    const items = (d && Array.isArray(d.data) ? d.data : []).map((e: Record<string, unknown>) => ({
      id: e.id,
      to: toList(e.to),
      cc: toList(e.cc),
      bcc: toList(e.bcc),
      from: String(e.from || ""),
      subject: String(e.subject || ""),
      status: String(e.last_event || ""),
      created_at: String(e.created_at || ""),
    }));
    return json({ ok: true, items, hasMore: !!(d && d.has_more) });
  } catch (e) {
    return json({ error: "Réseau : " + String(e).slice(0, 200) }, 502);
  }
});
