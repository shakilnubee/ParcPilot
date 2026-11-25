/* ============================================================================
 *  Parc Pilot — Écran « À vérifier » (automatisation Gmail → actions)
 * ============================================================================
 *  Liste les PROPOSITIONS d'action issues des mails (table gmail_a_verifier,
 *  lecture/MAJ par société via RLS). Le gestionnaire autorisé peut :
 *   - CONFIRMER  (statut → 'confirme' ; l'exécution de l'action sur le dossier
 *                 est faite par le parcours manuel — branchée en Phase 5),
 *   - CORRIGER   (ajuster le rattachement / l'action, statut → 'corrige'),
 *   - IGNORER    (statut → 'ignore').
 *  Aucune suppression : la traçabilité est conservée (un item change de statut).
 *
 *  Dormant tant que la table n'existe pas (prod) → message clair, pas d'erreur.
 *  Écritures via FP.supabase avec erreur VISIBLE (FP.notifyError) — jamais d'échec
 *  silencieux. Tout rendu de donnée externe est échappé (FP.esc).
 *
 *  cardHtml() est PUR (testable) ; render()/actions utilisent FP.supabase.
 * ========================================================================== */
(function () {
  'use strict';
  var A = {};
  function esc(s) { return (window.FP && FP.esc) ? FP.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function toast(m, t) { try { (FP.toast || function () {})(m, t); } catch (e) {} }
  function err(m) { try { (FP.notifyError || FP.toast || function () {})(m); } catch (e) {} }

  var DOMAINE_LABEL = { amende: '🅿️ Amende', maintenance: '🔧 Maintenance', sinistre: '💥 Sinistre', assurance: '🛡️ Assurance', relance: '📣 Relance', inconnu: '❓ À qualifier' };
  var ACTION_LABEL = {
    amende_payee: 'Marquer l’amende payée + justificatif',
    rdv_update: 'Mettre à jour le rendez-vous',
    sinistre_piece: 'Rattacher la pièce au dossier sinistre',
    a_verifier: 'À qualifier manuellement'
  };
  A.DOMAINE_LABEL = DOMAINE_LABEL; A.ACTION_LABEL = ACTION_LABEL;

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

  // Carte PURE (testable) d'un item de la file.
  A.cardHtml = function (it) {
    it = it || {};
    var ref = it.dossier_ref || {};
    var pieces = Array.isArray(it.pieces) ? it.pieces : [];
    var dom = DOMAINE_LABEL[it.domaine] || DOMAINE_LABEL.inconnu;
    var act = ACTION_LABEL[it.action] || esc(it.action || '—');
    var traite = it.statut && it.statut !== 'a_verifier';
    var statutBadge = traite ? '<span class="gav-statut gav-' + esc(it.statut) + '">' + esc(it.statut) + '</span>' : '';
    var piecesHtml = pieces.length
      ? '<div class="gav-pieces">' + pieces.map(function (p) { return '<span class="gav-piece">📎 ' + esc(p.filename || 'pièce') + '</span>'; }).join('') + '</div>'
      : '';
    var actions = traite ? '' :
      '<div class="gav-actions">'
      + '<button class="btn btn-dark text-xs gav-confirm" data-id="' + esc(it.id) + '" title="Valider et ouvrir la fiche pour finaliser (dépôt justificatif, MAJ du RDV, rattachement de pièce…)">✓ Confirmer</button>'
      + '<button class="btn btn-outline text-xs gav-correct" data-id="' + esc(it.id) + '" title="Corriger le rattachement / l’action">✎ Corriger</button>'
      + '<button class="btn btn-outline text-xs gav-ignore" data-id="' + esc(it.id) + '" title="Ignorer cette proposition">✕ Ignorer</button>'
      + '</div>';
    return '<div class="gav-card" data-id="' + esc(it.id) + '">'
      + '<div class="gav-head"><span class="gav-dom">' + dom + '</span>' + statutBadge
      + '<span class="gav-date">' + esc(A.fmtDate(it.recu_le || it.cree_le)) + '</span></div>'
      + '<div class="gav-from">' + esc(it.from_email || '—') + '</div>'
      + '<div class="gav-obj">' + esc(it.objet || '(sans objet)') + '</div>'
      + (it.extrait ? '<div class="gav-snip">' + esc(it.extrait) + '</div>' : '')
      + '<div class="gav-row"><b>Action :</b> ' + act + '</div>'
      + '<div class="gav-row"><b>Dossier proposé :</b> ' + esc(A.refSummary(ref)) + '</div>'
      + (it.motif_blocage ? '<div class="gav-motif">⚠️ ' + esc(it.motif_blocage) + '</div>' : '')
      + piecesHtml
      + actions
      + '</div>';
  };

  A.styleOnce = function () {
    if (document.getElementById('gav-style')) return;
    var s = document.createElement('style'); s.id = 'gav-style';
    s.textContent = [
      '.gav-wrap{display:flex;flex-direction:column;gap:12px}',
      '.gav-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}',
      '.gav-card{border:1px solid var(--fp-border,#E2E8F0);border-radius:12px;padding:12px 14px;background:#fff}',
      'body.fp-dark .gav-card{background:#0b1220;border-color:#243044}',
      '.gav-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px}',
      '.gav-dom{font-weight:800;font-size:.82rem}',
      '.gav-date{margin-left:auto;font-size:.72rem;color:var(--fp-muted,#64748B)}',
      '.gav-from{font-weight:700;font-size:.85rem;word-break:break-word}',
      '.gav-obj{font-size:.85rem;margin-top:1px;word-break:break-word}',
      '.gav-snip{font-size:.78rem;color:var(--fp-muted,#64748B);margin-top:5px;line-height:1.4}',
      '.gav-row{font-size:.8rem;margin-top:6px}',
      '.gav-motif{font-size:.78rem;color:#B45309;margin-top:6px}',
      '.gav-pieces{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}',
      '.gav-piece{font-size:.74rem;background:var(--fp-bg,#F1F5F9);border:1px solid var(--fp-border,#E2E8F0);border-radius:7px;padding:2px 7px}',
      '.gav-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}',
      '.gav-statut{font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.03em;border-radius:9999px;padding:1px 8px;background:#F1F5F9;color:#475569}',
      '.gav-confirme{background:#DCFCE7;color:#166534}.gav-ignore{background:#F1F5F9;color:#64748B}.gav-corrige{background:#FEF3C7;color:#78350F}.gav-applique{background:#DBEAFE;color:#1E3A8A}',
      '.gav-empty{text-align:center;color:var(--fp-muted,#64748B);font-size:.9rem;padding:26px 10px}'
    ].join('\n');
    document.head.appendChild(s);
  };

  A._state = 'a_verifier'; // filtre courant

  A.render = function (host) {
    if (!host) return;
    A.styleOnce();
    if (!(window.FP && FP.supabase)) { host.innerHTML = '<div class="gav-empty">Connexion indisponible.</div>'; return; }
    host.innerHTML = '<div class="gav-empty"><i data-lucide="loader" class="w-5 h-5 animate-spin" style="display:inline-block"></i><br>Chargement…</div>';
    try { window.lucide && lucide.createIcons && lucide.createIcons(); } catch (e) {}
    FP.supabase.from('gmail_a_verifier').select('*').order('cree_le', { ascending: false }).limit(200)
      .then(function (r) {
        if (r.error) {
          // Table absente (automatisation pas encore activée) → message doux, pas d'erreur rouge.
          var msg = /relation|does not exist|not exist|schema cache/i.test(String(r.error.message || ''))
            ? 'L’automatisation des mails n’est pas encore activée sur cette plateforme.'
            : 'Lecture impossible : ' + esc(r.error.message || '');
          host.innerHTML = '<div class="gav-empty">' + msg + '</div>'; return;
        }
        A._items = r.data || [];
        A.paint(host);
      });
  };

  A.paint = function (host) {
    var items = (A._items || []).filter(function (it) {
      return A._state === 'tous' ? true : (A._state === 'a_verifier' ? (!it.statut || it.statut === 'a_verifier') : it.statut === A._state);
    });
    var nA = (A._items || []).filter(function (it) { return !it.statut || it.statut === 'a_verifier'; }).length;
    var bar = '<div class="gav-bar">'
      + '<span style="font-weight:800;color:var(--fp-primary)">📨 À vérifier (mails)</span>'
      + '<span class="gav-statut" style="background:#FEE2E2;color:#B91C1C">' + nA + ' en attente</span>'
      + '<select id="gav-filter" class="text-sm border border-slate-200 rounded-lg px-2 py-1" style="margin-left:auto">'
      + ['a_verifier|À vérifier', 'tous|Tous', 'confirme|Confirmés', 'corrige|Corrigés', 'ignore|Ignorés', 'applique|Appliqués']
          .map(function (o) { var p = o.split('|'); return '<option value="' + p[0] + '"' + (p[0] === A._state ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('')
      + '</select></div>';
    var body = items.length ? items.map(A.cardHtml).join('') :
      '<div class="gav-empty">Rien ' + (A._state === 'a_verifier' ? 'à vérifier' : 'dans cette vue') + ' pour le moment.<br><span style="font-size:.78rem">Les mails de flotte détectés apparaîtront ici (lecture seule tant que la simulation n’est pas validée).</span></div>';
    host.innerHTML = '<div class="card p-5"><div class="gav-wrap">' + bar + body + '</div></div>';
    try { window.lucide && lucide.createIcons && lucide.createIcons(); } catch (e) {}
    var f = document.getElementById('gav-filter');
    if (f) f.addEventListener('change', function () { A._state = f.value; A.paint(host); });
    A.wire(host);
  };

  // MAJ du statut d'un item (durable, erreur visible).
  A.majStatut = function (id, statut, patch) {
    var row = Object.assign({ statut: statut, traite_le: new Date().toISOString() }, patch || {});
    try { var u = (FP.profile && FP.profile.id) || null; if (u) row.traite_par = u; } catch (e) {}
    return FP.supabase.from('gmail_a_verifier').update(row).eq('id', id)
      .then(function (r) { if (r.error) throw new Error(r.error.message || 'écriture refusée'); return true; });
  };

  // Lien (pur) vers le parcours manuel pré-ciblé selon le domaine/référence de la proposition.
  // Relatif à pages/ (l'écran vit dans notifications.html).
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

  // Confirmer = enregistrer la validation PUIS ouvrir la fiche pré-ciblée pour FINALISER via le
  // parcours manuel existant (dépôt justificatif + « payée », MAJ du RDV, rattachement de pièce…).
  // On NE devine NI date NI montant : c'est l'humain qui finalise dans l'écran habituel.
  A.confirmer = function (host, id) {
    var it = (A._items || []).find(function (x) { return x.id === id; }); if (!it) return;
    var lien = A.lienDossier(it);
    A.majStatut(id, 'confirme').then(function () {
      toast(lien ? 'Confirmé — ouverture de la fiche pour finaliser.' : 'Confirmé.');
      A._after(host, id, 'confirme');
      if (lien) { try { window.open(lien, '_blank'); } catch (e) { try { location.href = lien; } catch (_) {} } }
    }).catch(function (e) { err('Impossible de confirmer : ' + (e.message || e)); });
  };

  A.wire = function (host) {
    host.querySelectorAll('.gav-confirm').forEach(function (b) {
      b.addEventListener('click', function () { A.confirmer(host, b.dataset.id); });
    });
    host.querySelectorAll('.gav-ignore').forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true;
        A.majStatut(b.dataset.id, 'ignore').then(function () {
          toast('Proposition ignorée.'); A._after(host, b.dataset.id, 'ignore');
        }).catch(function (e) { b.disabled = false; err('Impossible d’ignorer : ' + (e.message || e)); });
      });
    });
    host.querySelectorAll('.gav-correct').forEach(function (b) {
      b.addEventListener('click', function () { A.openCorrect(host, b.dataset.id); });
    });
  };

  // Mise à jour locale après action (évite un rechargement complet).
  A._after = function (host, id, statut) {
    var it = (A._items || []).find(function (x) { return x.id === id; });
    if (it) it.statut = statut;
    A.paint(host);
  };

  // Correction simple du rattachement : plaque / n° d'avis / clé sinistre + action.
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
