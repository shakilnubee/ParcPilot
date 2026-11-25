/* ============================================================================
 *  Parc Pilot — MOTEUR DE TRI des e-mails Gmail (SOURCE UNIQUE, Deno + Node)
 * ============================================================================
 *  ES module PUR et déterministe (ni réseau, ni DOM, ni IA, ni écriture).
 *  Utilisé côté SERVEUR par la fonction cron `gmail-actions` (Deno) ET testé en
 *  Node (tests/unit/gmail-triage.mjs). Une seule implémentation = pas de drift.
 *
 *  classify(msg, ctx) → { domaine, action, refs, statutRdv, confidence, besoinIA,
 *                         bloque, motif, pieces } — PROPOSE, ne modifie rien.
 *  buildProposal(msg, decision, societe) → ligne gmail_a_verifier (pure).
 *  cleIdempotence / dejaTraite → décision d'idempotence (stockage = table gmail_traites).
 *
 *  Règles : RH/hors-flotte écarté avant IA ; ancre de fil déterministe
 *  (<pp-amende-ID@…>) sans stockage ; plaque seule ↔ plusieurs dossiers → à vérifier ;
 *  indemnisation/remboursement sinistre → toujours à vérifier ; libellé « Parc Pilot »
 *  = signal (jamais écarté, même archivé) ; idempotence par messageId.
 * ========================================================================== */

export const T = {};

T.norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
T.normImmat = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
T.normAvis = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

