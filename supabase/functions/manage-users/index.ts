// ============================================================================
//  Parc Pilot — Gestion des comptes / accès (CEO · Admin · Gestionnaire)
//  Créer / modifier / supprimer des utilisateurs DEPUIS la page Paramètres,
//  sans passer par Supabase. Tout est automatique et sécurisé.
//
//  ⚠️ SÉCURITÉ : cette fonction utilise la clé service_role (toute-puissante),
//     lue depuis l'environnement Supabase (JAMAIS dans le code du site public).
//     Elle vérifie D'ABORD que le demandeur est bien CEO ou Admin, et applique
//     sa PORTÉE : un Admin ne peut agir QUE dans sa propre société et ne peut
//     PAS créer de CEO. Un gestionnaire n'a aucun accès à cette fonction.
//
//  Déploiement (une fois) :
//    Supabase → Edge Functions → « Deploy a new function » → nom : manage-users
//    → colle ce fichier → Deploy.
//    (SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par
//     Supabase à toutes les Edge Functions — rien à configurer.)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Traduit un « accès » (ce que choisit l'utilisateur) en colonnes de la table profiles.
function accesToProfile(acces: string, societe: string | null) {
  if (acces === "ceo") return { is_admin: true, role: "admin", societe: null };
  if (acces === "gestionnaire") return { is_admin: false, role: "gestionnaire", societe };
  return { is_admin: false, role: "admin", societe }; // 'admin' (client)
}
function profileToAcces(p: { is_admin?: boolean; role?: string } | null) {
  // FAIL-CLOSED : aucun profil = AUCUN accès (avant : "admin" par défaut → un compte sans ligne
  // profiles, ex. orphelin d'une création/suppression interrompue, était traité comme Admin client).
  if (!p) return "";
  if (p.is_admin) return "ceo";
  return p.role === "gestionnaire" ? "gestionnaire" : "admin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Configuration serveur incomplète." }, 500);

  // Client « admin » (service_role) : lit/écrit auth + profiles en contournant la RLS.
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1) Qui appelle ? On valide le jeton (Bearer) de l'utilisateur connecté.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Non connecté." }, 401);
  const { data: { user: caller } } = await admin.auth.getUser(token);
  if (!caller) return json({ error: "Session expirée — reconnecte-toi." }, 401);

  // 3) Droits du demandeur (source de vérité = profiles)
  const { data: me } = await admin.from("profiles").select("is_admin,role,societe").eq("id", caller.id).maybeSingle();
  const callerAcces = profileToAcces(me);
  const isCEO = callerAcces === "ceo";
  const isAdmin = callerAcces === "admin";
  if (!isCEO && !isAdmin) return json({ error: "Accès refusé : réservé au CEO et aux administrateurs." }, 403);
  const mySociete = me?.societe || null;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "Corps JSON invalide." }, 400); }
  const action = String(body.action || "");

  // Garde-fou de PORTÉE : un Admin est limité à SA société et ne peut pas fabriquer de CEO.
  const guardScope = (acces: string, societe: string | null): string | null => {
    if (isCEO) return null;
    if (acces === "ceo") return "Un administrateur ne peut pas créer de compte CEO.";
    if (societe && mySociete && societe !== mySociete) return "Un administrateur ne peut agir que dans sa propre société.";
    return null;
  };
  // Vérifie qu'une cible existante est bien dans le périmètre du demandeur.
  const canTouchTarget = async (targetId: string): Promise<string | null> => {
    if (isCEO) return null;
    if (targetId === caller.id) return null;
    const { data: t } = await admin.from("profiles").select("is_admin,societe").eq("id", targetId).maybeSingle();
    if (!t) return "Compte introuvable.";
    if (t.is_admin) return "Vous ne pouvez pas modifier un compte CEO.";
    if ((t.societe || null) !== mySociete) return "Ce compte n'appartient pas à votre société.";
    return null;
  };

  try {
    // -------- LISTER --------
    if (action === "list") {
      let q = admin.from("profiles").select("id,email,societe,is_admin,role").order("email");
      if (!isCEO) q = q.eq("societe", mySociete);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      const users = (data || []).map((p) => ({
        id: p.id, email: p.email, societe: p.societe,
        acces: profileToAcces(p), self: p.id === caller.id,
      }));
      return json({ ok: true, users, callerAcces, mySociete });
    }

    // -------- CRÉER --------
    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const acces = String(body.acces || "gestionnaire");
      const societe = isCEO ? (body.societe ? String(body.societe) : null) : mySociete;
      if (!email || !password) return json({ error: "E-mail et mot de passe requis." }, 400);
      if (password.length < 8) return json({ error: "Le mot de passe doit faire au moins 8 caractères." }, 400);
      if (acces !== "ceo" && !societe) return json({ error: "Société requise pour un Admin/Gestionnaire." }, 400);
      const scopeErr = guardScope(acces, societe);
      if (scopeErr) return json({ error: scopeErr }, 403);

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (cErr || !created?.user) return json({ error: cErr?.message || "Création impossible (e-mail déjà utilisé ?)." }, 400);
      const prof = accesToProfile(acces, societe);
      const { error: pErr } = await admin.from("profiles").upsert({ id: created.user.id, email, ...prof });
      if (pErr) return json({ error: "Compte créé mais profil non enregistré : " + pErr.message }, 500);
      return json({ ok: true, id: created.user.id });
    }

    // -------- INVITER PAR E-MAIL (le client choisit LUI-MÊME son mot de passe) --------
    // Crée le compte (mot de passe aléatoire, jamais communiqué), génère un lien personnel de
    // définition de mot de passe (type recovery → géré par login.html), et envoie un e-mail
    // « sauce Parc Pilot » via Resend. L'invitation part TOUJOURS de l'adresse plateforme
    // (INVITE_FROM / EMAIL_FROM) — jamais de l'adresse d'une société — car c'est Parc Pilot qui invite.
    if (action === "invite") {
      const email = String(body.email || "").trim().toLowerCase();
      const acces = String(body.acces || "gestionnaire");
      const societe = isCEO ? (body.societe ? String(body.societe) : null) : mySociete;
      const redirectTo = String(body.redirectTo || "https://parc-pilot.fr/login.html");
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "E-mail valide requis." }, 400);
      if (acces !== "ceo" && !societe) return json({ error: "Société requise pour un Admin/Gestionnaire." }, 400);
      const scopeErr = guardScope(acces, societe);
      if (scopeErr) return json({ error: scopeErr }, 403);

      // 1) Créer le compte s'il n'existe pas (sinon = ré-invitation : on garde le compte, on met à jour le profil).
      let userId = "";
      // ⚠️ Mot de passe TEMPORAIRE (l'invité choisira le sien via le lien) : il doit rester ≤ 72 caractères,
      // limite de Supabase/GoTrue (bcrypt) — sinon createUser échoue avec « Password cannot be longer than 72
      // characters » et l'invitation ne part jamais. Un seul UUID (122 bits d'entropie) + suffixe = 40 car.,
      // largement sous la limite et avec maj/min/chiffre/symbole.
      const rndPw = crypto.randomUUID() + "aA9!";
      const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password: rndPw, email_confirm: true });
      if (created?.user) {
        userId = created.user.id;
        const prof = accesToProfile(acces, societe);
        const { error: pErr } = await admin.from("profiles").upsert({ id: userId, email, ...prof });
        if (pErr) return json({ error: "Compte créé mais profil non enregistré : " + pErr.message }, 500);
      } else {
        const { data: ex } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
        if (!ex?.id) return json({ error: cErr?.message || "Compte existant introuvable." }, 400);
        const scopeErr2 = await canTouchTarget(ex.id);
        if (scopeErr2) return json({ error: scopeErr2 }, 403);
        userId = ex.id;
        const prof = accesToProfile(acces, societe);
        await admin.from("profiles").update(prof).eq("id", userId);
      }

      // 2) Lien personnel de définition de mot de passe (login.html capte l'événement PASSWORD_RECOVERY).
      const { data: linkData, error: lErr } = await admin.auth.admin.generateLink({
        type: "recovery", email, options: { redirectTo },
      });
      const actionLink = linkData?.properties?.action_link;
      if (lErr || !actionLink) return json({ error: "Lien d'invitation impossible : " + (lErr?.message || "inconnu") }, 500);

      // 3) Envoi de NOTRE e-mail (sauce Parc Pilot) via Resend.
      const RESEND = Deno.env.get("RESEND_API_KEY");
      const from = Deno.env.get("INVITE_FROM") || Deno.env.get("EMAIL_FROM") || "Parc Pilot <onboarding@resend.dev>";
      if (!RESEND) return json({ ok: true, id: userId, emailSent: false, warn: "Compte prêt, mais RESEND_API_KEY absent → e-mail non envoyé. Configure Resend puis renvoie l'invitation." });
      const esc = (s: string) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] || c));
      // Message ÉDITABLE (Paramètres → E-mails → « invitation à un compte »), lu depuis la config société.
      let inviteMsg = "";
      let inviteObjet = "";
      try {
        const sid = societe || "global";
        const { data: st } = await admin.from("app_settings").select("data").eq("id", sid).maybeSingle();
        const pr = (st && st.data && typeof st.data === "object" ? (st.data as Record<string, unknown>).profil : null) as Record<string, unknown> | null;
        if (pr && pr.mailModeleInvitation) inviteMsg = String(pr.mailModeleInvitation);
        if (pr && pr.mailObjetInvitation) inviteObjet = String(pr.mailObjetInvitation);
      } catch (_) { /* repli défaut */ }
      const DEF_INVITE = "Bonjour,\n\nBienvenue sur Parc Pilot ! 🎉 Ton accès à la plateforme de gestion de flotte est prêt.\n\nChoisis ton mot de passe en un clic (bouton juste en dessous) et tu pourras te connecter tout de suite. Tout est réuni au même endroit, simple et rapide.\n\nTon identifiant : {email}\n\nÀ très vite ! 🚗";
      const inviteBody = String((inviteMsg && inviteMsg.trim()) ? inviteMsg : DEF_INVITE)
        .replace(/ ?\{email\}/gi, email ? " " + email : "").replace(/\n{3,}/g, "\n\n").trim();
      const inviteBodyHtml = '<div style="white-space:pre-wrap;line-height:1.55">' + esc(inviteBody).replace(/\n/g, "<br>") + "</div>";
      // Design BRANDÉ (même en-tête sombre que le relevé km / les amendes), robuste au mode sombre Gmail
      // (background-color solide → le texte blanc reste blanc).
      // Logo Parc Pilot « en dur » (barres orange + « Parc » blanc + « Pilot » orange) — identique au site.
      const ppLogo =
        '<span style="display:inline-block;vertical-align:middle;line-height:0;margin-right:9px">' +
        '<span style="display:block;width:17px;height:4px;background:#F8A24A;border-radius:3px"></span>' +
        '<span style="display:block;width:26px;height:4px;background:#F97316;border-radius:3px;margin-top:3px"></span>' +
        '<span style="display:block;width:11px;height:4px;background:#F97316;border-radius:3px;margin-top:3px"></span>' +
        '</span>' +
        '<span style="font-weight:900;font-style:italic;font-size:16px;color:#ffffff;vertical-align:middle">Parc</span>' +
        '<span style="vertical-align:middle">&#160;</span>' +
        '<span style="font-weight:900;font-style:italic;font-size:16px;color:#F97316;vertical-align:middle">Pilot</span>';
      // Document forçant le SCHÉMA CLAIR → mêmes couleurs en clair ET en sombre (pas d'inversion Gmail).
      const mailDoc = (inner: string) => '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<meta name="color-scheme" content="only light"><meta name="supported-color-schemes" content="only light">'
        + '</head><body style="margin:0;padding:0;background:#EEF2F7;color:#0F1E3D">' + inner + '</body></html>';
      const html = mailDoc(
        '<div style="font-family:Inter,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;color:#0F1E3D">' +
        '<div style="background-color:#0B1220;background-image:linear-gradient(135deg,#0B1220,#1E293B);color:#ffffff;padding:22px 24px;border-radius:14px 14px 0 0">' +
        '<div>' + ppLogo + '</div>' +
        '<div style="font-size:20px;font-weight:800;font-style:italic;margin-top:16px;line-height:1.25;color:#ffffff">Bienvenue !</div>' +
        '</div>' +
        '<div style="border:1px solid #E7EBF0;border-top:none;padding:22px;color:#0F1E3D">' +
        inviteBodyHtml +
        '<p style="text-align:center;margin:22px 0"><a href="' + esc(actionLink) + '" style="display:inline-block;background:#0B1220;color:#ffffff;padding:14px 30px;border-radius:10px;text-decoration:none;font-weight:800;font-size:15px">Définir mon mot de passe →</a></p>' +
        '<p style="font-size:12.5px;line-height:1.5;color:#64748b;margin:12px 0 0">Ce lien est personnel et temporaire ; s\'il a expiré, utilise « Mot de passe oublié » sur la page de connexion.</p>' +
        '</div>' +
        '<div style="background-color:#0B1220;padding:18px 22px;border-radius:0 0 14px 14px;text-align:center">' +
        '<div>' + ppLogo + '</div>' +
        '</div></div>');
      const text = inviteBody + "\n\nDéfinis ton mot de passe ici :\n" + actionLink + "\n\nParc Pilot · parc-pilot.fr";
      // Objet ÉDITABLE (Paramètres → E-mails → « Objet — invitation »), balise {email} ; repli défaut.
      const inviteSubject = String((inviteObjet && inviteObjet.trim()) ? inviteObjet : "Ton accès à Parc Pilot · définis ton mot de passe")
        .replace(/ ?\{email\}/gi, email ? " " + email : "").replace(/[ \t]{2,}/g, " ").trim();
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [email], subject: inviteSubject, html, text }),
        });
        const rd = await r.json().catch(() => ({}));
        if (!r.ok) return json({ ok: true, id: userId, emailSent: false, warn: "Compte prêt, mais e-mail non envoyé : " + (rd?.message || "erreur Resend") + " (domaine d'envoi vérifié ?)." });
        return json({ ok: true, id: userId, emailSent: true });
      } catch (e) {
        return json({ ok: true, id: userId, emailSent: false, warn: "Compte prêt, mais e-mail non envoyé (réseau Resend) : " + String(e) });
      }
    }

    // -------- CHANGER L'ACCÈS / LA SOCIÉTÉ --------
    if (action === "updateRole") {
      const id = String(body.id || "");
      const acces = String(body.acces || "");
      if (!id || !acces) return json({ error: "Paramètres manquants." }, 400);
      const scopeErr0 = await canTouchTarget(id);
      if (scopeErr0) return json({ error: scopeErr0 }, 403);
      // Société cible : si non fournie, on CONSERVE celle du compte (pas d'effacement involontaire).
      const { data: tgt } = await admin.from("profiles").select("societe").eq("id", id).maybeSingle();
      const societe = acces === "ceo"
        ? null
        : (isCEO ? (body.societe != null ? String(body.societe) : (tgt?.societe || null)) : mySociete);
      const scopeErr = guardScope(acces, societe);
      if (scopeErr) return json({ error: scopeErr }, 403);
      if (id === caller.id && acces !== callerAcces)
        return json({ error: "Vous ne pouvez pas changer votre propre niveau d'accès." }, 400);
      const prof = accesToProfile(acces, societe);
      const { error } = await admin.from("profiles").update(prof).eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // -------- RÉINITIALISER LE MOT DE PASSE --------
    if (action === "resetPassword") {
      const id = String(body.id || "");
      const password = String(body.password || "");
      if (!id || password.length < 8) return json({ error: "Mot de passe d'au moins 8 caractères requis." }, 400);
      const scopeErr = await canTouchTarget(id);
      if (scopeErr) return json({ error: scopeErr }, 403);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // -------- SUPPRIMER --------
    if (action === "delete") {
      const id = String(body.id || "");
      if (!id) return json({ error: "Identifiant manquant." }, 400);
      if (id === caller.id) return json({ error: "Vous ne pouvez pas supprimer votre propre compte." }, 400);
      const scopeErr = await canTouchTarget(id);
      if (scopeErr) return json({ error: scopeErr }, 403);
      // Ordre : compte AUTH d'abord, PUIS le profil. Si la suppression auth échoue, on n'a pas
      // laissé un compte auth orphelin sans profil (qui, même en fail-closed, n'aurait plus accès).
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 500);
      await admin.from("profiles").delete().eq("id", id);
      return json({ ok: true });
    }

    return json({ error: "Action inconnue." }, 400);
  } catch (e) {
    return json({ error: "Erreur serveur : " + String(e) }, 500);
  }
});
