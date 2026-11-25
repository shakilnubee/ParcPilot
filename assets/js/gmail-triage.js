/* ============================================================================
 *  Parc Pilot — MOTEUR DE TRI des e-mails Gmail (automatisation flotte, Option B)
 * ============================================================================
 *  PUR, DÉTERMINISTE : ni réseau, ni DOM, ni IA, ni écriture. Classe un message
 *  Gmail (déjà parsé par la fonction serveur gmail-read) en :
 *    { domaine, action, refs, dossiers, statutRdv, confidence, besoinIA, bloque, motif }
 *  Il ne MODIFIE jamais un dossier : il PROPOSE. L'IA (relais serveur scan-doc) et
 *  les écritures (file « À vérifier », parcours manuels FP.*) interviennent ENSUITE.
 *
 *  Règles clés (cf. demande utilisateur) :
 *   - Les mails RH / hors-flotte sont écartés AVANT tout appel IA (besoinIA=false).
 *   - Rattachement par ANCRE de fil déterministe (<pp-amende-ID@…>, <pp-sinistre-KEY@…>)
 *     présente dans References/In-Reply-To → lien fort, sans aucun stockage.
 *   - Sinon par n° d'avis / n° de dossier ; une PLAQUE SEULE qui correspond à
 *     PLUSIEURS dossiers → bloque = « à vérifier » (validation humaine).
 *   - Une proposition d'indemnisation / un remboursement annoncé (sinistre) →
 *     toujours « à vérifier » (jamais de saisie auto).
 *   - Idempotence : un messageId n'est traité qu'une fois (vu boîte + libellé = 1) ;
 *     une nouvelle réponse (nouveau messageId) reste traitable.
 *
 *  Testable en Node (module.exports) et attaché à window.FP_TRIAGE en navigateur.
 * ========================================================================== */
