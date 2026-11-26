/* ============================================================================
 *  Parc Pilot — Écran « À vérifier » (automatisation Gmail → actions)
 * ============================================================================
 *  Vue MAÎTRE-DÉTAIL : la liste des mails à vérifier à GAUCHE, le détail du mail
 *  sélectionné à DROITE (expéditeur, message, pièces jointes, véhicule proposé,
 *  ce qu'il reste à vérifier). Le PDF s'ouvre EN GRAND dans Parc Pilot (lecteur
 *  natif du navigateur, comme le scanner) avec bouton plein écran.
 *
 *  Le bouton d'action ANNONCE l'action : « Vérifier la facture », « Valider le
 *  rendez-vous », « Enregistrer le justificatif »… Pour une FACTURE, il ouvre le
 *  formulaire du SCAN MANUEL (factures.html) avec le PDF d'origine déjà chargé et
 *  les infos préremplies — l'enregistrement passe par le parcours métier existant
 *  (contrôle HT+TVA=TTC, anti-doublon FP.dupe, PDF joint à la facture), et le mail
 *  n'est marqué « traité » qu'après succès (sinon il reste à vérifier, avec la raison).
 *
 *  Réservé CEO/Admin (mêmes droits que l'accès serveur aux mails/PDF, gmail-read).
 *  Aucune suppression : un item change de statut (traçabilité). Lecture/MAJ via
 *  FP.supabase avec erreur VISIBLE (FP.notifyError). Tout rendu échappé (FP.esc).
 *
 *  Fonctions PURES (testables) : listItemHtml, detailHtml, actionBtnLabel,
 *  refSummary, lienDossier. Le reste utilise FP.supabase / le DOM.
 * ========================================================================== */
