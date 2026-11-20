// ============================================================================
//  Parc Pilot — Compteur de quota des API Google (fondation, Lot 2a)
//  ⚠️ AUCUNE clé Google ici et AUCUN appel Google : cette fonction ne fait que
//     COMPTER l'usage par société / par API / par mois, pour alerter à 80 % et
//     COUPER à 90 % de la limite gratuite. Les plafonds sont AUTHORITATIFS côté
//     serveur (un navigateur ne peut pas relever sa propre limite).
//
//  Actions (POST JSON { action }):
//   • 'status'  → conso du mois par API pour la société du caller (+ plafonds, %,
//                 suspendu, date de réinitialisation). Sert à l'écran « Intégrations
//                 Google » (Paramètres). Lecture seule.
//   • 'consume' → { api, unites } : réserve des unités AVANT un appel Google (Lot 2b).
//                 Renvoie { autorise, compteur, plafond, pct, suspendu }. Si autorise=false,
//                 l'appelant NE DOIT PAS appeler Google (coupure 90 %).
//
//  Sécurité : jeton utilisateur obligatoire (fail-closed). La société vient de la
//  table profiles (jamais user_metadata). L'écriture du compteur passe par la
//  fonction SQL fp_quota_consommer (service_role) → atomique, anti-course.
//
//  Tolérant : tant que la migration 20261120170000_google_quota_compteur.sql n'est
//  pas appliquée en PRODUCTION (accord requis), la table est absente → 'status'
//  renvoie configured:false et 'consume' renvoie autorise:false (rien n'est cassé).
//
//  Déploiement : automatique à la fusion sur main. Secrets requis : ceux injectés
//  par Supabase (SUPABASE_URL / ANON / SERVICE_ROLE). Aucune clé Google nécessaire.
// ============================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Plafonds GRATUITS mensuels (limite applicable, AUTHORITATIVE). Basés sur la tarification
// Google Maps Platform depuis mars 2025 : 10 000 appels/mois pour les SKU « Essentials »,
// 5 000 pour « Pro ». Modifiable ici (côté serveur) sans toucher au client.
const PLAFONDS: Record<string, { label: string; plafond: number; palier: string }> = {
  geocoding:  { label: "Geocoding (adresse → GPS)", plafond: 10000, palier: "Essentials" },
  maps_js:    { label: "Carte interactive (Maps JS)", plafond: 10000, palier: "Essentials" },
  routes:     { label: "Distances & itinéraires (Routes)", plafond: 5000, palier: "Pro" },
  places:     { label: "Recherche de lieux (Places)", plafond: 5000, palier: "Pro" },
  // maps_embed : illimité gratuit côté Google → non compté ici.
};
const SEUIL_ALERTE = 0.80;   // alerte à 80 %
const SEUIL_COUPURE = 0.90;  // coupure à 90 % (appliquée aussi dans la fonction SQL)

function periodeUTC(): string {
  const d = new Date();
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}
function resetISO(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  const SUPA = Deno.env.get("SUPABASE_URL");
  const ANON = Deno.env.get("SUPABASE_ANON_KEY");
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPA || !ANON || !SERVICE) return json({ error: "Non autorisé (validation impossible)." }, 401);

  // 1) Jeton utilisateur obligatoire (fail-closed).
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Non connecté." }, 401);
  let callerId = "";
  try {
    const u = await fetch(`${SUPA}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON } });
    if (!u.ok) return json({ error: "Session expirée — reconnecte-toi." }, 401);
    const uj = await u.json().catch(() => null);
    callerId = (uj && (uj.id || (uj.user && uj.user.id))) || "";
  } catch (_) { return json({ error: "Non autorisé." }, 401); }
  if (!callerId) return json({ error: "Non autorisé." }, 401);

  // 2) Société du caller (source de vérité = profiles, jamais user_metadata).
  let societe = "PXP";
  try {
    const pr = await fetch(
      `${SUPA}/rest/v1/profiles?id=eq.${encodeURIComponent(callerId)}&select=societe`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
    );
    const rows = pr.ok ? (await pr.json().catch(() => [])) : [];
    const prof = Array.isArray(rows) ? rows[0] : null;
    societe = String((prof && prof.societe) || "PXP") || "PXP";
  } catch (_) { societe = "PXP"; }

  const body = await req.json().catch(() => ({}));
  const action = String((body && body.action) || "status");

  // ---- STATUS : conso du mois par API (lecture) ----
  if (action === "status") {
    const periode = periodeUTC();
    let usage: Record<string, { compteur: number; suspendu: boolean }> = {};
    let configured = true;
    try {
      const r = await fetch(
        `${SUPA}/rest/v1/google_api_usage?societe=eq.${encodeURIComponent(societe)}&periode=eq.${encodeURIComponent(periode)}&select=api,compteur,suspendu`,
        { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
      );
      if (r.ok) {
        const rows = await r.json().catch(() => []);
        for (const row of (Array.isArray(rows) ? rows : [])) {
          usage[String(row.api)] = { compteur: Number(row.compteur) || 0, suspendu: !!row.suspendu };
        }
      } else { configured = false; }   // table absente (prod non migrée) → non initialisé
    } catch (_) { configured = false; }

    const apis = Object.entries(PLAFONDS).map(([api, cfg]) => {
      const used = usage[api] ? usage[api].compteur : 0;
      const pct = cfg.plafond ? Math.round((used / cfg.plafond) * 1000) / 10 : null;
      return {
        api, label: cfg.label, palier: cfg.palier, plafond: cfg.plafond,
        compteur: used, pct,
        alerte: pct != null && pct >= SEUIL_ALERTE * 100,
        suspendu: (usage[api] && usage[api].suspendu) || (pct != null && pct >= SEUIL_COUPURE * 100),
      };
    });
    return json({
      ok: true, configured, societe, periode, reset: resetISO(),
      seuilAlerte: SEUIL_ALERTE, seuilCoupure: SEUIL_COUPURE,
      // Lot 2a : aucune clé Google posée → l'intégration reste DÉSACTIVÉE (affichage).
      cleConfiguree: false,
      apis,
    });
  }

  // ---- CONSUME : réserve des unités avant un appel Google (Lot 2b) ----
  if (action === "consume") {
    const api = String((body && body.api) || "").trim();
    const unites = Math.max(1, parseInt(String((body && body.unites) || "1"), 10) || 1);
    const cfg = PLAFONDS[api];
    if (!cfg) return json({ error: "API inconnue : " + api }, 400);
    try {
      const r = await fetch(`${SUPA}/rest/v1/rpc/fp_quota_consommer`, {
        method: "POST",
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_societe: societe, p_api: api, p_unites: unites, p_plafond: cfg.plafond }),
      });
      if (!r.ok) {
        // Fonction/table absente (prod non migrée) → on refuse par prudence, sans casser.
        return json({ ok: true, autorise: false, raison: "Quota non initialisé (migration non appliquée).", compteur: 0, plafond: cfg.plafond, pct: null, suspendu: false });
      }
      const rows = await r.json().catch(() => []);
      const row = Array.isArray(rows) ? rows[0] : rows;
      return json({
        ok: true,
        autorise: !!(row && row.autorise),
        compteur: Number(row && row.compteur) || 0,
        plafond: Number(row && row.plafond) || cfg.plafond,
        pct: (row && row.pct != null) ? Number(row.pct) : null,
        suspendu: !!(row && row.suspendu),
      });
    } catch (e) {
      return json({ ok: true, autorise: false, raison: "Erreur quota : " + String(e).slice(0, 160) });
    }
  }

  return json({ error: "Action inconnue : " + action }, 400);
});
