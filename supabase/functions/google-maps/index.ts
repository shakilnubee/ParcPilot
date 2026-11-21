// ============================================================================
//  Parc Pilot — Passerelle Google Maps (Geocoding + autocomplétion d'adresse)
//  derrière le COMPTEUR DE QUOTA (Lot 2b).
//
//  Pourquoi un proxy serveur : la clé Google ne doit JAMAIS être exposée au
//  navigateur, et chaque appel doit être COMPTÉ (table google_api_usage via
//  fp_quota_consommer) pour alerter à 80 % et COUPER à 90 % de la limite gratuite.
//
//  Flux d'un appel : JWT valide → société (profiles) → fp_quota_consommer (réserve
//  1 unité AVANT l'appel) → si autorisé, appel Google avec la clé secrète → réponse
//  normalisée. Si la coupure 90 % est atteinte → on N'APPELLE PAS Google (autorise=false).
//
//  Actions (POST { action }):
//   • 'ping'         → { configured } : la clé est-elle posée ? (aucun appel Google)
//   • 'geocode'      → { q } : adresse texte → { formatee, lat, lng, composants }
//   • 'autocomplete' → { q, pays? } : suggestions d'adresse (Places Autocomplete)
//
//  ⚠️ DORMANT tant que le secret GOOGLE_MAPS_API_KEY n'est pas défini : 'ping' répond
//  configured:false, 'geocode'/'autocomplete' répondent configured:false (aucun appel,
//  aucun coût). Idem si la table de quota n'est pas encore en prod → autorise:false.
//
//  SECRET À DÉFINIR (Supabase → Edge Functions → Secrets), une seule fois :
//    GOOGLE_MAPS_API_KEY = clé API Google Cloud RESTREINTE (APIs : Geocoding + Places ;
//                          restriction « application » = sites web, référents parc-pilot.fr/*).
//  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY sont injectés par Supabase.
//  Déploiement : automatique à la fusion sur main.
// ============================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Plafonds gratuits mensuels (AUTHORITATIFS côté serveur) — mêmes valeurs que google-quota.
const PLAFONDS: Record<string, number> = { geocoding: 10000, places: 5000 };

function clamp(s: unknown, n: number) { return String(s == null ? "" : s).slice(0, n); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  const SUPA = Deno.env.get("SUPABASE_URL");
  const ANON = Deno.env.get("SUPABASE_ANON_KEY");
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const KEY = (Deno.env.get("GOOGLE_MAPS_API_KEY") || "").trim();
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

  const body = await req.json().catch(() => ({}));
  const action = String((body && body.action) || "ping");

  // 'ping' : la clé est-elle configurée ? (aucun appel Google)
  if (action === "ping") return json({ ok: true, configured: !!KEY });
  // DORMANT : pas de clé → aucun appel, aucun coût.
  if (!KEY) return json({ ok: true, configured: false, autorise: false, raison: "Intégration Google non configurée (clé absente)." });

  // 2) Société du caller (profiles, jamais user_metadata).
  let societe = "PXP";
  try {
    const pr = await fetch(`${SUPA}/rest/v1/profiles?id=eq.${encodeURIComponent(callerId)}&select=societe`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    const rows = pr.ok ? (await pr.json().catch(() => [])) : [];
    const prof = Array.isArray(rows) ? rows[0] : null;
    societe = String((prof && prof.societe) || "PXP") || "PXP";
  } catch (_) { societe = "PXP"; }

  const apiKind = action === "autocomplete" ? "places" : "geocoding";

  // 3) Réserve 1 unité de quota AVANT d'appeler Google (coupure 90 % appliquée côté SQL).
  let quota: { autorise: boolean; pct: number | null; suspendu: boolean; compteur: number; plafond: number };
  try {
    const r = await fetch(`${SUPA}/rest/v1/rpc/fp_quota_consommer`, {
      method: "POST",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_societe: societe, p_api: apiKind, p_unites: 1, p_plafond: PLAFONDS[apiKind] }),
    });
    if (!r.ok) {
      return json({ ok: true, autorise: false, raison: "Quota non initialisé (migration non appliquée en prod).", pct: null });
    }
    const rows = await r.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : rows;
    quota = {
      autorise: !!(row && row.autorise), pct: (row && row.pct != null) ? Number(row.pct) : null,
      suspendu: !!(row && row.suspendu), compteur: Number(row && row.compteur) || 0, plafond: Number(row && row.plafond) || PLAFONDS[apiKind],
    };
  } catch (e) {
    return json({ ok: true, autorise: false, raison: "Erreur quota : " + clamp(e, 160) });
  }
  if (!quota.autorise) {
    return json({ ok: true, autorise: false, suspendu: quota.suspendu, pct: quota.pct, raison: "Limite gratuite mensuelle atteinte (coupure 90 %)." });
  }

  // 4) Appel Google (la clé reste serveur). Réponses normalisées pour Parc Pilot.
  try {
    if (action === "geocode") {
      const q = clamp(body && body.q, 300);
      if (!q) return json({ error: "Adresse vide." }, 400);
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&language=fr&region=fr&key=${encodeURIComponent(KEY)}`;
      const r = await fetch(url);
      const d = await r.json().catch(() => null);
      if (!d || d.status === "REQUEST_DENIED") return json({ ok: false, autorise: true, error: "Google a refusé la requête (clé/restrictions) : " + clamp(d && d.error_message, 160) }, 502);
      const res = (d.results && d.results[0]) || null;
      if (!res) return json({ ok: true, autorise: true, found: false, pct: quota.pct });
      const comp: Record<string, string> = {};
      for (const c of (res.address_components || [])) {
        for (const t of (c.types || [])) comp[t] = c.long_name;
      }
      return json({
        ok: true, autorise: true, found: true, pct: quota.pct,
        formatee: res.formatted_address || q,
        lat: res.geometry && res.geometry.location ? res.geometry.location.lat : null,
        lng: res.geometry && res.geometry.location ? res.geometry.location.lng : null,
        composants: {
          rue: [comp.street_number, comp.route].filter(Boolean).join(" "),
          cp: comp.postal_code || "", ville: comp.locality || comp.postal_town || "", pays: comp.country || "",
        },
      });
    }

    if (action === "autocomplete") {
      const q = clamp(body && body.q, 200);
      if (!q) return json({ ok: true, autorise: true, suggestions: [] });
      const pays = clamp((body && body.pays) || "fr", 2).toLowerCase() || "fr";
      // Places API (new) — Autocomplete : POST places.googleapis.com/v1/places:autocomplete
      const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": KEY },
        body: JSON.stringify({ input: q, languageCode: "fr", includedRegionCodes: [pays] }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) return json({ ok: false, autorise: true, error: "Google a refusé la requête (clé/restrictions) : " + clamp(d && d.error && d.error.message, 160) }, 502);
      const sugg = ((d && d.suggestions) || []).map((s: Record<string, any>) => {
        const p = s.placePrediction || {};
        return { description: (p.text && p.text.text) || "", placeId: p.placeId || "" };
      }).filter((x: { description: string }) => x.description);
      return json({ ok: true, autorise: true, pct: quota.pct, suggestions: sugg });
    }

    return json({ error: "Action inconnue : " + action }, 400);
  } catch (e) {
    return json({ ok: false, autorise: true, error: "Réseau Google : " + clamp(e, 180) }, 502);
  }
});
