// Parc Pilot — client Supabase (backend)
// Le SDK officiel doit être chargé AVANT ce fichier via :
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

(function () {
  const SUPABASE_URL = 'https://tzjuptlzoywjeigmyfuj.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_KC3TZ1zda-ja-0wkyjHUlg_aKohD6tq';

  if (typeof window === 'undefined' || !window.supabase || !window.supabase.createClient) {
    console.error('[supabase-client] Le SDK @supabase/supabase-js n\'est pas chargé. Ajoute <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> avant ce fichier.');
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  window.FP = window.FP || {};
  FP.supabase = client;

  // ⚠️ MULTI-SOCIÉTÉS — purge des caches locaux liés à un TENANT (société) + à l'identité.
  // Indispensable pour que, sur un navigateur PARTAGÉ (ex. la démo de Shakil puis la connexion d'un
  // NOUVEAU CLIENT), le client suivant ne voie JAMAIS — même le temps d'un flash — les données de la
  // société précédente (véhicules, amendes, factures, NOMS de conducteurs) figées dans le cache/profil
  // du user précédent. Appelée à la connexion ET à la déconnexion, et en filet si l'id user change.
  // NE touche PAS aux préférences per-appareil (mode sombre, densité, « se souvenir de moi »).
  FP.purgeTenantCache = function () {
    try {
      // + fp_ctrl_ (caches Contrôle : conso/trouvailles → contiennent des NOMS de conducteurs = PII) :
      // sur un poste partagé, ils ne doivent pas survivre à la déconnexion. On NE purge PAS fp_bak_
      // (filet de restauration local des réglages — le supprimer effacerait des points de restauration).
      const KILL = /^(fp_data_cache|fp_cond_cache|fp_docs_cache|fp_emprunts|fp_ctrl_|auto_flotte_settings)/;
      const drop = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && KILL.test(k)) drop.push(k); }
      drop.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
      ['fp_profile', 'fp_societe', 'fp_email', 'fp_data_cache'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
      // ⚠️ ANTI-PERTE : on vide aussi le snapshot serveur EN MÉMOIRE des réglages. Sinon, après cette
      // purge (cache localStorage vidé), un enregistrement compare des DÉFAUTS locaux à un snapshot
      // encore plein → et réécrivait la config par les valeurs par défaut (nom de société, groupes,
      // ordre sidebar…). En le remettant à null, tout enregistrement repart en mode « le serveur gagne,
      // on ne comble que les trous » (cf. FP.settings._pushSettings). Rien ne peut plus être réinitialisé.
      try { if (window.FP && FP.settings) FP.settings._serverSnap = null; } catch (e) {}
    } catch (e) {}
  };

  // Envoi d'e-mail via l'Edge Function 'send-email' (la clé Resend reste SECRÈTE côté serveur).
  // Rejette si la fonction n'est pas (encore) déployée → l'appelant peut alors se replier sur Gmail.
  // msg = { to, cc?, subject, html?, text?, replyTo?, from? }
  // ⚠️ Expéditeur PAR SOCIÉTÉ : si l'appelant ne fixe pas `from`, on envoie depuis l'adresse
  // d'envoi configurée de la société active (FP.societeProfil().mailExpediteur), affichée
  // « <Nom société> <adresse> ». Le destinataire reçoit donc le mail DE l'adresse de la société.
  // (Resend n'accepte que les adresses d'un domaine vérifié → chaque société doit vérifier le sien.)
  // Découpe une liste d'adresses « a@x.fr, b@y.fr ; c@z.fr » en tableau propre (garde ce qui a un @).
  const _parseEmails = (v) => String(v == null ? '' : v).split(/[,;]+/).map(s => s.trim()).filter(s => s.includes('@'));
  FP.sendEmail = async (msg) => {
    msg = msg || {};
    try {
      const prof = (FP.societeProfil && FP.societeProfil()) || {};
      // ⚠️ COPIE SYSTÉMATIQUE (traçabilité légale) : toute personne configurée dans Paramètres →
      // Société → « E-mails toujours en copie » (prof.mailCopie) est mise en copie de TOUT e-mail
      // envoyé par la plateforme — amendes, états des lieux, RÉPONSES AUX DEMANDES CONDUCTEUR, accès
      // véhicule, relances… — pas seulement les amendes. On fusionne avec un éventuel cc explicite,
      // on dédoublonne (insensible à la casse) et on retire les adresses déjà destinataires (to) pour
      // ne pas copier deux fois. Centralisé ICI = aucun point d'envoi ne peut l'oublier (source unique).
      try {
        const seen = new Set(_parseEmails(msg.to).map(a => a.toLowerCase()));
        const merged = [];
        _parseEmails(msg.cc).concat(_parseEmails(prof.mailCopie)).forEach(a => {
          const k = a.toLowerCase();
          if (!seen.has(k)) { seen.add(k); merged.push(a); }
        });
        msg.cc = merged.join(', ');
      } catch (e) {}
      const exp = String(prof.mailExpediteur || '').trim();
      if (exp) {
        // Réponses → la VRAIE adresse de la société (même quand on envoie via un domaine dédié).
        if (!msg.replyTo) msg.replyTo = exp;
        if (!msg.from) {
          // Le FROM doit être sur le DOMAINE VÉRIFIÉ dans Resend. Si un domaine d'envoi est
          // configuré (Paramètres → Société → « Domaine d'envoi vérifié »), on garde la même
          // partie locale sur ce domaine (ex. shakil.nubee@resend.projectxparis.fr) →
          // Resend accepte l'envoi, et la réponse part vers l'adresse réelle (reply-to).
          const dom = String(prof.mailDomaineEnvoi || '').trim().replace(/^@/, '');
          const fromAddr = dom ? (exp.split('@')[0] + '@' + dom) : exp;
          // Nom d'expéditeur = nom de la société (Paramètres → Société), JAMAIS « Parc Pilot ».
          let nom = ''; try { nom = (FP.settings.get().societe && FP.settings.get().societe.nom) || ''; } catch (e) {}
          nom = String(nom).replace(/[<>"]/g, '').trim();
          if (/^parc\s*pilot$/i.test(nom)) nom = '';
          msg.from = nom ? `${nom} <${fromAddr}>` : fromAddr;
        }
      }
    } catch (e) {}
    if (client.functions && typeof client.functions.invoke === 'function') {
      const { data, error } = await client.functions.invoke('send-email', { body: msg });
      if (error) {
        // Le message par défaut ("Edge Function returned a non-2xx status code") est générique :
        // on va lire le VRAI message d'erreur renvoyé par la fonction (souvent une erreur Resend).
        let m = (error && error.message) || 'Erreur d\'envoi';
        try { const ctx = error.context && (await error.context.json()); if (ctx && ctx.error) m = ctx.error; } catch (e) {}
        throw new Error(m);
      }
      if (data && data.error) throw new Error(data.error);
      return data;
    }
    // Repli : appel direct de l'endpoint avec le jeton de l'utilisateur connecté
    let jwt = SUPABASE_KEY;
    try { const t = JSON.parse(localStorage.getItem('sb-tzjuptlzoywjeigmyfuj-auth-token') || '{}'); if (t && t.access_token) jwt = t.access_token; } catch (_) {}
    const res = await fetch(SUPABASE_URL + '/functions/v1/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + jwt },
      body: JSON.stringify(msg),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || (d && d.error)) throw new Error((d && d.error) || ('HTTP ' + res.status));
    return d;
  };

  // ===== Authentification =====
  // Détermine le chemin vers login.html selon le contexte (racine vs sous-dossier pages/)
  const loginPath = window.location.pathname.includes('/pages/') ? '../login.html' : 'login.html';

  FP.auth = {
    async getUser() {
      const { data: { session } } = await client.auth.getSession();
      return session ? session.user : null;
    },
    async getSession() {
      const { data: { session } } = await client.auth.getSession();
      return session;
    },
    async signOut() {
      // Déconnexion : plus d'ancienne transition « hyperspace » — on redirige vers login.html
      // où la scène d'orage joue un DÉLUGE d'éclairs (drapeau fp_logout_burst lu au chargement).
      try { sessionStorage.setItem('fp_logout_burst', '1'); } catch (e) {}
      // Purge tenant : le prochain compte connecté sur ce navigateur ne doit hériter d'aucune donnée.
      try { if (FP.purgeTenantCache) FP.purgeTenantCache(); } catch (e) {}
      try { localStorage.removeItem('fp_last_uid'); } catch (e) {}
      try { await client.auth.signOut(); } catch (e) {}
      setTimeout(function () { window.location.href = loginPath; }, 120);
    },
    /** Photo d'avatar de l'utilisateur (cosmétique) — stockée dans user_metadata.avatar_url.
     *  (Pas un champ de sécurité → OK dans user_metadata, contrairement au rôle/société.) */
    async updateAvatar(url) {
      const { data, error } = await client.auth.updateUser({ data: { avatar_url: url || null } });
      if (error) throw error;
      return data && data.user;
    },
    /** Force la présence d'une session, sinon redirige vers /login.html */
    async requireAuth() {
      const user = await this.getUser();
      if (!user) {
        window.location.href = loginPath;
        return null;
      }
      return user;
    },
  };

  // Si "Se souvenir de moi" n'était pas coché ET que le navigateur a été fermé entre-temps,
  // on nettoie la session pour forcer une reconnexion (sessionStorage est vidé à la fermeture).
  const rememberMe = localStorage.getItem('fp_remember_me') === '1';
  const sessionAlive = sessionStorage.getItem('fp_session_alive') === '1';
  if (!rememberMe && !sessionAlive) {
    // L'utilisateur ne voulait pas être mémorisé, et c'est une nouvelle session navigateur
    localStorage.removeItem('sb-tzjuptlzoywjeigmyfuj-auth-token');
  }
  // Marqueur pour cette session navigateur (sera vidé à la fermeture)
  sessionStorage.setItem('fp_session_alive', '1');

  // Auto-redirect vers login.html si pas connecté (sauf sur login.html ou index.html)
  const path = window.location.pathname;
  const isLoginPage = path.endsWith('login.html');
  const isLandingPage = path.endsWith('index.html') || path === '/' || path.endsWith('/fleet-app/');
  if (!isLoginPage && !isLandingPage) {
    FP.auth.requireAuth();
  }

  // ===== Mappings snake_case ↔ camelCase =====
  // Le cas général : snake_case → camelCase par split-_ + capitalize.
  // Quelques colonnes ont des sigles (HT, TVA, TTC, CG) où la convention historique
  // utilisée par le frontend est `montantTTC`, `montantHT`, etc. — il faut un override.
  const SNAKE_TO_CAMEL_OVERRIDES = {
    'montant_ht':           'montantHT',
    'montant_tva':          'montantTVA',
    'montant_ttc':          'montantTTC',
    'changer_cg':           'changerCG',
    // CT = Contrôle Technique : sans override, on obtiendrait "prochainCt" / "dateDernierCt"
    // (petit t) alors que le frontend lit "prochainCT" / "dateDernierCT".
    'prochain_ct':          'prochainCT',
    'date_dernier_ct':      'dateDernierCT',
    // La colonne historique "note_pneus" (champ "Note pneus" retiré de la fiche) est
    // réutilisée pour stocker l'autonomie du véhicule → propriété frontend "autonomie".
    'note_pneus':           'autonomie',
    // De même, "type_pneus" (champ "Type" retiré) est réutilisée pour la version/finition
    // du véhicule (lue sur la facture d'achat) → propriété frontend "version".
    'type_pneus':           'version',
  };
  const CAMEL_TO_SNAKE_OVERRIDES = {};
  Object.entries(SNAKE_TO_CAMEL_OVERRIDES).forEach(([s, c]) => { CAMEL_TO_SNAKE_OVERRIDES[c] = s; });

  function snakeToCamel(key) {
    if (SNAKE_TO_CAMEL_OVERRIDES[key]) return SNAKE_TO_CAMEL_OVERRIDES[key];
    return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
  }
  function camelToSnake(key) {
    if (CAMEL_TO_SNAKE_OVERRIDES[key]) return CAMEL_TO_SNAKE_OVERRIDES[key];
    return key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
  }

  function remapKeys(obj, fn) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[fn(k)] = v;
    return out;
  }
  const toClient = (row) => remapKeys(row, snakeToCamel);
  const toDb     = (row) => remapKeys(row, camelToSnake);

  // Cohérence compteur : le « km à jour » ne peut jamais être INFÉRIEUR au « km de la dernière
  // révision » (un véhicule roule toujours vers l'avant). Certaines lignes importées ont un
  // km à jour resté en dessous du km de révision → on le remonte pour TOUTES les pages, dès le
  // chargement (pas d'écriture en base : la correction se persiste au prochain enregistrement).
  function reconcileVehKm(v) {
    try { const rev = Number(v.kmDernierReleve) || 0, cur = Number(v.km) || 0; if (rev > cur) v.km = rev; } catch (e) {}
    return v;
  }

  // ===== Multi-sociétés (étiquette "societe" par ligne) =====
  // Société active = celle affichée par l'admin. Par défaut "PXP" (= comportement actuel).
  function activeSociete() { try { return localStorage.getItem('fp_societe') || 'PXP'; } catch (e) { return 'PXP'; } }
  // Filtre des lignes selon la société active ('__all__' = tout afficher). Une ligne
  // sans étiquette est considérée comme "PXP" (rétro-compatible avec les données existantes).
  function filterSociete(rows) {
    const s = activeSociete();
    if (s === '__all__') return rows;
    return (rows || []).filter(r => (r.societe || 'PXP') === s);
  }
  // Étiquette une nouvelle ligne avec la société active — UNIQUEMENT si on n'est pas sur "PXP"
  // (ainsi, tant qu'on reste sur PXP, on n'envoie rien de nouveau → aucun risque avant la migration SQL).
  function stampSociete(row) {
    const s = activeSociete();
    if (row && row.societe == null && s && s !== 'PXP' && s !== '__all__') return { ...row, societe: s };
    return row;
  }

  // ⚠️ ANTI-PERTE — écriture RÉSILIENTE à une colonne inconnue (schéma en retard sur le code).
  // Bug vécu : le code enregistrait `immatriculation` dans `amendes`, mais la colonne n'existait pas
  // → PostgREST renvoyait « Could not find the 'immatriculation' column of 'amendes' in the schema
  // cache » et TOUTE l'amende était PERDUE. Désormais, plutôt que de perdre la ligne entière à cause
  // d'un seul champ en trop, on RETIRE automatiquement la colonne fautive et on réécrit la ligne sans
  // elle (la donnée principale est sauvée ; le champ manquant est juste ignoré + signalé en console).
  // Marche pour insert / upsert / update. Borné (12 passes) pour ne jamais boucler.
  async function writeResilient(table, snake, run) {
    let payload = Object.assign({}, snake), res, guard = 0;
    while (guard++ < 12) {
      res = await run(payload);
      if (!res || !res.error) return res;
      const m = String(res.error.message || '').match(/could not find the '([^']+)' column/i);
      if (!m || !(m[1] in payload)) return res;          // autre erreur, ou colonne déjà absente → on rend la main
      delete payload[m[1]];
      try { console.warn(`[FP.db ${table}] colonne inconnue « ${m[1]} » ignorée (schéma en retard sur le code) — la ligne est quand même enregistrée.`); } catch (e) {}
      // ⚠️ M7 — la perte d'un champ ne doit PAS être SILENCIEUSE (règle 0-perte ③). La ligne est
      // sauvée, mais l'utilisateur doit SAVOIR qu'un champ n'a pas pu être enregistré (base à mettre
      // à jour). On le signale visiblement, une seule fois par champ/table (anti-spam).
      try {
        const _k = table + ':' + m[1];
        window.__fpColWarned = window.__fpColWarned || {};
        if (window.FP && FP.notifyError && !window.__fpColWarned[_k]) {
          window.__fpColWarned[_k] = 1;
          FP.notifyError('Un champ (« ' + m[1] + ' ») n\'a pas pu être enregistré : la base n\'est pas à jour. La fiche est sauvegardée sans ce champ — préviens le support pour l\'ajouter.');
        }
      } catch (e) {}
      if (!Object.keys(payload).length) return res;        // plus rien à écrire → on arrête
    }
    return res;
  }

  // Clé primaire par table : la table "conducteurs" est indexée par "key" (pas de colonne "id").
  // Clé primaire réelle par table (sinon 'id'). ⚠️ edl_signatures a pour PK `token` (PAS d'`id`) →
  // sans ça, le tri par `id` renvoyait un 400 « column id does not exist » à CHAQUE lecture (spam
  // console + requête inutile relancée). conducteurs → `key`.
  const PK_BY_TABLE = { conducteurs: 'key', edl_signatures: 'token' };
  function pkColumn(table) { return PK_BY_TABLE[table] || 'id'; }

  // Récupère TOUTES les lignes d'une table en PAGINANT. PostgREST/Supabase plafonne une réponse à
  // ~1000 lignes : sans pagination, au-delà de 1000 factures/amendes les totaux (coûts, TVA, TCO)
  // seraient SILENCIEUSEMENT tronqués. On boucle par pages de 1000 via .range() jusqu'à la dernière
  // page (renvoie < 1000). Comportement identique tant qu'une table tient sous 1000 lignes.
  async function fetchAllRows(table, orderCol) {
    const PAGE = 1000;
    let from = 0, out = [];
    for (;;) {
      let q = client.from(table).select('*');
      if (orderCol) q = q.order(orderCol, { ascending: true });
      const res = await q.range(from, from + PAGE - 1);
      if (res.error) return { data: null, error: res.error };
      const rows = res.data || [];
      out = out.concat(rows);
      if (rows.length < PAGE) break; // dernière page atteinte
      from += PAGE;
    }
    return { data: out, error: null };
  }

  // ⚠️ HELPER CANONIQUE — lecture PAGINÉE d'une table AVEC filtres (évite le cap SILENCIEUX de 1000
  // lignes de Supabase). `applyFilters(qb)` reçoit le query-builder (après .select('*')) pour poser des
  // .gte/.eq/etc. `orderCol` (obligatoire pour une pagination fiable) trie de façon stable.
  // À utiliser PARTOUT à la place d'un `FP.supabase.from(t).select('*')…` brut sur une grosse table
  // (total_conso_tx, factures…), sinon les lignes au-delà de 1000 sont perdues en silence.
  FP.selectAllPaged = async function (table, applyFilters, orderCol, cols) {
    const PAGE = 1000;
    let from = 0, out = [];
    for (;;) {
      let q = client.from(table).select(cols || '*');
      if (typeof applyFilters === 'function') { const q2 = applyFilters(q); if (q2) q = q2; }
      if (orderCol) q = q.order(orderCol, { ascending: true });
      const res = await q.range(from, from + PAGE - 1);
      if (res.error) return { data: out, error: res.error };
      const rows = res.data || [];
      out = out.concat(rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    return { data: out, error: null };
  };

  // ===== API publique =====
  FP.db = {
    /** Charge les 3 tables et retourne { vehicules, amendes, factures } en camelCase */
    async loadAll() {
      // Tri explicite par id : sans ça, PostgreSQL renvoie les lignes dans l'ordre
      // du tas (heap), et toute ligne modifiée passe en dernier → ordre instable.
      const [v, a, f, c] = await Promise.all([
        fetchAllRows('vehicules', 'id'),
        fetchAllRows('amendes', 'id'),
        fetchAllRows('factures', 'id'),
        fetchAllRows('conducteurs', null),
      ]);
      const errors = [v.error, a.error, f.error].filter(Boolean); // conducteurs non bloquant (compteur)
      if (errors.length) {
        console.error('[FP.db.loadAll] erreurs :', errors);
        throw new Error(errors.map(e => e.message).join(' | '));
      }
      return {
        vehicules: filterSociete((v.data || []).map(toClient).map(reconcileVehKm)),
        amendes:   filterSociete((a.data || []).map(toClient)),
        factures:  filterSociete((f.data || []).map(toClient)),
        // ⚠️ conducteurs = requête NON bloquante : en cas d'erreur (blip réseau sur CETTE table seule), on
        // renvoie null (PAS []) → l'appelant ne doit PAS écraser les conducteurs déjà chargés par un tableau
        // vide (sinon disparition en mémoire + cache, bug « 46 → 0 »). Les gardes Array.isArray + _writeDataCache
        // (repli sur window.FP_DATA) préservent l'existant.
        conducteurs: c.error ? null : filterSociete((c.data || []).map(toClient)),
      };
    },

    /** Met à jour partiellement une ligne. Renvoie { error } si échec. */
    async update(table, id, fields) {
      const snake = toDb(fields);
      const res = await writeResilient(table, snake, p => client.from(table).update(p).eq(pkColumn(table), id));
      if (res.error) console.error(`[FP.db.update ${table}#${id}]`, res.error);
      return res;
    },

    /** Insère une nouvelle ligne. */
    async insert(table, row) {
      const snake = toDb(table === 'app_settings' ? row : stampSociete(row));
      const res = await writeResilient(table, snake, p => client.from(table).insert(p));
      if (res.error) console.error(`[FP.db.insert ${table}]`, res.error);
      return res;
    },

    /** Lit toutes les lignes d'une table (converties en camelCase). */
    async select(table) {
      // Trier par la VRAIE clé primaire (conducteurs → "key", sinon "id") : sinon un ORDER BY id
      // sur une table sans colonne "id" renvoyait un 400 (visible dans la console) avant le repli.
      let res = await fetchAllRows(table, pkColumn(table)); // paginé (évite la troncature > 1000 lignes)
      // Filet de sécurité : si malgré tout le tri échoue (colonne absente), on réessaie sans tri.
      if (res.error && /column .* does not exist/i.test(res.error.message || '')) {
        res = await fetchAllRows(table, null);
      }
      if (res.error) { console.error(`[FP.db.select ${table}]`, res.error); return { data: [], error: res.error }; }
      return { data: filterSociete((res.data || []).map(toClient)), error: null };
    },

    /** Insère ou met à jour (upsert) une ligne par sa clé primaire. */
    async upsert(table, row) {
      const snake = toDb(table === 'app_settings' ? row : stampSociete(row));
      // Conflit sur la VRAIE clé primaire (ex. conducteurs → 'key', sinon 'id')
      const res = await writeResilient(table, snake, p => client.from(table).upsert(p, { onConflict: pkColumn(table) }));
      if (res.error) console.error(`[FP.db.upsert ${table}]`, res.error);
      return res;
    },

    /** Supprime une ligne par sa clé primaire (id, ou `key` pour conducteurs). */
    async delete(table, id) {
      const res = await client.from(table).delete().eq(pkColumn(table), id);
      if (res.error) console.error(`[FP.db.delete ${table}#${id}]`, res.error);
      return res;
    },
  };
  FP._clientLoaded = true; // marqueur : supabase-client.js a bien fini de s'initialiser

  // Remplace le CONTENU d'un array sans changer sa référence
  // (important pour que les `const data = window.FP_DATA` capturés par les pages
  // voient toujours les bons éléments)
  function replaceArrayInPlace(target, source) {
    if (!Array.isArray(target)) return;
    target.length = 0;
    for (const item of source) target.push(item);
  }

  // ⚠️ SOURCE UNIQUE — signature LÉGÈRE des champs AFFICHÉS quelque part : si les données live sont
  // identiques à ce qui est déjà affiché, on évite un re-rendu inutile (« grisaille »/page qui se remet).
  // Utilisée au chargement (loadDataFromSupabase) ET à la re-synchro au 1er plan (FP.refreshData). ⚠️ Doit
  // couvrir TOUS les champs affichés, sinon modifier un champ hors-liste ne déclenche pas 'fp:data-ready'
  // et l'écran garde l'ancienne valeur (cf. règle anti « cache périmé »).
  function _fpDataSig(d) {
    const f = (arr, ks) => (arr || []).map(x => ks.map(k => (x[k] ?? '')).join('|')).join(';');
    return f(d.vehicules, ['id','immat','marque','modele','version','km','kmDernierReleve','statut','chauffeur','prochainCT','dateDernierCT','derniereRevision','proprietaire','carburant','co2','puissanceFiscale','dateMiseEnCirculation','valeurAchat','prix','assurance','vin','couleur','boite','prixVente','groupes','categorie','pipelineStatut','autonomie','critAir','antiPollution','commentaire','photoUrl','dimensionPneus','sanef','cleSiege','cleSalarie','cgOrigSiege','cgOrigSalarie','cgUrl','cgFileId','dateChangementPneus'])
         + '~' + (d.vehicules || []).map(v => (v.id || '') + ':' + (v.etatDesLieux ? JSON.stringify(v.etatDesLieux) : '')).join(';')
         + '#' + f(d.amendes, ['id','statut','montant','montantTTC','montantMinore','montantForfaitaire','montantMajore','majoree','points','date','prenom','motif','numeroAvis','numeroTelepaiement','cle','avisUrl','justifUrl','commentaire','archived'])
         + '#' + (d.amendes || []).map(a => (a.id || '') + ':' + ((a.pieces || []).length) + ':' + ((a.pieces || []).map(p => (p && (p.id || p.url)) || '').join(','))).join(';')
         + '#' + f(d.factures, ['id','montantHT','montantTVA','montantTTC','type','date','vehiculeImmat','fournisseur','numeroFacture','km','description','categorie','source','conducteur','fileName','fileId','archived','url','fileUrl'])
         + '#' + (d.factures || []).map(x => (x.id || '') + ':' + ((x.pieces || []).length) + ':' + ((x.pieces || []).map(p => (p && (p.id || p.url)) || '').join(','))).join(';')
         + '#' + f(d.conducteurs, ['key','name','nom','prenom','masque','dateNaissance','poste','tel','email','adresse','permisNumero','permisExpiration','permisObtention','permisType','note']);
  }

  // Écrit le cache local des dernières données live (affichage initial de la prochaine page → zéro « flash »).
  // Repli progressif si le quota est dépassé (véhicules+amendes+conducteurs, puis amendes+conducteurs).
  function _writeDataCache(data) {
    const CK = window.FP_CACHE_KEY || 'fp_data_cache_v4';
    // ⚠️ Une table en échec (ex. conducteurs null) ne doit JAMAIS vider le cache : on retombe sur les
    // données déjà en mémoire (window.FP_DATA) pour cette table — jamais un tableau vide issu d'une erreur.
    const D = window.FP_DATA || {};
    const pick = (k) => Array.isArray(data && data[k]) ? data[k] : (Array.isArray(D[k]) ? D[k] : []);
    const veh = pick('vehicules'), amd = pick('amendes'), fac = pick('factures'), cond = pick('conducteurs');
    try { localStorage.removeItem('fp_data_cache'); } catch (e0) {}
    try {
      localStorage.setItem(CK, JSON.stringify({ vehicules: veh, amendes: amd, factures: fac, conducteurs: cond }));
    } catch (e) {
      try { localStorage.setItem(CK, JSON.stringify({ vehicules: veh, amendes: amd, conducteurs: cond })); }
      catch (e2) { try { localStorage.setItem(CK, JSON.stringify({ amendes: amd, conducteurs: cond })); } catch (e3) {} }
    }
  }

  // ===== Loader async qui remplace les données dans window.FP_DATA =====
  FP.dbReady = (async function loadDataFromSupabase() {
    // S'assurer que window.FP_DATA existe avec les bonnes propriétés (sinon créer)
    window.FP_DATA = window.FP_DATA || { vehicules: [], amendes: [], factures: [], conducteurs: [] };
    if (!Array.isArray(window.FP_DATA.vehicules)) window.FP_DATA.vehicules = [];
    if (!Array.isArray(window.FP_DATA.amendes))   window.FP_DATA.amendes   = [];
    if (!Array.isArray(window.FP_DATA.factures))  window.FP_DATA.factures  = [];
    if (!Array.isArray(window.FP_DATA.conducteurs)) window.FP_DATA.conducteurs = [];

    // Profil multi-société : récupère la société de l'utilisateur + s'il est super-admin.
    // Un CLIENT (non-admin) est verrouillé sur SA société (le filtre + l'étiquetage suivent),
    // AVANT de charger les données. (La base, via la RLS, ne renvoie de toute façon que SA société.)
    try {
      const { data: { session } } = await client.auth.getSession();
      const u = session && session.user;
      if (u) {
        // 🔒 FILET MULTI-SOCIÉTÉS : si l'utilisateur connecté a CHANGÉ depuis la dernière fois sur ce
        // navigateur (autre compte / autre société), on PURGE tout cache tenant AVANT de continuer —
        // évite qu'un client hérite des données du précédent (le login purge déjà, ceci couvre les
        // reconnexions auto « se souvenir de moi » et tout changement de session hors login.html).
        try {
          const prevUid = localStorage.getItem('fp_last_uid');
          if (prevUid && prevUid !== u.id) {
            if (FP.purgeTenantCache) FP.purgeTenantCache();
            // 🔒 SÉCURITÉ : changement de compte sur ce navigateur → on PURGE le profil de droits en cache
            // (fp_profile) AVANT de lire celui du nouveau compte. Sinon le profil (rôle / is_admin) du compte
            // précédent survivait → un Gestionnaire pouvait hériter des droits CEO du compte utilisé juste
            // avant (outils propriétaire, sélecteur multi-sociétés, config). Fail-closed : sans profil
            // confirmé, l'UI sensible reste masquée jusqu'à la lecture du bon profil.
            try { localStorage.removeItem('fp_profile'); } catch (e2) {}
            FP.profile = null;
          }
          localStorage.setItem('fp_last_uid', u.id);
        } catch (e) {}
        // Mémorise l'e-mail de connexion (sert au gating de l'onglet privé « JIS », CEO only).
        try { const em = String(u.email || '').toLowerCase(); localStorage.setItem('fp_email', em); FP.userEmail = em; } catch (e) {}
        const pr = await client.from('profiles').select('societe,is_admin,role').eq('id', u.id).maybeSingle();
        if (pr && pr.data) {
          FP.profile = pr.data;
          try { localStorage.setItem('fp_profile', JSON.stringify(pr.data)); } catch (e) {}
          // ⚠️ Verrou société : tout compte qui n'est PAS un CEO confirmé (is_admin !== true) est
          // verrouillé sur SA société (avant : `=== false` strict → un is_admin NULL restait délié et
          // pouvait afficher une autre société). Seul le CEO (is_admin === true) peut basculer / voir __all__.
          if (pr.data.is_admin !== true && pr.data.societe) {
            try { localStorage.setItem('fp_societe', pr.data.societe); } catch (e) {}
          }
          // Recalcule la CLÉ DE CACHE avec la vraie société résolue : sinon les données live seraient
          // écrites sous la clé figée au chargement (défaut PXP) → contamination croisée entre sociétés.
          try {
            const soc = (pr.data.is_admin !== true && pr.data.societe) ? pr.data.societe : (localStorage.getItem('fp_societe') || 'PXP');
            window.FP_CACHE_KEY = 'fp_data_cache_v4_' + soc;
          } catch (e) {}
        }
      }
    } catch (e) { /* table profiles absente / hors-ligne : on garde le comportement admin */ }

    // ⚡ PERF : la requête app_settings (réglages société) ne dépend QUE du profil (déjà résolu
    // ci-dessus), pas des données. On la lance EN PARALLÈLE de loadAll au lieu d'attendre après —
    // économise un aller-retour réseau séquentiel (latence mobile) avant d'appliquer thème/réglages.
    let _settingsPromise = null, _tablesPromise = null, _sid = 'PXP';
    try {
      _sid = (FP.settings && FP.settings._dbId) ? FP.settings._dbId() : 'PXP';
      // Données de travail en TABLES DÉDIÉES (congés, affectations… cf. FP.projections) : lues en parallèle,
      // puis projetées dans les réglages ci-dessous. Une table illisible → sa copie de transition est gardée.
      // ⚠️ Sur plusieurs pages, ce fichier est chargé AVANT app.js (qui définit FP.projections) : dans ce cas la
      // lecture est (re)lancée au moment d'appliquer les réglages — sinon la page restait sur la copie de transition.
      _tablesPromise = (FP.projections && FP.projections.charger) ? FP.projections.charger(client, _sid).catch(() => null) : null;
      _settingsPromise = client.from('app_settings').select('data').eq('id', _sid).maybeSingle()
        .then((sres) => {
          // ⚠️⚠️ UNE SEULE LIGNE PAR SOCIÉTÉ (correctif « deux tiroirs », 16/10/2026) : les réglages d'une
          // société vivent dans la ligne app_settings id = <société> — et NULLE PART AILLEURS. L'ancien repli
          // sur la ligne historique 'global' (PXP) se déclenchait aussi quand la lecture ÉCHOUAIT (coupure
          // réseau) → toute la session lisait ET écrivait dans 'global' pendant que les autres appareils
          // écrivaient dans 'PXP' : deux copies divergentes, et des données qui « reviennent ». La ligne
          // 'global' est désormais une archive gelée (supabase/migrations/…_geler_ligne_global.sql).
          // Lecture en échec → on ne fixe PAS la ligne effective : les écritures visent _dbId() (= la société)
          // et repartent en mode additif sûr (cf. FP.settings._pushSettings), la re-synchro réessaiera.
          if (sres && sres.error) return null;
          const shared = sres && sres.data && sres.data.data;
          try { if (FP.settings) FP.settings._effectiveId = _sid; } catch (e) {}
          return shared;
        }).catch(() => null);
    } catch (e) { _settingsPromise = null; }

    try {
      const data = await FP.db.loadAll();
      // Signature LÉGÈRE des champs affichés : si les données live sont IDENTIQUES à ce qui est
      // déjà affiché (data.js régénéré à jour), on évite le re-rendu inutile (« grisaille » /
      // page qui se remet). On ne ré-émet 'fp:data-ready' que si quelque chose a réellement changé.
      // ⚠️ La signature doit couvrir TOUS les champs AFFICHÉS quelque part, sinon modifier un
      // champe hors-liste (ex. valeurAchat, marque, fournisseur, montantHT/TVA…) ne déclenche
      // pas 'fp:data-ready' et l'écran reste sur l'ancienne valeur. On liste large.
      // ⚠️ Anti « revenant » (M1) : avant de comparer/afficher/cacher, on applique à ces données
      // FRAÎCHES du serveur les écritures locales encore EN FILE (suppressions/ajouts/éditions pas
      // encore synchronisées). Sinon une suppression suivie d'une navigation immédiate reviendrait.
      try { if (window.FP && FP.persist && FP.persist.applyTo) FP.persist.applyTo(data); } catch (e) {}
      const sigBefore = _fpDataSig(window.FP_DATA);
      const sigAfter  = _fpDataSig(data);
      // Remplace les contenus in-place
      replaceArrayInPlace(window.FP_DATA.vehicules, data.vehicules);
      replaceArrayInPlace(window.FP_DATA.amendes,   data.amendes);
      replaceArrayInPlace(window.FP_DATA.factures,  data.factures);
      if (Array.isArray(data.conducteurs)) replaceArrayInPlace(window.FP_DATA.conducteurs, data.conducteurs);
      const dataChanged = (sigBefore !== sigAfter);
      // Cache local des dernières données live → sert d'affichage initial à la prochaine ouverture
      // (évite le "flash" data.js figé → vraies données). On cache TOUT (source unique _writeDataCache).
      _writeDataCache(data);
      console.log(`[FP.db] Chargé depuis Supabase : ${data.vehicules.length} véhicules, ${data.amendes.length} amendes, ${data.factures.length} factures`);
      // Re-appliquer les overrides locaux (cases cochées par l'utilisateur, etc.)
      if (FP.loadVehicleOverrides) FP.loadVehicleOverrides();
      // Charger les réglages PAR SOCIÉTÉ (apparence). Ligne app_settings = la société.
      // Une seule ligne par société (plus de repli sur l'ancienne ligne 'global', gelée le 16/10/2026).
      // ⚠️ On mémorise si les réglages serveur DIFFÈRENT du cache local affiché : les données
      // « réglages » (congés `condConges`, badges/cartes `condBadgeUlys`/`condCarteTotal`,
      // km majorés, immobilisations, loueurs, assureurs, montants payés d'amendes…) vivent dans
      // app_settings — PAS dans les tables véhicules/amendes/factures. Si SEULS les réglages ont
      // changé (ex. on a saisi congés+badges sur le PC, puis on ouvre le tél dont le cache est
      // périmé), la signature de DONNÉES ne bouge pas → sans ça, `fp:data-ready` ne partait jamais
      // et le tél gardait les anciens réglages (congés/badges absents) jusqu'à un rechargement
      // manuel. On déclenche donc aussi le re-rendu quand les réglages serveur ≠ cache local.
      let settingsChanged = false, settingsLoaded = false;
      try {
        // Réglages société : déjà en vol (lancés en parallèle de loadAll ci-dessus).
        let shared = _settingsPromise ? await _settingsPromise : null;   // ⚠️ let : réassigné ligne ~517 (réconciliation). Un const levait un TypeError avalé → pull des réglages jeté à chaque chargement (désync multi-appareils).
        if (shared && typeof shared === 'object') {
          settingsLoaded = true;   // pull initial OK → pas besoin de la retry 3 s (évite un 2ᵉ SELECT app_settings)
          const key = (FP.settings && FP.settings._key) ? FP.settings._key() : 'auto_flotte_settings';
          let _prevSettingsRaw = null; try { _prevSettingsRaw = localStorage.getItem(key); } catch (_) {}
          // ⚠️ SOURCE UNIQUE de réconciliation (voir _reconcileServerSettings) : on préserve les accusés
          //   d'alerte « ✓ Vu » saisis localement ET on ré-applique les réglages ENCORE EN ATTENTE d'envoi
          //   (file durable) AVANT d'écraser le cache — sinon un pull serveur fait « revenir » une alerte
          //   cochée ou « repartir » un réglage saisi (mails, rappels km…).
          shared = _reconcileServerSettings(shared, _prevSettingsRaw, FP.settings && FP.settings._effectiveId);
          try {
            let lus = _tablesPromise ? await _tablesPromise : null;
            // app.js pas encore exécuté (réseau très rapide) : on attend la fin de l'analyse de la page.
            if (!lus && !(FP.projections && FP.projections.charger) && document.readyState === 'loading') {
              await new Promise(res => document.addEventListener('DOMContentLoaded', res, { once: true }));
            }
            if (!lus && FP.projections && FP.projections.charger) lus = await FP.projections.charger(client, _sid).catch(() => null);
            if (FP.projections) shared = FP.projections.projeter(shared, lus, _sid);
          } catch (_) {}
          const _freshSettingsRaw = JSON.stringify(shared);
          settingsChanged = (_prevSettingsRaw !== _freshSettingsRaw);
          localStorage.setItem(key, _freshSettingsRaw);
          // Point de référence pour la fusion « delta » anti-écrasement des réglages (cf. FP.settings._pushSettings).
          try { if (FP.settings) FP.settings._serverSnap = JSON.parse(JSON.stringify(shared)); } catch (_) {}
          // Migration unique PXP : BPCE devient un loueur normal (settings.loueurs), plus codé en dur.
          // Placée ICI = juste après le chargement des réglages serveur (⇒ pas d'écrasement, base fraîche).
          try { if (FP.normaliserLoueursPXP) FP.normaliserLoueursPXP(); } catch (_) {}
          try { if (FP.migrerModelesAmendeObsoletes) FP.migrerModelesAmendeObsoletes(); } catch (_) {}
          if (FP.settings && FP.settings.applyTheme) FP.settings.applyTheme();
          if (FP.applyCustomNavLabels) FP.applyCustomNavLabels();
          if (FP.applyNavOrder) FP.applyNavOrder();
          if (FP.applyNavVisibility) FP.applyNavVisibility();
          if (FP.applyCustomTexts) FP.applyCustomTexts();
        }
      } catch (e) { /* table absente ou hors-ligne : on garde les réglages locaux */ }
      // On ne déclenche le re-rendu des pages QUE si les données OU les réglages ont réellement
      // changé (sinon le 1er affichage depuis data.js/cache est déjà bon → pas de clignotement).
      // `settingsChanged` couvre les données stockées dans app_settings (congés, badges/cartes,
      // km majorés, immobilisations, loueurs/assureurs…) → un appareil au cache périmé rafraîchit
      // ces éléments dès l'arrivée des réglages serveur, sans rechargement manuel.
      if (dataChanged || settingsChanged) {
        document.dispatchEvent(new CustomEvent('fp:data-ready', { detail: { source: 'supabase', settingsChanged, counts: { vehicules: data.vehicules.length, amendes: data.amendes.length, factures: data.factures.length } } }));
      }
      // ⚠️ FILET ANTI « CACHE PÉRIMÉ » (mobile) : congés / leasing / loueurs… vivent dans app_settings.
      // Si le pull des réglages a échoué en silence (réseau mobile capricieux → `_settingsPromise` = null),
      // l'écran garderait les anciens réglages jusqu'à un vidage manuel du cache (inacceptable pour un
      // client). On RETENTE en tâche de fond ~3 s après le chargement : FP.refreshSettings re-lit le
      // serveur et ne rafraîchit QUE si ça diffère (aucune écriture). Les retours au 1er plan / réseau
      // relancent aussi cette re-synchro (voir wireSettingsAutoRefresh plus bas).
      // Retry SEULEMENT si le pull initial des réglages a échoué (réseau) → pas de 2ᵉ SELECT inutile
      // quand tout s'est bien chargé. Les triggers focus/online/pageshow assurent la re-synchro ensuite.
      if (!settingsLoaded) { try { setTimeout(function () { try { if (FP.refreshSettings) FP.refreshSettings(); } catch (e) {} }, 3000); } catch (e) {} }
      return data;
    } catch (e) {
      console.warn('[FP.db] Supabase indisponible, fallback sur data.js local :', e);
      // Appliquer quand même les modifs locales (overrides) pour qu'elles s'affichent partout
      if (FP.loadVehicleOverrides) FP.loadVehicleOverrides();
      document.dispatchEvent(new CustomEvent('fp:data-ready', { detail: { source: 'local', error: e.message } }));
      return null;
    }
  })();

  // ⚠️⚠️ SOURCE UNIQUE — réconcilie les réglages SERVEUR avec le local NON ENCORE CONFIRMÉ, AVANT
  // d'écraser le cache local. Utilisé au chargement (loadAll) ET à chaque re-synchro (refreshSettings :
  // focus / online / 3 s). Sans ça, un pull serveur écrase EN BLOC :
  //  • les accusés d'alerte « ✓ Vu » (alertesVues/alertesMasquees/alertesMasqueesInfo) cochés à l'instant
  //    → l'alerte REVIENT sans raison (bug « les notifs reviennent trop souvent ») ;
  //  • un réglage saisi juste avant (profil e-mails, rappels km `notif`, couleurs, date de cycle…) encore
  //    dans la file d'écriture durable → la valeur « repart » à l'ancienne (bug « ça remet une autre valeur »).
  // Règle : (1) accusés d'alerte = UNION local∪serveur ; (2) écritures app_settings ENCORE EN ATTENTE de CE
  // poste (file durable) ré-appliquées PAR-DESSUS le serveur (objets = fusion champ par champ ; scalaires /
  // tableaux = valeur en attente). Non destructif : la file finit d'envoyer ces écritures juste après.
  // `rowId` = ligne app_settings qu'on vient de lire : seules les écritures en attente visant CETTE ligne
  // sont ré-appliquées (une écriture restée en file pour une AUTRE ligne — ex. l'ancienne 'global' — ne doit
  // JAMAIS être recopiée par-dessus les réglages de la société : ce serait réinjecter une vieille copie).
  function _reconcileServerSettings(shared, prevRaw, rowId) {
    shared = (shared && typeof shared === 'object') ? shared : {};
    try {
      const lp = prevRaw ? JSON.parse(prevRaw) : null;
      if (lp && typeof lp === 'object') {
        if (lp.alertesVues && typeof lp.alertesVues === 'object') shared.alertesVues = Object.assign({}, shared.alertesVues || {}, lp.alertesVues);
        if (Array.isArray(lp.alertesMasquees)) shared.alertesMasquees = Array.from(new Set([].concat(Array.isArray(shared.alertesMasquees) ? shared.alertesMasquees : [], lp.alertesMasquees)));
        if (lp.alertesMasqueesInfo && typeof lp.alertesMasqueesInfo === 'object') shared.alertesMasqueesInfo = Object.assign({}, shared.alertesMasqueesInfo || {}, lp.alertesMasqueesInfo);
      }
    } catch (_) {}
    try {
      const q = (window.FP && FP.persist && FP.persist._loadQ) ? FP.persist._loadQ() : [];
      // Écritures app_settings EN ATTENTE pour cette ligne, rejouées dans l'ordre sur la version serveur fraîche
      // avec la MÊME règle que leur renvoi (FP._fusion.rejouer) : seules les clés réellement modifiées par ce poste
      // sont appliquées ; une copie sans repère ne fait que combler des trous. ⚠️ Avant, la copie en attente était
      // recopiée clé par clé PAR-DESSUS le serveur : une copie de réglages par défaut (cache vide à la connexion)
      // remplaçait alors les vrais réglages à l'affichage, puis au prochain enregistrement.
      if (window.FP && FP._fusion && FP._fusion.rejouer) {
        q.forEach(it => {
          if (it && it.op === 'upsert' && it.table === 'app_settings' && it.row && it.row.data && typeof it.row.data === 'object'
              && (!rowId || it.row.id === rowId)) shared = FP._fusion.rejouer(shared, it);
        });
      }
    } catch (_) {}
    return shared;
  }

  // ============================================================
  // RE-SYNCHRO DES RÉGLAGES — anti « cache périmé » (congés / leasing / loueurs / assureurs… vivent
  // dans app_settings, pas dans les tables véhicules/amendes/factures). RE-LIT le serveur et rafraîchit
  // l'affichage UNIQUEMENT si ça diffère. ⚠️ NE FAIT AUCUNE ÉCRITURE (lecture seule) → aucun risque
  // d'écraser le serveur. But : un client n'a JAMAIS besoin de vider son cache pour retrouver ses données.
  FP.refreshSettings = function () {
    try {
      if (!(FP.supabase && FP.supabase.from && FP.settings)) return Promise.resolve(false);
      if (FP._refreshingSettings) return Promise.resolve(false);
      FP._refreshingSettings = true;
      const release = (v) => { FP._refreshingSettings = false; return v; };
      // Toujours la ligne de LA société (plus de repli 'global' : cf. correctif « deux tiroirs » au chargement).
      let sid = 'PXP';
      try { sid = FP.settings._dbId ? FP.settings._dbId() : 'PXP'; } catch (e) {}
      const tablesP = FP.projections ? FP.projections.charger(FP.supabase, sid).catch(() => null) : Promise.resolve(null);
      return Promise.all([FP.supabase.from('app_settings').select('data').eq('id', sid).maybeSingle(), tablesP]).then(([r, tablesLues]) => {
        if (r && r.error) throw r.error;
        const shared = r && r.data && r.data.data;
        if (!shared || typeof shared !== 'object') return release(false);   // rien de fiable → on garde l'existant
        try { FP.settings._effectiveId = sid; } catch (e) {}
        const key = FP.settings._key ? FP.settings._key() : 'auto_flotte_settings';
        let prev = null; try { prev = localStorage.getItem(key); } catch (e) {}
        // ⚠️ MÊME réconciliation qu'au chargement : ce refresh (focus / online / 3 s après load) écrasait
        //   le cache SANS préserver ni les accusés « ✓ Vu » (→ alertes qui reviennent) ni les réglages
        //   encore en attente d'envoi (→ mails / rappels km qui « repartent »). On réconcilie AVANT d'écraser.
        shared = _reconcileServerSettings(shared, prev, sid);
        try { if (FP.projections) shared = FP.projections.projeter(shared, tablesLues, sid); } catch (e) {}   // congés, affectations… : source = tables
        const fresh = JSON.stringify(shared);
        const changed = (prev !== fresh);
        try { localStorage.setItem(key, fresh); } catch (e) {}
        try { FP.settings._serverSnap = JSON.parse(fresh); } catch (e) {}   // base de fusion delta = serveur frais
        if (changed) {
          try { if (FP.normaliserLoueursPXP) FP.normaliserLoueursPXP(); } catch (e) {}
          try { if (FP.migrerModelesAmendeObsoletes) FP.migrerModelesAmendeObsoletes(); } catch (e) {}
          try { if (FP.settings.applyTheme) FP.settings.applyTheme(); } catch (e) {}
          try { if (FP.applyCustomNavLabels) FP.applyCustomNavLabels(); } catch (e) {}
          try { if (FP.applyNavOrder) FP.applyNavOrder(); } catch (e) {}
          try { if (FP.applyNavVisibility) FP.applyNavVisibility(); } catch (e) {}
          try { if (FP.applyCustomTexts) FP.applyCustomTexts(); } catch (e) {}
          try { document.dispatchEvent(new CustomEvent('fp:data-ready', { detail: { source: 'settings-refresh', settingsChanged: true } })); } catch (e) {}
        }
        return release(changed);
      }).catch(() => release(false));
    } catch (e) { FP._refreshingSettings = false; return Promise.resolve(false); }
  };

  // ⚠️ RE-SYNCHRO DES DONNÉES (tables véhicules/amendes/factures/conducteurs) au retour au 1er plan.
  // Avant, seuls les RÉGLAGES (app_settings) étaient re-lus au focus/bfcache (FP.refreshSettings) : une
  // action faite ailleurs qui vit dans une TABLE (statut d'amende, pièce jointe, EDL sur la fiche, facture…)
  // restait PÉRIMÉE sur l'écran tant qu'on n'avait pas rechargé la page À LA MAIN (ex. alertes « déjà
  // traitées » qui restaient au tableau de bord jusqu'à un F5). On re-télécharge donc aussi les données,
  // et on ne ré-émet 'fp:data-ready' QUE si la signature change (aucun clignotement si rien n'a bougé).
  // Lecture seule (aucune écriture) ; les écritures locales en file sont ré-appliquées avant comparaison
  // (anti « revenant »). Anti-concurrence via FP._refreshingData.
  FP.refreshData = function () {
    try {
      if (!(FP.db && FP.db.loadAll)) return Promise.resolve(false);
      if (FP._refreshingData) return Promise.resolve(false);
      FP._refreshingData = true;
      const release = (v) => { FP._refreshingData = false; return v; };
      return FP.db.loadAll().then((data) => {
        if (!data || !window.FP_DATA) return release(false);
        try { if (window.FP && FP.persist && FP.persist.applyTo) FP.persist.applyTo(data); } catch (e) {}
        const changed = (_fpDataSig(window.FP_DATA) !== _fpDataSig(data));
        replaceArrayInPlace(window.FP_DATA.vehicules, data.vehicules);
        replaceArrayInPlace(window.FP_DATA.amendes,   data.amendes);
        replaceArrayInPlace(window.FP_DATA.factures,  data.factures);
        if (Array.isArray(data.conducteurs)) replaceArrayInPlace(window.FP_DATA.conducteurs, data.conducteurs);
        if (FP.loadVehicleOverrides) try { FP.loadVehicleOverrides(); } catch (e) {}
        _writeDataCache(data);
        if (changed) { try { document.dispatchEvent(new CustomEvent('fp:data-ready', { detail: { source: 'data-refresh', settingsChanged: false } })); } catch (e) {} }
        return release(changed);
      }).catch(() => release(false));
    } catch (e) { FP._refreshingData = false; return Promise.resolve(false); }
  };

  // Déclencheurs de re-synchro : retour de l'appli au 1er plan (crucial sur mobile/PWA ET sur PC via le
  // bfcache quand on revient avec « précédent »), retour du réseau. Anti-rafale (8 s) pour ne pas spammer.
  // On re-synchronise RÉGLAGES **et** DONNÉES (sinon une modif faite ailleurs qui vit dans une table reste
  // à l'écran jusqu'à un rechargement manuel).
  (function wireSettingsAutoRefresh() {
    let last = 0;
    const kick = () => { const now = Date.now(); if (now - last < 8000) return; last = now; try { FP.refreshSettings(); } catch (e) {} try { FP.refreshData(); } catch (e) {} };
    try { document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); }); } catch (e) {}
    try { window.addEventListener('focus', kick); } catch (e) {}
    try { window.addEventListener('online', kick); } catch (e) {}   // respecte l'anti-rafale (évite les rafales si le réseau « flappe »)
    try { window.addEventListener('pageshow', (e) => { if (e && e.persisted) { last = 0; kick(); } }); } catch (e) {} // retour via bfcache (mobile)
  })();
})();
