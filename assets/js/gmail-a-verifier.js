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
      + (traite ? '<span class="gav-statut gav-' + esc(it.statut) + '">' + esc(it.statut) + '</span>' : '')
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
    var piecesHtml = pieces.length
      ? '<div class="gav-d-pieces">' + pieces.map(function (p, i) {
          return '<button type="button" class="gav-piece" data-piece="' + i + '" title="Ouvrir le PDF en grand dans Parc Pilot">📎 ' + esc(p.filename || ('pièce ' + (i + 1))) + '</button>';
        }).join('') + '</div>'
      : '<div class="gav-d-nopj">Aucune pièce jointe PDF.</div>';
    var actions = traite
      ? '<div class="gav-d-done">✓ Déjà traité (' + esc(it.statut) + ')</div>'
      : '<div class="gav-d-actions">'
        + '<button type="button" class="btn btn-dark gav-go" data-id="' + esc(it.id) + '">' + esc(A.actionBtnLabel(it)) + '</button>'
        + '<button type="button" class="btn btn-outline gav-correct" data-id="' + esc(it.id) + '">✎ Corriger le rattachement</button>'
        + '<button type="button" class="btn btn-outline gav-ignore" data-id="' + esc(it.id) + '">✕ Ignorer</button>'
        + '</div>';
    return '<button type="button" class="gav-d-back">← Liste</button>'
      + '<div class="gav-d-head"><span class="gav-dom">' + dom + '</span>'
      + (traite ? '<span class="gav-statut gav-' + esc(it.statut) + '">' + esc(it.statut) + '</span>' : '')
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
      '.gav-list{display:flex;flex-direction:column;gap:8px;max-height:70vh;overflow:auto;padding-right:2px}',
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
      '.gav-d-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}',
      '.gav-d-actions .btn{font-size:.82rem}',
      '.gav-d-done{margin-top:14px;font-weight:700;color:#166534}',
      '.gav-statut{font-size:.66rem;font-weight:800;text-transform:uppercase;letter-spacing:.03em;border-radius:9999px;padding:1px 8px;background:#F1F5F9;color:#475569}',
      '.gav-confirme{background:#DCFCE7;color:#166534}.gav-applique{background:#DBEAFE;color:#1E3A8A}.gav-ignore{background:#F1F5F9;color:#64748B}.gav-corrige{background:#FEF3C7;color:#78350F}',
      '.gav-empty{text-align:center;color:var(--fp-muted,#64748B);font-size:.9rem;padding:26px 10px}',
      /* Lecteur PDF plein écran (natif, comme le scanner) */
      '.gav-pdf{position:fixed;inset:0;z-index:90;background:rgba(2,6,23,.72);display:flex;align-items:center;justify-content:center;padding:18px;padding-bottom:max(18px,env(safe-area-inset-bottom))}',
      '.gav-pdf-card{width:100%;max-width:980px;height:90vh;background:#fff;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 30px 80px -20px rgba(2,6,23,.6)}',
      'body.fp-dark .gav-pdf-card{background:#0b1220}',
      '.gav-pdf-head{display:flex;align-items:center;gap:10px;padding:10px 14px;background:linear-gradient(135deg,var(--fp-primary,#2563EB),var(--fp-primary-2,#1e40af));color:#fff}',
      '.gav-pdf-head .t{font-weight:700;font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}',
      '.gav-pdf-head button{background:rgba(255,255,255,.92);border:none;border-radius:8px;padding:5px 9px;cursor:pointer;font-size:.8rem;font-weight:700}',
      '.gav-pdf-stage{flex:1;min-height:0;background:#334155;position:relative}',
      '.gav-pdf-stage iframe{width:100%;height:100%;border:0;background:#fff}',
      '.gav-pdf-stage .gav-pdf-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:.9rem}',
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
    FP.supabase.from('gmail_a_verifier').select('*').order('cree_le', { ascending: false }).limit(300)
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

  A._filtered = function () {
    return (A._items || []).filter(function (it) {
      return A._state === 'tous' ? true : (A._state === 'a_verifier' ? (!it.statut || it.statut === 'a_verifier') : it.statut === A._state);
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
      + ['a_verifier|À vérifier', 'tous|Tous', 'confirme|Confirmés', 'applique|Enregistrés', 'corrige|Corrigés', 'ignore|Ignorés']
          .map(function (o) { var p = o.split('|'); return '<option value="' + p[0] + '"' + (p[0] === A._state ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('')
      + '</select></div>';
    var sel = items.filter(function (x) { return x.id === A._selId; })[0] || null;
    var list = items.length
      ? items.map(function (it) { return A.listItemHtml(it, A._selId); }).join('')
      : '<div class="gav-empty">Rien ' + (A._state === 'a_verifier' ? 'à vérifier' : 'dans cette vue') + ' pour le moment.<br><span style="font-size:.78rem">Les mails de flotte détectés apparaîtront ici.</span></div>';
    var md = '<div class="gav-md' + (A._showDetail ? ' show-detail' : '') + '">'
      + '<div class="gav-list">' + list + '</div>'
      + '<div class="gav-detail">' + A.detailHtml(sel) + '</div></div>';
    host.innerHTML = '<div class="card p-5"><div class="gav-wrap">' + bar + md + '</div></div>';
    try { window.lucide && lucide.createIcons && lucide.createIcons(); } catch (e) {}
    A.wire(host);
    try { A.updateTabBadge(); } catch (e) {}
  };

  A.wire = function (host) {
    var f = document.getElementById('gav-filter');
    if (f) f.addEventListener('change', function () { A._state = f.value; A._selId = null; A._showDetail = false; A.paint(host); });
    host.querySelectorAll('.gav-item').forEach(function (b) {
      b.addEventListener('click', function () { A._selId = b.dataset.id; A._showDetail = true; A.paint(host); });
    });
    var back = host.querySelector('.gav-d-back');
    if (back) back.addEventListener('click', function () { A._showDetail = false; A.paint(host); });
    var sel = (A._items || []).filter(function (x) { return x.id === A._selId; })[0] || null;
    host.querySelectorAll('.gav-piece').forEach(function (b) {
      b.addEventListener('click', function () { if (sel) A.openPdf(sel, Number(b.dataset.piece) || 0); });
    });
    var go = host.querySelector('.gav-go'); if (go) go.addEventListener('click', function () { if (sel) A.action(host, sel); });
    var co = host.querySelector('.gav-correct'); if (co) co.addEventListener('click', function () { if (sel) A.openCorrect(host, sel.id); });
    var ig = host.querySelector('.gav-ignore'); if (ig) ig.addEventListener('click', function () {
      if (!sel) return; ig.disabled = true;
      A.majStatut(sel.id, 'ignore').then(function () { toast('Proposition ignorée.'); A._after(host, sel.id, 'ignore'); })
        .catch(function (e) { ig.disabled = false; err('Impossible d’ignorer : ' + (e.message || e)); });
    });
  };

  A.societeDe = function (it) { return (it && it.societe) || (window.FP && FP.societe) || null; };

  // --- Ouverture du PDF EN GRAND (lecteur natif du navigateur, + plein écran) ---
  A.openPdf = function (it, idx) {
    var pieces = Array.isArray(it.pieces) ? it.pieces : [];
    var p = pieces[idx]; if (!p || !it.message_id || !p.attachmentId) { err('Pièce jointe indisponible.'); return; }
    var ov = document.createElement('div'); ov.className = 'gav-pdf'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = '<div class="gav-pdf-card">'
      + '<div class="gav-pdf-head"><span class="t">' + esc(p.filename || 'Document') + '</span>'
      + '<button type="button" class="gav-pdf-fs">⛶ Plein écran</button>'
      + '<button type="button" class="gav-pdf-x" aria-label="Fermer">✕</button></div>'
      + '<div class="gav-pdf-stage"><div class="gav-pdf-load">Chargement du PDF…</div></div></div>';
    document.body.appendChild(ov);
    var stage = ov.querySelector('.gav-pdf-stage');
    var close = function () { try { if (ov._url) URL.revokeObjectURL(ov._url); } catch (e) {} try { ov.remove(); } catch (e) {} };
    ov.querySelector('.gav-pdf-x').addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.gav-pdf-fs').addEventListener('click', function () { try { (ov.querySelector('.gav-pdf-card')).requestFullscreen(); } catch (e) {} });
    FP.supabase.functions.invoke('gmail-read', { body: { action: 'attachment', messageId: it.message_id, attachmentId: p.attachmentId, societe: A.societeDe(it) } })
      .then(function (r) {
        var d = r && r.data; if (!d || !d.ok || !d.dataB64) throw new Error((d && d.error) || (r && r.error && r.error.message) || 'PDF indisponible');
        var bin = atob(d.dataB64); var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var blob = new Blob([bytes], { type: d.mimeType || 'application/pdf' });
        var url = URL.createObjectURL(blob); ov._url = url;
        stage.innerHTML = '<iframe src="' + url + '#view=FitH" title="' + esc(p.filename || 'PDF') + '"></iframe>';
      })
      .catch(function (e) { stage.innerHTML = '<div class="gav-pdf-load">Impossible d’ouvrir le PDF : ' + esc(e.message || e) + '</div>'; });
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
    var pj = pieces.filter(function (p) { return p && p.attachmentId; })[0];
    if (!pj || !it.message_id) { err('Aucun PDF joint à cette facture — impossible d’ouvrir le formulaire.'); return; }
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