(function () {
  'use strict';
  var A = {};
  function esc(s) { return (window.FP && FP.esc) ? FP.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function toast(m, t) { try { (FP.toast || function () {})(m, t); } catch (e) {} }
  function err(m) { try { (FP.notifyError || FP.toast || function () {})(m); } catch (e) {} }

  var DOMAINE_LABEL = { facture: '🧾 Facture', amende: '🅿️ Amende', maintenance: '🔧 Maintenance', sinistre: '💥 Sinistre', assurance: '🛡️ Assurance', relance: '📣 Relance', inconnu: '❓ À qualifier' };
  // Libellé DÉTAILLÉ de l'action (ligne « Action : … » du détail).
  var ACTION_LABEL = {
    facture_saisir: 'Saisir la facture (formulaire de scan)',
    amende_payee: 'Marquer l’amende payée + justificatif',
    rdv_update: 'Mettre à jour le rendez-vous',
    sinistre_piece: 'Rattacher la pièce au dossier sinistre',
    a_verifier: 'À qualifier manuellement'
  };
  A.DOMAINE_LABEL = DOMAINE_LABEL; A.ACTION_LABEL = ACTION_LABEL;

  // Libellé du BOUTON principal — il ANNONCE l'action (demande explicite).
  A.actionBtnLabel = function (it) {
    switch (it && it.action) {
      case 'facture_saisir': return '🧾 Vérifier la facture';
      case 'amende_payee': return '✓ Enregistrer le justificatif';
      case 'rdv_update': return '📅 Valider le rendez-vous';
      case 'sinistre_piece': return '📎 Enregistrer la pièce';
      default: return '✓ Confirmer et ouvrir le dossier';
    }
  };

  A.fmtDate = function (d) { try { var dt = new Date(d); if (!isNaN(dt.getTime())) return dt.toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) {} return d || ''; };

  // Résumé lisible du dossier proposé (refs)
  A.refSummary = function (ref) {
    ref = ref || {};
    var bits = [];
    if (ref.numeroAvis) bits.push('avis ' + ref.numeroAvis);
    if (ref.sinistreKey) bits.push('sinistre ' + ref.sinistreKey);
    if (ref.dossierId) bits.push('dossier ' + ref.dossierId);
    if (ref.plaque) bits.push('plaque ' + ref.plaque);
    return bits.join(' · ') || '— (à préciser)';
  };

  // Véhicule proposé (immat lisible) à partir de la plaque de la proposition.
  A.vehLabel = function (it) {
    var ref = (it && it.dossier_ref) || {};
    if (!ref.plaque) return '';
    var v = (window.FP && FP.vehByImmat) ? FP.vehByImmat(ref.plaque) : null;
    var fmt = (window.FP && FP.immatFmt) ? FP.immatFmt(ref.plaque) : ref.plaque;
    return v ? (fmt + (v.marque ? ' · ' + v.marque + ' ' + (v.modele || '') : '')) : fmt;
  };

  // --- ITEM de LISTE (gauche) — PUR. Compact : type, objet, véhicule, « à vérifier ». ---
  A.listItemHtml = function (it, selId) {
    it = it || {};
    var dom = DOMAINE_LABEL[it.domaine] || DOMAINE_LABEL.inconnu;
    var traite = it.statut && it.statut !== 'a_verifier';
    var veh = A.vehLabel(it);
    var nPj = (Array.isArray(it.pieces) ? it.pieces.length : 0);
    return '<button type="button" class="gav-item' + (it.id === selId ? ' sel' : '') + '" data-id="' + esc(it.id) + '">'
      + '<div class="gav-item-top"><span class="gav-dom">' + dom + '</span>'
      + (traite ? (A._estAReprendre(it) ? '<span class="gav-statut gav-areprendre">à reprendre</span>' : '<span class="gav-statut gav-' + esc(it.statut) + '">' + esc(it.statut) + '</span>') : '')
      + '<span class="gav-date">' + esc(A.fmtDate(it.recu_le || it.cree_le)) + '</span></div>'
      + '<div class="gav-obj">' + esc(it.objet || '(sans objet)') + '</div>'
      + '<div class="gav-item-sub">' + esc(it.from_email || '—') + '</div>'
      + (veh ? '<div class="gav-item-veh">🚗 ' + esc(veh) + '</div>' : '')
      + (nPj ? '<div class="gav-item-pj">📎 ' + nPj + ' pièce' + (nPj > 1 ? 's' : '') + '</div>' : '')
      + (it.motif_blocage ? '<div class="gav-item-motif">⚠️ ' + esc(it.motif_blocage) + '</div>' : '')
      + '</button>';
  };

  // --- DÉTAIL (droite) — PUR. Expéditeur, message, pièces, dossier, actions. ---
  A.detailHtml = function (it) {
    if (!it) return '<div class="gav-empty">Sélectionne un mail à gauche pour voir le détail.</div>';
    var ref = it.dossier_ref || {};
    var pieces = Array.isArray(it.pieces) ? it.pieces : [];
    var dom = DOMAINE_LABEL[it.domaine] || DOMAINE_LABEL.inconnu;
    var act = ACTION_LABEL[it.action] || esc(it.action || '—');
    var traite = it.statut && it.statut !== 'a_verifier';
    var veh = A.vehLabel(it);
    var retire = it.statut === 'retire';
    var cls = A.classerPieces(it);
    var piecesHtml = pieces.length
      ? '<div class="gav-pc-list">' + cls.pieces.map(function (p) {
          var isSel = (p.idx === cls.factureIdx);
          return '<div class="gav-pc gav-pc-' + p.role + (isSel ? ' sel' : '') + '">'
            + '<div class="gav-pc-info">'
            +   '<div class="gav-pc-role">' + esc(A.roleLabel(p.role, isSel)) + '</div>'
            +   '<div class="gav-pc-name">' + esc(p.filename) + '</div>'
            + '</div>'
            + '<div class="gav-pc-act">'
            +   (p.attachmentId ? '<button type="button" class="gav-pc-open" data-piece="' + p.idx + '">👁 Ouvrir</button>' : '')
            +   (p.attachmentId && !isSel && !traite && !retire ? '<button type="button" class="gav-pc-pick" data-pick="' + p.idx + '">Importer celle-ci</button>' : '')
            + '</div>'
          + '</div>';
        }).join('')
        + (cls.choixRequis && !traite && !retire ? '<div class="gav-pc-choix">⚠️ Plusieurs documents possibles — choisis la <b>facture</b> à importer (« Importer celle-ci »). Le relevé reste consultable dans le mail, il ne crée pas de facture.</div>' : '')
        + '</div>'
      : '<div class="gav-d-nopj">Aucune pièce jointe PDF.</div>';
    var actions;
    if (retire) {
      actions = '<div class="gav-d-done" style="color:#64748b">🗑️ Retiré de Parc Pilot</div>'
        + '<div class="gav-muted" style="font-size:.78rem;margin-top:4px">Le mail d’origine dans Gmail et les factures déjà enregistrées restent accessibles. La synchronisation ne recréera pas cette entrée.</div>'
        + '<div class="gav-d-actions"><button type="button" class="btn btn-outline gav-restaurer">↩ Restaurer dans la liste</button></div>';
    } else if (traite) {
      actions = (A._estAReprendre(it)
          ? '<div class="gav-d-done" style="color:#B45309">⚠️ À reprendre — facture non enregistrée</div><div class="gav-d-motif">Facture confirmée avant le correctif du parcours — l’enregistrement n’a pas pu être vérifié. Clique « Reprendre le traitement ».</div>'
          : '<div class="gav-d-done">✓ Déjà traité (' + esc(it.statut) + ')</div>')
        + '<div class="gav-d-actions">'
        + '<button type="button" class="btn btn-dark gav-reprendre">🔄 Reprendre le traitement</button>'
        + '<button type="button" class="btn btn-outline gav-retirer">🗑️ Retirer de Parc Pilot</button>'
        + '</div><div class="gav-reprise" id="gav-reprise" hidden></div>';
    } else {
      actions = '<div class="gav-d-actions">'
        + '<button type="button" class="btn btn-dark gav-go" data-id="' + esc(it.id) + '">' + esc(A.actionBtnLabel(it)) + '</button>'
        + '<button type="button" class="btn btn-outline gav-correct" data-id="' + esc(it.id) + '">✎ Corriger le rattachement</button>'
        + '<button type="button" class="btn btn-outline gav-ignore" data-id="' + esc(it.id) + '">✕ Ignorer</button>'
        + '<button type="button" class="btn btn-outline gav-retirer">🗑️ Retirer</button>'
        + '</div>';
    }
    return '<button type="button" class="gav-d-back">← Liste</button>'
      + '<div class="gav-d-head"><span class="gav-dom">' + dom + '</span>'
      + (traite ? (A._estAReprendre(it) ? '<span class="gav-statut gav-areprendre">à reprendre</span>' : '<span class="gav-statut gav-' + esc(it.statut) + '">' + esc(it.statut) + '</span>') : '')
      + '<span class="gav-date">' + esc(A.fmtDate(it.recu_le || it.cree_le)) + '</span></div>'
      + '<div class="gav-d-obj">' + esc(it.objet || '(sans objet)') + '</div>'
      + '<div class="gav-d-from"><b>De :</b> ' + esc(it.from_email || '—') + '</div>'
      + '<div class="gav-d-label"><b>Type :</b> ' + dom.replace(/^[^ ]+ /, '') + '</div>'
      + (veh ? '<div class="gav-d-label"><b>Véhicule proposé :</b> ' + esc(veh) + '</div>' : '<div class="gav-d-label"><b>Véhicule proposé :</b> <span class="gav-muted">à préciser</span></div>')
      + '<div class="gav-d-label"><b>Dossier proposé :</b> ' + esc(A.refSummary(ref)) + '</div>'
      + '<div class="gav-d-label"><b>Action :</b> ' + act + '</div>'
      + (it.motif_blocage ? '<div class="gav-d-motif">⚠️ À vérifier : ' + esc(it.motif_blocage) + '</div>' : '')
      + '<div class="gav-d-msg-t">Message</div><div class="gav-d-msg">' + (it.extrait ? esc(it.extrait) : '<span class="gav-muted">(aperçu indisponible)</span>') + '</div>'
      + '<div class="gav-d-msg-t">Pièces jointes</div>' + piecesHtml
      + actions;
  };

  A.styleOnce = function () {
    if (document.getElementById('gav-style')) return;
    var s = document.createElement('style'); s.id = 'gav-style';
    s.textContent = [
      '.gav-wrap{display:flex;flex-direction:column;gap:12px}',
      '.gav-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.gav-md{display:grid;grid-template-columns:minmax(260px,360px) 1fr;gap:14px;align-items:start}',
      '.gav-listwrap{max-height:72vh;overflow:auto;padding-right:2px}',
      '.gav-search{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:6px;background:var(--fp-card,#fff);padding:2px 0 8px}',
      'body.fp-dark .gav-search{background:#0b1220}',
      '.gav-search input{flex:1;min-width:0;border:1px solid var(--fp-border,#E2E8F0);border-radius:10px;padding:7px 10px;font-size:.84rem;background:#fff;color:inherit}',
      'body.fp-dark .gav-search input{background:#0b1220;border-color:#243044}',
      '.gav-search button{border:1px solid var(--fp-border,#E2E8F0);background:var(--fp-bg,#F1F5F9);border-radius:10px;width:32px;height:32px;cursor:pointer;font-size:.9rem;flex:0 0 auto}',
      '.gav-list{display:flex;flex-direction:column;gap:8px}',
      '.gav-item{text-align:left;border:1px solid var(--fp-border,#E2E8F0);border-radius:12px;padding:10px 12px;background:#fff;cursor:pointer;width:100%;display:block}',
      '.gav-item:hover{border-color:var(--fp-primary,#2563EB)}',
      '.gav-item.sel{border-color:var(--fp-primary,#2563EB);box-shadow:0 0 0 2px rgba(37,99,235,.15)}',
      'body.fp-dark .gav-item{background:#0b1220;border-color:#243044}',
      '.gav-item-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.gav-dom{font-weight:800;font-size:.82rem}',
      '.gav-date{margin-left:auto;font-size:.7rem;color:var(--fp-muted,#64748B)}',
      '.gav-obj{font-weight:700;font-size:.85rem;margin-top:3px;word-break:break-word}',
      '.gav-item-sub{font-size:.75rem;color:var(--fp-muted,#64748B);word-break:break-word}',
      '.gav-item-veh{font-size:.76rem;margin-top:3px}',
      '.gav-item-pj{font-size:.72rem;color:var(--fp-muted,#64748B);margin-top:2px}',
      '.gav-item-motif{font-size:.72rem;color:#B45309;margin-top:3px}',
      '.gav-detail{border:1px solid var(--fp-border,#E2E8F0);border-radius:14px;padding:16px;background:#fff;min-height:220px;min-width:0}',
      'body.fp-dark .gav-detail{background:#0b1220;border-color:#243044}',
      '.gav-d-back{display:none;background:none;border:none;color:var(--fp-primary,#2563EB);font-weight:700;font-size:.82rem;cursor:pointer;margin-bottom:6px;padding:0}',
      '.gav-d-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.gav-d-obj{font-weight:800;font-size:1rem;margin:6px 0;word-break:break-word}',
      '.gav-d-from,.gav-d-label{font-size:.82rem;margin-top:4px;word-break:break-word}',
      '.gav-muted{color:var(--fp-muted,#64748B)}',
      '.gav-d-motif{font-size:.8rem;color:#92400E;background:#FEF3C7;border-radius:8px;padding:7px 10px;margin-top:8px}',
      'body.fp-dark .gav-d-motif{background:#78350F;color:#FDE68A}',
      '.gav-d-msg-t{font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.03em;color:var(--fp-muted,#64748B);margin-top:12px}',
      '.gav-d-msg{font-size:.84rem;line-height:1.5;margin-top:4px;white-space:pre-wrap;word-break:break-word}',
      '.gav-d-pieces{display:flex;flex-wrap:wrap;gap:7px;margin-top:5px}',
      '.gav-piece{font-size:.78rem;background:var(--fp-bg,#F1F5F9);border:1px solid var(--fp-border,#E2E8F0);border-radius:8px;padding:4px 10px;cursor:pointer}',
      '.gav-piece:hover{border-color:var(--fp-primary,#2563EB)}',
      '.gav-d-nopj{font-size:.8rem;color:var(--fp-muted,#64748B);margin-top:4px}',
      /* Pièces jointes : rôle (facture/relevé) + sélection d'import */
      '.gav-pc-list{display:flex;flex-direction:column;gap:7px;margin-top:5px}',
      '.gav-pc{display:flex;align-items:center;gap:10px;border:1px solid var(--fp-border,#E2E8F0);border-radius:10px;padding:8px 10px;background:var(--fp-bg,#F8FAFC)}',
      'body.fp-dark .gav-pc{background:#0b1220;border-color:#243044}',
      '.gav-pc.sel{border-color:#16a34a;box-shadow:0 0 0 2px rgba(22,163,74,.15);background:#F0FDF4}',
      'body.fp-dark .gav-pc.sel{background:#052e16;border-color:#16a34a}',
      '.gav-pc-info{min-width:0;flex:1}',
      '.gav-pc-role{font-size:.74rem;font-weight:800}',
      '.gav-pc-facture .gav-pc-role{color:#166534}.gav-pc-releve .gav-pc-role{color:#92400E}.gav-pc-autre .gav-pc-role{color:#475569}',
      'body.fp-dark .gav-pc-facture .gav-pc-role{color:#4ade80}body.fp-dark .gav-pc-releve .gav-pc-role{color:#fcd34d}',
      '.gav-pc-name{font-size:.74rem;color:var(--fp-muted,#64748B);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.gav-pc-act{display:flex;gap:6px;flex:0 0 auto}',
      '.gav-pc-open,.gav-pc-pick{border:1px solid var(--fp-border,#E2E8F0);background:#fff;border-radius:8px;padding:4px 9px;cursor:pointer;font-size:.76rem;font-weight:600;color:inherit}',
      '.gav-pc-pick{background:var(--fp-primary,#2563EB);color:#fff;border-color:var(--fp-primary,#2563EB)}',
      'body.fp-dark .gav-pc-open{background:#0b1220;border-color:#243044}',
      '.gav-pc-open:hover{border-color:var(--fp-primary,#2563EB)}',
      '.gav-pc-choix{font-size:.78rem;color:#92400E;background:#FEF3C7;border-radius:8px;padding:7px 10px;margin-top:4px}',
      'body.fp-dark .gav-pc-choix{background:#78350F;color:#FDE68A}',
      '.gav-d-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}',
      '.gav-d-actions .btn{font-size:.82rem}',
      '.gav-d-done{margin-top:14px;font-weight:700;color:#166534}',
      '.gav-reprise{margin-top:12px;border-top:1px dashed var(--fp-border,#E2E8F0);padding-top:10px}',
      '.gav-rep-card{border:1px solid var(--fp-border,#E2E8F0);border-radius:10px;padding:9px 11px;margin-top:7px;font-size:.82rem}',
      '.gav-rep-card .btn{font-size:.8rem;margin-top:7px}',
      '.gav-rep-ok{color:#166534;font-weight:700}.gav-rep-warn{color:#B45309;font-weight:700}',
      '.gav-statut{font-size:.66rem;font-weight:800;text-transform:uppercase;letter-spacing:.03em;border-radius:9999px;padding:1px 8px;background:#F1F5F9;color:#475569}',
      '.gav-confirme{background:#DCFCE7;color:#166534}.gav-applique{background:#DBEAFE;color:#1E3A8A}.gav-ignore{background:#F1F5F9;color:#64748B}.gav-corrige{background:#FEF3C7;color:#78350F}.gav-areprendre{background:#FEF3C7;color:#92400E}',
      '.gav-empty{text-align:center;color:var(--fp-muted,#64748B);font-size:.9rem;padding:26px 10px}',
      /* Le PDF s'ouvre via le LECTEUR COMMUN Parc Pilot (FP.docReview.openOverlay) → styles .fpdr-* (styles.css). */
      '@media(max-width:760px){',
      '  .gav-md{grid-template-columns:1fr}',
      '  .gav-md.show-detail .gav-list{display:none}',
      '  .gav-md:not(.show-detail) .gav-detail{display:none}',
      '  .gav-d-back{display:block}',
      '  .gav-list{max-height:none}',
      '}'
    ].join('\n');
    document.head.appendChild(s);
  };

  A._state = 'a_verifier'; // filtre courant
  A._loaded = false;       // la file a-t-elle été chargée au moins une fois ?
  A._selId = null;         // item sélectionné (détail)
  A._q = '';               // recherche texte (objet, expéditeur, immat, n° facture/avis/sinistre, pièce)

  // Normalisation recherche : minuscules, sans accents. (Plaque : on retire aussi tirets/espaces.)
  A._norm = function (s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
  A._normPlaque = function (s) { return A._norm(s).replace(/[^a-z0-9]/g, ''); };
  // Un item correspond-il à la recherche ? (objet, expéditeur, immat normalisée, n° avis/sinistre/dossier, pièces)
  A._match = function (it, q) {
    if (!q) return true;
    var nq = A._norm(q).trim(); if (!nq) return true;
    var ref = it.dossier_ref || {};
    var hay = [it.objet, it.from_email, it.extrait, it.domaine, ref.numeroAvis, ref.sinistreKey, ref.dossierId]
      .concat((it.pieces || []).map(function (p) { return p && p.filename; }))
      .map(A._norm).join('  ');
    if (hay.indexOf(nq) !== -1) return true;
    // Plaque : comparer sans tirets ni espaces (« GT818LC » = « GT-818-LC » = « GT 818 LC »).
    var pq = A._normPlaque(q);
    if (pq.length >= 4) {
      var plaques = [ref.plaque, it.objet].concat((it.pieces || []).map(function (p) { return p && p.filename; }));
      if (plaques.some(function (x) { return A._normPlaque(x).indexOf(pq) !== -1; })) return true;
    }
    return false;
  };

  // ─── CLASSIFICATION DES PIÈCES JOINTES (facture à importer vs relevé à écarter) ─────────────────
  // Un mail peut contenir PLUSIEURS PDF (ex. DKV : « …E-SUMMARY… » = relevé, « …E-INVOICE… » = facture).
  // On NE DOIT PAS importer la première pièce venue (c'était le bug : on prenait pieces[0] = le relevé).
  // Rôle déduit du NOM (multi-fournisseurs : DKV / TotalEnergies / Ulys-Vinci, FR/EN/DE/IT/NL). Le choix
  // manuel (`A._pieceSel`) l'emporte. L'ordre et la référence commune dans les noms ne suffisent pas.
  A._pieceSel = {}; // { itemId: idx } — pièce « facture » choisie à la main pour l'import
  A.roleDePiece = function (filename) {
    var f = A._norm(filename);
    // Relevé / récapitulatif / détail de consommation (à NE PAS importer comme facture). Testé en premier :
    // « e-invoice summary » doit rester un relevé si « summary » est présent sans « invoice » propre.
    if (/e[-_ ]?summary|\bsummary\b|releve|recapitulatif|statement|auszug|overzicht|zusammenfassung|detail\b|detaille|consommation/.test(f)) return 'releve';
    if (/e[-_ ]?invoice|\binvoice\b|facture|rechnung|fattura|factuur|\bfact\b/.test(f)) return 'facture';
    return 'autre';
  };
  A.roleLabel = function (role, sel) {
    if (role === 'facture') return sel ? '🧾 Facture · sélectionnée pour l’import' : '🧾 Facture';
    if (role === 'releve') return '📄 Relevé · exclu de l’import';
    return sel ? '📎 Document · sélectionné pour l’import' : '📎 Document';
  };
  // Classe toutes les pièces et désigne l'index de la FACTURE à importer (ou null si un choix est requis).
  A.classerPieces = function (it) {
    var raw = Array.isArray(it.pieces) ? it.pieces : [];
    var pieces = raw.map(function (p, i) {
      return { idx: i, filename: (p && p.filename) || ('pièce ' + (i + 1)), attachmentId: p && p.attachmentId, role: A.roleDePiece(p && p.filename) };
    });
    var pdfs = pieces.filter(function (p) { return p.attachmentId; });
    var factures = pdfs.filter(function (p) { return p.role === 'facture'; });
    var sel = A._pieceSel[it.id];
    var factureIdx;
    if (sel != null && pieces[sel] && pieces[sel].attachmentId) factureIdx = sel;        // choix manuel prioritaire
    else if (factures.length === 1) factureIdx = factures[0].idx;                        // une seule facture claire
    else if (factures.length === 0 && pdfs.length === 1) factureIdx = pdfs[0].idx;       // pas de « facture » mais 1 seul PDF → c'est lui
    else factureIdx = null;                                                              // 0 facture + plusieurs PDF, OU plusieurs factures → choix requis
    return { pieces: pieces, pdfs: pdfs, factures: factures, factureIdx: factureIdx,
             choixRequis: (factureIdx == null && pdfs.length > 0), aucun: pdfs.length === 0 };
  };
  A.pieceFactureIdx = function (it) { return A.classerPieces(it).factureIdx; };

  // Pastille « en attente » sur l'onglet « 📨 À vérifier ».
  A.badgeHtml = function (n) {
    return '📨 À vérifier' + (n ? ' <span style="background:#EF4444;color:#fff;border-radius:9999px;padding:1px 7px;font-size:11px;font-weight:800">' + n + '</span>' : '');
  };
  A._pending = function () { return (A._items || []).filter(function (it) { return !it.statut || it.statut === 'a_verifier'; }).length; };
  A.updateTabBadge = function (tabEl) {
    tabEl = tabEl || document.getElementById('tab-averifier');
    if (!tabEl || !(window.FP && FP.supabase)) return;
    if (A._loaded) { tabEl.innerHTML = A.badgeHtml(A._pending()); return; }
    FP.supabase.from('gmail_a_verifier').select('id', { count: 'exact', head: true }).eq('statut', 'a_verifier')
      .then(function (r) { if (r.error) return; tabEl.innerHTML = A.badgeHtml(r.count || 0); });
  };

  A.render = function (host) {
    if (!host) return;
    A._host = host;
    A.styleOnce();
    if (!(window.FP && FP.supabase)) { host.innerHTML = '<div class="gav-empty">Connexion indisponible.</div>'; return; }
    host.innerHTML = '<div class="gav-empty"><i data-lucide="loader" class="w-5 h-5 animate-spin" style="display:inline-block"></i><br>Chargement…</div>';
    try { window.lucide && lucide.createIcons && lucide.createIcons(); } catch (e) {}
    FP.supabase.from('gmail_a_verifier').select('*').order('cree_le', { ascending: false }).limit(1000)
      .then(function (r) {
        if (r.error) {
          var msg = /relation|does not exist|not exist|schema cache/i.test(String(r.error.message || ''))
            ? 'L’automatisation des mails n’est pas encore activée sur cette plateforme.'
            : 'Lecture impossible : ' + esc(r.error.message || '');
          host.innerHTML = '<div class="gav-empty">' + msg + '</div>'; return;
        }
        A._items = r.data || [];
        A._loaded = true;
        A.paint(host);
      });
  };

  // Un item « à reprendre » = ancienne proposition de FACTURE confirmée AVANT le correctif du parcours
  // (statut 'confirme' avec une pièce PDF) → son enregistrement ne peut pas être vérifié automatiquement.
  A._estAReprendre = function (it) {
    return it && it.statut === 'confirme' && Array.isArray(it.pieces) && it.pieces.some(function (p) { return p && p.attachmentId; });
  };
  A._filtered = function () {
    var st = A._state;
    return (A._items || []).filter(function (it) {
      var s = it.statut || 'a_verifier';
      // Les mails « retirés de PP » sont masqués partout, sauf dans la vue « Retirés ».
      if (s === 'retire') return st === 'retire';
      var okStatut;
      if (st === 'retire') okStatut = false;
      else if (st === 'tous') okStatut = true;
      else if (st === 'a_verifier') okStatut = (s === 'a_verifier');
      else if (st === 'a_reprendre') okStatut = A._estAReprendre(it);
      else okStatut = (s === st);
      return okStatut && A._match(it, A._q);
    });
  };

  A.paint = function (host) {
    host = host || A._host; if (!host) return;
    var items = A._filtered();
    // Sélection : garde l'item courant s'il est encore visible, sinon le premier.
    if (!items.some(function (x) { return x.id === A._selId; })) A._selId = items.length ? items[0].id : null;
    var nA = A._pending();
    var bar = '<div class="gav-bar">'
      + '<span style="font-weight:800;color:var(--fp-primary)">📨 À vérifier (mails)</span>'
      + '<span class="gav-statut" style="background:#FEE2E2;color:#B91C1C">' + nA + ' en attente</span>'
      + '<select id="gav-filter" class="text-sm border border-slate-200 rounded-lg px-2 py-1" style="margin-left:auto">'
      + ['a_verifier|À vérifier', 'a_reprendre|À reprendre', 'tous|Tous', 'confirme|Confirmés', 'applique|Enregistrés', 'corrige|Corrigés', 'ignore|Ignorés', 'retire|Retirés']
          .map(function (o) { var p = o.split('|'); return '<option value="' + p[0] + '"' + (p[0] === A._state ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('')
      + '</select></div>';
    var sel = items.filter(function (x) { return x.id === A._selId; })[0] || null;
    var emptyMsg = A._q
      ? '<div class="gav-empty">Aucun mail trouvé pour « ' + esc(A._q) + ' ».</div>'
      : '<div class="gav-empty">Rien ' + (A._state === 'a_verifier' ? 'à vérifier' : 'dans cette vue') + ' pour le moment.<br><span style="font-size:.78rem">Les mails de flotte détectés apparaîtront ici.</span></div>';
    var list = items.length ? items.map(function (it) { return A.listItemHtml(it, A._selId); }).join('') : emptyMsg;
    var searchBar = '<div class="gav-search">'
      + '<input id="gav-q" type="search" placeholder="Rechercher un mail…" value="' + esc(A._q) + '" autocomplete="off" spellcheck="false">'
      + (A._q ? '<button type="button" id="gav-q-clear" title="Effacer la recherche" aria-label="Effacer">✕</button>' : '')
      + '</div>';
    var leftCol = '<div class="gav-listwrap">' + searchBar + '<div class="gav-list">' + list + '</div></div>';
    var md = '<div class="gav-md' + (A._showDetail ? ' show-detail' : '') + '">'
      + leftCol
      + '<div class="gav-detail">' + A.detailHtml(sel) + '</div></div>';
    host.innerHTML = '<div class="card p-5"><div class="gav-wrap">' + bar + md + '</div></div>';
    try { window.lucide && lucide.createIcons && lucide.createIcons(); } catch (e) {}
    A.wire(host);
    // Garde le focus dans la recherche pendant la frappe (le re-rendu recrée l'input).
    if (A._focusSearch) { try { var qi = document.getElementById('gav-q'); if (qi) { qi.focus(); var v = qi.value; qi.value = ''; qi.value = v; } } catch (e) {} A._focusSearch = false; }
    try { A.updateTabBadge(); } catch (e) {}
  };

  A.wire = function (host) {
    var f = document.getElementById('gav-filter');
    if (f) f.addEventListener('change', function () { A._state = f.value; A._selId = null; A._showDetail = false; A.paint(host); });
    // Recherche : filtre à la frappe (débouncé), garde le focus, croix pour effacer.
    var qi = document.getElementById('gav-q');
    if (qi) qi.addEventListener('input', function () {
      A._q = qi.value || ''; A._focusSearch = true;
      clearTimeout(A._qT); A._qT = setTimeout(function () { A.paint(host); }, 150);
    });
    var qc = document.getElementById('gav-q-clear');
    if (qc) qc.addEventListener('click', function () { A._q = ''; A._focusSearch = true; A.paint(host); });
    host.querySelectorAll('.gav-item').forEach(function (b) {
      b.addEventListener('click', function () { A._selId = b.dataset.id; A._showDetail = true; A.paint(host); });
    });
    var back = host.querySelector('.gav-d-back');
    if (back) back.addEventListener('click', function () { A._showDetail = false; A.paint(host); });
    var sel = (A._items || []).filter(function (x) { return x.id === A._selId; })[0] || null;
    host.querySelectorAll('.gav-pc-open').forEach(function (b) {
      b.addEventListener('click', function () { if (sel) A.openPdf(sel, Number(b.dataset.piece) || 0); });
    });
    host.querySelectorAll('.gav-pc-pick').forEach(function (b) {
      b.addEventListener('click', function () { if (!sel) return; A._pieceSel[sel.id] = Number(b.dataset.pick) || 0; A.paint(host); });
    });
    var go = host.querySelector('.gav-go'); if (go) go.addEventListener('click', function () { if (sel) A.action(host, sel); });
    var co = host.querySelector('.gav-correct'); if (co) co.addEventListener('click', function () { if (sel) A.openCorrect(host, sel.id); });
    var ig = host.querySelector('.gav-ignore'); if (ig) ig.addEventListener('click', function () {
      if (!sel) return; ig.disabled = true;
      A.majStatut(sel.id, 'ignore').then(function () { toast('Proposition ignorée.'); A._after(host, sel.id, 'ignore'); })
        .catch(function (e) { ig.disabled = false; err('Impossible d’ignorer : ' + (e.message || e)); });
    });
    // Reprendre / Retirer / Restaurer (items déjà traités)
    var rp = host.querySelector('.gav-reprendre'); if (rp) rp.addEventListener('click', function () { if (sel) A.reprendre(host, sel); });
    var rt = host.querySelector('.gav-retirer'); if (rt) rt.addEventListener('click', function () { if (sel) A.retirer(host, sel); });
    var rs = host.querySelector('.gav-restaurer'); if (rs) rs.addEventListener('click', function () { if (sel) A.restaurer(host, sel); });
  };

  A.societeDe = function (it) { return (it && it.societe) || (window.FP && FP.societe) || null; };

  // --- Ouverture du PDF EN GRAND via le LECTEUR COMMUN Parc Pilot (FP.docReview.openOverlay) ---
  // Rendu canvas (pdf.js), UNE seule barre PP (pages/zoom/⛶ plein écran/↗ original), clair+sombre, plein
  // écran Échap non destructif. Fini l'iframe native + la double barre. Les octets viennent du serveur
  // (gmail-read, jeton côté serveur) : on ouvre l'overlay « en chargement » puis on l'alimente (setFile).
  A.openPdf = function (it, idx) {
    var pieces = Array.isArray(it.pieces) ? it.pieces : [];
    var p = pieces[idx]; if (!p || !it.message_id || !p.attachmentId) { err('Pièce jointe indisponible.'); return; }
    if (!(window.FP && FP.docReview && FP.docReview.openOverlay)) { err('Lecteur de document indisponible.'); return; }
    var fn = p.filename || 'document.pdf';
    var ov = FP.docReview.openOverlay(null, { label: '📄 ' + fn, title: fn, filename: fn, showName: false, loadingLabel: 'Chargement du PDF…' });
    FP.supabase.functions.invoke('gmail-read', { body: { action: 'attachment', messageId: it.message_id, attachmentId: p.attachmentId, societe: A.societeDe(it) } })
      .then(function (r) {
        var d = r && r.data; if (!d || !d.ok || !d.dataB64) throw new Error((d && d.error) || (r && r.error && r.error.message) || 'PDF indisponible');
        var bin = atob(d.dataB64); var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        ov.setFile(new File([bytes], fn, { type: d.mimeType || 'application/pdf' }));
      })
      .catch(function (e) { ov.setError('Impossible d’ouvrir le PDF : ' + (e.message || e)); });
  };

  // MAJ du statut d'un item (durable, erreur visible).
  A.majStatut = function (id, statut, patch) {
    var row = Object.assign({ statut: statut, traite_le: new Date().toISOString() }, patch || {});
    try { var u = (FP.profile && FP.profile.id) || null; if (u) row.traite_par = u; } catch (e) {}
    return FP.supabase.from('gmail_a_verifier').update(row).eq('id', id)
      .then(function (r) { if (r.error) throw new Error(r.error.message || 'écriture refusée'); return true; });
  };

  // Lien (pur) vers le parcours manuel pré-ciblé selon le domaine/référence. Relatif à pages/.
  A.lienDossier = function (it) {
    var ref = (it && it.dossier_ref) || {};
    var veh = (ref.plaque && window.FP && FP.vehByImmat) ? FP.vehByImmat(ref.plaque) : null;
    var vehLien = (veh && veh.id) ? 'vehicules.html?veh=' + encodeURIComponent(veh.id) : null;
    switch (it && it.domaine) {
      case 'amende': return ref.numeroAvis ? 'amendes.html?avis=' + encodeURIComponent(ref.numeroAvis) : 'amendes.html';
      case 'maintenance': return vehLien || 'entretiens.html';
      case 'sinistre': return vehLien || 'sinistres.html';
      case 'relance': return vehLien || 'conducteurs.html';
      default: return vehLien;
    }
  };

  // Bouton d'action principal : facture → formulaire de scan ; autres → fiche à finaliser.
  A.action = function (host, it) {
    if (it.domaine === 'facture') return A.verifierFacture(host, it);
    return A.confirmer(host, it);
  };

  // FACTURE : ouvre le FORMULAIRE de scan manuel (factures.html) avec le PDF d'origine déjà chargé.
  // On passe par sessionStorage les IDENTIFIANTS (pas les octets) ; factures.html récupère le PDF via
  // gmail-read (jeton côté serveur), préremplit, et l'enregistrement (parcours métier existant) marquera
  // le mail « traité » seulement après succès. Anti-doublon FP.dupe à l'enregistrement.
  A.verifierFacture = function (host, it) {
    var pieces = Array.isArray(it.pieces) ? it.pieces : [];
    var cls = A.classerPieces(it);
    if (cls.aucun) { err('Aucun PDF joint à cette facture — impossible d’ouvrir le formulaire.'); return; }
    if (cls.factureIdx == null) { err('Plusieurs documents sont joints : choisis d’abord la facture à importer (bouton « Importer celle-ci » sous la pièce).'); return; }
    var pj = pieces[cls.factureIdx];
    if (!pj || !pj.attachmentId || !it.message_id) { err('Pièce jointe indisponible.'); return; }
    var ref = it.dossier_ref || {};
    var payload = {
      avId: it.id, societe: A.societeDe(it), messageId: it.message_id,
      attachmentId: pj.attachmentId, filename: pj.filename || 'facture.pdf',
      prefill: { immat: ref.plaque || '' }
    };
    try { sessionStorage.setItem('fp_gmailfac', JSON.stringify(payload)); }
    catch (e) { err('Stockage local indisponible — réessaie.'); return; }
    try { location.href = 'factures.html?gmailfac=' + encodeURIComponent(it.id); }
    catch (e) { err('Navigation impossible.'); }
  };

  // Confirmer (domaines NON facture) = enregistrer la validation + ouvrir la fiche pré-ciblée à finaliser.
  A.confirmer = function (host, it) {
    var lien = A.lienDossier(it);
    A.majStatut(it.id, 'confirme').then(function () {
      toast(lien ? 'Confirmé — ouverture de la fiche pour finaliser.' : 'Confirmé.');
      A._after(host, it.id, 'confirme');
      if (lien) { try { window.open(lien, '_blank'); } catch (e) { try { location.href = lien; } catch (_) {} } }
    }).catch(function (e) { err('Impossible de confirmer : ' + (e.message || e)); });
  };

  // ---- RETIRER / RESTAURER (masquer une entrée de la liste PP, réversible ; Gmail et factures intacts) ----
  A.retirer = function (host, it) {
    if (!confirm('Retirer ce mail de la liste Parc Pilot ? (Le mail Gmail et les factures déjà enregistrées restent accessibles ; la synchro ne le recréera pas.)')) return;
    var pl = Object.assign({}, it.payload || {}, { statutAvant: it.statut || 'a_verifier' });
    A.majStatut(it.id, 'retire', { payload: pl }).then(function () {
      it.payload = pl; toast('Mail retiré de Parc Pilot.'); A._after(host, it.id, 'retire');
    }).catch(function (e) { err('Impossible de retirer : ' + (e.message || e)); });
  };
  A.restaurer = function (host, it) {
    var prev = (it.payload && it.payload.statutAvant) || 'a_verifier';
    A.majStatut(it.id, prev).then(function () { toast('Mail restauré.'); A._after(host, it.id, prev); })
      .catch(function (e) { err('Impossible de restaurer : ' + (e.message || e)); });
  };

  // Extrait un n° de facture plausible d'un texte (ex. « F-2026-627 », « 2026-627 »).
  A.numFacture = function (s) {
    var t = String(s || '');
    var m = t.match(/\b([A-Za-z]{0,3}[-_ ]?20\d{2}[-_ ]?\d{1,6})\b/) || t.match(/\b(F[-_ ]?\d{3,})\b/i);
    return m ? m[1] : '';
  };

  // Récupère le PDF d'origine (1re pièce) via gmail-read (jeton serveur) → octets + nom + type.
  A._fetchPdfBlob = function (it) {
    var idx = A.pieceFactureIdx(it);
    var pj = (idx != null) ? (it.pieces || [])[idx] : null;
    if (!pj || !pj.attachmentId || !it.message_id) return Promise.reject(new Error('Pièce jointe indisponible'));
    return FP.supabase.functions.invoke('gmail-read', { body: { action: 'attachment', messageId: it.message_id, attachmentId: pj.attachmentId, societe: A.societeDe(it) } })
      .then(function (r) {
        var d = r && r.data; if (!d || !d.ok || !d.dataB64) throw new Error((d && d.error) || (r && r.error && r.error.message) || 'PDF indisponible');
        var bin = atob(d.dataB64); var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { bytes: bytes, filename: pj.filename || 'facture.pdf', mime: d.mimeType || 'application/pdf' };
      });
  };

  // Cherche, dans la société du mail, une facture correspondante (n° de facture, nom de PDF, ou plaque).
  A.facturesMatch = function (it) {
    if (!(window.FP && FP.supabase)) return Promise.resolve([]);
    var soc = A.societeDe(it);
    var q = FP.supabase.from('factures').select('id,numero_facture,fournisseur,montant_ttc,vehicule_immat,file_id,file_name,date');
    if (soc) q = q.eq('societe', soc);
    return q.then(function (r) {
      if (r.error || !r.data) return [];
      var pieces = it.pieces || []; var _fidx = A.pieceFactureIdx(it);
      var fn = ((_fidx != null && pieces[_fidx]) ? pieces[_fidx].filename : (pieces[0] && pieces[0].filename)) || '';
      var num = A.numFacture(fn) || A.numFacture(it.objet);
      var plaque = (it.dossier_ref && it.dossier_ref.plaque) || '';
      var N = function (s) { return A._norm(s).replace(/[^a-z0-9]/g, ''); };
      var byStrong = r.data.filter(function (f) {
        var byNum = num && f.numero_facture && N(f.numero_facture).indexOf(N(num)) !== -1 && N(num).length >= 4;
        var byFile = f.file_name && fn && N(f.file_name) === N(fn);
        return byNum || byFile;
      });
      if (byStrong.length) return byStrong;
      // Repli par plaque : UNIQUEMENT corroboré par le FOURNISSEUR (son nom apparaît dans l'expéditeur ou
      // l'objet du mail) → une plaque seule ne propose JAMAIS 11 factures. Sinon rien (→ on ouvrira le formulaire).
      if (plaque) {
        var hay = N((it.from_email || '') + ' ' + (it.objet || ''));
        var parPlaque = r.data.filter(function (f) { return f.vehicule_immat && (window.FP && FP.immatEq ? FP.immatEq(f.vehicule_immat, plaque) : N(f.vehicule_immat) === N(plaque)); });
        var corrobore = parPlaque.filter(function (f) {
          var mots = A._norm(f.fournisseur || '').split(/\s+/).filter(function (w) { return w.length >= 4; });
          return mots.length && mots.some(function (w) { return hay.indexOf(N(w)) !== -1; });
        });
        return corrobore.slice(0, 6); // corroboré par le fournisseur ; vide si rien ne colle → formulaire direct
      }
      return [];
    }).catch(function () { return []; });
  };

  // ---- REPRENDRE LE TRAITEMENT d'un mail déjà confirmé/ignoré ----
  A.reprendre = function (host, it) {
    var box = document.getElementById('gav-reprise'); if (!box) return;
    box.hidden = false;
    var pdf = (it.pieces || []).some(function (p) { return p && p.attachmentId; });
    if (!pdf) {
      // Pas de PDF : simple remise « à vérifier » pour re-qualifier.
      box.innerHTML = '<div class="gav-rep-card">Aucune pièce PDF à reprendre. <button type="button" class="btn btn-outline gav-rep-requeue">↩ Remettre dans « À vérifier »</button></div>';
      var b0 = box.querySelector('.gav-rep-requeue'); if (b0) b0.addEventListener('click', function () { A.majStatut(it.id, 'a_verifier').then(function () { toast('Remis dans « À vérifier ».'); A._after(host, it.id, 'a_verifier'); }).catch(function (e) { err(e.message || e); }); });
      return;
    }
    box.innerHTML = '<div class="gav-rep-card">Recherche d’une facture correspondante…</div>';
    A.facturesMatch(it).then(function (matches) { A.renderReprise(host, it, matches); });
  };

  A.renderReprise = function (host, it, matches) {
    var box = document.getElementById('gav-reprise'); if (!box) return;
    var euro = function (x) { return (window.FP && FP.euro) ? FP.euro(x) : (x == null ? '—' : x); };
    var html = '';
    if (matches && matches.length) {
      html += '<div style="font-weight:700;font-size:.82rem;margin-bottom:4px">' + matches.length + ' facture(s) déjà enregistrée(s) qui pourrai(en)t correspondre :</div>';
      matches.slice(0, 6).forEach(function (f, i) {
        var aPdf = !!f.file_id;
        html += '<div class="gav-rep-card" data-fi="' + i + '">'
          + '<div><b>' + esc(f.numero_facture || '(sans n°)') + '</b> · ' + esc(f.fournisseur || '—') + ' · ' + esc(euro(f.montant_ttc)) + (f.vehicule_immat ? ' · ' + esc((window.FP && FP.immatFmt) ? FP.immatFmt(f.vehicule_immat) : f.vehicule_immat) : '') + '</div>'
          + '<div style="font-size:.76rem;margin-top:2px">PDF joint : ' + (aPdf ? '<span class="gav-rep-ok">oui</span>' : '<span class="gav-rep-warn">non</span>') + (f.file_id ? ' · <a href="factures.html?facture=' + encodeURIComponent(f.file_id) + '" target="_blank" rel="noopener">Voir la facture ↗</a>' : '') + '</div>'
          + (aPdf
              ? '<button type="button" class="btn btn-outline gav-rep-done" data-fi="' + i + '">✓ C’est bien celle-ci — marquer le mail traité</button>'
              : '<button type="button" class="btn btn-dark gav-rep-attach" data-fi="' + i + '">📎 Joindre le PDF d’origine à cette facture</button>')
          + '</div>';
      });
    } else {
      html += '<div class="gav-rep-card">Aucune facture correspondante trouvée dans cette société.</div>';
    }
    html += '<button type="button" class="btn btn-outline gav-rep-form" style="margin-top:9px">🧾 Aucune / rouvrir le formulaire de scan avec le PDF</button>';
    box.innerHTML = html;
    box.querySelectorAll('.gav-rep-done').forEach(function (b) { b.addEventListener('click', function () { A.markApplique(host, it, matches[+b.dataset.fi]); }); });
    box.querySelectorAll('.gav-rep-attach').forEach(function (b) { b.addEventListener('click', function () { A.attachToFacture(host, it, matches[+b.dataset.fi], b); }); });
    var bf = box.querySelector('.gav-rep-form'); if (bf) bf.addEventListener('click', function () {
      A.majStatut(it.id, 'a_verifier').then(function () { it.statut = 'a_verifier'; A.verifierFacture(host, it); }).catch(function () { A.verifierFacture(host, it); });
    });
  };

  A.markApplique = function (host, it, f) {
    A.majStatut(it.id, 'applique').then(function () {
      toast('Mail marqué traité.' + (f && f.file_id ? '' : ''));
      A._after(host, it.id, 'applique');
    }).catch(function (e) { err('Impossible : ' + (e.message || e)); });
  };

  // Joindre le PDF d'origine à une facture EXISTANTE (sans doublon) puis marquer le mail traité.
  A.attachToFacture = function (host, it, f, btn) {
    if (!f || !(window.FP && FP.uploadScan && FP.persist && FP.persist.update)) { err('Enregistrement en ligne indisponible.'); return; }
    if (btn) btn.disabled = true;
    var busy = (FP.busy ? FP.busy('Récupération du PDF…') : null);
    A._fetchPdfBlob(it).then(function (d) {
      if (busy && busy.update) busy.update('Enregistrement du document…');
      var file = new File([d.bytes], d.filename, { type: d.mime });
      return FP.uploadScan(file, 'factures').then(function (url) {
        if (!url) throw new Error('dépôt du PDF échoué');
        return FP.persist.update('factures', f.id, { fileId: url, fileName: d.filename });
      });
    }).then(function () {
      return A.majStatut(it.id, 'applique');
    }).then(function () {
      if (busy && busy.done) busy.done('✓ PDF joint à la facture.');
      toast('PDF joint à la facture et mail marqué traité.');
      A._after(host, it.id, 'applique');
    }).catch(function (e) {
      if (busy && busy.fail) busy.fail('Échec : ' + (e.message || e));
      if (btn) btn.disabled = false;
      err('Échec du rattachement : ' + (e.message || e) + ' — le mail reste à reprendre.');
    });
  };

  // Mise à jour locale après action (évite un rechargement complet).
  A._after = function (host, id, statut) {
    var it = (A._items || []).find(function (x) { return x.id === id; });
    if (it) it.statut = statut;
    A.paint(host);
    try { A.updateTabBadge(); } catch (e) {}
  };

  // Correction simple du rattachement : plaque / n° d'avis / clé sinistre.
  A.openCorrect = function (host, id) {
    var it = (A._items || []).find(function (x) { return x.id === id; }); if (!it) return;
    var ref = it.dossier_ref || {};
    var cur = A.refSummary(ref);
    var saisie = (window.prompt
      ? window.prompt('Corriger le rattachement (plaque, n° d’avis ou clé sinistre) pour :\n' + (it.objet || '') + '\n\nActuel : ' + cur, (ref.plaque || ref.numeroAvis || ref.sinistreKey || ''))
      : null);
    if (saisie == null) return;
    saisie = String(saisie).trim();
    var nref = Object.assign({}, ref);
    if (/^\d[\d\s]{6,}$/.test(saisie)) nref.numeroAvis = saisie.replace(/\s/g, '');
    else if (/^[A-Za-z0-9-]{2,}$/.test(saisie) && /[a-zA-Z]/.test(saisie) && /sin/i.test(saisie)) nref.sinistreKey = saisie;
    else nref.plaque = (FP.normImmat ? FP.normImmat(saisie) : saisie.toUpperCase());
    A.majStatut(id, 'corrige', { dossier_ref: nref }).then(function () {
      toast('Rattachement corrigé.'); if (it) it.dossier_ref = nref; A._after(host, id, 'corrige');
    }).catch(function (e) { err('Correction impossible : ' + (e.message || e)); });
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = A;
  else if (typeof window !== 'undefined') window.FP_AVERIFIER = A;
})();
