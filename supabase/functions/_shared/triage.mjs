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
T.RE_FACTURE = /(facture|facturation|\bavoir\b|note de d[eé]bit|\binvoice\b)/i;
// Mails CLAIREMENT hors flotte (bâtiment, commission de sécurité, informatique) : écartés si aucun
// indice fiable ne les rattache à la flotte. Ces termes priment sur un mot générique (« intervention »…).
T.RE_BATIMENT_IT = /(commission de s[eé]curit[eé]|[eé]tablissement recevant du public|\bb[aâ]timent\b|\bimmeuble\b|\blocaux\b|\bbureaux\b|incendie|extincteur|\bSSI\b|ascenseur|climatisation|plomberie|informatique|serveur informatique|\blogiciel\b|licence logiciel|helpdesk|imprimante|t[eé]l[eé]phonie|standard t[eé]l[eé]phonique)/i;
// Termes SPÉCIFIQUES à l'automobile : un seul suffit comme indice fiable (contrairement aux mots génériques).
T.RE_FLOTTE_SPEC = /(contravention|\bantai\b|forfait post-stationnement|\bfps\b|exc[eè]s de vitesse|carte grise|certificat d'immatriculation|immatricul|carte verte|\bconstat\b|t[eé]l[eé]p[eé]age|\bulys\b|crit'?\s?air|num[eé]ro de police|\bleasing\b|\blld\b|\bloa\b|contr[oô]le technique|proc[eè]s-verbal|pneumatique|\bpneus?\b|carrosserie|pare-brise|bris de glace|\bvidange\b|\bVIN\b)/i;
// Contexte automobile (plus large que les mots génériques « facture/maintenance ») : compte comme un
// indice additionnel → un vrai mail de garage pour « votre véhicule » (sans plaque) reste retenu.
T.RE_AUTO_CONTEXT = /(v[eé]hicule|voiture|automobile|\bauto\b|\bflotte\b|conducteur|chauffeur|motorisation|berline|utilitaire|\bSUV\b|concession|\bgarage\b)/i;
// Fournisseur/produit CARBURANT · PÉAGE · RECHARGE (flotte sans plaque : DKV, carte carburant, télépéage,
// borne de recharge…). Indice flotte FORT. Le NOM du fournisseur seul ne suffit pas — on exige un terme de
// carburant/péage/recharge (ex. « TotalEnergies » n'est PAS ici ; « carte carburant »/« DKV »/« Ulys » oui).
T.RE_CARB_PEAGE = /(\bdkv|euro\s*service|carte[s]? carburant|carte[s]? gr\b|\bgr[\s-]?card\b|\bas\s?24\b|t[eé]l[eé]p[eé]age|\bulys\b|eurotoll|\bsanef\b|badge[s]? (?:de )?p[eé]age|borne[s]? de recharge|recharge [eé]lectrique|\birve\b|point[s]? de charge|station[- ]service|\bcarburant\b|\bgazole\b|\bgnr\b|sans[- ]plomb|\bsp\s?9[58]\b)/i;
// Électricité / gaz / boutique (NON flotte) : une facture d'énergie de local/magasin (ex. TotalEnergies
// électricité d'une boutique) est écartée SAUF si un indice carburant/péage/recharge est présent.
T.RE_ELEC_BOUTIQUE = /([eé]lectricit[eé]|\bkwh\b|\bmwh\b|m[eé]gawatt|gaz naturel|abonnement [eé]lectricit|\bboutique\b|\bmagasin\b|point de vente|[eé]clairage|compteur (?:linky|[eé]lectrique)|tarif bleu|heures creuses)/i;
// Plaque au FORMAT SIV (AA-123-BB), même si le véhicule n'est pas (encore) reconnu dans la flotte.
T.RE_IMMAT_FORMAT = /\b[A-Z]{2}[-\s]?\d{3}[-\s]?[A-Z]{2}\b/;
// Mots GÉNÉRIQUES (jamais suffisants seuls) : regroupés pour le comptage d'indices.
T.MOTS_GENERIQUES = [T.RE_FACTURE, T.RE_MAINT, T.RE_SINISTRE, T.RE_AMENDE];
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