T.RE_HORSFLOTTE = /(bulletin de paie|fiche de paie|\bpaie\b|ressources humaines|\brh\b|cong[eé]s?\b|arret maladie|arr[eê]t maladie|mutuelle|urssaf|note de service|newsletter|desabonn|se d[eé]sabonner|unsubscribe|promotion|solde[s]? d|black friday)/i;
T.RE_AMENDE = /(contravention|amende|avis de contravention|\bantai\b|stationnement|forfait post-stationnement|\bfps\b|exc[eè]s de vitesse|infraction|t[eé]l[eé]paiement)/i;
T.RE_MAINT = /(rendez-?vous|\brdv\b|r[eé]vision|vidange|entretien|garage|carrosserie|pneus?|contr[oô]le technique|r[eé]paration|atelier|m[eé]canic)/i;
T.RE_SINISTRE = /(sinistre|expertise|\bexpert\b|indemnisation|indemnit[eé]|franchise|prise en charge|\bconstat\b|accident|assurance|assureur)/i;
T.RE_PAIEMENT = /(paiement|pay[eé]e?\b|r[eè]glement|r[eé]gl[eé]|re[çc]u\b|justificatif|quittance|acquitt|ticket de paiement|preuve de paiement)/i;
T.RE_RDV_CONFIRME = /(confirm|bien not[eé]|c'est not[eé]|enregistr[eé]|valid[eé]|nous vous attendons|rendez-?vous (?:fix|pris))/i;
T.RE_RDV_REPORTE = /(report|d[eé]cal|repouss|nouvelle date|changement de date|d[eé]placer le rendez)/i;
T.RE_RDV_ANNULE = /(annul|supprim(?:er|[eé]) le rendez)/i;
T.RE_RDV_PROPOSE = /(proposer?|je vous propose|seriez-vous|disponible le|cr[eé]neau|possible le|peut-on|que diriez-vous)/i;
T.RE_INDEMN = /(indemnisation|indemnit[eé]|proposition (?:d'|de l')indemn|offre d'indemn|remboursement|nous vous rembours|vous sera vers)/i;

T.RE_ANCRE = /pp-(amende|sinistre|entretien|intervention|relance)-([a-z0-9_.-]+)@/ig;
T.ancresDuFil = (headers) => {
  headers = headers || {};
  const refs = String(headers.references || headers.References || '') + ' ' +
               String(headers.inReplyTo || headers['In-Reply-To'] || '');
  const out = []; let m; T.RE_ANCRE.lastIndex = 0;
  while ((m = T.RE_ANCRE.exec(refs))) out.push({ type: m[1], id: m[2] });
  return out;
};

T.cleIdempotence = (messageId, action) => 'gmail:' + String(messageId || '') + (action ? ':' + action : '');
T.dejaTraite = (messageId, action, ledger) => {
  const key = T.cleIdempotence(messageId, action);
  if (!ledger) return false;
  if (typeof ledger.has === 'function') return ledger.has(key) || ledger.has(T.cleIdempotence(messageId, null));
  return !!ledger[key] || !!ledger[T.cleIdempotence(messageId, null)];
};

T.plaquesTrouvees = (texte, vehicules) => {
  const hay = T.normImmat(texte);
  const res = [];
  (vehicules || []).forEach((v) => {
    const p = T.normImmat(v && (v.immat || v.plaque));
    if (p && p.length >= 5 && hay.indexOf(p) !== -1) res.push(p);
  });
  return res.filter((p, i, a) => a.indexOf(p) === i);
};

T.avisTrouve = (texte, amendes) => {
  const hay = T.normAvis(texte);
  let found = null;
  (amendes || []).forEach((a) => {
    const n = T.normAvis(a && a.numeroAvis);
    if (n && n.length >= 8 && hay.indexOf(n) !== -1) found = a.numeroAvis;
  });
  return found;
};

T.classifyMaintenance = (out, texte, plaques, ctx, pieces, extra) => {
  extra = extra || {};
  let statut = null;
  if (T.RE_RDV_ANNULE.test(texte)) statut = 'annule';
  else if (T.RE_RDV_REPORTE.test(texte)) statut = 'reporte';
  else if (T.RE_RDV_CONFIRME.test(texte)) statut = 'confirme';
  const proposition = !statut && T.RE_RDV_PROPOSE.test(texte);
  const plaqueUnique = plaques.length === 1;
  if (plaques.length > 1) {
    return out({ domaine: 'maintenance', action: 'a_verifier', confidence: 'faible', bloque: true, motif: 'Plusieurs véhicules cités — dossier à préciser' });
  }
  if (proposition || !statut) {
    return out({ domaine: 'maintenance', action: 'a_verifier', statutRdv: null, refs: { fil: extra.fil || null },
      confidence: plaqueUnique ? 'moyenne' : 'faible', besoinIA: !plaqueUnique, bloque: true,
      motif: proposition ? 'Proposition de créneau — à confirmer' : 'RDV garage — statut à préciser' });
  }
  return out({ domaine: 'maintenance', action: 'rdv_update', statutRdv: statut, refs: { fil: extra.fil || null },
    confidence: plaqueUnique ? 'haute' : 'moyenne', bloque: !plaqueUnique,
    motif: 'RDV ' + statut + (plaqueUnique ? '' : ' — véhicule à confirmer') });
};

T.classify = (msg, ctx) => {
  msg = msg || {}; ctx = ctx || {};
  const sujet = String(msg.subject || '');
  const texte = [sujet, msg.snippet || '', msg.bodyText || '', msg.from || ''].join('  ');
  const hasPdf = !!(msg.hasPdf || (msg.pdfs && msg.pdfs.length));
  const pieces = (msg.pdfs || []).map((p) => ({ filename: p.filename, attachmentId: p.attachmentId }));
  const ancres = T.ancresDuFil(msg.headers);
  const plaques = T.plaquesTrouvees(texte, ctx.vehicules);
  const numeroAvis = T.avisTrouve(texte, ctx.amendes);

  const out = (o) => {
    o.refs = o.refs || {};
    o.refs.plaque = o.refs.plaque || (plaques[0] || null);
    o.refs.ancres = ancres;
    o.pieces = pieces;
    o.confidence = o.confidence || 'moyenne';
    o.besoinIA = !!o.besoinIA;
    o.bloque = !!o.bloque;
    return o;
  };

  const force = !!(msg.viaLibelle || (msg.labels && msg.labels.some((l) => /parc[\s_-]?pilot/i.test(String(l)))));
  const refFlotteForte = ancres.length || numeroAvis || plaques.length;
  if (!force && !refFlotteForte && T.RE_HORSFLOTTE.test(texte) &&
      !T.RE_AMENDE.test(texte) && !T.RE_MAINT.test(texte) && !T.RE_SINISTRE.test(texte)) {
    return out({ domaine: 'horsflotte', action: 'ignore', confidence: 'haute', besoinIA: false, motif: 'RH / hors flotte' });
  }

  if (ancres.length) {
    const anc = ancres[ancres.length - 1];
    if (anc.type === 'amende') {
      const payeA = T.RE_PAIEMENT.test(texte) || hasPdf;
      return out({ domaine: 'amende', action: payeA ? 'amende_payee' : 'a_verifier', refs: { numeroAvis, dossierId: anc.id },
        confidence: 'haute', bloque: !payeA, motif: payeA ? 'Justificatif de paiement (fil PP)' : 'Réponse sur l’amende — à qualifier' });
    }
    if (anc.type === 'sinistre') {
      const indemn = T.RE_INDEMN.test(texte);
      return out({ domaine: 'sinistre', action: indemn ? 'a_verifier' : 'sinistre_piece', refs: { sinistreKey: anc.id },
        confidence: 'haute', bloque: indemn, motif: indemn ? 'Indemnisation / remboursement annoncé — à valider' : 'Pièce/réponse assureur à rattacher (fil PP)' });
    }
    if (anc.type === 'entretien' || anc.type === 'intervention') return T.classifyMaintenance(out, texte, plaques, ctx, pieces, { fil: anc.id });
    if (anc.type === 'relance') return out({ domaine: 'relance', action: 'a_verifier', refs: { dossierId: anc.id }, confidence: 'haute', bloque: true, motif: 'Réponse à une relance PP' });
  }

  if (numeroAvis && (T.RE_AMENDE.test(texte) || hasPdf || T.RE_PAIEMENT.test(texte))) {
    const paye = T.RE_PAIEMENT.test(texte) || hasPdf;
    return out({ domaine: 'amende', action: paye ? 'amende_payee' : 'a_verifier', refs: { numeroAvis }, confidence: 'haute', bloque: !paye,
      motif: paye ? 'Reçu/justificatif pour un avis connu' : 'Avis connu — pièce manquante ou montant à vérifier' });
  }
  if (T.RE_AMENDE.test(texte)) {
    return out({ domaine: 'amende', action: 'a_verifier', confidence: 'faible', besoinIA: true, bloque: true, motif: 'Amende sans n° d’avis reconnu' });
  }

  if (T.RE_SINISTRE.test(texte)) {
    const sinDoss = (ctx.sinistres || []).filter((s) => plaques.indexOf(T.normImmat(s.plaque)) !== -1);
    const indemn2 = T.RE_INDEMN.test(texte);
    if (sinDoss.length === 1 && !indemn2) {
      return out({ domaine: 'sinistre', action: 'sinistre_piece', refs: { sinistreKey: sinDoss[0].key }, dossiers: sinDoss,
        confidence: 'moyenne', bloque: false, motif: 'Réponse assureur rattachée par plaque (dossier unique)' });
    }
    return out({ domaine: 'sinistre', action: 'a_verifier', dossiers: sinDoss, confidence: 'faible', besoinIA: !sinDoss.length, bloque: true,
      motif: indemn2 ? 'Indemnisation / remboursement annoncé — à valider' : (sinDoss.length > 1 ? 'Plusieurs dossiers sinistres pour cette plaque' : 'Sinistre sans dossier identifié') });
  }

  if (T.RE_MAINT.test(texte)) return T.classifyMaintenance(out, texte, plaques, ctx, pieces, {});

  if (plaques.length || force) {
    return out({ domaine: 'inconnu', action: 'a_verifier', confidence: 'faible', besoinIA: true, bloque: true,
      motif: force ? 'Mail signalé par le libellé « Parc Pilot » — nature à préciser' : 'Mail lié à un véhicule — nature à préciser' });
  }
  return out({ domaine: 'inconnu', action: 'ignore', confidence: 'faible', besoinIA: false, motif: 'Non lié à la flotte' });
};

// simuler(msgs, ctx, ledger) — enchaîne idempotence + classify (banc de test / mode simulation).
T.simuler = (msgs, ctx, ledger) => {
  const seen = ledger || new Set();
  return (msgs || []).map((m) => {
    if (T.dejaTraite(m.id, null, seen)) return { id: m.id, skip: true, motif: 'déjà traité (idempotence)' };
    const d = T.classify(m, ctx);
    if (d.action !== 'ignore' && !d.bloque) { try { seen.add(T.cleIdempotence(m.id, null)); } catch (e) { /* noop */ } }
    d.id = m.id; d.skip = false; return d;
  });
};

// Identifiant déterministe d'une proposition (anti-doublon natif via la PK).
T.idFor = (messageId, n) => 'AV-' + String(messageId || 'x') + (n ? '-' + n : '');

// Construit la ligne gmail_a_verifier (PURE) à partir d'un message + sa décision.
T.buildProposal = (msg, decision, societe) => {
  msg = msg || {}; decision = decision || {};
  const ref = Object.assign({}, decision.refs || {});
  if (decision.statutRdv) ref.statutRdv = decision.statutRdv;
  delete ref.ancres; // on ne stocke pas le détail des ancres (bruit)
  return {
    id: T.idFor(msg.id),
    societe: societe || null,
    message_id: msg.id || null,
    thread_id: msg.threadId || null,
    from_email: msg.fromEmail || msg.from || null,
    objet: msg.subject || null,
    recu_le: msg.dateISO || null,
    extrait: (msg.snippet || '').slice(0, 500) || null,
    domaine: decision.domaine || 'inconnu',
    action: decision.action || 'a_verifier',
    dossier_ref: ref,
    pieces: decision.pieces || [],
    motif_blocage: decision.motif || null,
    statut: 'a_verifier',
    payload: { confidence: decision.confidence, besoinIA: decision.besoinIA, statutRdv: decision.statutRdv || null }
  };
};
