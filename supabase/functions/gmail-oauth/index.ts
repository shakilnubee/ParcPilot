// ============================================================================
//  Parc Pilot — Connexion OAuth d'une boîte Gmail PAR SOCIÉTÉ (socle « Option B », Lot 1)
// ============================================================================
//  Permet à un CEO/Admin de connecter la boîte Gmail de SA société (lecture seule)
//  pour, plus tard (Lot 2/3), récupérer les e-mails libellés + les PJ (factures…).
//
//  ⚠️ SÉCURITÉ :
//   • Le secret client OAuth (GMAIL_OAUTH_CLIENT_SECRET) et le jeton de
//     rafraîchissement restent CÔTÉ SERVEUR (jamais exposés au navigateur).
//   • Toutes les actions valident le JWT de l'appelant et exigent CEO/Admin
//     (config société). Un gestionnaire n'y a pas accès.
//   • Le jeton est stocké dans la table PRIVÉE gmail_connexions (service_role).
//
//  DORMANT : si GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET ne sont pas
//  définis (Supabase → Edge Functions → Secrets), 'status' répond configured:false
//  et aucune action n'appelle Google (aucun effet, aucun coût).
//
//  Actions (POST { action }):
//   • 'status'      → { configured, connected, email, societe }
//   • 'auth-url'    → { url } : l'URL de consentement Google (le client y redirige)
//   • 'callback'    → { ok, email } : échange le code reçu contre les jetons et stocke
//   • 'disconnect'  → { ok } : révoque chez Google + supprime la connexion de la société
//
//  Scopes demandés : gmail.readonly (lecture seule). Redirection fixe :
//    https://parc-pilot.fr/gmail-callback.html  (à déclarer dans l'ID client OAuth Google)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const REDIRECT_URI = "https://parc-pilot.fr/gmail-callback.html";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function profileToAcces(p: { is_admin?: boolean; role?: string } | null) {
  if (!p) return "";
  if (p.is_admin) return "ceo";
  return p.role === "gestionnaire" ? "gestionnaire" : "admin";
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

  // 1) Qui appelle ? (JWT obligatoire) + droits (CEO/Admin) via profiles.
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
  const action = String((body as Record<string, unknown>).action || "status");

  // Le paramètre `state` (généré à l'étape 'auth-url' sous la forme "societe::uuid") est
  // renvoyé tel quel par Google puis retransmis par la page de callback : il permet de
  // retrouver la société au RETOUR (le CEO n'a pas de société fixée dans son profil).
  const stateRaw = String((body as Record<string, unknown>).state || "").trim();
  const stateSociete = stateRaw.includes("::") ? stateRaw.split("::")[0].trim() : "";

  // Société cible : un Admin agit TOUJOURS sur SA société (state ignoré → aucune escalade) ;
  // un CEO précise la société (body.societe) ou la retrouve via le state au callback.
  const societe = isCEO
    ? String((body as Record<string, unknown>).societe || stateSociete || me?.societe || "").trim()
    : String(me?.societe || "").trim();
  if (!societe) return json({ error: "Société introuvable pour cette action." }, 400);

  // ---- status : état de configuration + de connexion + CONFIG par société (aucun appel Google) ----
  //  select('*') → tolère l'absence des colonnes de config (avant migration) sans erreur.
  if (action === "status") {
    let connected = false, email: string | null = null;
    let cfg: Record<string, unknown> = { watchLabelId: null, watchLabelName: null, suiviActif: false, derniereSync: null, syncErreur: null };
    if (configured) {
      const { data } = await admin.from("gmail_connexions").select("*").eq("societe", societe).maybeSingle();
      if (data) {
        connected = true; email = data.email || null;
        cfg = {
          watchLabelId: data.watch_label_id || null,
          watchLabelName: data.watch_label_name || null,
          // null (boîte connectée avant la config) = surveillée par défaut → « actif » ; false = en pause.
          suiviActif: data.suivi_actif !== false,
          derniereSync: data.derniere_sync || null,
          syncErreur: data.sync_erreur || null,
        };
      }
    }
    return json({ ok: true, configured, connected, email, societe, ...cfg });
  }

  if (!configured) return json({ ok: true, configured: false, error: "Intégration Gmail non configurée (secrets absents)." });

  // ---- set-label : enregistre le libellé surveillé (id + nom) pour la boîte de CETTE société ----
  if (action === "set-label") {
    const labelId = String((body as Record<string, unknown>).labelId || "").trim();
    const labelName = String((body as Record<string, unknown>).labelName || "").trim();
    const { error } = await admin.from("gmail_connexions")
      .update({ watch_label_id: labelId || null, watch_label_name: labelName || null, sync_erreur: null })
      .eq("societe", societe);
    if (error) return json({ error: "Enregistrement du libellé impossible : " + error.message }, 500);
    return json({ ok: true, watchLabelId: labelId || null, watchLabelName: labelName || null });
  }

  // ---- activate / pause : démarre ou suspend le suivi des nouveaux mails pour CETTE société ----
  if (action === "activate" || action === "pause") {
    const actif = action === "activate";
    const { error } = await admin.from("gmail_connexions").update({ suivi_actif: actif }).eq("societe", societe);
    if (error) return json({ error: "Mise à jour impossible : " + error.message }, 500);
    return json({ ok: true, suiviActif: actif });
  }

  // ---- auth-url : construit l'URL de consentement Google ----
  if (action === "auth-url") {
    const state = `${societe}::${crypto.randomUUID()}`;
    const p = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",      // pour obtenir un refresh_token
      prompt: "consent",           // force la ré-émission d'un refresh_token
      include_granted_scopes: "true",
      state,
    });
    return json({ ok: true, url: "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString() });
  }

  // ---- callback : échange le code contre les jetons, récupère l'e-mail, stocke ----
  if (action === "callback") {
    const code = String((body as Record<string, unknown>).code || "").trim();
    if (!code) return json({ error: "Code d'autorisation manquant." }, 400);
    // 1) code → access_token (+ refresh_token)
    const tr = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI, grant_type: "authorization_code",
      }),
    });
    const td = await tr.json().catch(() => null) as Record<string, unknown> | null;
    if (!tr.ok || !td) return json({ error: "Échange de jeton refusé par Google : " + ((td && (td.error_description || td.error)) || tr.status) }, 502);
    const refresh = String(td.refresh_token || "").trim();
    const access = String(td.access_token || "").trim();
    const scope = String(td.scope || SCOPE);
    // 2) e-mail de la boîte connectée (profil Gmail)
    let email: string | null = null;
    try {
      const pr = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${access}` } });
      const pj = await pr.json().catch(() => null) as Record<string, unknown> | null;
      if (pr.ok && pj) email = String(pj.emailAddress || "") || null;
    } catch (_) { /* non bloquant */ }
    // 3) refresh_token : Google ne le renvoie que la 1re fois / avec prompt=consent.
    //    Si absent, on conserve celui déjà stocké (reconnexion), sinon on refuse proprement.
    if (!refresh) {
      const { data: ex } = await admin.from("gmail_connexions").select("refresh_token").eq("societe", societe).maybeSingle();
      if (!ex || !ex.refresh_token) {
        return json({ error: "Google n'a pas renvoyé de jeton de rafraîchissement. Déconnecte l'accès dans ton compte Google puis reconnecte." }, 400);
      }
      await admin.from("gmail_connexions").update({ email, scope, connected_by: caller.id }).eq("societe", societe);
      return json({ ok: true, email });
    }
    // 4) upsert (1 ligne par société) via service_role (contourne la RLS).
    //    On NE touche PAS suivi_actif ici (prompt=consent renvoie un refresh à CHAQUE reconnexion →
    //    l'écraser suspendrait une boîte déjà active). Pour une NOUVELLE connexion seulement, on pose
    //    suivi_actif=false ensuite (l'admin teste puis clique « Activer »).
    const { data: dejaLa } = await admin.from("gmail_connexions").select("societe").eq("societe", societe).maybeSingle();
    const { error } = await admin.from("gmail_connexions").upsert({
      societe, email, refresh_token: refresh, scope, connected_by: caller.id, updated_at: new Date().toISOString(),
    }, { onConflict: "societe" });
    if (error) return json({ error: "Enregistrement impossible : " + error.message }, 500);
    // Nouvelle boîte → suivi en pause jusqu'à activation explicite (tolère l'absence de colonne avant migration).
    if (!dejaLa) { try { await admin.from("gmail_connexions").update({ suivi_actif: false }).eq("societe", societe); } catch (_) { /* colonne absente (avant migration) */ } }
    return json({ ok: true, email });
  }

  // ---- disconnect : révoque chez Google + supprime la connexion de la société ----
  if (action === "disconnect") {
    const { data } = await admin.from("gmail_connexions").select("refresh_token").eq("societe", societe).maybeSingle();
    if (data && data.refresh_token) {
      try { await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(data.refresh_token), { method: "POST" }); } catch (_) { /* best-effort */ }
    }
    await admin.from("gmail_connexions").delete().eq("societe", societe);
    return json({ ok: true });
  }

  return json({ error: "Action inconnue : " + action }, 400);
});
