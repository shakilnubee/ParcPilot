/* ============================================================
   BARÈME TARIFAIRE — SOURCE UNIQUE (JIS)
   Lu par : bareme.html (édition), devis.html + contrat.html (générateurs), prix.html (calculateur).
   localStorage (clé 'pp_bareme') = simple cache rapide ; la SOURCE partagée est Supabase
   (app_settings id='bareme') → modifiable sur le site, SYNCHRONISÉ sur tous les appareils.
   Modèle : GESTION DÉLÉGUÉE (logiciel Parc Pilot inclus). Minimum mensuel + tranches dégressives.
   ============================================================ */
(function () {
  var KEY = 'pp_bareme';
  // Tranches (au véhicule / mois) : 1-9 = minimum ; 10-24 = r1 ; 25-49 = r2 ; 50-79 = r3 ; 80+ = sur devis.
  var DEFAULTS = {
    refVeh: 65,        // € / véhicule / mois — tarif de référence (gestion déléguée, logiciel inclus)
    minMensuel: 590,   // facturation MINIMUM / mois (1 à 9 véhicules)
    r1: 65,            // € / véhicule / mois — de 10 à 24 véhicules
    r2: 60,            // € / véhicule / mois — de 25 à 49 véhicules
    r3: 54,            // € / véhicule / mois — de 50 à 79 véhicules
    surDevisMin: 80,   // à partir de ce nombre de véhicules → « sur devis » (analyse de la flotte)
    mes: 500,          // mise en service (audit + reprise + intégration) — indicatif 350 à 1000
    mesMin: 350,       // fourchette basse mise en service (info)
    mesMax: 1000,      // fourchette haute mise en service (info)
    tauxHoraire: 65,   // € / heure — prestations hors forfait / au temps passé
    // ===== FORMULE « LOGICIEL SEUL » (app sans gestion déléguée) =====
    appMin: 550,       // forfait mensuel LOGICIEL SEUL — de 1 à 25 véhicules (1 accès gestionnaire inclus)
    appVeh: 22,        // € / véhicule / mois — LOGICIEL SEUL au-delà de 25 véhicules (22×25 = 550 → continuité)
    misePlace: 1500,   // mise en place initiale LOGICIEL SEUL (paramétrage + intégration + QR + onboarding) — paiement unique
    // Prestations PONCTUELLES facturées en supplément (cochables dans le devis).
    // unite : 'heure' | 'vehicule' | 'intervention' | 'dossier' | 'forfait'
    supplements: [
      { key: 'reprise',     label: 'Reprise / régularisation de flotte désorganisée', prix: 65,  unite: 'heure' },
      { key: 'deplacement', label: 'Livraison, récupération ou déplacement d’un véhicule', prix: 150, unite: 'intervention' },
      { key: 'restitution', label: 'Restitution d’un véhicule (LLD : contrôle + présence)', prix: 180, unite: 'vehicule' },
      { key: 'commande',    label: 'Commande / recherche d’un nouveau véhicule', prix: 220, unite: 'vehicule' },
      { key: 'sinistre',    label: 'Gestion d’un sinistre complexe', prix: 150, unite: 'dossier' },
      { key: 'amende',      label: 'Contestation / dossier d’amende exceptionnel', prix: 75,  unite: 'dossier' },
      { key: 'audit',       label: 'Audit & optimisation de la flotte', prix: 800, unite: 'forfait' },
      { key: 'urgence',     label: 'Mission urgente (traitement prioritaire)', prix: 75, unite: 'heure' }
    ]
  };
  var NUMKEYS = ['refVeh', 'minMensuel', 'r1', 'r2', 'r3', 'surDevisMin', 'mes', 'mesMin', 'mesMax', 'tauxHoraire', 'appMin', 'appVeh', 'misePlace'];
  var UNITES = ['heure', 'vehicule', 'intervention', 'dossier', 'forfait'];
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function num(v, d) { v = Number(v); return (isFinite(v) && v >= 0) ? v : d; }
  function cleanSupps(arr) {
    if (!Array.isArray(arr)) return clone(DEFAULTS.supplements);
    var out = [];
    arr.forEach(function (s, i) {
      if (!s || typeof s !== 'object') return;
      var label = String(s.label == null ? '' : s.label).trim();
      if (!label) return;
      var unite = (UNITES.indexOf(s.unite) !== -1) ? s.unite : 'forfait';
      out.push({ key: String(s.key || ('opt' + i)).trim() || ('opt' + i), label: label, prix: num(s.prix, 0), unite: unite });
    });
    return out;
  }
  function get() {
    var b = clone(DEFAULTS);
    try {
      var s = JSON.parse(localStorage.getItem(KEY)) || {};
      NUMKEYS.forEach(function (k) { if (s[k] != null) b[k] = num(s[k], b[k]); });
      if (s.supplements != null) b.supplements = cleanSupps(s.supplements);
    } catch (e) {}
    return b;
  }
  function save(obj) {
    var b = get();
    NUMKEYS.forEach(function (k) { if (obj && obj[k] != null) b[k] = num(obj[k], b[k]); });
    if (obj && obj.supplements != null) b.supplements = cleanSupps(obj.supplements);
    try { localStorage.setItem(KEY, JSON.stringify(b)); } catch (e) {}
    pushRemote(b); // synchro tous appareils
    return b;
  }
  function reset() { try { localStorage.removeItem(KEY); } catch (e) {} pushRemote(clone(DEFAULTS)); return clone(DEFAULTS); }

  // ===== Synchro TOUS APPAREILS (Supabase app_settings, id='bareme') =====
  var SB_URL = 'https://tzjuptlzoywjeigmyfuj.supabase.co';
  var SB_KEY = 'sb_publishable_KC3TZ1zda-ja-0wkyjHUlg_aKohD6tq';
  function sb() {
    try {
      if (window.__ppSB) return window.__ppSB;
      if (window.supabase && window.supabase.createClient) { window.__ppSB = window.supabase.createClient(SB_URL, SB_KEY); return window.__ppSB; }
    } catch (e) {}
    return null;
  }
  function clean(obj) {
    var b = {};
    NUMKEYS.forEach(function (k) { if (obj && obj[k] != null) b[k] = num(obj[k], DEFAULTS[k]); });
    b.supplements = cleanSupps(obj && obj.supplements);
    return b;
  }
  // ⚠️ L'échec de synchro du barème ne doit PAS être avalé (règle 0-perte ③) : on remonte une erreur VISIBLE
  // (pastille/notif) pour que l'utilisateur sache que son tarif n'est pas parti sur les autres appareils.
  function pushRemote(b) {
    var c = sb(); if (!c) return;
    var onErr = function (e) { try { if (window.FP && FP.notifyError) FP.notifyError('Barème : échec de la synchronisation — réessaie.'); } catch (_) {} try { console.warn('[bareme] push échec', e); } catch (_) {} };
    try { c.from('app_settings').upsert({ id: 'bareme', data: clean(b) }).then(function (r) { if (r && r.error) onErr(r.error); }, onErr); } catch (e) { onErr(e); }
  }
  function pull() {
    var c = sb(); if (!c) return Promise.resolve(null);
    return c.from('app_settings').select('data').eq('id', 'bareme').maybeSingle().then(function (r) {
      if (r && r.data && r.data.data) { try { localStorage.setItem(KEY, JSON.stringify(clean(r.data.data))); } catch (e) {} try { window.dispatchEvent(new Event('pp:bareme-ready')); } catch (e) {} return r.data.data; }
      return null;
    }, function () { return null; });
  }
  // À partir de quel nombre de véhicules on passe « sur devis » (analyse de la flotte).
  function surDevis(nb, b) { b = b || get(); return Math.max(1, nb || 1) >= (b.surDevisMin || 80); }
  // Tarif au véhicule pour un nombre donné (null = forfait minimum ≤9, ou « sur devis » ≥ seuil).
  function tarifVeh(nb, b) {
    b = b || get(); nb = Math.max(1, nb || 1);
    if (nb <= 9) return null;
    if (surDevis(nb, b)) return null;
    if (nb <= 24) return b.r1;
    if (nb <= 49) return b.r2;
    return b.r3; // 50 → (seuil-1)
  }
  // Montant mensuel total (minimum garanti). null = « sur devis ».
  function tarifMensuel(nb, b) {
    b = b || get(); nb = Math.max(1, nb || 1);
    if (surDevis(nb, b)) return null;
    var pv = tarifVeh(nb, b);
    return (pv == null) ? b.minMensuel : Math.max(b.minMensuel, pv * nb);
  }
  // ===== FORMULE « LOGICIEL SEUL » =====
  // Tarif au véhicule (app seule) : null = forfait (≤ 25 véh) ou « sur devis » (≥ seuil).
  function tarifAppVeh(nb, b) {
    b = b || get(); nb = Math.max(1, nb || 1);
    if (nb <= 25) return null;      // forfait minimum (550 € / mois)
    if (surDevis(nb, b)) return null;
    return b.appVeh;
  }
  // Montant mensuel total (app seule, minimum 550 € garanti). null = « sur devis » (≥ seuil).
  function tarifAppMensuel(nb, b) {
    b = b || get(); nb = Math.max(1, nb || 1);
    if (surDevis(nb, b)) return null;
    return Math.max(b.appMin, b.appVeh * nb);   // 22×25 = 550 → continuité parfaite au seuil de 25
  }
  // Libellé court d'une unité de supplément.
  function uniteLabel(u) {
    return ({ heure: '/ heure', vehicule: 'par véhicule', intervention: 'par intervention', dossier: 'par dossier', forfait: 'forfait' })[u] || '';
  }
  window.PP_BAREME = {
    KEY: KEY, defaults: function () { return clone(DEFAULTS); }, get: get, save: save, reset: reset,
    tarifVeh: tarifVeh, tarifMensuel: tarifMensuel, surDevis: surDevis, uniteLabel: uniteLabel, pull: pull,
    tarifAppVeh: tarifAppVeh, tarifAppMensuel: tarifAppMensuel
  };
  try { pull(); } catch (e) {}
})();