// Expéditeur connu de la société ? (liste d'e-mails ou de domaines fournie par le serveur :
// e-mails des conducteurs, fournisseurs/garages/assureurs déjà enregistrés). Compare l'adresse et le domaine.
T.senderConnu = (fromEmail, known) => {
  const e = String(fromEmail || '').toLowerCase().trim();
  if (!e || !known || !known.length) return false;
  const dom = e.indexOf('@') >= 0 ? e.slice(e.indexOf('@') + 1) : '';
  return known.some((k) => {
    const kk = String(k || '').toLowerCase().trim();
    if (!kk) return false;
    return kk === e || (kk.indexOf('@') < 0 && dom && (dom === kk || dom.endsWith('.' + kk)));
  });
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
  // On inclut le NOM DES PIÈCES JOINTES dans le texte analysé : un mail court (« Voici votre facture »)
  // peut ne porter l'indice (plaque, « facture », n° de facture) que dans le nom du PDF.
  const noms = (msg.pdfs || []).map((p) => String(p.filename || '')).join('  ');
  const texte = [sujet, msg.snippet || '', msg.bodyText || '', msg.from || '', noms].join('  ');
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

  // Exclusion PRIORITAIRE des onglets Gmail « Promotions » et « Réseaux sociaux » : même si le mail
  // porte le libellé surveillé, il est écarté (règle valable AUSSI au test « Tester la configuration »).
  const cats = (msg.labels || []).map((l) => String(l).toUpperCase());
  if (cats.indexOf('CATEGORY_PROMOTIONS') !== -1 || cats.indexOf('CATEGORY_SOCIAL') !== -1) {
    return out({ domaine: 'horsflotte', action: 'ignore', confidence: 'haute', besoinIA: false, motif: 'Onglet Promotions / Réseaux sociaux — exclu' });
  }
  // « force » = mail signalé par le LIBELLÉ surveillé (nom propre à CHAQUE société). On le détecte par
  // l'ID de libellé fourni par le serveur (ctx.watchLabelId, dans msg.labels) OU le drapeau msg.viaLibelle.
  // (Repli historique sur un libellé nommé « Parc Pilot » conservé pour compatibilité.)
  const wId = ctx.watchLabelId ? String(ctx.watchLabelId).toUpperCase() : '';
  const force = !!(msg.viaLibelle || (wId && cats.indexOf(wId) !== -1) ||
    (msg.labels && msg.labels.some((l) => /parc[\s_-]?pilot/i.test(String(l)))));
  // ---- Signaux de LIEN FLOTTE (source unique de la décision « retenir / écarter ») ----
  const RE_FACT = T.RE_FACTURE.test(texte);
  const autoCtx = T.RE_AUTO_CONTEXT.test(texte);
  const fleetSpec = T.RE_FLOTTE_SPEC.test(texte) || T.RE_IMMAT_FORMAT.test(texte) || T.RE_CARB_PEAGE.test(texte);
  const actionTheme = T.RE_MAINT.test(texte) || T.RE_SINISTRE.test(texte) || T.RE_AMENDE.test(texte);
  const senderKnown = !!(ctx.knownSenders && msg.fromEmail && T.senderConnu(msg.fromEmail, ctx.knownSenders));
  const refFlotteForte = ancres.length || numeroAvis || plaques.length;
  const lienFlotteFort = !!(refFlotteForte || fleetSpec);
  // ⚠️ RÈGLE GÉNÉRALE (faux positif « factures orange », 27/11/2026) : « facture » + PDF + expéditeur
  //  INTERNE ne suffisent PAS. Le domaine interne (ex. @projectxparis.fr) est partagé par ~50 conducteurs
  //  → un « expéditeur connu » ne compte QUE corroboré par du contexte auto / un terme flotte, jamais seul.
  //  Un lien flotte est établi par : une référence FORTE (fil PP, n° d'avis, plaque reconnue, plaque format
  //  SIV, terme spécifique auto, carburant/péage) ; OU du contexte auto corroboré par un thème métier
  //  (facture/maintenance/sinistre/amende) ; OU un expéditeur connu corroboré de la même façon.
  const lienFlotte = lienFlotteFort
    || (autoCtx && (RE_FACT || actionTheme))
    || (senderKnown && (autoCtx || fleetSpec || actionTheme));

  // RH / newsletter / promo clairement hors flotte → écarté MÊME avec le libellé (tant qu'aucun lien fort).
  if (!lienFlotteFort && T.RE_HORSFLOTTE.test(texte) &&
      !T.RE_AMENDE.test(texte) && !T.RE_MAINT.test(texte) && !T.RE_SINISTRE.test(texte) && !RE_FACT) {
    return out({ domaine: 'horsflotte', action: 'ignore', confidence: 'haute', besoinIA: false, motif: 'RH / hors flotte' });
  }

  // ====================================================================================
  //  GARDE « LIEN FLOTTE FIABLE » (avant toute classification par mot-clé, avant toute IA)
  // ------------------------------------------------------------------------------------
  //  Un mail n'est RETENU (ni entrée créée, ni PDF présélectionné) que si un LIEN FLOTTE fiable est
  //  établi (voir `lienFlotte`). Un simple mot générique (« facture », « maintenance »…), un PDF, un nom
  //  de société OU un expéditeur interne ne suffisent JAMAIS → écarte Babilou / SCI / restaurant /
  //  « factures orange » et les mails bâtiment / commission de sécurité / informatique. Le libellé
  //  surveillé (force) SOUMET le mail au tri mais ne crée PAS d'entrée actionnable sans lien flotte
  //  (il retombe en « nature à préciser », cf. bas de fonction) ; un mail CLAIREMENT hors flotte reste
  //  écarté même sous le libellé (exclusions dures ci-dessous).
  if (!lienFlotteFort) {
    // Bâtiment / commission de sécurité / informatique → écarté, même sous le libellé.
    if (T.RE_BATIMENT_IT.test(texte)) {
      return out({ domaine: 'horsflotte', action: 'ignore', confidence: 'haute', besoinIA: false,
        motif: 'Bâtiment / commission de sécurité / informatique — hors flotte' });
    }
    // Facture d'ÉLECTRICITÉ / gaz / boutique (local, magasin) sans carburant/péage → écarté, même libellé.
    if (T.RE_ELEC_BOUTIQUE.test(texte) && !T.RE_CARB_PEAGE.test(texte) && !T.RE_FLOTTE_SPEC.test(texte)) {
      return out({ domaine: 'horsflotte', action: 'ignore', confidence: 'haute', besoinIA: false,
        motif: 'Facture électricité / gaz / boutique (hors carburant-péage) — hors flotte' });
    }
    // Pas de lien flotte établi ET pas de libellé de revue → écarté (règle GÉNÉRALE, pas une liste de mots).
    if (!force && !lienFlotte) {
      return out({ domaine: 'inconnu', action: 'ignore', confidence: 'faible', besoinIA: false,
        motif: 'Pas de lien flotte fiable (mot générique / expéditeur interne seul) — écarté' });
    }
    // Ici : soit un lien flotte (faible) est établi, soit le libellé de revue force la soumission → on
    //  poursuit vers les branches, TOUJOURS « à vérifier » (jamais d'action auto sans lien fort).
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

  // FACTURE : le mot « facture » (souvent + un PDF joint) → on oriente vers le FORMULAIRE de scan
  // manuel (lecture IA du PDF + contrôle HT+TVA=TTC + anti-doublon FP.dupe à l'enregistrement).
  // Une plaque reconnue PROPOSE le véhicule ; sinon il reste à choisir dans le formulaire. L'IA ne
  // tourne PAS ici (triage = règles pures) : elle lira le PDF au moment de la saisie.
  if (RE_FACT && lienFlotte && (hasPdf || plaques.length)) {
    const p1 = plaques.length === 1;
    return out({ domaine: 'facture', action: 'facture_saisir', refs: { plaque: plaques[0] || null },
      confidence: p1 ? 'moyenne' : 'faible', besoinIA: false, bloque: true,
      motif: plaques.length > 1 ? 'Facture — plusieurs véhicules cités, à préciser'
        : (p1 ? 'Facture reçue — véhicule proposé, à vérifier au formulaire' : 'Facture reçue — véhicule à préciser au formulaire') });
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
      motif: force ? 'Mail signalé par le libellé surveillé — nature à préciser' : 'Mail lié à un véhicule — nature à préciser' });
  }
  return out({ domaine: 'inconnu', action: 'ignore', confidence: 'faible', besoinIA: false, motif: 'Non lié à la flotte' });
};

