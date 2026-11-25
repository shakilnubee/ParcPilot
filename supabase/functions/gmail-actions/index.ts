// ============================================================================
//  Parc Pilot — AUTOMATISATION GMAIL : moteur serveur (lecture → tri → file « À vérifier »)
// ============================================================================
//  Lit les NOUVEAUX mails de chaque boîte connectée (boîte principale + libellé
//  « Parc Pilot », même archivés), les TRIE avec le moteur partagé (_shared/triage.mjs),
//  et écrit des PROPOSITIONS dans la file gmail_a_verifier. ⚠️ NE MODIFIE JAMAIS un
//  dossier : il ne fait que proposer. L'exécution reste humaine (écran « À vérifier »)
//  et reprend les parcours manuels FP.* (Phase 5).
//
//  SÉCURITÉ / GARDES :
//   • DORMANT par défaut : le mode 'run' ne fait rien tant que GMAIL_ACTIONS_ENABLED
//     n'est pas posé (= '1'/'true'). Déployer la fonction n'a donc aucun effet.
//   • 'simulate' : classe des messages FICTIFS fournis dans la requête et renvoie les
//     propositions SANS rien écrire (pour valider le tri avant toute reprise réelle).
//   • Auth : en-tête x-cron-secret (GMAIL_ACTIONS_SECRET ou KM_RELANCE_SECRET) OU JWT CEO.
//   • Jeton Gmail (refresh_token) et clés restent CÔTÉ SERVEUR. Scope lecture seule.
//   • Idempotence : table gmail_traites (claim) → un messageId traité une seule fois ;
//     une nouvelle réponse (nouveau messageId) reste traitable. Insertion de la
//     proposition en upsert(id) ignore-duplicates → aucun doublon même en cas de relance.
//
//  Actions (POST { action }):
//   • 'status'   → { ok, configured, enabled }
//   • 'simulate' → { ok, simulate:true, results:[{id, decision, proposal}] }  (aucune écriture)
//   • 'run'      → lit Gmail + remplit la file (exige enabled). { ok, run:true, par_societe:[…] }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { T } from "../_shared/triage.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

// --- échange refresh_token → access_token (lecture seule), comme gmail-read ---
async function accessTokenFrom(refresh: string, clientId: string, clientSecret: string): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const d = await r.json().catch(() => null) as Record<string, unknown> | null;
  if (!r.ok || !d || !d.access_token) throw new Error("Jeton Google invalide ou révoqué.");
  return String(d.access_token);
}

