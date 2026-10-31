// ============================================================================
//  Parc Pilot — RAPPELS PUSH des TÂCHES (tâche planifiée)
//
//  But (demande explicite de l'utilisateur, « même processus que Google Agenda ») :
//  recevoir une notification PUSH sur son téléphone / ordinateur — MÊME appli fermée —
//  pour les TÂCHES de la page Tâches, avec :
//    (1) un RAPPEL ANTICIPÉ « quelques heures avant » pour un rendez-vous à heure fixe
//        (type « rdv » avec une heure) — délai réglable (notif.tacheRappelHeures, défaut 3 h) ;
//    (2) un RÉSUMÉ DU JOUR le matin (une seule notification) listant les tâches du jour
//        + le nombre de tâches en retard — pour les tâches « journée » (sans heure) et l'agenda.
//    (3) un RAPPEL « LA VEILLE » (le matin du jour précédent) des tâches datées de DEMAIN, envoyé en
//        PUSH **et par E-MAIL** au gestionnaire (mailExpediteur + mailCopie) → fiable même sans push.
//        Comble le trou : une tâche programmée dans la page Tâches SANS véhicule (ou non-RDV) n'avait
//        aucun rappel la veille (km-relance ne couvre QUE les RDV liés à un véhicule via vehRdvGarage).
//        On exclut ces RDV-véhicule ici pour ne pas doublonner avec km-relance. Réglable : notif.tacheRappelVeille.
//
//  DÉCLENCHEMENT : appelée régulièrement (toutes les 30 min conseillé) par pg_cron →
//    net.http_post (voir supabase/task-reminders-setup.sql). La granularité 30 min suffit
//    largement pour un rappel « quelques heures avant ». Peut être testée à la main par un CEO.
//
//  ANTI-DOUBLON : chaque notification a une CLÉ unique (task-id + moment, ou jour+société pour
//    le résumé) enregistrée dans la table `push_log`. On n'envoie que si la clé est NOUVELLE
//    (INSERT ignore-duplicates = atomique) → jamais deux fois le même rappel, même si le cron
//    tourne souvent ou rattrape un retard. (Même esprit que la fenêtre « demain » de km-relance.)
//
//  DESTINATAIRES : tous les appareils ABONNÉS de la société (gestionnaires/admins qui ont
//    activé les notifications dans Paramètres → Notifications). Table push_subscriptions, isolée
//    par société. Les tâches vivent dans app_settings.data.taches (par société). La ligne
//    historique `global` = la société PXP (comme côté client).
//
//  SÉCURITÉ : verify_jwt=false (voir config.toml). L'appel doit fournir l'en-tête x-cron-secret
//    == TASK_REMINDERS_SECRET **ou** KM_RELANCE_SECRET (on réutilise le secret existant → aucun
//    nouveau secret à créer), OU un JWT de CEO (is_admin) pour un test manuel. Sinon 401.
//    La clé PRIVÉE VAPID reste un SECRET serveur (VAPID_PRIVATE_KEY), jamais côté client.
//
//  SECRETS (Supabase → Edge Functions → Secrets) — tous DÉJÀ présents pour les autres fonctions :
//    VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT  (déjà utilisés par km-collect)
//    KM_RELANCE_SECRET (réutilisé)  — ou, au choix, TASK_REMINDERS_SECRET.
//
//  Déploiement : automatique (GitHub Action deploy-edge-functions.yml au push sur main).
// ============================================================================

import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

// ─── Fuseau Europe/Paris (interprétation des dates/heures de tâches comme heure locale FR). ───
function parisOffsetMin(d: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(d)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour === "24" ? "0" : p.hour), +p.minute);
  return Math.round((asUTC - d.getTime()) / 60000);
}
// Millisecondes UTC correspondant à une date+heure LOCALE de Paris (ex. "2026-10-14","09:30").
function parisMs(ymd: string, hm: string): number | null {
  const md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").slice(0, 10));
  const mh = /^(\d{1,2}):(\d{2})$/.exec(String(hm || "").trim());
  if (!md || !mh) return null;
  const Y = +md[1], Mo = +md[2], D = +md[3], h = +mh[1], mi = +mh[2];
  const guess = Date.UTC(Y, Mo - 1, D, h, mi);
  const off = parisOffsetMin(new Date(guess));
  return guess - off * 60000;
}
const parisYMD = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const parisHour = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }).format(d).replace(/\D/g, "")) || 0;