// Requête de recherche Gmail (SOURCE UNIQUE, utilisée par le cron `run` ET le « Tester la config ») :
// onglet « Principale » (category:primary) + libellé surveillé (label:"…", capté MÊME archivé),
// en EXCLUANT TOUJOURS Promotions et Réseaux sociaux (règle prioritaire, vaut aussi pour le test).
//   opts = { sinceUnix?, labelName? }
T.gmailQuery = (opts) => {
  opts = opts || {};
  const parts = ['-category:promotions', '-category:social'];
  if (opts.sinceUnix) parts.push('after:' + opts.sinceUnix);
  const name = opts.labelName ? String(opts.labelName).replace(/"/g, '') : '';
  // {a b} = OU dans Gmail : « dans Principale » OU « porte le libellé » (ce dernier capte l'archivé).
  parts.push(name ? '{category:primary label:"' + name + '"}' : 'category:primary');
  return parts.join(' ');
};

// Source d'un message (pour l'affichage du test) à partir de ses labelIds Gmail + l'ID du libellé surveillé.
T.sourceDe = (labels, watchLabelId) => {
  const L = (labels || []).map((x) => String(x));
  const primaire = L.indexOf('CATEGORY_PERSONAL') !== -1 || (L.indexOf('INBOX') !== -1 && !L.some((x) => /^CATEGORY_/.test(x)));
  const parLibelle = !!(watchLabelId && L.indexOf(String(watchLabelId)) !== -1);
  const src = [];
  if (primaire) src.push('Principale');
  if (parLibelle) src.push('Libellé');
  return src.join(' + ') || 'Boîte';
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