(function () {
  'use strict';
  var T = {};

  // --- Normalisations (alignées sur FP.normImmat / FP.dupe._n) ---
  T.norm = function (s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
  T.normImmat = function (s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  T.normAvis = function (s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); };

  // --- Dictionnaires de détection (déterministes) ---
  T.RE_HORSFLOTTE = /(bulletin de paie|fiche de paie|\bpaie\b|ressources humaines|\brh\b|cong[eé]s?\b|arret maladie|arr[eê]t maladie|mutuelle|urssaf|note de service|newsletter|desabonn|se d[eé]sabonner|unsubscribe|promotion|solde[s]? d|black friday)/i;
  T.RE_AMENDE = /(contravention|amende|avis de contravention|\bantai\b|stationnement|forfait post-stationnement|\bfps\b|exc[eè]s de vitesse|infraction|t[eé]l[eé]paiement)/i;
  T.RE_MAINT = /(rendez-?vous|\brdv\b|r[eé]vision|vidange|entretien|garage|carrosserie|pneus?|contr[oô]le technique|r[eé]paration|atelier|m[eé]canic)/i;
  T.RE_SINISTRE = /(sinistre|expertise|\bexpert\b|indemnisation|indemnit[eé]|franchise|prise en charge|\bconstat\b|accident|assurance|assureur)/i;
  T.RE_PAIEMENT = /(paiement|pay[eé]e?\b|r[eè]glement|r[eé]gl[eé]|re[çc]u\b|justificatif|quittance|acquitt|ticket de paiement|preuve de paiement)/i;
  // Statut d'un RDV (maintenance)
  T.RE_RDV_CONFIRME = /(confirm|bien not[eé]|c'est not[eé]|enregistr[eé]|valid[eé]|nous vous attendons|rendez-?vous (?:fix|pris))/i;
  T.RE_RDV_REPORTE = /(report|d[eé]cal|repouss|nouvelle date|changement de date|d[eé]placer le rendez)/i;
  T.RE_RDV_ANNULE = /(annul|supprim(?:er|[eé]) le rendez)/i;
  T.RE_RDV_PROPOSE = /(proposer?|je vous propose|seriez-vous|disponible le|cr[eé]neau|possible le|peut-on|que diriez-vous)/i;
  // Sinistre : proposition d'indemnisation / remboursement annoncé → toujours à vérifier
  T.RE_INDEMN = /(indemnisation|indemnit[eé]|proposition (?:d'|de l')indemn|offre d'indemn|remboursement|nous vous rembours|vous sera vers)/i;

  // --- Ancres de fil posées par PP sur ses mails sortants ---
  // ex. <pp-amende-FA123@parc-pilot.fr>, <pp-sinistre-abc@parc-pilot.fr>
  T.RE_ANCRE = /pp-(amende|sinistre|entretien|intervention|relance)-([a-z0-9_.-]+)@/ig;
  T.ancresDuFil = function (headers) {
    headers = headers || {};
    var refs = String(headers.references || headers.References || '') + ' ' +
               String(headers.inReplyTo || headers['In-Reply-To'] || '');
    var out = [], m; T.RE_ANCRE.lastIndex = 0;
    while ((m = T.RE_ANCRE.exec(refs))) out.push({ type: m[1], id: m[2] });
    return out;
  };

  // --- Idempotence (le stockage réel = table gmail_traites ; ici la DÉCISION pure) ---
  T.cleIdempotence = function (messageId, action) {
    return 'gmail:' + String(messageId || '') + (action ? ':' + action : '');
  };
  T.dejaTraite = function (messageId, action, ledger) {
    var key = T.cleIdempotence(messageId, action);
    if (!ledger) return false;
    if (typeof ledger.has === 'function') return ledger.has(key) || ledger.has(T.cleIdempotence(messageId, null));
    return !!ledger[key] || !!ledger[T.cleIdempotence(messageId, null)];
  };

  // --- Recherche de plaque(s) de la flotte dans un texte (via FP.normImmat des deux côtés) ---
  T.plaquesTrouvees = function (texte, vehicules) {
    var hay = T.normImmat(texte);                 // texte sans séparateurs, MAJ
    var res = [];
    (vehicules || []).forEach(function (v) {
      var p = T.normImmat(v && (v.immat || v.plaque));
      if (p && p.length >= 5 && hay.indexOf(p) !== -1) res.push(p);
    });
    return res.filter(function (p, i, a) { return a.indexOf(p) === i; });
  };

  // --- Recherche d'un n° d'avis connu dans un texte ---
  T.avisTrouve = function (texte, amendes) {
    var hay = T.normAvis(texte);
    var found = null;
    (amendes || []).forEach(function (a) {
      var n = T.normAvis(a && a.numeroAvis);
      if (n && n.length >= 8 && hay.indexOf(n) !== -1) found = (a.numeroAvis);
    });
    return found;
  };

  /* classify(msg, ctx)
   *  msg : { id, threadId, from, fromEmail, subject, date, snippet, bodyText?, pdfs?, hasPdf?,
   *          headers?:{references,inReplyTo}, labels?:[], viaLibelle?:bool }
   *  ctx : { vehicules:[{immat}], amendes:[{numeroAvis}], sinistres:[{key,plaque}],
   *          expediteursConnus?:[emails], domaineSociete?:string }
   *  → objet de décision (voir en-tête). NE modifie rien.
   */
  T.classify = function (msg, ctx) {
    msg = msg || {}; ctx = ctx || {};
    var sujet = String(msg.subject || '');
    var texte = [sujet, msg.snippet || '', msg.bodyText || '', msg.from || ''].join('  ');
    var hay = T.norm(texte);
    var hasPdf = !!(msg.hasPdf || (msg.pdfs && msg.pdfs.length));
    var pieces = (msg.pdfs || []).map(function (p) { return { filename: p.filename, attachmentId: p.attachmentId }; });
    var ancres = T.ancresDuFil(msg.headers);
    var plaques = T.plaquesTrouvees(texte, ctx.vehicules);
    var numeroAvis = T.avisTrouve(texte, ctx.amendes);

    function out(o) {
      o.refs = o.refs || {};
      o.refs.plaque = o.refs.plaque || (plaques[0] || null);
      o.refs.ancres = ancres;
      o.pieces = pieces;
      o.confidence = o.confidence || 'moyenne';
      o.besoinIA = !!o.besoinIA;
      o.bloque = !!o.bloque;
      return o;
    }

    // Libellé Gmail « Parc Pilot » = signal explicite de l'utilisateur (même mail archivé) :
    // on ne l'écarte jamais comme hors-flotte, et un mail libellé sans nature nette va « à vérifier ».
    var force = !!(msg.viaLibelle || (msg.labels && msg.labels.some(function (l) { return /parc[\s_-]?pilot/i.test(String(l)); })));

    // 0) RH / hors-flotte : écarté AVANT toute IA — sauf si une référence flotte forte existe
    //    (ancre PP, n° d'avis connu, plaque connue) ou le libellé « Parc Pilot » (qui priment).
    var refFlotteForte = ancres.length || numeroAvis || plaques.length;
    if (!force && !refFlotteForte && T.RE_HORSFLOTTE.test(texte) &&
        !T.RE_AMENDE.test(texte) && !T.RE_MAINT.test(texte) && !T.RE_SINISTRE.test(texte)) {
      return out({ domaine: 'horsflotte', action: 'ignore', confidence: 'haute', besoinIA: false, motif: 'RH / hors flotte' });
    }

    // 1) Ancre de fil déterministe = lien FORT à un dossier PP (réponse à un mail sortant PP)
    if (ancres.length) {
      var anc = ancres[ancres.length - 1]; // la plus spécifique
      if (anc.type === 'amende') {
        var payeA = T.RE_PAIEMENT.test(texte) || hasPdf;
        return out({ domaine: 'amende', action: payeA ? 'amende_payee' : 'a_verifier',
          refs: { numeroAvis: numeroAvis, dossierId: anc.id }, confidence: 'haute',
          bloque: !payeA, motif: payeA ? 'Justificatif de paiement (fil PP)' : 'Réponse sur l’amende — à qualifier' });
      }
      if (anc.type === 'sinistre') {
        var indemn = T.RE_INDEMN.test(texte);
        return out({ domaine: 'sinistre', action: indemn ? 'a_verifier' : 'sinistre_piece',
          refs: { sinistreKey: anc.id }, confidence: 'haute', bloque: indemn,
          motif: indemn ? 'Indemnisation / remboursement annoncé — à valider' : 'Pièce/réponse assureur à rattacher (fil PP)' });
      }
      if (anc.type === 'entretien' || anc.type === 'intervention') {
        return T.classifyMaintenance(out, texte, plaques, ctx, pieces, { fil: anc.id });
      }
      if (anc.type === 'relance') {
        return out({ domaine: 'relance', action: 'a_verifier', refs: { dossierId: anc.id },
          confidence: 'haute', bloque: true, motif: 'Réponse à une relance PP' });
      }
    }

    // 2) AMENDE par n° d'avis connu
    if (numeroAvis && (T.RE_AMENDE.test(texte) || hasPdf || T.RE_PAIEMENT.test(texte))) {
      var paye = T.RE_PAIEMENT.test(texte) || hasPdf;
      return out({ domaine: 'amende', action: paye ? 'amende_payee' : 'a_verifier',
        refs: { numeroAvis: numeroAvis }, confidence: 'haute', bloque: !paye,
        motif: paye ? 'Reçu/justificatif pour un avis connu' : 'Avis connu — pièce manquante ou montant à vérifier' });
    }
    // amende évoquée mais avis inconnu → à vérifier (IA peut aider à lire l'avis)
    if (T.RE_AMENDE.test(texte)) {
      return out({ domaine: 'amende', action: 'a_verifier', confidence: 'faible', besoinIA: true,
        bloque: true, motif: 'Amende sans n° d’avis reconnu' });
    }

    // 3) SINISTRE / ASSURANCE
    if (T.RE_SINISTRE.test(texte)) {
      var sinDoss = (ctx.sinistres || []).filter(function (s) {
        return plaques.indexOf(T.normImmat(s.plaque)) !== -1;
      });
      var indemn2 = T.RE_INDEMN.test(texte);
      if (sinDoss.length === 1 && !indemn2) {
        return out({ domaine: 'sinistre', action: 'sinistre_piece', refs: { sinistreKey: sinDoss[0].key },
          dossiers: sinDoss, confidence: 'moyenne', bloque: false, motif: 'Réponse assureur rattachée par plaque (dossier unique)' });
      }
      // plaque seule ↔ plusieurs dossiers, ou indemnisation annoncée → à vérifier
      return out({ domaine: 'sinistre', action: 'a_verifier', dossiers: sinDoss,
        confidence: 'faible', besoinIA: !sinDoss.length, bloque: true,
        motif: indemn2 ? 'Indemnisation / remboursement annoncé — à valider'
          : (sinDoss.length > 1 ? 'Plusieurs dossiers sinistres pour cette plaque' : 'Sinistre sans dossier identifié') });
    }

    // 4) MAINTENANCE / GARAGE
    if (T.RE_MAINT.test(texte)) {
      return T.classifyMaintenance(out, texte, plaques, ctx, pieces, {});
    }

    // 5) Rien de net : plaque connue OU libellé « Parc Pilot » → à vérifier (flotte) ; sinon inconnu
    if (plaques.length || force) {
      return out({ domaine: 'inconnu', action: 'a_verifier', confidence: 'faible', besoinIA: true,
        bloque: true, motif: force ? 'Mail signalé par le libellé « Parc Pilot » — nature à préciser' : 'Mail lié à un véhicule — nature à préciser' });
    }
    return out({ domaine: 'inconnu', action: 'ignore', confidence: 'faible', besoinIA: false, motif: 'Non lié à la flotte' });
  };

  // Sous-classification maintenance (statut du RDV + blocage si simple proposition/ambigu)
  T.classifyMaintenance = function (out, texte, plaques, ctx, pieces, extra) {
    extra = extra || {};
    var statut = null;
    if (T.RE_RDV_ANNULE.test(texte)) statut = 'annule';
    else if (T.RE_RDV_REPORTE.test(texte)) statut = 'reporte';
    else if (T.RE_RDV_CONFIRME.test(texte)) statut = 'confirme';
    var proposition = !statut && T.RE_RDV_PROPOSE.test(texte);
    var plaqueUnique = plaques.length === 1;

    if (plaques.length > 1) {
      return out({ domaine: 'maintenance', action: 'a_verifier', confidence: 'faible',
        bloque: true, motif: 'Plusieurs véhicules cités — dossier à préciser' });
    }
    if (proposition || !statut) {
      // Une simple proposition de créneau → À vérifier (jamais de mise à jour auto)
      return out({ domaine: 'maintenance', action: 'a_verifier', statutRdv: null,
        refs: { fil: extra.fil || null }, confidence: plaqueUnique ? 'moyenne' : 'faible',
        besoinIA: !plaqueUnique, bloque: true,
        motif: proposition ? 'Proposition de créneau — à confirmer' : 'RDV garage — statut à préciser' });
    }
    // Confirmation / report / annulation CLAIRE d'un véhicule unique → mise à jour proposée
    return out({ domaine: 'maintenance', action: 'rdv_update', statutRdv: statut,
      refs: { fil: extra.fil || null }, confidence: plaqueUnique ? 'haute' : 'moyenne',
      bloque: !plaqueUnique, motif: 'RDV ' + statut + (plaqueUnique ? '' : ' — véhicule à confirmer') });
  };

  /* simuler(msgs, ctx, ledger) — enchaîne idempotence + classify (pour le banc de test). */
  T.simuler = function (msgs, ctx, ledger) {
    var seen = ledger || new Set();
    return (msgs || []).map(function (m) {
      if (T.dejaTraite(m.id, null, seen)) return { id: m.id, skip: true, motif: 'déjà traité (idempotence)' };
      var d = T.classify(m, ctx);
      if (d.action !== 'ignore' && !d.bloque) { try { seen.add(T.cleIdempotence(m.id, null)); } catch (e) {} }
      d.id = m.id; d.skip = false; return d;
    });
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = T;
  else if (typeof window !== 'undefined') window.FP_TRIAGE = T;
})();