// Tâche « faite » ? (miroir de taskStatut côté client : statut 'done' OU drapeau fait.)
const estFaite = (t: any) => (t && (t.statut === "done" || (t.statut == null && !!t.fait)));
// Tâche « en attente » (colonne En attente du Kanban) = volontairement mise EN PAUSE par l'utilisateur
// → ni « en retard » ni relancée (sinon elle renotifie chaque matin alors qu'elle est parquée exprès).
const estEnAttente = (t: any) => (t && t.statut === "attente");

// Échappement HTML pour l'e-mail de rappel (titres/lieux/conducteurs saisis).
const esc = (s: unknown) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }) as Record<string, string>)[c]);
// Validation/dédoublonnage d'adresses (mirror km-relance) : une saisie bancale ne bloque pas l'envoi.
const RE_EMAIL = /[^\s<>,;]+@[^\s<>,;]+\.[^\s<>,;]+/g;
function cleanEmails(raw: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  for (const entry of raw) { const f = String(entry || "").match(RE_EMAIL); if (f) for (const e of f) out.push(e.trim().toLowerCase()); }
  return [...new Set(out)];
}

// ─── PUSH (Web Push / VAPID) ────────────────────────────────────────────────
let _vapidReady: boolean | null = null;
function vapidReady(): boolean {
  if (_vapidReady !== null) return _vapidReady;
  const pub = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const priv = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const subj = Deno.env.get("VAPID_SUBJECT") || "mailto:contact@parc-pilot.fr";
  if (!pub || !priv) { _vapidReady = false; return false; }
  try { webpush.setVapidDetails(subj, pub, priv); _vapidReady = true; }
  catch { _vapidReady = false; }
  return _vapidReady;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  const SUPA = Deno.env.get("SUPABASE_URL");
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPA || !SERVICE) return json({ error: "Configuration serveur incomplète." }, 500);

  // --- Authentification : secret cron (task OU km-relance réutilisé) OU JWT de CEO (test manuel). ---
  const SECRETS = [Deno.env.get("TASK_REMINDERS_SECRET"), Deno.env.get("KM_RELANCE_SECRET")].map((s) => (s || "").trim()).filter(Boolean);
  const provided = (req.headers.get("x-cron-secret") || "").trim();
  let authed = !!(provided && SECRETS.includes(provided));
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

  let body: { dryRun?: boolean; societe?: string } = {};
  try { body = await req.json(); } catch { /* body vide = ok */ }
  const dryRun = !!body.dryRun;
  const onlySoc = body.societe ? String(body.societe).trim() : "";

  const rest = (path: string, init?: RequestInit) =>
    fetch(`${SUPA}/rest/v1/${path}`, { ...(init || {}), headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...((init && init.headers) || {}) } });
  const getJson = (path: string) => rest(path).then((r) => (r.ok ? r.json() : [])).catch(() => []);

  // Réserve une clé d'anti-doublon (INSERT ignore-duplicates = atomique). true = clé NOUVELLE
  // (on envoie), false = déjà envoyée (on saute) OU table absente (on ne spamme pas). dryRun = n'écrit
  // rien et renvoie true pour simuler ce qui PARTIRAIT.
  const claim = async (key: string, soc: string): Promise<boolean> => {
    if (dryRun) return true;
    try {
      const r = await rest("push_log", { method: "POST", headers: { Prefer: "return=representation,resolution=ignore-duplicates" }, body: JSON.stringify({ dedup_key: key, societe: soc }) });
      if (!r.ok) return false;
      const arr = await r.json().catch(() => []);
      return Array.isArray(arr) && arr.length > 0;
    } catch { return false; }
  };

  // Envoi PUSH à tous les appareils abonnés d'une société. Supprime les abonnements expirés (404/410).
  const subsCache: Record<string, any[]> = {};
  const subsOf = async (soc: string): Promise<any[]> => {
    if (subsCache[soc]) return subsCache[soc];
    const rows = await getJson(`push_subscriptions?societe=eq.${encodeURIComponent(soc)}&select=id,endpoint,p256dh,auth`);
    return (subsCache[soc] = Array.isArray(rows) ? rows : []);
  };
  const sendPush = async (soc: string, payload: { title: string; body: string; url?: string; tag?: string }): Promise<number> => {
    if (!vapidReady()) return 0;
    const subs = await subsOf(soc);
    if (!subs.length) return 0;
    const msg = JSON.stringify({
      title: payload.title || "Parc Pilot",
      body: payload.body || "",
      url: payload.url || "./pages/taches.html",
      tag: payload.tag || undefined,
      icon: "./assets/icons/icon-192.png",
    });
    let okCount = 0;
    await Promise.all(subs.map(async (s: any) => {
      const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try { await webpush.sendNotification(sub, msg); okCount++; }
      catch (e) {
        const code = e && (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) { try { await rest(`push_subscriptions?id=eq.${s.id}`, { method: "DELETE" }); } catch { /* ignore */ } }
      }
    }));
    return okCount;
  };

  // Ménage best-effort : purge les clés d'anti-doublon de plus de 30 jours (table qui ne gonfle pas).
  if (!dryRun) { try { await rest(`push_log?created_at=lt.${new Date(Date.now() - 30 * 864e5).toISOString()}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); } catch { /* ignore */ } }

  const settingsRows = await getJson("app_settings?select=id,data");
  const now = Date.now();
  const nowDate = new Date(now);
  const todayYMD = parisYMD(nowDate);
  const hourNow = parisHour(nowDate);
  const GRACE = 6 * 3600 * 1000;   // fenêtre de rattrapage si le cron a sauté un créneau

  const summary = { digestSent: 0, leadSent: 0, veilleSent: 0, skipped: 0, societes: 0 };
  const details: any[] = [];

  // Expéditeur e-mail (mirror km-relance / send-email) pour le rappel « la veille ».
  const RESEND_KEY = (Deno.env.get("RESEND_API_KEY") || "").trim();
  let envFrom = (Deno.env.get("EMAIL_FROM") || "").trim();
  if (!envFrom || /resend\.dev/i.test(envFrom)) envFrom = "Parc Pilot <noreply@projectxparis.fr>";
  const sendMail = async (profil: any, societeNom: string, to: string[], subject: string, html: string, text: string): Promise<boolean> => {
    if (dryRun) return true;
    if (!RESEND_KEY || !to.length) return false;
    let from = envFrom, replyTo = "";
    const exp = String((profil && profil.mailExpediteur) || "").trim();
    if (exp) {
      const dom = String((profil && profil.mailDomaineEnvoi) || "").trim().replace(/^@/, "");
      const fromAddr = dom ? (exp.split("@")[0] + "@" + dom) : exp;
      let nom = String(societeNom || "").replace(/[<>"]/g, "").trim();
      if (/^parc\s*pilot$/i.test(nom)) nom = "";
      from = nom ? `${nom} <${fromAddr}>` : fromAddr; replyTo = exp;
    }
    const payload: Record<string, unknown> = { from, to, subject, html, text };
    if (replyTo) payload.reply_to = replyTo;
    try { const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) }); return r.ok; }
    catch { return false; }
  };

  // Regroupe les tâches PAR SOCIÉTÉ (la ligne historique `global` = PXP, comme côté client), en
  // dédoublonnant par id — évite un double comptage si PXP a par erreur des tâches dans `global` ET `PXP`.
  const bySoc: Record<string, { tasks: Map<string, any>; notif: any; profil: any; societeNom: string }> = {};
  for (const row of (settingsRows as any[])) {
    if (!row || !row.id) continue;
    const soc = row.id === "global" ? "PXP" : String(row.id);
    if (onlySoc && soc !== onlySoc) continue;
    const data = (row.data && typeof row.data === "object") ? row.data : {};
    const taches = Array.isArray(data.taches) ? data.taches : [];
    if (!taches.length) continue;
    const slot = bySoc[soc] || (bySoc[soc] = { tasks: new Map(), notif: {}, profil: {}, societeNom: "" });
    // La config `notif`/`profil`/`societe` d'une société vient d'UNE ligne : on prend celle qui en a une
    // (priorité à la ligne portant le nom de la société plutôt que `global`, mais une seule en a en pratique).
    if (data.notif && typeof data.notif === "object" && (!slot.notif || !Object.keys(slot.notif).length || row.id === soc)) slot.notif = data.notif;
    if (data.profil && typeof data.profil === "object" && (!slot.profil || !Object.keys(slot.profil).length || row.id === soc)) slot.profil = data.profil;
    if (data.societe && typeof data.societe === "object" && data.societe.nom && (!slot.societeNom || row.id === soc)) slot.societeNom = String(data.societe.nom);
    for (const t of taches) { if (t && (t.id != null)) slot.tasks.set(String(t.id), t); else if (t) slot.tasks.set("_" + slot.tasks.size, t); }
  }

  for (const soc of Object.keys(bySoc)) {
    const { tasks, notif, profil, societeNom } = bySoc[soc];
    summary.societes++;
    const leadH = Math.max(0, Number.isFinite(Number(notif.tacheRappelHeures)) ? Number(notif.tacheRappelHeures) : 3);
    const digestHour = Math.min(23, Math.max(0, Number.isFinite(Number(notif.tacheDigestHeure)) ? Number(notif.tacheDigestHeure) : 8));

    const actives = [...tasks.values()].filter((t: any) => t && !estFaite(t) && !estEnAttente(t) && t.echeance);

    // ── (1) RÉSUMÉ DU JOUR (une notif/jour, à partir de l'heure réglée) ──
    if (hourNow >= digestHour) {
      const dueToday = actives.filter((t: any) => String(t.echeance).slice(0, 10) === todayYMD);
      const overdue = actives.filter((t: any) => String(t.echeance).slice(0, 10) < todayYMD);
      if (dueToday.length || overdue.length) {
        const key = "digest:" + soc + ":" + todayYMD;
        if (await claim(key, soc)) {
          const titres = dueToday.slice(0, 3).map((t: any) => String(t.titre || "Tâche")).join(" · ");
          const parts: string[] = [];
          if (dueToday.length) parts.push(dueToday.length + " tâche" + (dueToday.length > 1 ? "s" : "") + " aujourd'hui" + (titres ? " : " + titres + (dueToday.length > 3 ? "…" : "") : ""));
          if (overdue.length) parts.push(overdue.length + " en retard");
          const n = await sendPush(soc, { title: "📋 Tâches du jour", body: parts.join(" · "), url: "./pages/taches.html", tag: "taches-digest-" + todayYMD });
          if (!dryRun && n === 0) { /* personne d'abonné : rien à signaler */ }
          summary.digestSent++;
          details.push({ societe: soc, type: "digest", due: dueToday.length, retard: overdue.length, devices: dryRun ? "(dry-run)" : n });
        } else summary.skipped++;
      }
    }

    // ── (2) RAPPEL ANTICIPÉ « quelques heures avant » (rdv à heure fixe) ──
    if (leadH > 0) {
      for (const t of actives) {
        if (!(t.type === "rdv" && t.heure && /^\d{1,2}:\d{2}$/.test(String(t.heure).trim()))) continue;
        const startMs = parisMs(String(t.echeance), String(t.heure));
        if (startMs == null) continue;
        const targetMs = startMs - leadH * 3600 * 1000;
        // On envoie si le moment du rappel est atteint (avec rattrapage ≤ 6 h), ET que le rdv n'a pas
        // encore eu lieu (sinon le rappel « avant » n'a plus de sens — le résumé du jour l'aura couvert).
        if (targetMs <= now && targetMs > now - GRACE && startMs > now) {
          const key = "lead:" + String(t.id || (t.echeance + "T" + t.heure)) + ":" + String(t.echeance).slice(0, 10) + "T" + String(t.heure).trim() + ":" + leadH;
          if (await claim(key, soc)) {
            const extra = [t.lieu ? String(t.lieu) : "", t.conducteur ? String(t.conducteur) : ""].filter(Boolean).join(" · ");
            const heures = Math.round((startMs - now) / 3600000);
            const quand = heures >= 1 ? ("dans ~" + heures + " h") : "bientôt";
            const n = await sendPush(soc, { title: "🕑 " + String(t.titre || "Rendez-vous"), body: "Rendez-vous " + quand + " (" + String(t.heure).trim() + ")" + (extra ? " · " + extra : ""), url: "./pages/taches.html", tag: "tache-" + String(t.id || "") });
            summary.leadSent++;
            details.push({ societe: soc, type: "lead", titre: String(t.titre || ""), heure: String(t.heure).trim(), devices: dryRun ? "(dry-run)" : n });
          } else summary.skipped++;
        }
      }
    }

    // ── (3) RAPPEL « LA VEILLE » (tâches datées de DEMAIN) — push + e-mail au gestionnaire ──
    //   Comble le trou : une tâche programmée dans la page Tâches SANS véhicule (ou non-RDV) n'avait
    //   AUCUN rappel la veille (km-relance ne couvre QUE les RDV liés à un véhicule via vehRdvGarage).
    //   On exclut ici les RDV-véhicule (déjà rappelés par km-relance) pour ne pas doublonner. Une seule
    //   notification/e-mail par société et par jour (anti-doublon `claim`). E-mail = copie fiable même
    //   sans push (adresses du gestionnaire : mailExpediteur + mailCopie).
    if (notif.tacheRappelVeille !== false && hourNow >= digestHour) {
      const demain = parisYMD(new Date(now + 86400000));
      const veille = actives.filter((t: any) =>
        String(t.echeance).slice(0, 10) === demain &&
        !(t.type === "rdv" && t.vehiculeId != null) // déjà couvert par km-relance (vehRdvGarage)
      );
      if (veille.length) {
        const key = "veille:" + soc + ":" + demain;
        if (await claim(key, soc)) {
          const ligne = (t: any, bullet: string) => {
            const h = (t.type === "rdv" && /^\d{1,2}:\d{2}$/.test(String(t.heure || "").trim())) ? (" " + String(t.heure).trim()) : "";
            const extra = [t.lieu, t.conducteur].map((x: any) => String(x || "").trim()).filter(Boolean).join(" · ");
            return bullet + String(t.titre || "Tâche") + h + (extra ? " (" + extra + ")" : "");
          };
          const resume = veille.length + " tâche" + (veille.length > 1 ? "s" : "") + " demain : "
            + veille.slice(0, 3).map((t: any) => String(t.titre || "Tâche")).join(" · ") + (veille.length > 3 ? "…" : "");
          const n = await sendPush(soc, { title: "📅 Demain", body: resume, url: "./pages/taches.html", tag: "taches-veille-" + demain });
          // E-mail de copie fiable au gestionnaire
          const to = cleanEmails([profil && profil.mailExpediteur, profil && profil.mailCopie]);
          let mailed = false;
          if (to.length) {
            const dateFr = demain.split("-").reverse().join("/");
            const htmlList = veille.map((t: any) => {
              const h = (t.type === "rdv" && /^\d{1,2}:\d{2}$/.test(String(t.heure || "").trim())) ? (" à " + esc(String(t.heure).trim())) : "";
              const extra = [t.lieu, t.conducteur].map((x: any) => String(x || "").trim()).filter(Boolean).join(" · ");
              return '<li style="margin:4px 0"><b>' + esc(t.titre || "Tâche") + "</b>" + h + (extra ? ' — <span style="color:#555">' + esc(extra) + "</span>" : "") + "</li>";
            }).join("");
            const html = '<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#111">'
              + '<h2 style="margin:0 0 4px">📅 Rappel : ' + (veille.length > 1 ? "tâches" : "tâche") + " de demain</h2>"
              + '<p style="color:#666;margin:0 0 12px">' + esc(dateFr) + "</p>"
              + '<ul style="padding-left:18px;margin:0 0 16px">' + htmlList + "</ul>"
              + '<p style="color:#999;font-size:12px;margin:0">Parc Pilot — rappel automatique de la veille.</p></div>';
            const text = "Rappel — " + (veille.length > 1 ? "tâches" : "tâche") + " de demain (" + dateFr + ") :\n"
              + veille.map((t: any) => ligne(t, "- ")).join("\n");
            mailed = await sendMail(profil, societeNom, to, "📅 Demain : " + resume, html, text);
          }
          summary.veilleSent++;
          details.push({ societe: soc, type: "veille", date: demain, taches: veille.length, devices: dryRun ? "(dry-run)" : n, email: dryRun ? "(dry-run)" : (to.length ? (mailed ? to.join(",") : "echec") : "sans-adresse") });
        } else summary.skipped++;
      }
    }
  }

  return json({ ok: true, dryRun, now: nowDate.toISOString(), todayYMD, hourNow, summary, details });
});