function headerOf(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  const h = (headers || []).find((x) => (x.name || "").toLowerCase() === name.toLowerCase());
  return (h && h.value) ? String(h.value) : "";
}
function emailOf(from: string): string {
  const m = /<([^>]+)>/.exec(from || ""); if (m) return m[1].trim();
  const m2 = /([^\s<>]+@[^\s<>]+)/.exec(from || ""); return m2 ? m2[1].trim() : "";
}
// deno-lint-ignore no-explicit-any
function collectPdfs(payload: any, out: Array<{ filename: string; attachmentId: string; size: number }>): void {
  if (!payload || typeof payload !== "object") return;
  const fn = String(payload.filename || ""), mt = String(payload.mimeType || "");
  const attId = payload.body && payload.body.attachmentId ? String(payload.body.attachmentId) : "";
  if (attId && fn && (mt === "application/pdf" || /\.pdf$/i.test(fn))) {
    out.push({ filename: fn, attachmentId: attId, size: Number((payload.body && payload.body.size) || 0) });
  }
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const p of parts) collectPdfs(p, out);
}
// deno-lint-ignore no-explicit-any
function parseFull(msg: any) {
  const payload = (msg && msg.payload) || {};
  const headers = payload.headers || [];
  const from = headerOf(headers, "From");
  const pdfs: Array<{ filename: string; attachmentId: string; size: number }> = [];
  collectPdfs(payload, pdfs);
  let dateISO: string | null = null;
  const intd = msg && msg.internalDate ? Number(msg.internalDate) : NaN;
  if (!isNaN(intd)) { try { dateISO = new Date(intd).toISOString(); } catch (_) { dateISO = null; } }
  return {
    id: String((msg && msg.id) || ""), threadId: String((msg && msg.threadId) || ""),
    from, fromEmail: emailOf(from), subject: headerOf(headers, "Subject"),
    snippet: String((msg && msg.snippet) || ""), dateISO,
    headers: { references: headerOf(headers, "References"), inReplyTo: headerOf(headers, "In-Reply-To") },
    labels: Array.isArray(msg && msg.labelIds) ? msg.labelIds : [],
    pdfs, hasPdf: pdfs.length > 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPA = Deno.env.get("SUPABASE_URL");
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPA || !SERVICE) return json({ error: "Configuration serveur incomplète." }, 500);
  const CLIENT_ID = (Deno.env.get("GMAIL_OAUTH_CLIENT_ID") || "").trim();
  const CLIENT_SECRET = (Deno.env.get("GMAIL_OAUTH_CLIENT_SECRET") || "").trim();
  const configured = !!(CLIENT_ID && CLIENT_SECRET);
  const enabled = /^(1|true|oui|on)$/i.test((Deno.env.get("GMAIL_ACTIONS_ENABLED") || "").trim());
  const admin = createClient(SUPA, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

  // ---- Authentification : secret cron OU JWT CEO ----
  const CRON = (Deno.env.get("GMAIL_ACTIONS_SECRET") || Deno.env.get("KM_RELANCE_SECRET") || "").trim();
  const given = (req.headers.get("x-cron-secret") || "").trim();
  let authed = !!(CRON && given && given === CRON);
  if (!authed) {
    const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (tok) {
      try {
        const { data: { user } } = await admin.auth.getUser(tok);
        if (user) {
          const { data: me } = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
          if (me && me.is_admin) authed = true; // CEO uniquement pour un test manuel
        }
      } catch (_) { /* noop */ }
    }
  }
  if (!authed) return json({ error: "Non autorisé." }, 401);

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const action = String((body as Record<string, unknown>).action || "status");

  if (action === "status") return json({ ok: true, configured, enabled });

  // ---- simulate : classe des messages fictifs, N'ÉCRIT RIEN (sûr même si désactivé) ----
  if (action === "simulate") {
    const msgs = Array.isArray((body as Record<string, unknown>).messages) ? (body as Record<string, unknown>).messages as unknown[] : [];
    const ctx = ((body as Record<string, unknown>).ctx as Record<string, unknown>) || {};
    const results = msgs.map((m) => {
      const decision = T.classify(m, ctx);
      const proposal = T.buildProposal(m, decision, (ctx.societe as string) || "SIMU");
      return { id: (m as Record<string, unknown>).id, decision, proposal };
    });
    return json({ ok: true, simulate: true, count: results.length, results });
  }

  // ---- run : lecture réelle + remplissage de la file (DORMANT si non activé) ----
  if (action === "run") {
    if (!enabled) return json({ ok: true, run: false, enabled: false, info: "Traitement réel désactivé (GMAIL_ACTIONS_ENABLED absent)." });
    if (!configured) return json({ ok: true, run: false, configured: false, info: "Secrets Gmail absents." });

    const startedAt = new Date().toISOString();
    const onlySoc = String((body as Record<string, unknown>).societe || "").trim();
    const maxMsg = Math.min(Math.max(Number((body as Record<string, unknown>).max || 40) || 40, 1), 60);

    let q = admin.from("gmail_connexions").select("societe,refresh_token,email,created_at");
    if (onlySoc) q = q.eq("societe", onlySoc);
    const { data: conns } = await q;
    const parSociete: Array<Record<string, unknown>> = [];

    for (const c of (conns || [])) {
      const soc = String(c.societe);
      const res = { societe: soc, lus: 0, proposes: 0, ignores: 0, deja: 0, erreurs: 0 };
      try {
        const access = await accessTokenFrom(String(c.refresh_token), CLIENT_ID, CLIENT_SECRET);
        const since = Math.floor(new Date(c.created_at || Date.now()).getTime() / 1000);
        const query = `after:${since} {in:inbox label:"Parc Pilot"}`;
        const lr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxMsg}&q=${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${access}` } });
        const ld = await lr.json().catch(() => null) as Record<string, unknown> | null;
        const ids: string[] = (ld && Array.isArray(ld.messages)) ? (ld.messages as Array<{ id: string }>).map((m) => m.id) : [];
        const uniq = ids.filter((x, i) => ids.indexOf(x) === i);

        // Contexte société (vehicules + amendes) — sinistres : enrichissement ultérieur.
        const [{ data: vehs }, { data: ams }] = await Promise.all([
          admin.from("vehicules").select("immat").eq("societe", soc),
          admin.from("amendes").select("numero_avis").eq("societe", soc),
        ]);
        const ctx = {
          vehicules: (vehs || []).map((v: Record<string, unknown>) => ({ immat: v.immat })),
          amendes: (ams || []).map((a: Record<string, unknown>) => ({ numeroAvis: a.numero_avis })),
          sinistres: [] as unknown[],
        };

        for (const id of uniq) {
          // Claim idempotent : n'insère la clé que si neuve (sinon déjà traité).
          const { data: claimed } = await admin.from("gmail_traites")
            .upsert({ dedup_key: T.cleIdempotence(id, null), societe: soc, message_id: id, resultat: "propose" }, { onConflict: "dedup_key", ignoreDuplicates: true })
            .select();
          if (!claimed || !claimed.length) { res.deja++; continue; }

          const mr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, { headers: { Authorization: `Bearer ${access}` } });
          if (!mr.ok) { res.erreurs++; continue; }
          const mj = await mr.json().catch(() => null);
          if (!mj) { res.erreurs++; continue; }
          const parsed = parseFull(mj);
          const decision = T.classify(parsed, ctx);
          res.lus++;
          if (decision.domaine === "horsflotte" || decision.action === "ignore") {
            res.ignores++;
            await admin.from("gmail_traites").update({ resultat: "ignore", action: decision.action }).eq("dedup_key", T.cleIdempotence(id, null));
            continue;
          }
          const prop = T.buildProposal(parsed, decision, soc);
          await admin.from("gmail_a_verifier").upsert(prop, { onConflict: "id", ignoreDuplicates: true });
          res.proposes++;
        }
      } catch (e) {
        res.erreurs++;
        (res as Record<string, unknown>).message = String((e as Error).message || e);
      }
      parSociete.push(res);
    }

    // Supervision best-effort (compteurs non sensibles uniquement).
    try {
      await admin.from("cron_runs").insert({ job: "gmail-actions", status: "ok", started_at: startedAt, finished_at: new Date().toISOString(), detail: { par_societe: parSociete } });
    } catch (_) { /* noop */ }

    return json({ ok: true, run: true, par_societe: parSociete });
  }

  return json({ error: "Action inconnue : " + action }, 400);
});
