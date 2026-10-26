/* fleet-views.js — Vues Total Fleet + Ulys EXTRAITES de factures.html, affichées NATIVEMENT
   sur la page Factures ET sur Contrôle (plus d'iframe). Un seul code source. Chargé APRÈS app.js.
   FP.mountUlys(container) / FP.mountTotal(container) : injectent markup + moteur + CSS. */
(function(){
  if(!window.FP) window.FP={};
  var FP=window.FP;
  var $=function(id){return document.getElementById(id);};
  var isUlys=function(f){try{return FP.estUlys?FP.estUlys(f):(String(f&&f.type||'').toLowerCase()==='ulys'||/\bulys\b/i.test(String(f&&f.fournisseur||'')));}catch(e){return false;}};
  var isTotalFleet=function(f){try{return FP.estTotalFleet?FP.estTotalFleet(f):false;}catch(e){return false;}};
  var JSZIP_CDN='https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  function loadScript(s){ return FP.ocr.loadScript(s); }
  async function loadPdf(file){ await FP.ocr.loadScript(FP.ocr.PDFJS_CDN); window.pdfjsLib.GlobalWorkerOptions.workerSrc=FP.ocr.PDFJS_WORKER; var buf=await file.arrayBuffer(); return window.pdfjsLib.getDocument({data:buf}).promise; }
  function parseEuro(s){ if(!s) return null; s=s.replace(/[^\d.,]/g,''); if(s.includes(',')&&s.includes('.')) s=s.replace(/\./g,'').replace(',','.'); else if(s.includes(',')) s=s.replace(',','.'); var v=parseFloat(s); return isNaN(v)?null:v; }
  var FL_CSS="  .fa-spin { display: inline-block; width: 14px; height: 14px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: fa-spin .7s linear infinite; }\n  @keyframes fa-spin { to { transform: rotate(360deg); } }\n        .tfview-toggle{display:inline-flex;border:1px solid var(--fp-border);border-radius:9px;overflow:hidden}\n        .tfview-toggle button{padding:6px 11px;font-size:.8rem;font-weight:700;background:#fff;border:none;color:var(--fp-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px}\n        .tfview-toggle button.active{background:var(--fp-primary);color:#fff}\n        .tf-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:14px}\n        .tf-cards.hidden{display:none}  /* sinon .tf-cards (chargé après Tailwind) écrase .hidden → cartes + tableau visibles ensemble */\n        .tf-ccard{background:#fff;border:1px solid var(--fp-border);border-radius:14px;box-shadow:0 1px 2px rgba(15,30,61,.05),0 8px 24px -18px rgba(15,30,61,.25);padding:15px 16px;display:flex;flex-direction:column;gap:11px}\n        .tf-ccard .top{display:flex;align-items:center;justify-content:space-between;gap:10px}\n        .tf-ccard .nm{font-weight:800;color:var(--fp-primary)}\n        .tf-ccard .tot{font-size:1.28rem;font-weight:800;color:var(--fp-primary);white-space:nowrap}\n        .tf-splbar{display:flex;height:8px;border-radius:5px;overflow:hidden;background:var(--fp-border)}\n        .tf-splbar i{display:block;height:100%}\n        .tf-brk{display:flex;flex-direction:column;gap:5px;font-size:.8rem}\n        .tf-brk .r{display:flex;align-items:center;justify-content:space-between;gap:8px}\n        .tf-brk .r .k{display:inline-flex;align-items:center;gap:6px;color:var(--fp-muted)}\n        .tf-brk .r .k::before{content:\"\";width:9px;height:9px;border-radius:2px;background:var(--d,#64748B)}\n        .tf-ccard .foot{display:flex;gap:14px;border-top:1px solid var(--fp-border);padding-top:9px;font-size:.72rem;color:var(--fp-muted)}\n        .tf-ccard .foot b{display:block;font-size:.92rem;color:var(--fp-primary);font-weight:800}\n\n.chart-wrap-sm{position:relative;height:240px}\n.tf-anom-hidden{display:none}\n/* Mode sombre (module rendu nativement sur Contrôle) */\nbody.fp-dark .tf-ccard{background:#1e293b;border-color:#334155}\nbody.fp-dark .tf-ccard .nm,body.fp-dark .tf-ccard .tot,body.fp-dark .tf-ccard .foot b{color:#e6edf6}\nbody.fp-dark .tfview-toggle button{background:#1e293b;color:#cbd5e1}\nbody.fp-dark .tfview-toggle button.active{background:var(--fp-primary);color:#fff}";
  function injectCss(){if(document.getElementById('fleet-views-css'))return;try{var st=document.createElement('style');st.id='fleet-views-css';st.textContent=FL_CSS;(document.head||document.documentElement).appendChild(st);}catch(e){}}
  var ULYS_MARKUP="    <div id=\"view-ulys\">\n      <!-- Import (visible partout, y compris intégré dans Contrôle) — accepte un OU plusieurs PDF -->\n      <div class=\"flex flex-wrap items-center gap-2 mb-4\">\n        <button type=\"button\" id=\"uls-import-btn\" class=\"btn btn-dark text-sm\"><i data-lucide=\"file-up\" class=\"w-4 h-4\"></i> Importer un relevé Ulys <span class=\"text-xs font-normal opacity-80\">(PDF ou CSV — un ou plusieurs)</span></button>\n      </div>\n      <!-- KPIs -->\n      <div class=\"grid grid-cols-2 md:grid-cols-4 gap-4 mb-6\">\n        <div class=\"kpi\"><div class=\"kpi-label\">Total péages (TTC)</div><div class=\"kpi-value\" id=\"uls-kpi-ttc\">—</div><div class=\"kpi-delta\" id=\"uls-kpi-sub\">—</div></div>\n        <div class=\"kpi\"><div class=\"kpi-label\">Total HT</div><div class=\"kpi-value\" id=\"uls-kpi-ht\">—</div><div class=\"kpi-delta\">hors taxe</div></div>\n        <div class=\"kpi\"><div class=\"kpi-label\">TVA</div><div class=\"kpi-value\" id=\"uls-kpi-tva\">—</div><div class=\"kpi-delta\">récupérable</div></div>\n        <div class=\"kpi\"><div class=\"kpi-label\">Nb factures</div><div class=\"kpi-value\" id=\"uls-kpi-count\">—</div><div class=\"kpi-delta\">filtre actif</div></div>\n      </div>\n\n      <!-- Consommation par conducteur (péages par badge) — filtres + exports CÔTE À CÔTE -->\n      <div class=\"flex flex-wrap items-center justify-between gap-3 mt-2 mb-3\">\n        <h3 class=\"text-lg font-extrabold\" style=\"color: var(--fp-primary)\">Consommation par conducteur</h3>\n        <div class=\"flex flex-wrap items-center gap-2\">\n          <select id=\"uls-conso-mois\" class=\"text-sm border border-slate-200 rounded-lg px-3 py-2\"></select>\n          <span class=\"text-xs text-slate-400\">ou période :</span>\n          <input type=\"date\" id=\"uls-conso-from\" class=\"text-sm border border-slate-200 rounded-lg px-2 py-2\" title=\"Du\" />\n          <span class=\"text-xs text-slate-400\">→</span>\n          <input type=\"date\" id=\"uls-conso-to\" class=\"text-sm border border-slate-200 rounded-lg px-2 py-2\" title=\"Au\" />\n          <button id=\"uls-conso-clear\" type=\"button\" class=\"hidden text-xs text-slate-500 underline\">effacer</button>\n          <span class=\"w-px h-6 bg-slate-200 mx-1\"></span>\n          <span class=\"tfview-toggle\" id=\"uls-conso-view\" title=\"Changer l'affichage\">\n            <button type=\"button\" data-v=\"table\"><i data-lucide=\"table\" class=\"w-4 h-4\"></i> Tableau</button>\n            <button type=\"button\" data-v=\"cards\"><i data-lucide=\"layout-grid\" class=\"w-4 h-4\"></i> Cartes</button>\n          </span>\n          <span class=\"w-px h-6 bg-slate-200 mx-1\"></span>\n          <button id=\"uls-an-csv\" type=\"button\" class=\"btn btn-outline text-xs\" title=\"Exporter la conso de la période choisie en CSV\"><i data-lucide=\"file-down\" class=\"w-3.5 h-3.5\"></i> Export CSV</button>\n          <button id=\"uls-an-pdf\" type=\"button\" class=\"btn btn-dark text-xs\" title=\"Relevé PDF de la période choisie\"><i data-lucide=\"file-text\" class=\"w-3.5 h-3.5\"></i> Relevé PDF</button>\n        </div>\n      </div>\n      <div class=\"card overflow-hidden mb-2\">\n        <div class=\"scrollable\">\n          <table class=\"fp-table\" id=\"uls-conso-table\">\n            <thead><tr><th>Conducteur</th><th style=\"text-align:right\">Trajets</th><th style=\"text-align:right\">Km</th><th style=\"text-align:right\">Total TTC</th></tr></thead>\n            <tbody id=\"uls-conso-tbody\"></tbody>\n            <tfoot id=\"uls-conso-tfoot\"></tfoot>\n          </table>\n        </div>\n        <div id=\"uls-conso-empty\" class=\"hidden p-10 text-center\"><p class=\"text-slate-500 text-sm\" id=\"uls-conso-empty-msg\">Aucun détail de consommation pour ce mois.</p></div>\n      </div>\n      <div id=\"uls-conso-cards\" class=\"tf-cards mb-6 hidden\"></div>\n      <p class=\"text-xs text-slate-500 mb-6\">Détail des péages par conducteur (reconstitué depuis les factures Ulys, par badge).</p>\n\n      <!-- Filtres -->\n      <div class=\"card p-4 mb-6\">\n        <div class=\"flex flex-wrap items-center gap-3\">\n          <div class=\"relative flex-1 min-w-[220px]\">\n            <i data-lucide=\"search\" class=\"w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400\"></i>\n            <input id=\"uls-search\" type=\"text\" placeholder=\"N° facture, description…\" class=\"w-full pl-10 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-teal-500\" />\n          </div>\n          <select id=\"uls-filter-annee\" class=\"text-sm border border-slate-200 rounded-lg px-3 py-2\"><option value=\"all\">Toutes les années</option></select>\n        </div>\n      </div>\n\n      <!-- Import facture Ulys : déclenché par le bouton « Importer un relevé Ulys » du HAUT de page\n           (plus de bouton en double ici). Le champ fichier + le statut/aperçu restent pour l'import. -->\n      <input type=\"file\" id=\"uls-import-file\" accept=\"application/pdf,.csv,text/csv\" multiple class=\"hidden\" />\n      <div id=\"uls-import-status\" class=\"hidden mb-3 text-xs leading-relaxed rounded-lg px-3 py-2\"></div>\n      <div id=\"uls-import-preview\" class=\"hidden mb-3\"></div>\n\n      <!-- Table -->\n      <div class=\"card overflow-hidden\">\n        <div class=\"scrollable\">\n          <table class=\"fp-table\" id=\"uls-table\">\n            <thead><tr><th>Date</th><th>N° facture</th><th>Désignation</th><th>Fournisseur</th><th style=\"text-align:right\">HT</th><th style=\"text-align:right\">TVA</th><th style=\"text-align:right\">TTC</th><th></th></tr></thead>\n            <tbody id=\"uls-tbody\"></tbody>\n          </table>\n        </div>\n        <div id=\"uls-empty\" class=\"hidden p-12 text-center\">\n          <i data-lucide=\"route\" class=\"w-12 h-12 mx-auto text-slate-300 mb-3\"></i>\n          <p class=\"text-slate-500 text-sm\">Aucune facture Ulys pour le moment.</p>\n          <p class=\"text-slate-400 text-xs mt-1\">Importe tes factures de péage Ulys — elles s'afficheront ici.</p>\n        </div>\n      </div>\n      <div id=\"uls-more\" class=\"mt-3 text-center\"></div>\n      <p class=\"text-xs text-slate-500 mt-4\">Factures <b>Ulys</b> (péages VINCI Autoroutes). Même présentation que Total Fleet.</p>\n    </div>\n";
  var TOTAL_MARKUP="    <div id=\"view-total\">\n      <!-- Import (visible partout, y compris intégré dans Contrôle) — accepte un OU plusieurs PDF / ZIP -->\n      <div class=\"flex flex-wrap items-center gap-2 mb-4\">\n        <button type=\"button\" id=\"tf-import-btn\" class=\"btn btn-dark text-sm\"><i data-lucide=\"file-up\" class=\"w-4 h-4\"></i> Importer un relevé Total <span class=\"text-xs font-normal opacity-80\">(un ou plusieurs / ZIP)</span></button>\n      </div>\n      <!-- Statut / aperçu d'import EN HAUT (bien visible dès qu'on importe) -->\n      <div id=\"tf-import-status\" class=\"hidden mb-3 text-xs leading-relaxed rounded-lg px-3 py-2\"></div>\n      <div id=\"tf-import-preview\" class=\"hidden mb-4\"></div>\n      <!-- KPIs -->\n      <div class=\"grid grid-cols-2 md:grid-cols-4 gap-4 mb-6\">\n        <div class=\"kpi\"><div class=\"kpi-label\">Total dépensé (TTC)</div><div class=\"kpi-value\" id=\"tf-kpi-ttc\">—</div><div class=\"kpi-delta\" id=\"tf-kpi-sub\">—</div></div>\n        <div class=\"kpi\"><div class=\"kpi-label\">Total HT</div><div class=\"kpi-value\" id=\"tf-kpi-ht\">—</div><div class=\"kpi-delta\">hors taxe</div></div>\n        <div class=\"kpi\"><div class=\"kpi-label\">TVA</div><div class=\"kpi-value\" id=\"tf-kpi-tva\">—</div><div class=\"kpi-delta\">récupérable</div></div>\n        <div class=\"kpi\"><div class=\"kpi-label\">Nb factures</div><div class=\"kpi-value\" id=\"tf-kpi-count\">—</div><div class=\"kpi-delta\">filtre actif</div></div>\n      </div>\n      <!-- Consommation par conducteur / véhicule -->\n      <style>\n        .tfview-toggle{display:inline-flex;border:1px solid var(--fp-border);border-radius:9px;overflow:hidden}\n        .tfview-toggle button{padding:6px 11px;font-size:.8rem;font-weight:700;background:#fff;border:none;color:var(--fp-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px}\n        .tfview-toggle button.active{background:var(--fp-primary);color:#fff}\n        .tf-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:14px}\n        .tf-cards.hidden{display:none}  /* sinon .tf-cards (chargé après Tailwind) écrase .hidden → cartes + tableau visibles ensemble */\n        .tf-ccard{background:#fff;border:1px solid var(--fp-border);border-radius:14px;box-shadow:0 1px 2px rgba(15,30,61,.05),0 8px 24px -18px rgba(15,30,61,.25);padding:15px 16px;display:flex;flex-direction:column;gap:11px}\n        .tf-ccard .top{display:flex;align-items:center;justify-content:space-between;gap:10px}\n        .tf-ccard .nm{font-weight:800;color:var(--fp-primary)}\n        .tf-ccard .tot{font-size:1.28rem;font-weight:800;color:var(--fp-primary);white-space:nowrap}\n        .tf-splbar{display:flex;height:8px;border-radius:5px;overflow:hidden;background:var(--fp-border)}\n        .tf-splbar i{display:block;height:100%}\n        .tf-brk{display:flex;flex-direction:column;gap:5px;font-size:.8rem}\n        .tf-brk .r{display:flex;align-items:center;justify-content:space-between;gap:8px}\n        .tf-brk .r .k{display:inline-flex;align-items:center;gap:6px;color:var(--fp-muted)}\n        .tf-brk .r .k::before{content:\"\";width:9px;height:9px;border-radius:2px;background:var(--d,#64748B)}\n        .tf-ccard .foot{display:flex;gap:14px;border-top:1px solid var(--fp-border);padding-top:9px;font-size:.72rem;color:var(--fp-muted)}\n        .tf-ccard .foot b{display:block;font-size:.92rem;color:var(--fp-primary);font-weight:800}\n      </style>\n      <div class=\"flex flex-wrap items-center justify-between gap-3 mt-10 mb-3\">\n        <h3 class=\"text-lg font-extrabold\" style=\"color: var(--fp-primary)\">Consommation par conducteur / véhicule</h3>\n        <div class=\"flex flex-wrap items-center gap-2\">\n          <select id=\"tf-conso-cond\" class=\"text-sm border border-slate-200 rounded-lg px-3 py-2\" title=\"Filtrer un conducteur\"><option value=\"\">Tous les conducteurs</option></select>\n          <select id=\"tf-conso-mois\" class=\"text-sm border border-slate-200 rounded-lg px-3 py-2\"></select>\n          <span class=\"text-xs text-slate-400\">ou période :</span>\n          <input type=\"date\" id=\"tf-conso-from\" class=\"text-sm border border-slate-200 rounded-lg px-2 py-2\" title=\"Du\" />\n          <span class=\"text-xs text-slate-400\">→</span>\n          <input type=\"date\" id=\"tf-conso-to\" class=\"text-sm border border-slate-200 rounded-lg px-2 py-2\" title=\"Au\" />\n          <button id=\"tf-conso-clear\" type=\"button\" class=\"hidden text-xs text-slate-500 underline\">effacer</button>\n          <span class=\"w-px h-6 bg-slate-200 mx-1\"></span>\n          <span class=\"tfview-toggle\" id=\"tf-conso-view\" title=\"Changer l'affichage\">\n            <button type=\"button\" data-v=\"table\"><i data-lucide=\"table\" class=\"w-4 h-4\"></i> Tableau</button>\n            <button type=\"button\" data-v=\"cards\"><i data-lucide=\"layout-grid\" class=\"w-4 h-4\"></i> Cartes</button>\n          </span>\n          <span class=\"w-px h-6 bg-slate-200 mx-1\"></span>\n          <button id=\"tf-an-csv\" type=\"button\" class=\"btn btn-outline text-xs\" title=\"Exporter la conso de la période choisie en CSV\"><i data-lucide=\"file-down\" class=\"w-3.5 h-3.5\"></i> Export CSV</button>\n          <button id=\"tf-an-pdf\" type=\"button\" class=\"btn btn-dark text-xs\" title=\"Relevé PDF de la période choisie\"><i data-lucide=\"file-text\" class=\"w-3.5 h-3.5\"></i> Rapport PDF</button>\n        </div>\n      </div>\n      <div class=\"card overflow-hidden\">\n        <div class=\"scrollable\">\n          <table class=\"fp-table\" id=\"tf-conso-table\">\n            <thead><tr>\n              <th>Conducteur / Véhicule</th>\n              <th style=\"text-align:right\">Carburant</th><th style=\"text-align:right\">Litres</th>\n              <th style=\"text-align:right\">Boutique / Repas</th><th style=\"text-align:right\">Lavage</th>\n              <th style=\"text-align:right\">Péage / Parking</th><th style=\"text-align:right\">Autres</th>\n              <th style=\"text-align:right\">HT</th><th style=\"text-align:right\">TVA</th><th style=\"text-align:right\">Total TTC</th>\n            </tr></thead>\n            <tbody id=\"tf-conso-tbody\"></tbody>\n            <tfoot id=\"tf-conso-tfoot\"></tfoot>\n          </table>\n        </div>\n        <div id=\"tf-conso-empty\" class=\"hidden p-10 text-center\">\n          <p class=\"text-slate-500 text-sm\" id=\"tf-conso-empty-msg\">Aucun détail de consommation pour ce mois.</p>\n        </div>\n      </div>\n      <div id=\"tf-conso-cards\" class=\"tf-cards mt-2 hidden\"></div>\n      <p class=\"text-xs text-slate-500 mt-3\">Détail reconstitué depuis les factures TotalEnergies (par carte carburant). Les « Frais de gestion » ne sont pas rattachés à un conducteur. Clique sur l'en-tête « Total TTC » pour trier.</p>\n      <!-- Rapprochement : conducteurs des relevés (Total/Ulys) qui ne correspondent à aucune fiche → lier / créer -->\n      <div id=\"conso-rapproch\"></div>\n\n      <!-- ===== ANALYSE CONSO (prix/litre, CO₂, répartition, évolution, classement, anomalies) ===== -->\n      <div id=\"tf-analyse\" class=\"mt-10 hidden\">\n        <div class=\"mb-3\">\n          <h3 class=\"text-lg font-extrabold\" style=\"color: var(--fp-primary)\">Analyse de la consommation <span id=\"tf-an-period\" class=\"text-sm font-semibold text-slate-400\"></span></h3>\n        </div>\n        <!-- Chiffres clés enrichis -->\n        <div id=\"tf-an-stats\" class=\"grid grid-cols-2 md:grid-cols-4 gap-4 mb-5\"></div>\n        <div class=\"grid md:grid-cols-2 gap-5\">\n          <!-- Évolution 12 mois -->\n          <div class=\"card p-4\">\n            <div class=\"font-semibold text-slate-800 mb-3\">Évolution sur 12 mois</div>\n            <div id=\"tf-an-evol\"></div>\n          </div>\n          <!-- Répartition -->\n          <div class=\"card p-4\">\n            <div class=\"font-semibold text-slate-800 mb-3\">Répartition des dépenses</div>\n            <div id=\"tf-an-repart\"></div>\n          </div>\n        </div>\n        <div class=\"grid md:grid-cols-2 gap-5 mt-5\">\n          <!-- Classement conducteurs -->\n          <div class=\"card p-4\">\n            <div class=\"font-semibold text-slate-800 mb-3\">Classement conducteurs <span class=\"text-xs font-normal text-slate-400\">(dépense totale)</span></div>\n            <div id=\"tf-an-rank\"></div>\n          </div>\n          <!-- Anomalies -->\n          <div class=\"card p-4\">\n            <div class=\"font-semibold text-slate-800 mb-3 flex items-center justify-between gap-2\">\n              <span class=\"flex items-center gap-2\"><i data-lucide=\"alert-triangle\" class=\"w-4 h-4 text-amber-500\"></i> Points à vérifier</span>\n              <span class=\"flex items-center gap-3\">\n                <button id=\"tf-seuils-btn\" type=\"button\" class=\"text-xs text-slate-400 hover:text-teal-600 flex items-center gap-1\" title=\"Régler les seuils d'alerte\"><i data-lucide=\"settings-2\" class=\"w-3.5 h-3.5\"></i> Seuils</button>\n              </span>\n            </div>\n            <div id=\"tf-seuils\" class=\"hidden mb-3 p-3 rounded-lg bg-slate-50 border border-slate-200 text-sm\">\n              <div class=\"font-medium text-slate-700 mb-2 text-xs uppercase tracking-wide\">Seuils d'alerte (carte carburant)</div>\n              <label class=\"flex items-center justify-between gap-3 mb-2\">\n                <span class=\"text-slate-600\">Repas / jour au-delà de</span>\n                <span class=\"flex items-center gap-1\"><input id=\"ts-repas\" type=\"number\" min=\"0\" step=\"1\" class=\"w-16 border border-slate-200 rounded px-2 py-1 text-right\"> €</span>\n              </label>\n              <label class=\"flex items-center justify-between gap-3 mb-1\">\n                <span class=\"text-slate-600\">Achat « Autres » listé au-delà de</span>\n                <span class=\"flex items-center gap-1\"><input id=\"ts-autre\" type=\"number\" min=\"0\" step=\"1\" class=\"w-16 border border-slate-200 rounded px-2 py-1 text-right\"> €</span>\n              </label>\n              <p class=\"text-[11px] text-slate-400 mb-2\">Défaut 20 € : seuls les achats « Autres » notables (bonbonne de gaz…) sont signalés. Mets 0 pour tout voir.</p>\n              <label class=\"flex items-center justify-between gap-3 mb-3\">\n                <span class=\"text-slate-600\">Boutique (hors carburant) / mois au-delà de</span>\n                <span class=\"flex items-center gap-1\"><input id=\"ts-horscarb\" type=\"number\" min=\"0\" step=\"1\" class=\"w-16 border border-slate-200 rounded px-2 py-1 text-right\"> €</span>\n              </label>\n              <div class=\"flex items-center justify-end gap-2\">\n                <button id=\"ts-reset\" type=\"button\" class=\"text-xs text-slate-500 hover:text-slate-700\">Valeurs par défaut</button>\n                <button id=\"ts-save\" type=\"button\" class=\"text-xs bg-teal-600 text-white rounded px-3 py-1.5 hover:bg-teal-700\">Enregistrer</button>\n              </div>\n            </div>\n            <div class=\"flex items-center gap-2 mb-2\">\n              <button id=\"tf-anom-tab-active\" type=\"button\" class=\"text-xs font-semibold px-2.5 py-1 rounded-full border border-teal-500 bg-teal-500 text-white\">À vérifier</button>\n              <button id=\"tf-anom-tab-arch\" type=\"button\" class=\"text-xs font-semibold px-2.5 py-1 rounded-full border border-slate-200 text-slate-500 hover:border-teal-400\">Archivées <span id=\"tf-anom-arch-n\">(0)</span></button>\n            </div>\n            <div id=\"tf-an-anom\"></div>\n          </div>\n        </div>\n        <p class=\"text-xs text-slate-400 mt-3\">Les prix au litre, CO₂ et anomalies sont calculés sur les relevés mensuels par carte. La détection « plein par plein » (plein impossible, week-end, > 3 pleins/jour) nécessitera le relevé <b>transaction par transaction</b> — à activer plus tard.</p>\n      </div>\n\n      <!-- Filtres -->\n      <div class=\"card p-4 mb-6\">\n        <div class=\"flex flex-wrap items-center gap-3\">\n          <div class=\"relative flex-1 min-w-[220px]\">\n            <i data-lucide=\"search\" class=\"w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400\"></i>\n            <input id=\"tf-search\" type=\"text\" placeholder=\"N° facture, pays, description…\" class=\"w-full pl-10 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-teal-500\" />\n          </div>\n          <select id=\"tf-filter-annee\" class=\"text-sm border border-slate-200 rounded-lg px-3 py-2\"><option value=\"all\">Toutes les années</option></select>\n        </div>\n      </div>\n\n      <!-- Import d'un relevé Total : déclenché par le bouton « Importer un relevé Total » du HAUT de page\n           (plus de bouton en double ici). Le champ fichier + le statut/aperçu restent pour l'import. -->\n      <input type=\"file\" id=\"tf-import-file\" accept=\"application/pdf,application/zip,application/x-zip-compressed,.zip\" multiple class=\"hidden\" />\n\n      <!-- Table -->\n      <div class=\"card overflow-hidden\">\n        <div class=\"scrollable\">\n          <table class=\"fp-table\" id=\"tf-table\">\n            <thead><tr><th>Date</th><th>N° facture</th><th>Désignation</th><th>Fournisseur</th><th style=\"text-align:right\">HT</th><th style=\"text-align:right\">TVA</th><th style=\"text-align:right\">TTC</th><th></th></tr></thead>\n            <tbody id=\"tf-tbody\"></tbody>\n          </table>\n        </div>\n        <div id=\"tf-empty\" class=\"hidden p-12 text-center\">\n          <i data-lucide=\"fuel\" class=\"w-12 h-12 mx-auto text-slate-300 mb-3\"></i>\n          <p class=\"text-slate-500 text-sm\">Aucune facture Total Fleet pour le moment.</p>\n          <p class=\"text-slate-400 text-xs mt-1\">Dépose tes relevés Total (carburant, péages) — ils s'afficheront ici.</p>\n        </div>\n      </div>\n      <div id=\"tf-more\" class=\"mt-3 text-center\"></div>\n      <p class=\"text-xs text-slate-500 mt-4\">Factures <b>TotalEnergies Fleet</b> (carburant, lavage, péages…). ⚠️ Le <b>relevé de factures</b> mensuel récapitule les factures par pays : on n'importe QUE les factures détaillées (France, Allemagne, Pays-Bas…), jamais le relevé, pour éviter de compter deux fois.</p>\n\n    </div>\n";
  FP.mountUlys=function(container){
    try{
      if(!container) return false;
      if(container.getAttribute('data-fl-ulys')==='1'){ try{ if(window.renderUlys) window.renderUlys(); }catch(e){} try{ if(FP.ulysRenderPanel){ var pp=container.querySelector('#ulys-api-panel'); if(pp) FP.ulysRenderPanel(pp); } }catch(e){} return true; }
      container.setAttribute('data-fl-ulys','1');
      injectCss(); container.innerHTML='<div id="ulys-api-panel"></div>'+ULYS_MARKUP;
      try{ if(FP.ulysRenderPanel) FP.ulysRenderPanel(container.querySelector('#ulys-api-panel')); }catch(e){}
      try{ if(window.lucide&&lucide.createIcons) lucide.createIcons(); }catch(e){}
  (function ulysTab(){
    const ust = { search: '', annee: 'all', expanded: false };
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    // Dé-doublonné par n° de facture (comme Total Fleet) → un n° = une seule ligne, KPI = total des
    // factures affichées, jamais compté deux fois même si la base contient un doublon d'un ancien import.
    const list = () => {
      const seen = new Set(), out = [];
      (window.FP_DATA.factures || []).filter(isUlys).forEach(f => {
        const k = (f.numeroFacture || f.id || '').toString().toUpperCase();
        if (k && seen.has(k)) return; if (k) seen.add(k); out.push(f);
      });
      return out;
    };

    function render(){
      const all = list();
      const annees = [...new Set(all.map(f => (f.date || '').slice(0,4)).filter(Boolean))].sort().reverse();
      const sel = $('uls-filter-annee');
      if (sel && sel.dataset.filled !== annees.join(',')) {
        sel.innerHTML = '<option value="all">Toutes les années</option>' + annees.map(a => `<option value="${a}">${a}</option>`).join('');
        sel.value = ust.annee; sel.dataset.filled = annees.join(',');
      }
      const q = FP.norm(ust.search).trim();
      const rows = all.filter(f => {
        if (ust.annee !== 'all' && (f.date || '').slice(0,4) !== ust.annee) return false;
        if (q && !FP.norm(`${f.numeroFacture||''} ${f.description||''} ${f.fournisseur||''}`).includes(q)) return false;
        return true;
      }).sort((a,b) => (b.date||'').localeCompare(a.date||''));

      const sum = (k) => rows.reduce((s,f) => s + (Number(f[k]) || 0), 0);
      $('uls-kpi-ttc').textContent   = FP.euro(sum('montantTTC'));
      $('uls-kpi-ht').textContent    = FP.euro(sum('montantHT'));
      $('uls-kpi-tva').textContent   = FP.euro(sum('montantTVA'));
      $('uls-kpi-count').textContent = rows.length;
      $('uls-kpi-sub').textContent   = ust.annee === 'all' ? 'toutes années' : ust.annee;

      const tbody = $('uls-tbody');
      $('uls-empty').classList.toggle('hidden', rows.length > 0);
      const LIMIT = 15;
      const visible = ust.expanded ? rows : rows.slice(0, LIMIT);
      tbody.innerHTML = visible.map(f => `<tr>
        <td style="white-space:nowrap">${f.date ? FP.date(f.date) : '—'}</td>
        <td style="font-family:monospace">${esc(f.numeroFacture || '—')}</td>
        <td>${esc(f.description || '—')}</td>
        <td>${esc(f.fournisseur || 'Ulys')}</td>
        <td style="text-align:right">${f.montantHT != null ? FP.euro(f.montantHT) : '—'}</td>
        <td style="text-align:right">${f.montantTVA != null ? FP.euro(f.montantTVA) : '—'}</td>
        <td style="text-align:right;font-weight:700">${f.montantTTC != null ? FP.euro(f.montantTTC) : '—'}</td>
        <td style="text-align:right;white-space:nowrap"><button type="button" class="btn btn-outline" style="padding:3px 10px;font-size:12px" data-uls-voir="${esc(f.id)}"><i data-lucide="eye" class="w-3 h-3"></i> Voir</button> <button type="button" class="btn btn-outline" style="padding:3px 8px;font-size:12px;color:#B91C1C;border-color:#FCA5A5" data-uls-del="${esc(f.id)}" title="Supprimer cette facture"><i data-lucide="trash-2" class="w-3 h-3"></i></button></td>
      </tr>`).join('');
      const more = $('uls-more');
      if (rows.length > LIMIT){
        more.innerHTML = `<button type="button" id="uls-more-btn" class="btn btn-outline text-sm">${ust.expanded ? 'Réduire' : `Voir tout (${rows.length})`}</button>`;
        $('uls-more-btn').addEventListener('click', () => { ust.expanded = !ust.expanded; render(); });
      } else { more.innerHTML = ''; }
      if (window.lucide) lucide.createIcons();
    }

    $('uls-search').addEventListener('input', (e) => { ust.search = e.target.value; render(); });
    $('uls-filter-annee').addEventListener('change', (e) => { ust.annee = e.target.value; render(); });
    // ===== Import auto des factures Ulys (PDF) : facture + détail par conducteur =====
    const MOIS_FR = { janvier:'01',fevrier:'02',mars:'03',avril:'04',mai:'05',juin:'06',juillet:'07',aout:'08',septembre:'09',octobre:'10',novembre:'11',decembre:'12' };
    const ulsNum  = (s) => parseFloat(String(s).replace(/[\s  ]/g,'').replace(',','.')) || 0;
    const ulsNorm = (s) => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
    const ulsSlug = (s) => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    function ulsKnownNames(){
      const set = new Set();
      const add = (str) => String(str||'').split(/[\s/]+/).forEach(tok => { if (tok.length>=3 && /^[A-ZÀ-Ý][a-zà-ÿ]/.test(tok)) set.add(tok); });
      (window.FP_DATA.conducteurs||[]).forEach(c => add(c.prenom||c.nom||c.label||c.conducteur||c.key));
      (window.FP_DATA.vehicules||[]).forEach(v => add(v.chauffeur));
      return set;
    }
    // Lecture Ulys = SOURCE UNIQUE FP.ulys (app.js), partagée avec le scanner unifié. On délègue.
    function parseUlys(text){ if (window.FP && FP.ulys && FP.ulys.parse) return FP.ulys.parse(text); return parseUlysLegacy(text); }
    function parseUlysLegacy(text){
      const t = text || '';
      const mNum = t.match(/Facture\s*n[°ºo]\s*([A-Z]{1,3}\d{6,})/i);
      const mEm  = t.match(/[ÉE]mise?\s*le\s*(\d{2})\/(\d{2})\/(\d{4})/i);
      const numero = mNum ? mNum[1] : null;
      const emise = mEm ? `${mEm[3]}-${mEm[2]}-${mEm[1]}` : '';
      let mois = '';
      const mPer = t.match(/Facture\s+(?:de|d['’])\s*([a-zA-ZéèûôA-ZÀ-Ý]+)\s*(\d{4})/);
      if (mPer){ const mm = MOIS_FR[ulsNorm(mPer[1])]; if (mm) mois = mPer[2] + '-' + mm; }
      if (!mois && emise){ const d = new Date(emise); d.setMonth(d.getMonth()-1); mois = d.toISOString().slice(0,7); }
      // Date de la facture = 1er jour de la PÉRIODE (ex. janvier = 2026-01-01), pas la date d'émission
      // (sinon la facture « de janvier » s'afficherait en février → confusion de mois).
      const date = mois ? (mois + '-01') : emise;
      // --- Montants (robuste & exact) -------------------------------------
      // Le vrai total est le « NET A PAYER TTC » imprimé avec le symbole € (ex. « 1 734,36 € »).
      // TVA française = 20 % : on repère dans le récap (1re page) le couple (base HT, TVA) présent
      //   où TVA = 20 % de la base — base MAXIMALE, avec base+TVA ≤ TTC. Robuste même si une part
      //   est à 0 % (péage étranger, frais de gestion). Puis HT = TTC − TVA.
      //   ⚠️ Avant : on sommait TOUS les nombres après « NET A PAYER » → TVA/HT aberrants (négatifs).
      let ht=null, tva=null, ttc=null;
      const toNums = (s) => (String(s||'').match(/\d[\d\s\u00a0\u202f\u2009]*,\d{2}/g)||[]).map(ulsNum);
      const afterNet = t.split(/NET\s*A\s*PAYER\s*TTC/i).slice(1).join(' ') || t;
      const mTtc = afterNet.match(/(\d[\d\s\u00a0\u202f\u2009]*,\d{2})\s*€/) || t.match(/(\d[\d\s\u00a0\u202f\u2009]*,\d{2})\s*€/);
      if (mTtc) ttc = ulsNum(mTtc[1]);
      const page1 = t.split(/Badge n[°ºo]/)[0];          // le récap TVA est sur la 1re page
      const p1nums = toNums(page1);
      if (ttc == null && p1nums.length) {
        // ⚠️ NE PAS prendre Math.max brut (piège « 1875 € » : une référence parasite ramassée par le
        // plus grand nombre). Repli sûr : on ne retient un TTC que s'il est COHÉRENT avec un couple
        // base/TVA à 20 % de la 1re page (base + TVA ≈ candidat). Le plus grand candidat cohérent
        // gagne ; si aucun triplet ne colle, ttc reste null → la facture est signalée illisible (skip)
        // plutôt que devinée (cf. règle CLAUDE.md « jamais un Math.max, jamais une somme parasite »).
        let cand = null;
        for (const c of p1nums) for (const b of p1nums) for (const tv of p1nums) {
          if (tv > 0 && Math.abs(b * 0.20 - tv) <= 0.02 && Math.abs(b + tv - c) <= 0.05) { if (cand == null || c > cand) cand = c; }
        }
        ttc = cand;
      }
      if (ttc != null){
        let best = null;
        for (const b of p1nums) for (const tv of p1nums){
          if (tv > 0 && Math.abs(b * 0.20 - tv) <= 0.02 && b + tv <= ttc + 0.05){ if (!best || b > best.b) best = { b, tv }; }
        }
        if (best){ tva = best.tv; ht = +(ttc - tva).toFixed(2); }
        else { ht = +(ttc / 1.2).toFixed(2); tva = +(ttc - ht).toFixed(2); }   // repli : tout à 20 %
      }
      // --- Détail par collaborateur (ancré sur le N° de BADGE) ------------
      // Texte reconstruit EN LIGNES par position (cf. ulysPdfToText) :
      //   « Badge n° <id> <Nom> »
      //   « Total Badge <id> <n> consommation(s) <ttc> € TTC <km> km »
      // On rattache le prénom à son total PAR NUMÉRO DE BADGE (fiable — l'ordre des prénoms ne
      // l'est PAS, colonnes inversées). Le « Total Contrat » (grand total) est ignoré (pas « Badge »).
      const badgeSuffix = (x) => String(x).replace(/\D/g,'').slice(-5);
      const nameByBadge = {};
      { const rx = /Badge\s*n[°ºo]\s+([\d ]+\d)\s+([A-Za-zÀ-ÿ][^\n]*?)\s*$/gim; let m;
        while ((m = rx.exec(t))){ const suf = badgeSuffix(m[1]); const nm = m[2].trim();
          if (suf && nm && !nameByBadge[suf]) nameByBadge[suf] = nm; } }
      const conso = [];
      { const rx = /Total\s+Badge\s+([\d ]+?\d)\s+(\d+)\s*consommation\(s\)\s*([\d  .,]+?)\s*€\s*TTC\s*([\d  .,]+?)\s*km/gi; let m;
        const seenB = new Set();
        while ((m = rx.exec(t))){
          const suf = badgeSuffix(m[1]); if (seenB.has(suf)) continue; seenB.add(suf);
          conso.push({ conducteur: nameByBadge[suf] || ('Badge ' + suf), nb: parseInt(m[2],10)||0, ttc: ulsNum(m[3]), km: ulsNum(m[4]) });
        }
      }
      return { numero, date, mois, ht, tva, ttc, conso };
    }

    let _ulsPending = null;
    // Reconstruit le texte du PDF Ulys EN LIGNES, en triant les fragments par POSITION (y puis x).
    // Indispensable : « Badge n° <id> <Nom> » et « Total Badge <id> … <ttc> € TTC <km> km » doivent
    // rester sur une seule ligne. La lecture standard (FP.ocr) colle les fragments dans le désordre
    // (colonnes entremêlées) → montants/prénoms illisibles. Repli sur FP.ocr si pas de couche texte.
    async function ulysPdfToText(file){
      if (window.FP && FP.ulys && FP.ulys.pdfToText) return FP.ulys.pdfToText(file);
      try {
        await FP.ocr.loadScript(FP.ocr.PDFJS_CDN);
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = FP.ocr.PDFJS_WORKER;
        const buf = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        let text = '';
        for (let pg=1; pg<=pdf.numPages; pg++){
          const page = await pdf.getPage(pg);
          const tc = await page.getTextContent();
          const items = tc.items
            .filter(i => i.str && i.str.trim() !== '')
            .map(i => ({ x: i.transform[4], y: i.transform[5], s: i.str.trim() }));
          items.sort((a,b) => (b.y - a.y) || (a.x - b.x));   // haut→bas (y décroissant), puis gauche→droite
          const lines = []; let cur = null;
          for (const it of items){
            if (!cur || Math.abs(it.y - cur.y) > 2){ cur = { y: it.y, parts: [it] }; lines.push(cur); }
            else cur.parts.push(it);
          }
          for (const ln of lines){ ln.parts.sort((a,b)=>a.x-b.x); text += ln.parts.map(p=>p.s).join(' ') + '\n'; }
          text += '\n';
        }
        return text;
      } catch(e){ console.warn('[ulysPdfToText]', e); return ''; }
    }
    function ulsImpStatus(html, kind){ const el=$('uls-import-status'); el.classList.remove('hidden'); el.innerHTML=html; el.style.background = kind==='ok'?'#ECFDF5':kind==='err'?'#FEF2F2':'#F1F5F9'; el.style.color = kind==='ok'?'#047857':kind==='err'?'#B91C1C':'#334155'; }
    function ulsImpReset(){ _ulsPending=null; $('uls-import-preview').classList.add('hidden'); $('uls-import-preview').innerHTML=''; $('uls-import-status').classList.add('hidden'); }
    // ===== IMPORT AUTOMATIQUE : relevé de consommations Ulys en CSV (export espace abonnés / API) =====
    // Format Ulys : Date;Heure;JourSemaine;NumeroBadge;Immatriculation;LibelleBadge;Affectation;Type;
    //   GareEntree;GareSortie;Classe;Km;TarifTTC;TarifHT;Etat;NumeroFacture;MoisFacture;TauxTva;… (séparateur « ; »).
    // On attribue chaque trajet au conducteur PAR N° DE BADGE (source fiable, jamais le prénom seul),
    // avec repli sur le prénom (LibelleBadge). Produit { fac, rows, tx } comme l'import PDF → même commit.
    const _ulsNum = (s) => { if (s == null) return 0; const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
    function _ulsNomBadge(badge, prenom){
      try { if (FP.conducteurParBadgeUlys){ const c = FP.conducteurParBadgeUlys(badge); if (c){
        const nm = (c.prenom && c.nom) ? (c.prenom + ' ' + c.nom) : (c.name || c.prenom || c.nom || ''); if (nm && nm.trim()) return nm.trim();
        if (c.key && FP.conducteurNomUnifie){ const u = FP.conducteurNomUnifie(c.key); if (u) return u; } } } } catch (e) {}
      try { if (FP.conducteurNomUnifie){ const u = FP.conducteurNomUnifie(prenom); if (u) return u; } } catch (e) {}
      return prenom || '—';
    }
    function parseUlysCsv(text){
      const linesR = String(text || '').split(/\r?\n/).filter(l => l.trim());
      if (linesR.length < 2) return { error: 'Fichier vide ou illisible.' };
      const sep = (linesR[0].indexOf(';') >= 0) ? ';' : ((linesR[0].indexOf('\t') >= 0) ? '\t' : ';');
      const Hh = linesR[0].split(sep).map(h => h.trim().replace(/^﻿/, ''));
      const ix = {}; Hh.forEach((h, i) => ix[h] = i);
      for (const k of ['Date', 'NumeroBadge', 'Km', 'TarifTTC', 'TarifHT', 'NumeroFacture']){ if (ix[k] == null) return { error: 'Ce CSV n\'est pas un relevé de consommations Ulys (colonne « ' + k + ' » absente).' }; }
      const txAll = [];
      for (let i = 1; i < linesR.length; i++){
        const c = linesR[i].split(sep); if (c.length < Hh.length) continue;
        const dfr = (c[ix.Date] || '').trim(); const dm = dfr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        const date = dm ? (dm[3] + '-' + dm[2] + '-' + dm[1]) : '';
        const badge = (c[ix.NumeroBadge] || '').replace(/\s/g, '');
        if (!badge) continue;
        const type = ((ix.Type != null ? c[ix.Type] : '') || '').trim().toUpperCase();
        txAll.push({ date, mois: date.slice(0, 7), badge,
          plaque: FP.normImmat ? FP.normImmat((c[ix.Immatriculation] || '')) : (c[ix.Immatriculation] || '').replace(/\s/g, '').toUpperCase(),
          prenom: ((ix.LibelleBadge != null && c[ix.LibelleBadge]) || '').trim(),
          type, km: _ulsNum(c[ix.Km]), ttc: _ulsNum(c[ix.TarifTTC]), ht: _ulsNum(c[ix.TarifHT]),
          numero: (c[ix.NumeroFacture] || '').trim() });
      }
      if (!txAll.length) return { error: 'Aucune transaction lisible dans ce CSV.' };
      // Agrégat conso par (badge, mois) → lignes ulys_conso (comme l'import PDF).
      const aggM = {}, rows = [], tx = [];
      txAll.forEach((t, i) => {
        const nom = _ulsNomBadge(t.badge, t.prenom);
        const k = t.badge + '|' + t.mois;
        const a = aggM[k] || (aggM[k] = { mois: t.mois, numero: t.numero, conducteur: nom, badge: t.badge, nb: 0, km: 0, ttc: 0 });
        a.nb++; a.km += t.km; a.ttc += t.ttc; if (!a.numero && t.numero) a.numero = t.numero;
        tx.push({ mois: t.mois, numero: t.numero, seq: i, date: t.date, conducteur: nom, badge: t.badge,
          montant: t.ttc, plaque: t.plaque || null, produit: t.type === 'PARKING' ? 'Parking Ulys' : 'Péage Ulys',
          categorie: t.type === 'PARKING' ? 'parking' : 'peage' });
      });
      Object.values(aggM).forEach(a => { a.km = Math.round(a.km * 10) / 10; a.ttc = Math.round(a.ttc * 100) / 100; rows.push(a); });
      // Factures : uniquement celles ABSENTES de PP (on n'écrase jamais une facture déjà importée
      // API/PDF, dont le total peut inclure des frais hors CSV). Sinon la conso s'y adosse telle quelle.
      const have = new Set((window.FP_DATA.factures || []).map(f => String(f.numeroFacture || '').trim().toUpperCase()).filter(Boolean));
      const facM = {};
      txAll.forEach(t => { if (!t.numero || have.has(t.numero.toUpperCase())) return; const f = facM[t.numero] || (facM[t.numero] = { numero: t.numero, mois: t.mois, ht: 0, ttc: 0, _dates: [] }); f.ht += t.ht; f.ttc += t.ttc; f._dates.push(t.date); });
      const fac = Object.values(facM).map(f => ({ numero: f.numero, mois: f.mois, date: (f._dates.filter(Boolean).sort()[0] || null), ht: Math.round(f.ht * 100) / 100, tva: Math.round((f.ttc - f.ht) * 100) / 100, ttc: Math.round(f.ttc * 100) / 100 }));
      return { fac, rows, tx };
    }
    // ── Import SILENCIEUX de la conso depuis un CSV de transactions (fourni par l'API Ulys). ──
    // Réutilise le MÊME parseur que l'import manuel (parseUlysCsv) et écrit ulys_conso + total_conso_tx
    // avec les MÊMES ids/champs que commitUlys → upsert IDEMPOTENT (ré-import sans doublon). Ne crée PAS
    // de facture (l'en-tête vient déjà de l'API importInvoices). Renvoie {conducteurs, tx} ou {error}.
    // Appelé par FP.ulysApi.importInvoices (app.js) au moment de la synchro.
    window.__ulysImportConsoCsv = async function (csvText) {
      const pc = parseUlysCsv(String(csvText || ''));
      if (pc.error) return { error: pc.error };
      let soc = (FP.activeSociete ? FP.activeSociete() : 'PXP') || 'PXP';
      if (soc === '__all__') soc = 'PXP';   // vue CEO « toutes sociétés » → rattacher à PXP (règle canonique), jamais écrire '__all__'
      let okC = 0, okTx = 0;
      for (const c of (pc.rows || [])) {
        if (c.ttc == null) continue;
        const row = { id: 'ULYSC-' + c.mois + '-' + ulsSlug(c.conducteur), mois: c.mois, conducteur: c.conducteur, nbTrajets: c.nb, km: c.km, totalTtc: c.ttc, numeroFacture: c.numero, societe: soc };
        try { await FP.persist.upsert('ulys_conso', row); okC++; } catch (e) { console.error('[uls conso api]', e); }
      }
      for (const c of (pc.tx || [])) {
        if (!c.date || !c.conducteur) continue;
        const tr = { id: 'ULYSTX-' + c.numero + '-' + (c.badge || '') + '-' + (c.seq != null ? c.seq : ''), facnum: c.numero, carte: 'ULYS-' + (c.badge || ''), conducteur: c.conducteur, plaque: (c.plaque || null), dateTx: c.date, mois: (c.date || '').slice(0, 7), produit: (c.produit || 'Péage Ulys'), categorie: (c.categorie || 'peage'), montantTtc: (c.montant != null ? c.montant : 0) };
        try { const res = (FP.db && FP.db.upsert) ? await FP.db.upsert('total_conso_tx', tr) : null; if (res && res.error) throw res.error; okTx++; }
        catch (e) { break; }
      }
      try { consoLoaded = false; loadConso(); } catch (e) {}
      return { conducteurs: okC, tx: okTx };
    };
    async function handleUlysImport(files){
      if (!files || !files.length) return;
      if (!(window.FP && FP.ocr)){ ulsImpStatus('Lecteur PDF indisponible.', 'err'); return; }
      ulsImpStatus('<span class="inline-flex items-center gap-2"><span class="fa-spin"></span> Lecture de '+files.length+' fichier(s)…</span>', 'working');
      const fac=[], rows=[], tx=[]; let skipped=0;
      for (const f of files){
        // Relevé de CONSO en CSV (export Ulys / API) → parseur dédié, attribution par n° de badge.
        if (/\.csv$/i.test(f.name || '') || /csv/i.test(f.type || '')){
          try {
            const buf = await f.arrayBuffer();
            let t = new TextDecoder('utf-8').decode(buf); if (t.indexOf('�') !== -1) t = new TextDecoder('windows-1252').decode(buf);
            const pc = parseUlysCsv(t);
            if (pc.error){ skipped++; console.warn('[uls-csv]', pc.error); continue; }
            pc.fac.forEach(x => fac.push(x)); pc.rows.forEach(x => rows.push(x)); pc.tx.forEach(x => tx.push(x));
          } catch (e){ console.error('[uls-csv]', e); skipped++; }
          continue;
        }
        try {
          let text = await ulysPdfToText(f);                 // reconstruction par position (lignes)
          if (!text || text.replace(/\s/g,'').length < 80) text = await FP.ocr.fileToText(f, 99); // repli
          const p = parseUlys(text);
          if (!p.numero || p.ttc == null) { skipped++; console.warn('[uls-import] non reconnu :', f.name); continue; }
          p._file = f;                                       // garde le PDF d'origine → stocké au commit (bouton « Voir »)
          fac.push(p);
          p.conso.forEach(c => rows.push(Object.assign({ mois:p.mois, numero:p.numero }, c)));
          // ℹ️ Le détail DATÉ transaction par transaction (pour la détection « conso pendant congé »
          // à la DATE exacte) n'est PAS extrait du PDF Ulys (parseUlys ne fournit que le total mensuel
          // par badge). Il arrive par l'import CSV Ulys (parseUlysCsv remplit `tx`) et par le bouton
          // « Reconstruire le détail ». (Ancien code mort `p.txConso` retiré : ce champ n'existait pas.)
        } catch (e){ console.error('[uls-import]', e); skipped++; }
      }
      // On peut n'avoir AUCUNE facture à créer (CSV dont les factures sont déjà dans PP) mais quand même
      // du détail conso à enregistrer → on continue si fac OU rows. On abandonne seulement si tout est vide.
      if (!fac.length && !rows.length){ ulsImpStatus('Aucune donnée Ulys lisible' + (skipped ? ' ('+skipped+' fichier(s) non reconnus — PDF avec couche texte Ulys, ou CSV export Ulys)' : '') + '.', 'err'); return; }
      _ulsPending = { fac, rows, tx, skipped };
      const facLines = fac.map(p => `<tr><td style="font-family:monospace">${esc(p.numero)}</td><td>${p.date?FP.date(p.date):'—'}</td><td>${esc(moisLabel(p.mois))}</td><td style="text-align:right">${p.ht!=null?FP.euro(p.ht):'—'}</td><td style="text-align:right">${p.tva!=null?FP.euro(p.tva):'—'}</td><td style="text-align:right;font-weight:700">${FP.euro(p.ttc)}</td></tr>`).join('');
      const collabs = [...new Set(rows.map(c => c.conducteur).filter(Boolean))];
      const withTtc = rows.filter(c => c.ttc != null);
      const sumTtc = withTtc.reduce((s,c) => s + (Number(c.ttc)||0), 0);
      // Bloc détail : tableau avec montants si dispo, sinon puces (noms seuls)
      let detailBlock;
      if (withTtc.length){
        const consoLines = rows.map(c => `<tr><td>${esc(c.conducteur)}</td><td>${esc(moisLabel(c.mois))}</td><td style="text-align:right">${c.nb!=null?c.nb:'—'}</td><td style="text-align:right">${c.km!=null?FP.num(c.km)+' km':'—'}</td><td style="text-align:right;font-weight:700">${c.ttc!=null?FP.euro(c.ttc):'—'}</td></tr>`).join('');
        detailBlock =
          '<div class="text-sm font-semibold mt-4 mb-2">Détail par collaborateur : '+withTtc.length+' · total '+FP.euro(sumTtc)+'</div>'
          + '<div class="scrollable" style="max-height:260px"><table class="fp-table" style="font-size:13px"><thead><tr><th>Collaborateur</th><th>Période</th><th style="text-align:right">Trajets</th><th style="text-align:right">Km</th><th style="text-align:right">TTC</th></tr></thead><tbody>'+consoLines+'</tbody></table></div>';
      } else {
        const collabChips = collabs.length
          ? collabs.map(n => `<span class="inline-block text-xs font-semibold px-2.5 py-1 rounded-full" style="background:#EEF2F6;color:#334155;margin:2px">${esc(n)}</span>`).join('')
          : '<span class="text-sm text-slate-400">Aucun collaborateur reconnu (vérifie que leurs prénoms figurent dans l\'onglet Conducteurs).</span>';
        detailBlock =
          '<div class="text-sm font-semibold mt-4 mb-1">Collaborateurs détectés : '+collabs.length+'</div>'
          + '<div class="mb-1">'+collabChips+'</div>'
          + '<div class="text-xs text-slate-500 mb-2" style="line-height:1.5">ℹ️ Les prénoms ont été détectés mais le <b>montant par collaborateur</b> n\'a pas pu être rattaché de façon fiable sur cette facture (nombre de prénoms ≠ nombre de totaux). On n\'invente pas de chiffre. Le total de la facture, lui, est correct.</div>';
      }
      $('uls-import-preview').classList.remove('hidden');
      $('uls-import-preview').innerHTML =
        '<div class="text-sm font-semibold mb-2">'+fac.length+' facture(s) Ulys</div>'
        + '<div class="scrollable" style="max-height:170px"><table class="fp-table" style="font-size:13px"><thead><tr><th>N°</th><th>Date</th><th>Période</th><th style="text-align:right">HT</th><th style="text-align:right">TVA</th><th style="text-align:right">TTC</th></tr></thead><tbody>'+facLines+'</tbody></table></div>'
        + detailBlock
        + '<div class="flex gap-2 mt-3"><button type="button" class="btn btn-outline text-sm" id="uls-import-cancel">Annuler</button><button type="button" class="btn btn-dark text-sm" id="uls-import-confirm"><i data-lucide="check" class="w-4 h-4"></i> Enregistrer</button></div>';
      ulsImpStatus('Vérifie l\'aperçu puis valide.', 'working');
      if (window.lucide) lucide.createIcons();
      $('uls-import-cancel').addEventListener('click', ulsImpReset);
      $('uls-import-confirm').addEventListener('click', commitUlys);
      // Amène l'aperçu à confirmer EN HAUT de l'écran (sinon il faut scroller pour le voir).
      try { $('uls-import-preview').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
    }
    async function commitUlys(){
      if (!_ulsPending) return;
      $('uls-import-confirm').disabled = true;
      // Détail de CE qu'on va enregistrer, montré dans l'overlay (l'utilisateur voit le contenu).
      const _nF = _ulsPending.fac.length, _nC = (_ulsPending.rows || []).filter(r => r.ttc != null).length, _nTx = (_ulsPending.tx || []).filter(c => c.date && c.conducteur).length;
      const _busy = (window.FP && FP.busy) ? FP.busy('Relevé Ulys : ' + _nF + ' facture(s) · ' + _nC + ' détail(s) conducteur · ' + _nTx + ' conso datée(s)…') : null;
      ulsImpStatus('<span class="inline-flex items-center gap-2"><span class="fa-spin"></span> Enregistrement…</span>', 'working');
      let okF=0, okC=0, _iF=0;
      for (const p of _ulsPending.fac){
        if (_busy) _busy.update('Facture ' + (++_iF) + '/' + _nF + ' · ' + p.numero + ' (' + FP.euro(p.ttc) + ')…');
        // Stocke le PDF d'origine (MÊME système que TotalEnergies) → bouton « Voir » = aperçu intégré.
        const prev = (window.FP_DATA.factures||[]).find(x => x.id === ('ULYS-'+p.numero));
        let fileUrl = null;
        if (p._file && FP.uploadScan) { try { fileUrl = await FP.uploadScan(p._file, 'factures-total', { name:'ULYS-'+p.numero }); } catch(e){ console.warn('[uls upload PDF]', e); } }
        const newF = { id:'ULYS-'+p.numero, date:p.date||null, vehiculeImmat:(prev && prev.vehiculeImmat) || null, fournisseur:'Ulys', numeroFacture:p.numero, description:'Péages Ulys — '+moisLabel(p.mois), type:'peage', montantHT:p.ht, montantTVA:p.tva, montantTTC:p.ttc,
          fileId: fileUrl || (prev && prev.fileId) || null, fileName: (p._file ? p._file.name : (prev && prev.fileName)) || null };
        const i = (window.FP_DATA.factures||[]).findIndex(x => x.id === newF.id);
        if (i>=0) window.FP_DATA.factures[i]=newF; else window.FP_DATA.factures.push(newF);
        try { await FP.persist.upsert('factures', newF); okF++; } catch(e){ console.error('[uls facture]', e); }
      }
      // Détail par collaborateur : on n'enregistre QUE si un montant fiable a pu être lu (sinon on
      // n'écrit pas de faux « 0 € » — cf. note d'import). Sur le format Ulys entremêlé, c.ttc est null.
      if (_busy && _nC) _busy.update('Détail par conducteur : ' + _nC + ' à enregistrer…');
      for (const c of _ulsPending.rows){
        if (c.ttc == null) continue;
        // ⚠️ Société = la société ACTIVE (jamais 'PXP' en dur) sinon le détail Ulys d'une autre
        // société atterrit chez PXP (fuite inter-sociétés + attribution conso faussée).
        let _soc = (FP.activeSociete?FP.activeSociete():'PXP') || 'PXP'; if (_soc === '__all__') _soc = 'PXP';   // '__all__' n'est pas une vraie société → rattacher à PXP, jamais l'écrire brut
        const row = { id:'ULYSC-'+c.mois+'-'+ulsSlug(c.conducteur), mois:c.mois, conducteur:c.conducteur, nbTrajets:c.nb, km:c.km, totalTtc:c.ttc, numeroFacture:c.numero, societe:_soc };
        try { await FP.persist.upsert('ulys_conso', row); okC++; } catch(e){ console.error('[uls conso]', e); }
      }
      // Détail DATÉ (colonne date des consommations) → total_conso_tx (péage) pour la détection
      // « conso pendant un congé » à la bonne date. Best-effort : table absente = silencieux (repli mensuel).
      let okTx = 0;
      if (_busy && _nTx) _busy.update('Conso datées (pour le suivi des congés) : ' + _nTx + '…');
      for (const c of (_ulsPending.tx || [])){
        if (!c.date || !c.conducteur) continue;
        const tr = { id:'ULYSTX-'+c.numero+'-'+(c.badge||'')+'-'+(c.seq!=null?c.seq:''), facnum:c.numero, carte:'ULYS-'+(c.badge||''),
          conducteur:c.conducteur, plaque:(c.plaque||null), dateTx:c.date, mois:(c.date||'').slice(0,7), produit:(c.produit||'Péage Ulys'),
          categorie:(c.categorie||'peage'), montantTtc:(c.montant!=null?c.montant:0) };
        try { const res = (FP.db && FP.db.upsert) ? await FP.db.upsert('total_conso_tx', tr) : null; if (res && res.error) throw res.error; okTx++; }
        catch (e){ const msg = String((e && (e.message || e)) || e); if (/relation|exist|schema|column/i.test(msg)) break; /* table absente → on arrête ; sinon on saute CETTE ligne et on continue (une ligne KO ne doit pas perdre tout le relevé) */ }
      }
      const nbCollab = new Set(_ulsPending.rows.map(r => r.conducteur).filter(Boolean)).size;
      const _skip = _ulsPending.skipped || 0;
      ulsImpStatus('<b>Enregistré</b> : '+okF+' facture(s) Ulys.' + (okC ? ' Détail de '+okC+' conducteur(s).' : (nbCollab ? ' '+nbCollab+' collaborateur(s) détecté(s) (montant par personne non lu automatiquement sur ce format).' : '')) + (okTx ? ' '+okTx+' conso(s) datée(s) pour le suivi des congés.' : '') + (_skip ? ' <span style="color:#B45309">'+_skip+' fichier(s) non reconnus.</span>' : '') + ' Visible sur tous les postes.', 'ok');
      if (_busy) _busy.done('✓ Relevé Ulys enregistré — '+okF+' facture(s)' + (okTx ? ', '+okTx+' conso datées' : '') + (_skip ? ' · '+_skip+' non reconnu(s)' : ''));
      $('uls-import-preview').classList.add('hidden'); _ulsPending=null;
      render(); consoLoaded=false; loadConso();
    }
    // (Le bouton de dropzone Ulys a été retiré : l'import se lance via le bouton « Importer un relevé Ulys » du haut.)
    $('uls-import-file').addEventListener('change', (e) => { handleUlysImport(e.target.files); e.target.value=''; });
    if ($('uls-import-btn')) $('uls-import-btn').addEventListener('click', () => $('uls-import-file').click());

    function openUlsDrawer(f){
      $('drawer-num').textContent = f.numeroFacture || '—';
      $('drawer-title').textContent = f.description || 'Facture Ulys';
      $('drawer-subtitle').textContent = `${f.fournisseur || 'Ulys'} · ${f.date ? FP.date(f.date) : '—'}`;
      $('drawer-body').innerHTML = `
        <div class="grid grid-cols-3 gap-3">
          <div class="kpi p-3"><div class="kpi-label">HT</div><div class="kpi-value" style="font-size:1rem">${f.montantHT != null ? FP.euroPrecis(f.montantHT) : '—'}</div></div>
          <div class="kpi p-3"><div class="kpi-label">TVA</div><div class="kpi-value" style="font-size:1rem">${f.montantTVA != null ? FP.euroPrecis(f.montantTVA) : '—'}</div></div>
          <div class="kpi p-3"><div class="kpi-label">TTC</div><div class="kpi-value" style="font-size:1rem; color: var(--fp-primary)">${f.montantTTC != null ? FP.euroPrecis(f.montantTTC) : '—'}</div></div>
        </div>
        <div><div class="field-label">N° de facture</div><div class="text-sm bg-slate-50 p-3 rounded-lg">${esc(f.numeroFacture || '—')}</div></div>
        <div><div class="field-label">Date</div><div class="text-sm">${f.date ? FP.date(f.date) : '—'}</div></div>`;
      const openBtn = $('drawer-open-drive');
      const url = f.url || (f.fileId && !/^IMP-/.test(f.fileId) ? (/^https?:\/\//.test(f.fileId) ? f.fileId : `https://drive.google.com/file/d/${f.fileId}/view`) : null);
      if (url){ openBtn.href = url; openBtn.style.display = ''; } else { openBtn.removeAttribute('href'); openBtn.style.display = 'none'; }
      $('drawer').classList.add('open'); $('drawer-backdrop').classList.add('open');
      if (window.lucide) lucide.createIcons();
    }

    async function deleteUlsFacture(f){
      if (!(await FP.confirm(`Supprimer la facture ${f.numeroFacture || f.id} (${f.montantTTC != null ? FP.euro(f.montantTTC) : '—'}) ?`))) return;
      const idx = (window.FP_DATA.factures || []).findIndex(x => x.id === f.id);
      if (idx >= 0) window.FP_DATA.factures.splice(idx, 1);
      try { await FP.persist.delete('factures', f.id); } catch (e) { console.error('[uls-del]', e); }
      // Purge aussi le détail conso rattaché à cette facture (sinon conso orpheline → total faussé).
      try {
        const num = String(f.numeroFacture || '').trim();
        if (num && Array.isArray(conso)){
          const orphans = conso.filter(c => String(c.numeroFacture || '').trim() === num);
          for (const c of orphans){ if (c.id){ try { await FP.persist.delete('ulys_conso', c.id); } catch (_){} } }
          if (orphans.length) conso = conso.filter(c => !orphans.includes(c));
        }
      } catch (_){}
      // Purge aussi le DÉTAIL transaction total_conso_tx (péage Ulys daté) rattaché à ce n° de facture —
      // sinon la détection conso-pendant-congé continue de signaler des lignes d'une facture supprimée.
      try { const num = String(f.numeroFacture || '').trim();
        if (num){ const r = await FP.supabase.from('total_conso_tx').select('id').eq('facnum', num);
          if (r && !r.error && Array.isArray(r.data)) for (const row of r.data){ try { await FP.persist.delete('total_conso_tx', row.id); } catch (e) {} } } } catch (e) { console.warn('[uls-del tx]', e); }
      render();
      if (consoLoaded) renderConso();
    }

    $('uls-tbody').addEventListener('click', (e) => {
      const voir = e.target.closest('[data-uls-voir]');
      // « Voir » = ouvre DIRECTEMENT le PDF dans un nouvel onglet (jamais un pop-up) — helper unique FP.openPdf.
      if (voir){ const f = (window.FP_DATA.factures || []).find(x => String(x.id) === voir.getAttribute('data-uls-voir')); if (f) { if (FP.openPdf) FP.openPdf(f.url || f.fileId, 'Aucun PDF stocké pour ce relevé Ulys — réimporte-le une fois pour l\'attacher.'); else (window.__facOpenTfDrawer ? window.__facOpenTfDrawer(f) : openUlsDrawer(f)); } return; }
      const del = e.target.closest('[data-uls-del]');
      if (del){ const f = (window.FP_DATA.factures || []).find(x => String(x.id) === del.getAttribute('data-uls-del')); if (f) deleteUlsFacture(f); }
    });

    // --- Consommation par conducteur (table ulys_conso) ---
    let conso = null, consoLoaded = false;
    const moisLabel = (m) => { const [y, mo] = (m || '').split('-'); const N = ['','Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']; return mo ? `${N[+mo]} ${y}` : m; };
    // Clé canonique par PERSONNE (dédoublonne « Charles » ⇄ « Charles LENNON », sépare 2 homonymes).
    const _np = (s) => (FP.condGroupKey ? FP.condGroupKey(s) : (FP.normPrenom ? FP.normPrenom(s) : String(s || '').trim().toLowerCase()));
    const _nomUnif = (raw) => (FP.prenomAffiche ? (FP.prenomAffiche(raw) || raw) : raw);   // AFFICHAGE = prénom seul (règle globale) ; le regroupement reste par clé canonique (_np)
    // ⚠️ SOURCE UNIQUE du regroupement conso (table ET exports CSV/PDF) : dédoublonne une même personne
    // stockée sous 2 orthographes (prénom seul + nom complet = mêmes chiffres en double), puis regroupe
    // par PERSONNE (et par MOIS si byMonth). Avant, seule la TABLE dédoublonnait → l'export comptait DOUBLE.
    function ulsGroup(src, byMonth){
      const seen = new Set(), dedup = [], bestName = {};
      (src || []).forEach(c => {
        const np = _np(c.conducteur);
        const uk = np + '|' + (c.mois || '') + '|' + (c.numeroFacture || c.numero_facture || '');
        if (seen.has(uk)) return; seen.add(uk); dedup.push(c);
        const cur = bestName[np]; if (!cur || String(c.conducteur || '').length > cur.length) bestName[np] = c.conducteur || '—';
      });
      const g = {};
      dedup.forEach(c => {
        const np = _np(c.conducteur);
        const key = byMonth ? (np + '|' + (c.mois || '')) : (np || (c.conducteur || '—'));
        const a = (g[key] = g[key] || { mois: c.mois, conducteur: _nomUnif(bestName[np] || c.conducteur || '—'), nb_trajets: 0, km: 0, total_ttc: 0 });
        a.nb_trajets += Number(c.nb_trajets) || 0; a.km += Number(c.km) || 0; a.total_ttc += Number(c.total_ttc) || 0;
      });
      return Object.values(g);
    }
    async function loadConso(){
      consoLoaded = true;
      try { const r = FP.selectAllPaged ? await FP.selectAllPaged('ulys_conso', null, 'id') : await FP.supabase.from('ulys_conso').select('*'); if (r.error) throw r.error; conso = r.data || []; const _soc = FP.activeSociete ? FP.activeSociete() : null; if (_soc && _soc !== '__all__') conso = conso.filter(x => x.societe ? String(x.societe) === _soc : _soc === 'PXP'); }   // NULL société → PXP (règle canonique, cf. lignes plus bas)
      catch (e) { console.warn('[ulys_conso] indisponible :', e && (e.message || e)); conso = null; }
      renderConso();
      try { window.showConsoRapproch && window.showConsoRapproch(); } catch (e) {}
    }
    function renderConso(){
      const sel = $('uls-conso-mois'), tbody = $('uls-conso-tbody'), tfoot = $('uls-conso-tfoot');
      const empty = $('uls-conso-empty'), emptyMsg = $('uls-conso-empty-msg');
      if (conso === null) { sel.innerHTML = ''; tbody.innerHTML = ''; tfoot.innerHTML = ''; empty.classList.remove('hidden'); emptyMsg.textContent = 'Le détail des consommations Ulys n\'est pas encore disponible.'; console.warn('[fleet-views] ulys_conso absente — infra one-shot : script supabase/ulys-conso-setup.sql.'); return; }
      // ⚠️ Ne compter QUE la conso ADOSSÉE À UNE FACTURE Ulys réellement présente. Une conso orpheline
      // (facture jamais importée, ou supprimée) fausserait le total → à ne PAS compter. On relie par le
      // n° de facture ; à défaut (anciennes lignes sans n°), par le mois d'une facture Ulys existante.
      const backed = ulsBacked();
      const moisList = [...new Set(backed.map(c => c.mois).filter(Boolean))].sort().reverse();
      const filledKey = 'all,' + moisList.join(',');
      if (sel.dataset.filled !== filledKey) { sel.innerHTML = '<option value="all">Toutes les périodes</option>' + moisList.map(m => `<option value="${m}">${moisLabel(m)}</option>`).join(''); sel.dataset.filled = filledKey; sel.value = 'all'; }
      const { src, label } = ulsPeriod();
      // Regroupement par PERSONNE via la SOURCE UNIQUE ulsGroup (même dédoublonnage que les exports).
      const rows = ulsGroup(src, false).sort((a, b) => b.total_ttc - a.total_ttc);
      empty.classList.toggle('hidden', rows.length > 0);
      if (!rows.length) emptyMsg.textContent = 'Aucun détail de consommation sur cette période (importe la facture Ulys correspondante).';
      tbody.innerHTML = rows.map(c => `<tr><td>${esc(c.conducteur || '—')}</td><td style="text-align:right">${c.nb_trajets ? c.nb_trajets : '—'}</td><td style="text-align:right">${c.km ? FP.num(c.km) + ' km' : '—'}</td><td style="text-align:right;font-weight:700">${FP.euro(c.total_ttc || 0)}</td></tr>`).join('');
      const tot = rows.reduce((s,c) => s + (Number(c.total_ttc)||0), 0);
      const totKm = rows.reduce((s,c) => s + (Number(c.km)||0), 0);
      tfoot.innerHTML = rows.length ? `<tr style="font-weight:700;border-top:2px solid var(--fp-border)"><td>Total ${esc(label)}</td><td></td><td style="text-align:right">${totKm ? FP.num(totKm) + ' km' : '—'}</td><td style="text-align:right">${FP.euro(tot)}</td></tr>` : '';
      // ===== Vue CARTES (Direction B) — une carte par conducteur =====
      const cardsBox = $('uls-conso-cards');
      if (cardsBox) cardsBox.innerHTML = rows.map(c => {
        const tr = Number(c.nb_trajets)||0, km = Number(c.km)||0, ttc = Number(c.total_ttc)||0;
        return `<div class="tf-ccard"><div class="top"><span class="nm">${esc(c.conducteur || '—')}</span><span class="tot">${FP.euro(ttc)}</span></div>
          <div class="foot"><div>Trajets<b>${tr || '—'}</b></div><div>Km<b>${km ? FP.num(km) + ' km' : '—'}</b></div><div>€ / trajet<b>${tr ? FP.euro(ttc / tr) : '—'}</b></div></div></div>`;
      }).join('');
      applyUlsView(!rows.length);
    }
    // Bascule Tableau / Cartes (même préférence société que Total Fleet : FP.settings.consoView).
    function applyUlsView(forceTable){
      let pref = 'table';
      try { if (window.FP && FP.settings) pref = (FP.settings.get().consoView === 'cards') ? 'cards' : 'table'; } catch (e) {}
      const v = forceTable ? 'table' : pref;
      const tbl = $('uls-conso-table'), cardsBox = $('uls-conso-cards');
      const tableCard = tbl ? tbl.closest('.card') : null;
      if (tableCard) tableCard.classList.toggle('hidden', v === 'cards');
      if (cardsBox) cardsBox.classList.toggle('hidden', v !== 'cards');
      const tg = $('uls-conso-view'); if (tg) tg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === pref));
      if (window.lucide) { try { lucide.createIcons(); } catch (e) {} }
    }
    // Conso Ulys ADOSSÉE à une facture réellement présente (même règle partout).
    function ulsBacked(){
      if (!conso) return [];
      const ulsFac = (window.FP_DATA.factures || []).filter(isUlys);
      const facNums = new Set(ulsFac.map(f => String(f.numeroFacture || '').trim()).filter(Boolean));
      const facMois = new Set(ulsFac.map(f => (f.date || '').slice(0, 7)).filter(Boolean));
      return conso.filter(c => { const n = String(c.numeroFacture || '').trim(); return n ? facNums.has(n) : facMois.has(c.mois); });
    }
    // Période choisie (mois rapide OU dates) → { src, label }. Partagée table + exports.
    function ulsPeriod(){
      const sel = $('uls-conso-mois');
      const from = $('uls-conso-from').value, to = $('uls-conso-to').value;
      const dateMode = !!(from || to);
      const clr = $('uls-conso-clear'); if (clr) clr.classList.toggle('hidden', !dateMode);
      if (sel){ sel.disabled = dateMode; sel.style.opacity = dateMode ? '0.5' : ''; }
      const backed = ulsBacked();
      if (dateMode){
        const fromM = from ? from.slice(0, 7) : null, toM = to ? to.slice(0, 7) : null;
        return { src: backed.filter(c => (!fromM || (c.mois || '') >= fromM) && (!toM || (c.mois || '') <= toM)),
                 label: (from ? FP.date(from) : '…') + ' → ' + (to ? FP.date(to) : '…') };
      }
      const mois = (sel && sel.value) || 'all';
      if (mois === 'all') return { src: backed.slice(), label: 'Toutes les périodes' };
      return { src: backed.filter(c => c.mois === mois), label: moisLabel(mois) };
    }
    function ulsExportRows(){ return ulsPeriod().src; }
    const _ulsRe = () => renderConso();
    $('uls-conso-mois').addEventListener('change', _ulsRe);
    $('uls-conso-from').addEventListener('change', _ulsRe);
    $('uls-conso-to').addEventListener('change', _ulsRe);
    $('uls-conso-clear').addEventListener('click', () => { $('uls-conso-from').value = ''; $('uls-conso-to').value = ''; renderConso(); });
    { const vt = $('uls-conso-view'); if (vt) vt.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { try { if (window.FP && FP.settings) { const s = FP.settings.get(); s.consoView = b.dataset.v; FP.settings.save(s); } } catch (e) {} applyUlsView(); })); }
    if (FP.filterResetButton) FP.filterResetButton($('uls-conso-mois').closest('div'), { onReset: () => { $('uls-conso-mois').value = 'all'; $('uls-conso-from').value = ''; $('uls-conso-to').value = ''; renderConso(); } });
    if ($('uls-an-csv')) $('uls-an-csv').addEventListener('click', () => {
      const rows = ulsGroup(ulsExportRows(), true); if (!rows.length) { if (FP.toast) FP.toast('Aucune donnée à exporter'); return; }
      const cols = ['mois', 'conducteur', 'nb_trajets', 'km', 'total_ttc'];
      const head = ['Mois', 'Conducteur', 'Trajets', 'Km', 'TTC'];
      const numCols = { nb_trajets:1, km:1, total_ttc:1 };
      const src = rows.slice().sort((a, b) => String(a.mois).localeCompare(String(b.mois)));
      if (FP.downloadXlsx) {
        const data = src.map(c => cols.map(k => { const v = c[k]; if (numCols[k]) { const n = Number(v); return isFinite(n) ? n : ''; } return v == null ? '' : v; }));
        FP.downloadXlsx('ulys-conso', head, data, { sheet: 'Ulys' }); return;
      }
      const q = v => { const s = String(v == null ? '' : v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const lines = ['sep=;', head.join(';')].concat(src.map(c => cols.map(k => q(c[k])).join(';')));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ulys-conso.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    });
    if ($('uls-an-pdf')) $('uls-an-pdf').addEventListener('click', () => {
      if (!(FP.fiche && FP.fiche.open)) return; const { src, label } = ulsPeriod(); if (!src.length) { if (FP.toast) FP.toast('Aucune donnée sur la période'); return; }
      // Même dédoublonnage que la table (source unique ulsGroup) → plus de conducteur compté en double.
      const list = ulsGroup(src, false).map(c => ({ nom: c.conducteur || '—', trajets: Number(c.nb_trajets) || 0, km: Number(c.km) || 0, ttc: Number(c.total_ttc) || 0 })).sort((a, b) => b.ttc - a.ttc);
      FP.fiche.open({ key: 'ulys', title: 'Relevé Ulys — péages' + (label && label !== 'Toutes les périodes' ? ' — ' + label : ''), rows: list, cols: [
        { id: 'nom', label: 'Conducteur', def: true, get: r => r.nom },
        { id: 'trajets', label: 'Trajets', def: true, align: 'right', get: r => r.trajets ? String(r.trajets) : '—', sum: r => r.trajets, fmt: t => String(Math.round(t)) },
        { id: 'km', label: 'Km', def: true, align: 'right', get: r => r.km ? FP.num(r.km) + ' km' : '—', sum: r => r.km, fmt: t => FP.num(Math.round(t)) + ' km' },
        { id: 'ttc', label: 'TTC', def: true, align: 'right', get: r => FP.euro(r.ttc), sum: r => r.ttc },
      ] });
    });

    window.renderUlys = () => { render(); if (!consoLoaded) loadConso(); else renderConso(); };
    document.addEventListener('fp:data-ready', () => { if (!$('view-ulys').classList.contains('hidden')){ render(); if (consoLoaded) renderConso(); } });

    // ── Exposé pour l'IMPORT EN LOT : router les relevés Ulys vers CE traitement dédié (détail par
    //    collaborateur ancré sur le badge). Détecteur = lecture texte + parseUlys (n° + TTC présents).
    FP._importUlysReleves = handleUlysImport;
    window.__facIsUlysStatement = async (file) => {
      try {
        if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) return false;
        let text = await ulysPdfToText(file);
        if (!text || text.replace(/\s/g, '').length < 80) return false; // OCR = trop coûteux juste pour détecter
        if (!/ulys|vinci\s*autoroute/i.test(text)) return false;
        const p = parseUlys(text); return !!(p && p.numero && p.ttc != null);
      } catch (e) { return false; }
    };
  })();

      return true;
    }catch(e){ console.error('[FP.mountUlys]', e); return false; }
  };
  FP.mountTotal=function(container){
    try{
      if(!container) return false;
      if(container.getAttribute('data-fl-total')==='1'){ try{ if(window.renderTotalFleet) window.renderTotalFleet(); }catch(e){} return true; }
      container.setAttribute('data-fl-total','1');
      injectCss(); container.innerHTML=TOTAL_MARKUP;
      try{ if(window.lucide&&lucide.createIcons) lucide.createIcons(); }catch(e){}
  (function totalFleetTab(){
    const tfState = { search: '', annee: 'all', expanded: false };
    // Liste Total Fleet, dé-doublonnée par n° de facture (un n° = une seule ligne, même si la base
    // contient un doublon d'un ancien import) → corrige l'affichage ET les totaux.
    const list = () => {
      const seen = new Set(), out = [];
      (window.FP_DATA.factures || []).filter(isTotalFleet).forEach(f => {
        const k = (f.numeroFacture || f.id || '').toString().toUpperCase();
        if (k && seen.has(k)) return; if (k) seen.add(k); out.push(f);
      });
      return out;
    };

    function render(){
      const all = list();
      // Remplir le filtre années
      const annees = [...new Set(all.map(f => (f.date || '').slice(0,4)).filter(Boolean))].sort().reverse();
      const sel = $('tf-filter-annee');
      if (sel && sel.dataset.filled !== annees.join(',')) {
        sel.innerHTML = '<option value="all">Toutes les années</option>' + annees.map(a => `<option value="${a}">${a}</option>`).join('');
        sel.value = tfState.annee; sel.dataset.filled = annees.join(',');
      }
      const q = FP.norm(tfState.search).trim();
      const rows = all.filter(f => {
        if (tfState.annee !== 'all' && (f.date || '').slice(0,4) !== tfState.annee) return false;
        if (q && !FP.norm(`${f.numeroFacture||''} ${f.description||''} ${f.fournisseur||''}`).includes(q)) return false;
        return true;
      }).sort((a,b) => (b.date||'').localeCompare(a.date||''));

      const sum = (k) => rows.reduce((s,f) => s + (Number(f[k]) || 0), 0);
      $('tf-kpi-ttc').textContent   = FP.euro(sum('montantTTC'));
      $('tf-kpi-ht').textContent    = FP.euro(sum('montantHT'));
      $('tf-kpi-tva').textContent   = FP.euro(sum('montantTVA'));
      $('tf-kpi-count').textContent = rows.length;
      $('tf-kpi-sub').textContent   = tfState.annee === 'all' ? 'toutes années' : tfState.annee;

      const tbody = $('tf-tbody');
      $('tf-empty').classList.toggle('hidden', rows.length > 0);
      const LIMIT = 15;
      const visible = tfState.expanded ? rows : rows.slice(0, LIMIT);
      tbody.innerHTML = visible.map(f => `<tr>
        <td style="white-space:nowrap">${f.date ? FP.date(f.date) : '—'}</td>
        <td style="font-family:monospace">${esc(f.numeroFacture || '—')}</td>
        <td>${esc(f.description || '—')}</td>
        <td>${esc(f.fournisseur || 'TotalEnergies')}</td>
        <td style="text-align:right">${f.montantHT != null ? FP.euro(f.montantHT) : '—'}</td>
        <td style="text-align:right">${f.montantTVA != null ? FP.euro(f.montantTVA) : '—'}</td>
        <td style="text-align:right;font-weight:700">${f.montantTTC != null ? FP.euro(f.montantTTC) : '—'}</td>
        <td style="text-align:right;white-space:nowrap"><button type="button" class="btn btn-outline" style="padding:3px 10px;font-size:12px" data-tf-voir="${esc(f.id)}"><i data-lucide="eye" class="w-3 h-3"></i> Voir</button> <button type="button" class="btn btn-outline" style="padding:3px 8px;font-size:12px;color:#B91C1C;border-color:#FCA5A5" data-tf-del="${esc(f.id)}" title="Supprimer cette facture (et retirer sa conso du cumul)"><i data-lucide="trash-2" class="w-3 h-3"></i></button></td>
      </tr>`).join('');
      const more = $('tf-more');
      if (rows.length > LIMIT){
        more.innerHTML = `<button type="button" id="tf-more-btn" class="btn btn-outline text-sm">${tfState.expanded ? 'Réduire' : `Voir tout (${rows.length})`}</button>`;
        $('tf-more-btn').addEventListener('click', () => { tfState.expanded = !tfState.expanded; render(); });
      } else { more.innerHTML = ''; }
      if (window.lucide) lucide.createIcons();
    }
    function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

    $('tf-search').addEventListener('input', (e) => { tfState.search = e.target.value; render(); });
    $('tf-filter-annee').addEventListener('change', (e) => { tfState.annee = e.target.value; render(); });

    // Bouton « Voir » : ouvre le tiroir de détail de la facture Total (réutilise #drawer).
    function openTfDrawer(f){
      $('drawer-num').textContent = f.numeroFacture || '—';
      $('drawer-title').textContent = f.description || 'Facture TotalEnergies';
      $('drawer-subtitle').textContent = `${f.fournisseur || 'TotalEnergies'} · ${f.date ? FP.date(f.date) : '—'}`;
      const url = f.url || (f.fileId && !/^IMP-/.test(f.fileId) ? (/^https?:\/\//.test(f.fileId) ? f.fileId : `https://drive.google.com/file/d/${f.fileId}/view`) : null);
      // Aperçu intégré du PDF complet : URL directe (Supabase Storage) → embed direct ;
      // lien Google Drive « /view » → variante « /preview » qui s'affiche dans une iframe.
      const embed = url ? (/drive\.google\.com/.test(url) ? url.replace(/\/view.*$/, '/preview') : url) : null;
      const preview = embed
        ? `<div><div class="field-label">Facture (PDF complet)</div>
             ${(window.FP && FP.docFrame) ? FP.docFrame(embed, { height:'62vh', title:'Facture ' + (f.numeroFacture || '') }) : `<iframe src="${esc(embed)}" title="Facture ${esc(f.numeroFacture || '')}" style="width:100%;height:62vh;border:1px solid var(--fp-border);border-radius:.6rem;background:#fff"></iframe>`}</div>`
        : `<div class="text-sm text-slate-400 bg-slate-50 p-3 rounded-lg">Aucun PDF stocké pour ce relevé (réimporte-le une fois pour l'attacher).</div>`;
      $('drawer-body').innerHTML = `
        <div class="grid grid-cols-3 gap-3">
          <div class="kpi p-3"><div class="kpi-label">HT</div><div class="kpi-value" style="font-size:1rem">${f.montantHT != null ? FP.euroPrecis(f.montantHT) : '—'}</div></div>
          <div class="kpi p-3"><div class="kpi-label">TVA</div><div class="kpi-value" style="font-size:1rem">${f.montantTVA != null ? FP.euroPrecis(f.montantTVA) : '—'}</div></div>
          <div class="kpi p-3"><div class="kpi-label">TTC</div><div class="kpi-value" style="font-size:1rem; color: var(--fp-primary)">${f.montantTTC != null ? FP.euroPrecis(f.montantTTC) : '—'}</div></div>
        </div>
        <div><div class="field-label">N° de facture</div><div class="text-sm bg-slate-50 p-3 rounded-lg">${esc(f.numeroFacture || '—')}</div></div>
        <div><div class="field-label">Date</div><div class="text-sm">${f.date ? FP.date(f.date) : '—'}</div></div>
        ${preview}`;
      const openBtn = $('drawer-open-drive');
      if (url){ openBtn.href = url; openBtn.style.display = ''; } else { openBtn.removeAttribute('href'); openBtn.style.display = 'none'; }
      // Bucket privé : l'URL publique ne s'affiche pas → on la remplace par une URL SIGNÉE (async).
      if (url && /\/storage\/v1\/object\//.test(url) && FP.supabase && FP.supabase.storage) {
        (async () => {
          try {
            const m = /\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?([^/?]+)\/([^?]+)/.exec(url);
            if (!m) return;
            const r = await FP.supabase.storage.from(decodeURIComponent(m[1])).createSignedUrl(decodeURIComponent(m[2]), 3600);
            const signed = r && r.data && (r.data.signedUrl || r.data.signedURL); if (!signed) return;
            const ifr = $('drawer-body') && $('drawer-body').querySelector('iframe'); if (ifr && ifr.src !== signed) ifr.src = signed;
            if (openBtn) openBtn.href = signed;
          } catch (e) {}
        })();
      }
      $('drawer').classList.add('open'); $('drawer-backdrop').classList.add('open');
      if (window.lucide) lucide.createIcons();
    }
    // Exposé pour l'onglet Ulys : MÊME tiroir (aperçu PDF intégré + URL signée) que TotalEnergies.
    window.__facOpenTfDrawer = openTfDrawer;
    $('tf-tbody').addEventListener('click', (e) => {
      const voir = e.target.closest('[data-tf-voir]');
      // « Voir » = ouvre DIRECTEMENT le PDF dans un nouvel onglet (jamais un pop-up/aperçu intégré) — via le helper unique FP.openPdf.
      if (voir){ const f = (window.FP_DATA.factures || []).find(x => String(x.id) === voir.getAttribute('data-tf-voir')); if (f) { if (FP.openPdf) FP.openPdf(f.url || f.fileId, 'Aucun PDF stocké pour ce relevé — réimporte-le une fois pour l\'attacher.'); else openTfDrawer(f); } return; }
      const del = e.target.closest('[data-tf-del]');
      if (del){ const f = (window.FP_DATA.factures || []).find(x => String(x.id) === del.getAttribute('data-tf-del')); if (f) deleteTfFacture(f); }
    });

    // Supprime une facture Total + RETIRE sa conso du cumul (lignes total_conso
    // dont l'identifiant se termine par le n° de cette facture : mois-carte-NoFacture).
    async function deleteTfFacture(f){
      const num = f.numeroFacture || '';
      const liees = (conso || []).filter(c => String(c.id).split('-').pop() === num);
      const msg = `Supprimer la facture ${num || f.id} (${f.montantTTC != null ? FP.euro(f.montantTTC) : '—'}) ?`
        + (liees.length ? `\n\n${liees.length} ligne(s) de consommation liée(s) seront aussi retirées du cumul.` : '');
      if (!(await FP.confirm(msg))) return;
      // 1) la facture
      const idx = (window.FP_DATA.factures || []).findIndex(x => x.id === f.id);
      if (idx >= 0) window.FP_DATA.factures.splice(idx, 1);
      try { await FP.persist.delete('factures', f.id); } catch (e) { console.error('[tf-del facture]', e); }
      // 2) la conso liée (décompte du cumul)
      for (const c of liees){ try { await FP.persist.delete('total_conso', c.id); } catch (e) { console.error('[tf-del conso]', e); } }
      if (conso) conso = conso.filter(c => String(c.id).split('-').pop() !== num);
      // 3) le DÉTAIL transaction (total_conso_tx) rattaché à ce n° de facture — sinon la détection
      //    conso-pendant-congé / les anomalies continuent de signaler les lignes d'une facture supprimée.
      if (num) { try { const r = await FP.supabase.from('total_conso_tx').select('id').eq('facnum', num);
        if (r && !r.error && Array.isArray(r.data)) for (const row of r.data){ try { await FP.persist.delete('total_conso_tx', row.id); } catch (e) {} } } catch (e) { console.warn('[tf-del tx]', e); } }
      render(); renderConso();
    }

    // --- Consommation par conducteur / véhicule (table total_conso) ---
    let conso = null, consoTx = null, consoLoaded = false, consoSortDesc = true, _tfAnom = [], _tfAnomByKey = {};
    // Seuils d'alerte configurables (réglages société). Défauts raisonnables.
    function tfLimits(){ let s = {}; try { s = (FP.settings.get().tfSeuils) || {}; } catch (e) {} return { repasJour: Number(s.repasJour) > 0 ? Number(s.repasJour) : 20, autreItem: (s.autreItem === 0 || Number(s.autreItem) > 0) ? Number(s.autreItem) : 20, horsCarbMois: Number(s.horsCarbMois) > 0 ? Number(s.horsCarbMois) : 40 }; }
    const moisLabel = (m) => { const [y, mo] = (m || '').split('-'); const N = ['','Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']; return mo ? `${N[+mo]} ${y}` : m; };

    // Rapprochement conducteurs : liste les noms/n° des relevés (Total ET Ulys) qui ne correspondent
    // à AUCUNE fiche → propose de lier à un conducteur existant OU d'en créer un (FP.rapprochementPanel).
    // Lecture seule ; s'affiche sous le détail conso, et se vide au fur et à mesure des rattachements.
    window.showConsoRapproch = async function () {
      const mount = document.getElementById('conso-rapproch');
      if (!mount || !(window.FP && FP.rapprochementPanel && FP.supabase)) return;
      const soc = FP.activeSociete ? FP.activeSociete() : null;
      const inSoc = x => !soc || soc === '__all__' || (x.societe ? String(x.societe) === soc : soc === 'PXP');   // NULL société → PXP (règle canonique)
      const items = [];
      const _pg = (t, c) => FP.selectAllPaged ? FP.selectAllPaged(t, null, 'id', c) : FP.supabase.from(t).select(c); // PAGINÉ (cap 1000)
      try { const r = await _pg('total_conso_tx', 'conducteur,carte,societe');
        (r.data || []).filter(inSoc).forEach(x => { const c = String(x.carte || ''); items.push({ name: x.conducteur, num: c, numKey: /^ULYS/i.test(c) ? 'condBadgeUlys' : 'condCarteTotal' }); }); } catch (e) {}
      try { const r = await _pg('total_conso', 'conducteur,carte,societe');
        (r.data || []).filter(inSoc).forEach(x => { if (x.conducteur) items.push({ name: x.conducteur, num: String(x.carte || ''), numKey: 'condCarteTotal' }); }); } catch (e) {}
      try { const r = await _pg('ulys_conso', 'conducteur,badge,societe');
        (r.data || []).filter(inSoc).forEach(x => { if (x.conducteur) items.push({ name: x.conducteur, num: String(x.badge || ''), numKey: 'condBadgeUlys' }); }); } catch (e) {}
      try { FP.rapprochementPanel(mount, items, function () { try { if (window.renderTotalFleet) window.renderTotalFleet(); } catch (e) {} }); } catch (e) {}
    };
    async function loadConso(){
      consoLoaded = true;
      try {
        const r = FP.selectAllPaged ? await FP.selectAllPaged('total_conso', null, 'id') : await FP.supabase.from('total_conso').select('*'); // PAGINÉ (cap 1000)
        if (r.error) throw r.error;
        conso = r.data || [];
        // Aligne la vue CEO scopée : ne montrer que la société active (RLS isole déjà les clients).
        const _soc = FP.activeSociete ? FP.activeSociete() : null;
        if (_soc && _soc !== '__all__') conso = conso.filter(x => x.societe ? String(x.societe) === _soc : _soc === 'PXP');   // NULL société → PXP
      } catch (e) {
        console.warn('[total_conso] indisponible :', e && (e.message || e));
        conso = null; // table absente → on affiche un message d'aide
      }
      // Détail transaction par transaction (best-effort : table absente = null → repli mensuel).
      try {
        const rt = FP.selectAllPaged ? await FP.selectAllPaged('total_conso_tx', null, 'id') : await FP.supabase.from('total_conso_tx').select('*'); // PAGINÉ (cap 1000)
        if (rt.error) throw rt.error;
        // Dédoublonnage « badge par personne » (même passage listé sous plusieurs plaques) — source unique.
        consoTx = (FP.dedupeConsoTx ? FP.dedupeConsoTx(rt.data || []) : (rt.data || []));
        const _soc = FP.activeSociete ? FP.activeSociete() : null;
        if (_soc && _soc !== '__all__') consoTx = consoTx.filter(x => x.societe ? String(x.societe) === _soc : _soc === 'PXP');   // NULL société → PXP
        // Les conso Ulys (péage) datées vivent aussi dans total_conso_tx (pour le suivi des congés) mais
        // ne font PAS partie du relevé carte carburant Total → on les exclut des vues « Total Fleet ».
        consoTx = consoTx.filter(x => !String(x.carte || '').toUpperCase().startsWith('ULYS'));
      } catch (e) { consoTx = null; }
      renderConso();
      renderAnalyse();
      try { window.showConsoRapproch && window.showConsoRapproch(); } catch (e) {}
    }

    function tfCondSel(){ const s = $('tf-conso-cond'); return s ? (s.value || '') : ''; }
    // Période (mois OU dates) + CONDUCTEUR → { src, label, cond }. Partagée table/analyse/exports.
    function tfPeriodSrc(){
      const sel = $('tf-conso-mois');
      const all = conso || [];
      const from = $('tf-conso-from').value, to = $('tf-conso-to').value;
      const dateMode = !!(from || to);
      const clr = $('tf-conso-clear'); if (clr) clr.classList.toggle('hidden', !dateMode);
      if (sel){ sel.disabled = dateMode; sel.style.opacity = dateMode ? '0.5' : ''; }
      let periodSrc, label;
      if (dateMode){
        const fromM = from ? from.slice(0, 7) : null, toM = to ? to.slice(0, 7) : null;
        periodSrc = all.filter(c => (!fromM || (c.mois || '') >= fromM) && (!toM || (c.mois || '') <= toM));
        label = (from ? FP.date(from) : '…') + ' → ' + (to ? FP.date(to) : '…');
      } else {
        const moisDispo = [...new Set(all.map(c => c.mois).filter(Boolean))].sort().reverse();
        const mois = (sel && sel.value) || moisDispo[0] || '';
        if (mois === '__all__' || !mois) { periodSrc = all.slice(); label = 'Toutes les périodes'; }
        else { periodSrc = all.filter(c => c.mois === mois); label = moisLabel(mois); }
      }
      const cond = tfCondSel();
      if (cond){ const vbp = _tfVehBy(); periodSrc = periodSrc.filter(c => _tfName(c, vbp) === cond); label = cond + ' · ' + label; }
      return { src: periodSrc, label, cond };
    }
    function renderConso(){
      const sel = $('tf-conso-mois'), tbody = $('tf-conso-tbody'), tfoot = $('tf-conso-tfoot');
      const empty = $('tf-conso-empty'), emptyMsg = $('tf-conso-empty-msg');
      if (conso === null) {
        sel.innerHTML = ''; tbody.innerHTML = ''; tfoot.innerHTML = '';
        empty.classList.remove('hidden');
        emptyMsg.textContent = "Le suivi détaillé n'est pas encore disponible."; console.warn('[fleet-views] total_conso absente — infra one-shot : script « total-conso ».');
        return;
      }
      const moisDispo = [...new Set(conso.map(c => c.mois).filter(Boolean))].sort().reverse();
      if (sel.dataset.filled !== moisDispo.join(',')) {
        sel.innerHTML = '<option value="__all__">Toutes les périodes</option>' + moisDispo.map(m => `<option value="${m}">${moisLabel(m)}</option>`).join('');
        sel.dataset.filled = moisDispo.join(',');
      }
      // Filtre « Par conducteur » : rempli une fois (noms résolus, triés) + rendu cherchable.
      { const cs = $('tf-conso-cond'); if (cs && !cs.dataset.filled) { const vbp0 = _tfVehBy(); const names = [...new Set(conso.map(c => _tfName(c, vbp0)).filter(n => n && n !== '—'))].sort((a, b) => a.localeCompare(b)); cs.innerHTML = '<option value="">Tous les conducteurs</option>' + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join(''); cs.dataset.filled = '1'; if (window.FP && FP.searchSelect) { try { FP.searchSelect(cs, { placeholder: 'Conducteur…' }); } catch (e) {} } } }
      // Période (mois ou dates) + conducteur (source unique tfPeriodSrc) → table, analyse ET exports alignés.
      const { src, label, cond } = tfPeriodSrc();

      // Index des véhicules par plaque (normalisée) → pour retrouver le conducteur
      // quand la ligne de conso n'a qu'une plaque (ex. « GP-333-QJ ») au lieu d'un prénom.
      const normPlaque = (s) => FP.normImmat(s); // source unique : helper canonique
      const vehByPlaque = {};
      (window.FP_DATA.vehicules || []).forEach(v => { if (v.immat) vehByPlaque[normPlaque(v.immat)] = v; });
      const resolveName = (c) => {
        if (c.conducteur) return c.conducteur;
        if (c.plaque) {
          const v = vehByPlaque[normPlaque(c.plaque)];
          if (v && v.chauffeur && v.chauffeur.trim() && v.chauffeur !== '—') return v.chauffeur;
        }
        return null;
      };

      // ⚠️ On N'ÉCRASE RIEN : on CUMULE. Plusieurs relevés/factures d'une même
      // période sont additionnés par carte (ou par conducteur si pas de carte).
      const KNUM = ['carburant_ttc','litres','boutique_ttc','lavage_ttc','peage_ttc','total_ht','total_tva','total_ttc'];
      // Un conducteur filtré → on regroupe PAR MOIS (sa conso mois par mois). Sinon par carte/conducteur.
      const groups = new Map();
      for (const c of src){
        const key = cond ? (c.mois || '—') : ((c.carte && String(c.carte)) || resolveName(c) || c.plaque || c.id);
        let g = groups.get(key);
        if (!g){ g = { _month:c.mois, carte:c.carte, conducteur:c.conducteur, plaque:c.plaque, type_vehicule:c.type_vehicule }; KNUM.forEach(k => g[k] = 0); groups.set(key, g); }
        g.conducteur = g.conducteur || c.conducteur;
        g.plaque = g.plaque || c.plaque;
        g.type_vehicule = g.type_vehicule || c.type_vehicule;
        KNUM.forEach(k => g[k] += Number(c[k]) || 0);
      }
      let rows = [...groups.values()];
      if (cond) rows.sort((a,b) => String(b._month || '').localeCompare(String(a._month || '')));
      else rows.sort((a,b) => consoSortDesc ? (b.total_ttc - a.total_ttc) : (a.total_ttc - b.total_ttc));
      // En-tête 1re colonne : « Mois » quand on filtre un conducteur, sinon « Conducteur / Véhicule ».
      { const th = document.querySelector('#tf-conso-table thead th:first-child'); if (th) th.textContent = cond ? 'Mois' : 'Conducteur / Véhicule'; }
      empty.classList.toggle('hidden', rows.length > 0);
      if (!rows.length) { tbody.innerHTML = ''; tfoot.innerHTML = ''; const _cb = $('tf-conso-cards'); if (_cb) _cb.innerHTML = ''; emptyMsg.textContent = 'Aucun détail de consommation pour cette période.'; applyConsoView(true); return; }

      // Si un conducteur a plusieurs véhicules (plusieurs lignes), on garde la plaque.
      const nameCount = {};
      rows.forEach(c => { const n = resolveName(c); if (n) nameCount[n] = (nameCount[n] || 0) + 1; });
      const who = (c) => {
        const brut = resolveName(c);
        // Nom AFFICHÉ = PRÉNOM SEUL (règle globale) ; la clé de regroupement reste le nom complet (`brut`),
        // et la plaque est ajoutée en cas d'homonymes (nameCount[brut] > 1) pour lever l'ambiguïté.
        const nom = brut ? (FP.prenomAffiche ? FP.prenomAffiche(brut) : brut) : brut;
        if (nom) {
          if (c.plaque && nameCount[brut] > 1) {
            return `<span class="font-semibold">${esc(nom)}</span> <span class="font-mono text-slate-400 text-xs">${esc(c.plaque)}</span>`;
          }
          return `<span class="font-semibold">${esc(nom)}</span>`;
        }
        if (c.plaque) return `<span class="font-mono text-slate-500 text-xs">${esc(c.plaque)}</span>`;
        return '<span class="text-slate-400">—</span>';
      };
      // Colonne « Autres » (bonbonne de gaz, accessoires, lubrifiant… = ni carburant, ni boutique/repas,
      // ni lavage, ni péage) depuis le détail transaction, agrégée par la MÊME clé que les lignes. La
      // « Boutique / Repas » affichée est alors NETTE de ces « autres » (sinon le gaz compterait 2×).
      const rowKey = (c) => cond ? (c._month || '—') : ((c.carte && String(c.carte)) || resolveName(c) || c.plaque || c.id);
      // Quand le DÉTAIL transaction est présent, on calcule « Boutique / Repas » et « Autres » depuis les
      // VRAIES transactions (source fiable), pas depuis la ventilation mensuelle groupée (qui sous-comptait
      // les repas). Repas/Boutique = alimentation, sandwich, boissons, produit frais, lubrifiant… ;
      // Autres = uniquement ce qui n'est ni carburant, ni repas/boutique, ni lavage, ni péage (gaz, lave-glace…).
      const txByKey = {};
      if (consoTx && consoTx.length) {
        const _f = $('tf-conso-from').value, _t = $('tf-conso-to').value, _sm = (!_f && !_t) ? ($('tf-conso-mois').value || '') : '', _cs = tfCondSel();
        consoTx.forEach(t => {
          if (_f || _t) { const fm = _f ? _f.slice(0, 7) : null, tm = _t ? _t.slice(0, 7) : null; if (fm && (t.mois || '') < fm) return; if (tm && (t.mois || '') > tm) return; }
          else if (_sm && _sm !== '__all__') { if ((t.mois || '') !== _sm) return; }
          if (_cs && (t.conducteur || '') !== _cs) return;
          const cat = t.produit ? txCat(t.produit) : (t.categorie || 'autre');
          const key = cond ? (t.mois || '—') : ((t.carte && String(t.carte)) || t.conducteur || t.plaque || '—');
          const o = txByKey[key] || (txByKey[key] = { repas: 0, autre: 0, has: true });
          const m = Number(t.montant_ttc) || 0;
          if (cat === 'repas' || cat === 'boutique') o.repas += m;
          else if (cat === 'autre') o.autre += m;
        });
      }
      const txOf = (c) => txByKey[rowKey(c)];
      const autreOf = (c) => { const x = txOf(c); return x ? x.autre : 0; };
      // Avec détail tx : repas réel ; sans détail : ventilation mensuelle « boutique » (repli).
      const boutiqueNetOf = (c) => { const x = txOf(c); return x ? x.repas : (Number(c.boutique_ttc) || 0); };
      const cell = (v) => v ? FP.euro(v) : '<span class="text-slate-300">—</span>';
      tbody.innerHTML = rows.map(c => `<tr>
        <td>${cond ? '<span class="font-semibold">' + esc(moisLabel(c._month || '—')) + '</span>' : who(c)}</td>
        <td style="text-align:right">${cell(c.carburant_ttc)}</td>
        <td style="text-align:right" class="text-slate-500">${c.litres ? FP.num(Math.round(c.litres)) + ' L' : '—'}</td>
        <td style="text-align:right">${cell(boutiqueNetOf(c))}</td>
        <td style="text-align:right">${cell(c.lavage_ttc)}</td>
        <td style="text-align:right">${cell(c.peage_ttc)}</td>
        <td style="text-align:right">${cell(autreOf(c))}</td>
        <td style="text-align:right" class="text-slate-500">${cell(c.total_ht)}</td>
        <td style="text-align:right" class="text-slate-500">${cell(c.total_tva)}</td>
        <td style="text-align:right;font-weight:700">${FP.euro(c.total_ttc)}</td>
      </tr>`).join('');
      const sum = (k) => rows.reduce((s,c) => s + (Number(c[k]) || 0), 0);
      const sumAutre = rows.reduce((s, c) => s + autreOf(c), 0);
      const sumBoutiqueNet = rows.reduce((s, c) => s + boutiqueNetOf(c), 0);
      tfoot.innerHTML = `<tr style="border-top:2px solid var(--fp-border);font-weight:700;background:#f8fafc">
        <td>Total ${esc(label)}</td>
        <td style="text-align:right">${FP.euro(sum('carburant_ttc'))}</td>
        <td style="text-align:right" class="text-slate-500">${FP.num(Math.round(sum('litres')))} L</td>
        <td style="text-align:right">${FP.euro(sumBoutiqueNet)}</td>
        <td style="text-align:right">${FP.euro(sum('lavage_ttc'))}</td>
        <td style="text-align:right">${FP.euro(sum('peage_ttc'))}</td>
        <td style="text-align:right">${FP.euro(sumAutre)}</td>
        <td style="text-align:right">${FP.euro(sum('total_ht'))}</td>
        <td style="text-align:right">${FP.euro(sum('total_tva'))}</td>
        <td style="text-align:right">${FP.euro(sum('total_ttc'))}</td>
      </tr>`;
      // ===== Vue CARTES (Direction B) — mêmes données, une carte par conducteur (ou par mois si filtré) =====
      const _cc = { carb:'#F97316', peage:'#2563EB', repas:'#7C3AED', lav:'#0D9488', autre:'#64748B' };
      const cardsBox = $('tf-conso-cards');
      if (cardsBox) {
        cardsBox.innerHTML = rows.map(c => {
          const nm = cond ? moisLabel(c._month || '—') : (resolveName(c) || c.plaque || '—');
          const carb = Number(c.carburant_ttc)||0, peage = Number(c.peage_ttc)||0, repas = boutiqueNetOf(c), lav = Number(c.lavage_ttc)||0, autre = autreOf(c);
          const ttc = Number(c.total_ttc)||0, litres = Number(c.litres)||0, prixL = litres>0 ? carb/litres : 0;
          const parts = [['carb',carb,'Carburant'],['peage',peage,'Péage / Parking'],['repas',repas,'Boutique / Repas'],['lav',lav,'Lavage'],['autre',autre,'Autres']];
          const denom = (carb+peage+repas+lav+autre) || 1;
          const bar = parts.filter(p=>p[1]>0).map(p=>`<i style="width:${(p[1]/denom*100).toFixed(1)}%;background:${_cc[p[0]]}"></i>`).join('');
          const brk = parts.filter(p=>p[1]>0).map(p=>`<div class="r"><span class="k" style="--d:${_cc[p[0]]}">${p[2]}</span><b>${FP.euro(p[1])}</b></div>`).join('') || '<span class="text-slate-400 text-xs">Aucun détail chiffré</span>';
          const plaque = (!cond && c.plaque && resolveName(c)) ? ` <span class="font-mono text-slate-400 text-xs">${esc(c.plaque)}</span>` : '';
          return `<div class="tf-ccard">
            <div class="top"><span class="nm">${esc(nm)}${plaque}</span><span class="tot">${FP.euro(ttc)}</span></div>
            <div class="tf-splbar">${bar}</div>
            <div class="tf-brk">${brk}</div>
            <div class="foot"><div>Litres<b>${litres?FP.num(Math.round(litres))+' L':'—'}</b></div><div>Prix / L<b>${(prixL>0&&prixL<=4)?prixL.toFixed(3).replace('.',',')+' €':'—'}</b></div><div>HT / TVA<b>${FP.euro(c.total_ht)} / ${FP.euro(c.total_tva)}</b></div></div>
          </div>`;
        }).join('');
      }
      applyConsoView();
    }

    // Bascule Tableau ⟷ Cartes (mémorisé par société via FP.settings, comme la vue Conducteurs).
    function applyConsoView(forceTable){
      let pref = 'table';
      try { if (window.FP && FP.settings) pref = (FP.settings.get().consoView === 'cards') ? 'cards' : 'table'; } catch (e) {}
      let v = forceTable ? 'table' : pref;
      // 📱 MOBILE : la table conso (10 colonnes) est illisible sur téléphone → vue CARTES d'office
      // (sauf forceTable = liste vide). Sur grand écran, le choix de l'utilisateur est respecté.
      try { if (!forceTable && window.matchMedia && window.matchMedia('(max-width: 768px)').matches) v = 'cards'; } catch (e) {}
      const tbl = $('tf-conso-table'), cardsBox = $('tf-conso-cards');
      const tableCard = tbl ? tbl.closest('.card') : null;
      if (tableCard) tableCard.classList.toggle('hidden', v === 'cards');
      if (cardsBox) cardsBox.classList.toggle('hidden', v !== 'cards');
      const tg = $('tf-conso-view'); if (tg) tg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === pref));
      if (window.lucide) { try { lucide.createIcons(); } catch (e) {} }
    }

    // ===== ANALYSE CONSO : prix/litre, CO₂, évolution, répartition, classement, anomalies =====
    const _tfN = x => Number(x) || 0;
    const _tfNormP = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    function _tfVehBy(){ const m = {}; (window.FP_DATA.vehicules || []).forEach(v => { if (v.immat) m[_tfNormP(v.immat)] = v; }); return m; }
    function _tfName(c, vbp){
      // Priorité au n° de carte enregistré sur une fiche conducteur (rattachement fiable, même pour
      // la conso déjà en base : elle suit la fiche en direct). Sinon nom stocké, puis chauffeur/plaque.
      if (window.FP && FP.conducteurParCarteTotal && c.carte){ const rc = FP.conducteurParCarteTotal(c.carte); if (rc && rc.name) return rc.name; }
      // Nom stocké → unifié (prénom seul du relevé → nom complet de la fiche conducteur si connu).
      if (c.conducteur) return (window.FP && FP.conducteurNomUnifie) ? FP.conducteurNomUnifie(c.conducteur) : c.conducteur;
      const v = c.plaque && vbp[_tfNormP(c.plaque)]; if (v && v.chauffeur && v.chauffeur !== '—') return (window.FP && FP.conducteurNomUnifie) ? FP.conducteurNomUnifie(v.chauffeur) : v.chauffeur; return c.plaque || '—';
    }
    function renderAnalyse(){
      const wrap = $('tf-analyse'); if (!wrap) return;
      if (!conso || !conso.length) { wrap.classList.add('hidden'); return; }
      wrap.classList.remove('hidden');
      // Les chiffres, la répartition et le classement suivent la PÉRIODE choisie (mois ou dates).
      // L'évolution (12 mois) et les anomalies restent sur tout l'historique (contexte / veille).
      const { src: rows, label: perLabel } = tfPeriodSrc();
      const perEl = $('tf-an-period'); if (perEl) perEl.textContent = perLabel;
      const vbp = _tfVehBy();
      const tot = { carb:0, litres:0, bout:0, lav:0, peage:0, ttc:0, ht:0, tva:0 }, co2Ref = { gazole:2.64, essence:2.31, mixte:2.51 };
      let co2 = 0;
      rows.forEach(c => {
        tot.carb += _tfN(c.carburant_ttc); tot.litres += _tfN(c.litres); tot.bout += _tfN(c.boutique_ttc);
        tot.lav += _tfN(c.lavage_ttc); tot.peage += _tfN(c.peage_ttc); tot.ttc += _tfN(c.total_ttc);
        tot.ht += _tfN(c.total_ht); tot.tva += _tfN(c.total_tva);
        const v = c.plaque && vbp[_tfNormP(c.plaque)]; const carb = ((v && v.carburant) || '').toLowerCase();
        let f = co2Ref.mixte; if (/gazole|diesel|gasoil/.test(carb)) f = co2Ref.gazole; else if (/essence|sp9|sans plomb/.test(carb)) f = co2Ref.essence; else if (/lectri|hydrog/.test(carb)) f = 0;
        co2 += _tfN(c.litres) * f;
      });
      const prixL = tot.litres > 0 ? tot.carb / tot.litres : 0;
      const eur = FP.euro;
      $('tf-an-stats').innerHTML = [
        ['Litres totaux', FP.num(Math.round(tot.litres)) + ' L', 'carburant consommé'],
        ['Prix moyen / L', (prixL > 0 && prixL <= 4) ? (prixL.toFixed(3).replace('.', ',') + ' €') : '—', 'carburant TTC ÷ litres (relevé)'],
        ['CO₂ estimé', (Math.round(co2 / 100) / 10).toLocaleString('fr-FR') + ' t', 'depuis les litres (est.)'],
        ['Péages', eur(tot.peage), Math.round(tot.peage / (tot.ttc || 1) * 100) + ' % du total'],
      ].map(s => `<div class="kpi"><div class="kpi-label">${s[0]}</div><div class="kpi-value" style="font-size:1.35rem">${s[1]}</div><div class="kpi-delta">${s[2]}</div></div>`).join('');
      // Évolution 12 mois
      const byMonth = {}; conso.forEach(c => { if (!c.mois) return; const m = byMonth[c.mois] || (byMonth[c.mois] = { ttc:0, litres:0 }); m.ttc += _tfN(c.total_ttc); m.litres += _tfN(c.litres); });
      const months = Object.keys(byMonth).sort().slice(-12); const maxT = Math.max(1, ...months.map(m => byMonth[m].ttc));
      $('tf-an-evol').innerHTML = months.length ? months.map(m => { const v = byMonth[m]; return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="width:74px;font-size:11px;color:#64748b">${moisLabel(m)}</div><div style="flex:1;background:#f1f5f9;border-radius:6px;overflow:hidden;height:15px"><div style="width:${Math.round(v.ttc / maxT * 100)}%;height:100%;background:linear-gradient(90deg,#f97316,#fb923c)"></div></div><div style="width:88px;text-align:right;font-size:12px;font-weight:600">${eur(v.ttc)}</div><div style="width:60px;text-align:right;font-size:11px;color:#94a3b8">${FP.num(Math.round(v.litres))} L</div></div>`; }).join('') : '<p class="text-sm text-slate-400">Pas assez de données.</p>';
      // Répartition — si le détail transaction est importé, on sépare « Repas » et « Autres »
      // (bonbonne de gaz, divers) ; sinon on garde le poste groupé « Boutique / repas ».
      let repasTot = 0, autreTot = 0, hasTxRep = false;
      if (consoTx && consoTx.length) {
        const _f = $('tf-conso-from').value, _t = $('tf-conso-to').value;
        const _sm = (!_f && !_t) ? ($('tf-conso-mois').value || '') : '', _cs = tfCondSel();
        consoTx.forEach(t => {
          if (_f || _t) { const fm = _f ? _f.slice(0, 7) : null, tm = _t ? _t.slice(0, 7) : null; if (fm && (t.mois || '') < fm) return; if (tm && (t.mois || '') > tm) return; }
          else if (_sm && _sm !== '__all__') { if ((t.mois || '') !== _sm) return; }
          if (_cs && (t.conducteur || '') !== _cs) return;
          const _c = t.produit ? txCat(t.produit) : (t.categorie || 'autre');
          if (_c === 'repas' || _c === 'boutique') { repasTot += _tfN(t.montant_ttc); hasTxRep = true; }
          else if (_c === 'autre') { autreTot += _tfN(t.montant_ttc); hasTxRep = true; }
        });
      }
      const parts = hasTxRep
        ? [['Carburant', tot.carb, '#f97316'], ['Péage / parking', tot.peage, '#0e7490'], ['Lavage', tot.lav, '#0891b2'], ['Boutique / repas', repasTot, '#8b5cf6'], ['Autres (gaz, divers)', autreTot, '#ec4899']]
        : [['Carburant', tot.carb, '#f97316'], ['Péage / parking', tot.peage, '#0e7490'], ['Lavage', tot.lav, '#0891b2'], ['Boutique / repas', tot.bout, '#8b5cf6']];
      const totP = parts.reduce((s, p) => s + p[1], 0) || 1;
      $('tf-an-repart').innerHTML = parts.map(p => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:9px"><div style="width:118px;font-size:12px;color:#475569">${p[0]}</div><div style="flex:1;background:#f1f5f9;border-radius:6px;overflow:hidden;height:14px"><div style="width:${Math.round(p[1] / totP * 100)}%;height:100%;background:${p[2]}"></div></div><div style="width:42px;text-align:right;font-size:12px;font-weight:600">${Math.round(p[1] / totP * 100)}%</div><div style="width:78px;text-align:right;font-size:11px;color:#94a3b8">${eur(p[1])}</div></div>`).join('');
      // Classement conducteurs
      const byD = {}; rows.forEach(c => { const n = _tfName(c, vbp); const d = byD[n] || (byD[n] = { nom:n, ttc:0, carb:0, litres:0, bout:0 }); d.ttc += _tfN(c.total_ttc); d.carb += _tfN(c.carburant_ttc); d.litres += _tfN(c.litres); d.bout += _tfN(c.boutique_ttc); });
      const rank = Object.values(byD).sort((a, b) => b.ttc - a.ttc).slice(0, 8); const maxD = Math.max(1, ...rank.map(d => d.ttc));
      $('tf-an-rank').innerHTML = rank.map((d, i) => { const pl = d.litres > 0 ? d.carb / d.litres : 0; return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px"><div style="width:16px;font-weight:800;color:#94a3b8">${i + 1}</div><div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:#0f1e3d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.nom)}</div><div style="background:#f1f5f9;border-radius:5px;overflow:hidden;height:7px;margin-top:2px"><div style="width:${Math.round(d.ttc / maxD * 100)}%;height:100%;background:#f97316"></div></div></div><div style="width:78px;text-align:right;font-size:12px;font-weight:700">${eur(d.ttc)}</div><div style="width:66px;text-align:right;font-size:11px;color:#94a3b8" title="${(pl>0&&pl<=4)?'Carburant TTC ÷ litres du relevé':'Prix/L masqué : nombre de litres incomplet sur le relevé'}">${(pl>0&&pl<=4) ? pl.toFixed(2).replace('.', ',') + ' €/L' : ''}</div></div>`; }).join('') || '<p class="text-sm text-slate-400">—</p>';
      // === POINTS À VÉRIFIER — seuils configurables ; clic → ouvre la facture concernée ===
      const anom = [];
      const lim = tfLimits();
      // Même filtre de période que la vue (mois OU dates), + conducteur.
      const _from = $('tf-conso-from').value, _to = $('tf-conso-to').value;
      const _selM = (!_from && !_to) ? ($('tf-conso-mois').value || '') : '';
      const _condSel = tfCondSel();
      const _txIn = (t) => {
        if (_from || _to) { const fm = _from ? _from.slice(0, 7) : null, tm = _to ? _to.slice(0, 7) : null; if (fm && (t.mois || '') < fm) return false; if (tm && (t.mois || '') > tm) return false; }
        else if (_selM && _selM !== '__all__') { if ((t.mois || '') !== _selM) return false; }
        return !_condSel || (t.conducteur || '') === _condSel;
      };
      if (consoTx && consoTx.length) {
        // ⚠️ SOURCE UNIQUE : détection (>3 pleins/jour, repas>seuil/jour, achats « Autres ») via le helper
        //    partagé FP.totalFleetAnomaliesTx → MÊME logique que la page « Suivi & alertes ».
        FP.totalFleetAnomaliesTx(consoTx.filter(_txIn)).forEach(a => anom.push(a));
      } else {
        // Détail pas encore importé → PAS d'amalgame mensuel : une seule invitation à reconstruire le détail.
        anom.push({ t:'info', txt:'Le détail achat par achat (repas/jour, bonbonnes de gaz, accessoires…) se reconstruit tout seul à l\'ouverture de l\'onglet Contrôle. Reviens dans un instant, il apparaîtra automatiquement.' });
      }
      // Dépense globale d'un conducteur qui EXPLOSE d'un mois sur l'autre (grosse hausse seulement).
      const dm = {}; conso.forEach(c => { if (!c.mois) return; const n = _tfName(c, vbp); (dm[n] = dm[n] || {})[c.mois] = (dm[n][c.mois] || 0) + _tfN(c.total_ttc); });
      Object.keys(dm).forEach(n => { const ms = Object.keys(dm[n]).sort(); if (ms.length < 3) return; const last = ms[ms.length - 1], prev = ms.slice(0, -1); const avg = prev.reduce((s, m) => s + dm[n][m], 0) / prev.length; if (avg > 100 && dm[n][last] > avg * 1.6) anom.push({ t:'info', mois:last, txt:`${n} · ${moisLabel(last)} : ${eur(dm[n][last])} dépensés ce mois-ci vs ${eur(Math.round(avg))} en moyenne → forte hausse, à vérifier` }); });
      anom.sort((a, b) => (a.t === 'warn' ? 0 : 1) - (b.t === 'warn' ? 0 : 1));
      // Clé stable par anomalie (pour mémoriser « vérifiée / archivée ») + index par clé (ouverture facture).
      // ⚠️ NE PAS écraser la clé déjà posée par le helper partagé (ex. diesel = « diesel|<nom> ») :
      //    sinon l'archivage ne serait PAS reconnu par « Suivi & alertes » (clés différentes).
      anom.forEach(a => { if (!a.key) a.key = a.t + '|' + (a.facnum || '') + '|' + a.txt; });
      _tfAnom = anom; _tfAnomByKey = {}; anom.forEach(a => { _tfAnomByKey[a.key] = a; });
      renderAnomList();
    }
    // Anomalies « vérifiées » (archivées) : mémorisées dans les réglages (clé → enregistrement complet,
    // pour garder l'HISTORIQUE même si la donnée change). Coche verte = archive ; flèche rouge = désarchive.
    function tfAnomOk(){ try { return FP.settings.get().tfAnomOk || {}; } catch (e) { return {}; } }
    function tfAnomSaveOk(map){ try { const s = FP.settings.get(); s.tfAnomOk = map; FP.settings.save(s); } catch (e) { if (FP.toast) FP.toast('Enregistrement impossible'); } try { window.dispatchEvent(new CustomEvent('pp:anom-sync')); } catch (e) {} }
    let _tfAnomMode = 'active';
    // Statut changé côté Contrôle (justifié/fraude/classé) → tfAnomOk modifié ailleurs : on rafraîchit
    // « Points à vérifier » EN DIRECT (même source unique tfAnomOk, cohérence des deux vues).
    try { window.addEventListener('pp:anom-sync', function () { try { renderAnomList(); } catch (e) {} }); } catch (e) {}
    function renderAnomList(){
      const box = $('tf-an-anom'); if (!box) return;
      const okMap = tfAnomOk();
      const okKeys = Object.keys(okMap);
      { const n = $('tf-anom-arch-n'); if (n) n.textContent = '(' + okKeys.length + ')'; }
      // onglets
      const tA = $('tf-anom-tab-active'), tR = $('tf-anom-tab-arch');
      if (tA && tR) {
        const on = 'border-teal-500 bg-teal-500 text-white', off = 'border-slate-200 text-slate-500 hover:border-teal-400';
        tA.className = 'text-xs font-semibold px-2.5 py-1 rounded-full border ' + (_tfAnomMode === 'active' ? on : off);
        tR.className = 'text-xs font-semibold px-2.5 py-1 rounded-full border ' + (_tfAnomMode === 'archive' ? on : off);
      }
      const dot = (t) => `<span style="color:${t === 'warn' ? '#d97706' : '#64748b'}">●</span>`;
      if (_tfAnomMode === 'archive') {
        const recs = okKeys.map(k => okMap[k]).sort((a, b) => (b.okAt || 0) - (a.okAt || 0));
        if (!recs.length) { box.innerHTML = '<p class="text-sm text-slate-400">Aucune anomalie archivée. Coche la ✓ verte sur un point à vérifier pour l\'archiver.</p>'; if (window.lucide) lucide.createIcons(); return; }
        box.innerHTML = recs.map(a => `<div data-anom-key="${esc(a.key)}" style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid #f1f5f9;font-size:12.5px;border-radius:6px"><button type="button" data-anom-unok="${esc(a.key)}" title="Désarchiver (remettre à vérifier)" style="flex:none;color:#dc2626;background:none;border:none;cursor:pointer;font-weight:800;font-size:14px">↩</button>${dot(a.t)}<span style="color:#334155;flex:1;cursor:pointer" data-anom-open="1">${esc(a.txt)}${a.okAt ? ' <span style=\"color:#94a3b8\">· vérifié le ' + esc(FP.dateNum(new Date(a.okAt).toISOString().slice(0,10))) + '</span>' : ''}</span><span style="font-size:11px;color:var(--fp-accent);font-weight:700;white-space:nowrap;cursor:pointer" data-anom-open="1">Voir la facture ›</span></div>`).join('');
        if (window.lucide) lucide.createIcons();
        return;
      }
      // mode « à vérifier » : anomalies calculées NON archivées
      const active = _tfAnom.filter(a => (FP.tfAnomArchivee ? !FP.tfAnomArchivee(a, okMap) : !okMap[a.key]));
      if (!active.length) { box.innerHTML = '<p class="text-sm text-emerald-700">✓ Rien à vérifier' + (okKeys.length ? ' (tout est archivé).' : '.') + '</p>'; if (window.lucide) lucide.createIcons(); return; }
      const row = (a) => `<div class="tf-anom-row" data-anom-key="${esc(a.key)}" style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid #f1f5f9;font-size:12.5px;border-radius:6px"><button type="button" data-anom-ok="${esc(a.key)}" title="Marquer comme vérifié / OK (archive)" style="flex:none;color:#16a34a;background:none;border:none;cursor:pointer;font-weight:800;font-size:15px">✓</button>${dot(a.t)}<span style="color:#334155;flex:1;cursor:pointer" data-anom-open="1" title="Ouvrir la facture Total concernée">${esc(a.txt)}</span><span style="font-size:11px;color:var(--fp-accent);font-weight:700;white-space:nowrap;cursor:pointer" data-anom-open="1">Voir la facture ›</span></div>`;
      box.innerHTML = active.map(row).join('')
        + `<button type="button" id="tf-anom-more" data-open="0" data-total="${active.length}" data-cut="0" style="display:none;margin-top:8px;width:100%;text-align:center;font-size:12px;font-weight:700;color:var(--fp-accent);background:none;border:none;cursor:pointer;padding:6px">Voir tout (${active.length}) ›</button>`;
      (window.requestAnimationFrame || setTimeout)(fitAnoms);
      if (window.lucide) lucide.createIcons();
    }
    // Réduit la liste des points à vérifier à ce qui TIENT dans la carte (hauteur = carte « Classement »
    // via la grille), le reste est masqué derrière « Voir tout ». Recalculé au rendu et au redimensionnement.
    function fitAnoms(){
      const box = $('tf-an-anom'); if (!box) return;
      const rows = [].slice.call(box.querySelectorAll('[data-anom-key]'));
      const btn = box.querySelector('#tf-anom-more');
      if (!rows.length || !btn) return;
      rows.forEach(r => r.classList.remove('tf-anom-hidden'));
      btn.style.display = 'none';
      // Cible = hauteur du CONTENU de la carte « Classement » (voisine), qui donne la hauteur naturelle
      // à remplir. (On ne mesure PAS la carte Points à vérifier elle-même : avec toutes les lignes elle
      // est gonflée et la grille égalise les deux hauteurs → référence faussée.)
      const rank = document.getElementById('tf-an-rank');
      const budget = (rank && rank.offsetHeight > 60) ? rank.offsetHeight - 26 /* place du bouton */ : 300;
      if (budget < 60) return;
      let used = 0, cut = rows.length;
      for (let i = 0; i < rows.length; i++){ const h = rows[i].offsetHeight; if (used + h > budget){ cut = Math.max(1, i); break; } used += h; }
      cut = Math.min(cut, 12); // garde-fou : jamais plus de 12 lignes d'un coup (toggle garanti si longue liste)
      if (cut >= rows.length) return; // tout rentre → pas de bouton
      rows.forEach((r, i) => { if (i >= cut) r.classList.add('tf-anom-hidden'); });
      btn.dataset.open = '0'; btn.dataset.cut = String(cut); btn.dataset.total = String(rows.length);
      btn.innerHTML = 'Voir tout (' + rows.length + ') ›'; btn.style.display = '';
    }
    { let _rt; window.addEventListener('resize', () => { clearTimeout(_rt); _rt = setTimeout(() => { if (!$('view-total').classList.contains('hidden')) fitAnoms(); }, 200); }); }
    // Export CSV de la conso (relevés mensuels par carte)
    if ($('tf-an-csv')) $('tf-an-csv').addEventListener('click', () => {
      const rows = tfPeriodSrc().src; // export = période choisie
      if (!rows.length) { if (FP.toast) FP.toast('Aucune donnée sur la période'); return; }
      const cols = ['mois', 'conducteur', 'plaque', 'carte', 'carburant_ttc', 'litres', 'boutique_ttc', 'lavage_ttc', 'peage_ttc', 'total_ht', 'total_tva', 'total_ttc'];
      const head = ['Mois', 'Conducteur', 'Plaque', 'Carte', 'Carburant TTC', 'Litres', 'Boutique', 'Lavage', 'Péage', 'HT', 'TVA', 'TTC'];
      const numCols = { carburant_ttc:1, litres:1, boutique_ttc:1, lavage_ttc:1, peage_ttc:1, total_ht:1, total_tva:1, total_ttc:1 };
      const src = rows.slice().sort((a, b) => String(a.mois).localeCompare(String(b.mois)));
      // Vrai Excel (.xlsx) : montants en cellules numériques, colonnes propres, encodage correct.
      if (FP.downloadXlsx) {
        const data = src.map(c => cols.map(k => { const v = c[k]; if (numCols[k]) { const n = Number(v); return isFinite(n) ? n : ''; } return v == null ? '' : v; }));
        FP.downloadXlsx('total-fleet-conso', head, data, { sheet: 'Total Fleet' }); return;
      }
      const q = v => { const s = String(v == null ? '' : v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const lines = ['sep=;', head.join(';')].concat(src.map(c => cols.map(k => q(c[k])).join(';')));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'total-fleet-conso.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    });
    // Rapport PDF (relevé Total Fleet agrégé par conducteur) — via FP.fiche (jsPDF paresseux géré)
    if ($('tf-an-pdf')) $('tf-an-pdf').addEventListener('click', () => {
      if (!(FP.fiche && FP.fiche.open)) return;
      const { src, label, cond } = tfPeriodSrc(); // relevé = période + conducteur choisis
      if (!src.length) { if (FP.toast) FP.toast('Aucune donnée sur la période'); return; }
      const vbp = _tfVehBy(); const g = {};
      // Conducteur filtré → relevé PAR MOIS ; sinon PAR conducteur.
      src.forEach(c => { const n = cond ? moisLabel(c.mois || '—') : _tfName(c, vbp); const d = g[n] || (g[n] = { nom:n, carb:0, litres:0, peage:0, ht:0, tva:0, ttc:0 }); d.carb += _tfN(c.carburant_ttc); d.litres += _tfN(c.litres); d.peage += _tfN(c.peage_ttc); d.ht += _tfN(c.total_ht); d.tva += _tfN(c.total_tva); d.ttc += _tfN(c.total_ttc); });
      const rows = cond ? Object.values(g) : Object.values(g).sort((a, b) => b.ttc - a.ttc);
      FP.fiche.open({ key: 'totalfleet', title: 'Relevé Total Fleet — carburant & péages' + (label && label !== 'Toutes les périodes' ? ' — ' + label : ''), rows, cols: [
        { id: 'nom', label: cond ? 'Mois' : 'Conducteur / Véhicule', def: true, get: r => r.nom },
        { id: 'carb', label: 'Carburant', def: true, align: 'right', get: r => FP.euro(r.carb), sum: r => r.carb },
        { id: 'litres', label: 'Litres', def: true, align: 'right', get: r => FP.num(Math.round(r.litres)) + ' L', sum: r => r.litres, fmt: t => FP.num(Math.round(t)) + ' L' },
        { id: 'peage', label: 'Péage', def: true, align: 'right', get: r => FP.euro(r.peage), sum: r => r.peage },
        { id: 'ht', label: 'HT', def: false, align: 'right', get: r => FP.euro(r.ht), sum: r => r.ht },
        { id: 'tva', label: 'TVA', def: false, align: 'right', get: r => FP.euro(r.tva), sum: r => r.tva },
        { id: 'ttc', label: 'TTC', def: true, align: 'right', get: r => FP.euro(r.ttc), sum: r => r.ttc },
      ] });
    });

    // Onglets « À vérifier » / « Archivées ».
    if ($('tf-anom-tab-active')) $('tf-anom-tab-active').addEventListener('click', () => { _tfAnomMode = 'active'; renderAnomList(); });
    if ($('tf-anom-tab-arch')) $('tf-anom-tab-arch').addEventListener('click', () => { _tfAnomMode = 'archive'; renderAnomList(); });

    // Clics dans la liste des points à vérifier : ✓ archive · ↩ désarchive · toggle · ouvrir la facture.
    if ($('tf-an-anom')) $('tf-an-anom').addEventListener('click', (e) => {
      // ✓ vert : marquer vérifié (archiver)
      const ok = e.target.closest('[data-anom-ok]');
      if (ok) { const key = ok.getAttribute('data-anom-ok'); const a = _tfAnomByKey[key]; if (a) { const m = tfAnomOk(); m[key] = { key, t: a.t, txt: a.txt, mois: a.mois || '', facnum: a.facnum || '', okAt: Date.now() }; tfAnomSaveOk(m); renderAnomList(); if (FP.toast) FP.toast('✓ Archivé'); } return; }
      // ↩ rouge : désarchiver (remettre à vérifier)
      const unok = e.target.closest('[data-anom-unok]');
      if (unok) { const key = unok.getAttribute('data-anom-unok'); const m = tfAnomOk(); m[key] = { unok: true }; tfAnomSaveOk(m); renderAnomList(); if (FP.toast) FP.toast('Remis à vérifier'); return; }
      // Toggle « Voir tout / Voir moins »
      const more = e.target.closest('#tf-anom-more');
      if (more) {
        const rows = [].slice.call($('tf-an-anom').querySelectorAll('[data-anom-key]'));
        const open = more.dataset.open === '1', cut = +(more.dataset.cut || 0);
        rows.forEach((r, i) => { if (i >= cut) r.classList.toggle('tf-anom-hidden', open); });
        more.dataset.open = open ? '0' : '1';
        more.innerHTML = open ? ('Voir tout (' + (more.dataset.total || '') + ') ›') : 'Voir moins ▲';
        return;
      }
      // Ouvrir la facture (clic sur le texte / « Voir la facture »)
      const el = e.target.closest('[data-anom-key]'); if (!el) return;
      const key = el.getAttribute('data-anom-key'); const a = _tfAnomByKey[key] || tfAnomOk()[key]; if (!a) return;
      let fac = a.facnum ? (window.FP_DATA.factures || []).find(f => (f.numeroFacture || '') === a.facnum || f.id === 'TF-' + a.facnum) : null;
      if (!fac && a.mois) { fac = (window.FP_DATA.factures || []).filter(f => (typeof isTotalFleet === 'function' ? isTotalFleet(f) : true) && (f.date || '').slice(0, 7) === a.mois).sort((x, y) => (Number(y.montantTTC) || 0) - (Number(x.montantTTC) || 0))[0]; }
      // « Voir la facture » = ouvre DIRECTEMENT le PDF (jamais un aperçu intégré) — helper unique FP.openPdf.
      if (fac && FP.openPdf) FP.openPdf(fac.url || fac.fileId, 'Aucun PDF stocké pour ce relevé — réimporte-le une fois.');
      else if (fac && typeof openTfDrawer === 'function') openTfDrawer(fac);
      else if (FP.toast) FP.toast('Facture introuvable — réimporte le relevé Total.');
    });

    // === Seuils d'alerte configurables (repas/jour, article « autre », boutique/mois) ===
    (function () {
      const btn = $('tf-seuils-btn'), panel = $('tf-seuils'); if (!btn || !panel) return;
      const canEdit = !FP.canManageSociete || FP.canManageSociete(); // config société = CEO/Admin
      const fill = () => { const l = tfLimits(); $('ts-repas').value = l.repasJour; $('ts-autre').value = l.autreItem; $('ts-horscarb').value = l.horsCarbMois; };
      btn.addEventListener('click', () => { const show = panel.classList.contains('hidden'); panel.classList.toggle('hidden'); if (show) fill(); });
      if (!canEdit) {
        // Gestionnaire : lecture seule (la config société est réservée CEO/Admin).
        ['ts-repas', 'ts-autre', 'ts-horscarb'].forEach(id => { const e = $(id); if (e) e.disabled = true; });
        const s = $('ts-save'); if (s) { s.disabled = true; s.classList.add('opacity-40', 'cursor-not-allowed'); s.title = 'Réservé à l\'administrateur'; }
        const r = $('ts-reset'); if (r) r.style.display = 'none';
      }
      if ($('ts-reset')) $('ts-reset').addEventListener('click', () => { $('ts-repas').value = 20; $('ts-autre').value = 20; $('ts-horscarb').value = 40; });
      if ($('ts-save')) $('ts-save').addEventListener('click', async () => {
        if (!canEdit) return;
        const g = (id, d) => { const v = Number($(id).value); return v > 0 ? v : d; };
        const seuils = { repasJour: g('ts-repas', 20), autreItem: Math.max(0, Number($('ts-autre').value) || 0), horsCarbMois: g('ts-horscarb', 40) };
        try { const s = FP.settings.get(); s.tfSeuils = seuils; await FP.settings.save(s); if (FP.toast) FP.toast('Seuils enregistrés ✓'); }
        catch (e) { if (FP.toast) FP.toast('Enregistrement impossible'); return; }
        panel.classList.add('hidden'); renderAnalyse();
      });
    })();
    const _tfRerender = () => { renderConso(); renderAnalyse(); };
    $('tf-conso-cond').addEventListener('change', _tfRerender);
    $('tf-conso-mois').addEventListener('change', _tfRerender);
    $('tf-conso-from').addEventListener('change', _tfRerender);
    $('tf-conso-to').addEventListener('change', _tfRerender);
    $('tf-conso-clear').addEventListener('click', () => { $('tf-conso-from').value = ''; $('tf-conso-to').value = ''; _tfRerender(); });
    // Bascule Tableau / Cartes (mémorisée par société) — comme le sélecteur de vue des Conducteurs.
    { const vt = $('tf-conso-view'); if (vt) vt.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { try { if (window.FP && FP.settings) { const s = FP.settings.get(); s.consoView = b.dataset.v; FP.settings.save(s); } } catch (e) {} applyConsoView(); })); }
    try { const _mqC = window.matchMedia('(max-width: 768px)'); (_mqC.addEventListener ? _mqC.addEventListener('change', () => applyConsoView()) : _mqC.addListener(() => applyConsoView())); } catch (e) {}
    if (FP.filterResetButton) FP.filterResetButton($('tf-conso-cond').closest('div'), { onReset: () => {
      $('tf-conso-mois').value = '__all__'; $('tf-conso-from').value = ''; $('tf-conso-to').value = '';
      const cs = $('tf-conso-cond'); cs.value = ''; cs.dispatchEvent(new Event('change', { bubbles: true })); // resync searchSelect + re-render
    } });
    document.querySelector('#tf-conso-table thead th:last-child').style.cursor = 'pointer';
    document.querySelector('#tf-conso-table thead th:last-child').addEventListener('click', () => { consoSortDesc = !consoSortDesc; renderConso(); });

    window.renderTotalFleet = () => { render(); if (!consoLoaded) loadConso(); else renderConso(); };
    document.addEventListener('fp:data-ready', () => { if (!$('view-total').classList.contains('hidden')) render(); });

    // ============================================================
    //  Import Total (PDF) -> 1) factures par pays  2) consommation par carte.
    //  - Le releve (RLP) donne le recap des factures par pays.
    //  - Chaque facture detaillee (FAC) donne SA facture + le detail PAR CARTE
    //    (section « Votre Facture et son detail » -> lignes « Total Support »).
    //  Le conducteur est resolu via la correspondance carte->nom deja connue
    //  (les noms du PDF sont abreges, le n° de carte est le seul repere fiable).
    //  Reutilise loadPdf / parseEuro definis plus haut (meme <script>).
    // ============================================================
    const PAYS = { FRA:'France', NLD:'Pays-Bas', BEL:'Belgique', DEU:'Allemagne', LUX:'Luxembourg',
                   ESP:'Espagne', ITA:'Italie', PRT:'Portugal', GBR:'Royaume-Uni', CHE:'Suisse',
                   AUT:'Autriche', POL:'Pologne', CZE:'Tchequie', DNK:'Danemark', SWE:'Suede' };
    const PAYS_FAC = { FRANCE:'France', BELGIE:'Belgique', BELGIQUE:'Belgique', NEDERLAND:'Pays-Bas',
                       DEUTSCHLAND:'Allemagne', ALLEMAGNE:'Allemagne' };
    const DEC = '\\d[\\d \\u00a0\\u202f]*[.,]\\d{2}';
    const SP = /[\u00a0\u202f\u2009\u2007]/g;
    const n0 = (v) => parseEuro(v) || 0;
    const isPlaque = (s) => /^[A-Z]{2}-?\d{3}-?[A-Z]{2}$/.test(String(s || '').toUpperCase().trim());

    async function pdfTextAll(pdf){
      let txt = '';
      for (let p = 1; p <= pdf.numPages; p++){ const page = await pdf.getPage(p); const c = await page.getTextContent(); txt += c.items.map(it => it.str).join(' ') + '\n'; }
      return txt;
    }

    // 1) Recap du releve : <N° piece> Facture <date> <PAYS3> EUR <HT> <TVA> <TTC>
    function parseReleve(raw){
      const t = (raw || '').replace(SP, ' ');
      const A = '([0-9][0-9 ]*[.,][0-9]{2})';
      const re = new RegExp('([A-Z][0-9][A-Z0-9]{5,7})\\s+Facture\\s+(\\d{2}/\\d{2}/\\d{4})\\s+([A-Z]{3})\\s+EUR\\s+' + A + '\\s+' + A + '\\s+' + A, 'g');
      const seen = new Set(), rows = []; let m;
      while ((m = re.exec(t))){
        if (seen.has(m[1])) continue; seen.add(m[1]);
        const [dd, mm, yyyy] = m[2].split('/');
        rows.push({ numero: m[1], dmy: m[2], paysLabel: PAYS[m[3]] || m[3], date: yyyy + '-' + mm + '-' + dd,
                    ht: parseEuro(m[4]), tva: parseEuro(m[5]), ttc: parseEuro(m[6]) });
      }
      return rows;
    }

    // 2) Une facture detaillee (FAC) -> { numero, pays, date, HT, TVA, TTC }
    function parseFac(raw, fileName){
      const t = (raw || '').replace(SP, ' ');
      let mh = t.match(/(FRANCE|BELGIE|BELGIQUE|NEDERLAND|DEUTSCHLAND|ALLEMAGNE)\s*[-–]\s*N\s*[°ºo]?\s*([A-Z][0-9][A-Z0-9]{5,7})/i);
      // Repli : pays détecté n'importe où + n° pris dans le nom de fichier (…_F6J72387_…)
      if (!mh) {
        const pays = (t.match(/\b(FRANCE|BELGIE|BELGIQUE|NEDERLAND|DEUTSCHLAND|ALLEMAGNE)\b/i) || [])[1];
        const num = fileName && (String(fileName).match(/_([A-Z][0-9][A-Z0-9]{5,7})_/) || [])[1];
        if (pays && num) mh = [null, pays.toUpperCase(), num];
      }
      if (!mh) return null;
      const md = t.match(/(?:Le|Factuurdatum)\s*(\d{2})\/(\d{2})\/(\d{4})/);
      let dmy = md ? (md[1] + '/' + md[2] + '/' + md[3]) : null;
      let date = md ? (md[3] + '-' + md[2] + '-' + md[1]) : null;
      // Repli (factures allemandes notamment) : la date est dans le nom du fichier (…_AAAAMMJJFAC…)
      if (!date && fileName) { const mf = String(fileName).match(/(20\d{2})(\d{2})(\d{2})/); if (mf) { date = mf[1] + '-' + mf[2] + '-' + mf[3]; dmy = mf[3] + '/' + mf[2] + '/' + mf[1]; } }
      // Total : « Total Général » (FR), « Totaal » (NL) ou « Insgesamt » (DE)
      const mt = t.match(new RegExp('(?:Total General|Total Général|Totaal|Insgesamt)\\s+(' + DEC + ')\\s+(' + DEC + ')\\s+EUR\\s+(' + DEC + ')'));
      return { numero: mh[2], paysLabel: PAYS_FAC[String(mh[1]).toUpperCase()] || mh[1],
               dmy: dmy, date: date,
               ht: mt ? parseEuro(mt[1]) : null, tva: mt ? parseEuro(mt[2]) : null, ttc: mt ? parseEuro(mt[3]) : null };
    }

    // 3) Detail par carte. Categories imprimees en colonnes -> on de-mele :
    //    N libelles consecutifs puis 4N nombres (qte,HT,TVA,TTC par colonnes).
    const CATS = [
      { key:'carburant', lit:true, rx:'Total Essences & Gazole|Totaal Benzines en Diesel|Summe Benzin & Diesel' },
      { key:'boutique',           rx:'Total Services et Partenaires|Totaal Services en Partners' },
      { key:'peage',              rx:'Total Parkings|Totaal Parkings' },
      { key:'lavage',             rx:'Total Lavages?|Totaal Wassen' },
    ];
    const CAT_LABELS = CATS.map(c => c.rx).join('|');
    function parseConso(raw){
      // ⚠️ On COLLAPSE les espaces multiples en un seul : certaines factures TotalEnergies
      // s'extraient avec plusieurs espaces (« Type véh.   03 ») → les regex à espace unique
      // ne trouvaient plus AUCUNE carte (conso par conducteur vide). Le collapse rend la
      // lecture robuste quel que soit l'espacement du PDF. (parseFac/parseReleve utilisent
      // déjà \s+, seul ce détail par carte était rigide.)
      const t = (raw || '').replace(SP, ' ').replace(/[ \t]+/g, ' ');
      const idx = t.indexOf('Votre Facture et son détail');
      const det = idx >= 0 ? t.slice(idx) : t;
      const supRe = new RegExp(
        'Total Support (\\d+)(?: \\d+)? (.+?) Type véh\\. (\\d+)\\D{0,30}?(' + DEC + ')\\s+(' + DEC + ')\\s+(' + DEC + ')'
        + '|Totaal Kaart (\\d+) \\d+ (.+?) (\\d{2}) (' + DEC + ') (' + DEC + ') (' + DEC + ')'
        + '|Summe Karte / Telebadge (\\d+) \\d+ (.+?) Kfz-Typ (\\d+)\\s+(' + DEC + ')\\s+(' + DEC + ')\\s+(' + DEC + ')', 'g');
      const hits = []; let m;
      while ((m = supRe.exec(det))){
        if (m[1] != null)       hits.push({ i:m.index, end:supRe.lastIndex, carte:m[1],  nom:m[2].trim(),  type:m[3],  ht:n0(m[4]),  tva:n0(m[5]),  total:n0(m[6]) });
        else if (m[7] != null)  hits.push({ i:m.index, end:supRe.lastIndex, carte:m[7],  nom:m[8].trim(),  type:m[9],  ht:n0(m[10]), tva:n0(m[11]), total:n0(m[12]) });
        else                    hits.push({ i:m.index, end:supRe.lastIndex, carte:m[13], nom:m[14].trim(), type:m[15], ht:n0(m[16]), tva:n0(m[17]), total:n0(m[18]) });
      }
      const grpRe = new RegExp('((?:(?:' + CAT_LABELS + ')\\s*)+)((?:(?:' + DEC + '|\\d+)\\s*)+)');
      const rows = []; let prev = 0;
      for (const h of hits){
        const block = det.slice(prev, h.i); prev = h.end;
        const r = { carte:h.carte, nom:h.nom, type:h.type, carburant:0, litres:0, boutique:0, peage:0, lavage:0, total:h.total, ht:h.ht, tva:h.tva };
        const g = block.match(grpRe);
        if (g){
          const order = []; let lm; const lre = new RegExp(CAT_LABELS, 'g');
          while ((lm = lre.exec(g[1]))) order.push(CATS.find(c => new RegExp('^(?:' + c.rx + ')$').test(lm[0])));
          const N = order.length, toks = g[2].trim().split(/\s+/).map(n0);
          order.forEach((c, k) => { if (!c) return; r[c.key] = toks[3 * N + k] || 0; if (c.lit) r.litres = toks[k] || 0; });
        }
        // Si la ventilation ne tombe pas juste sur le total de la carte (format
        // etranger different) -> tout en carburant (ce sont des cartes essence).
        if (Math.abs(r.carburant + r.boutique + r.peage + r.lavage - r.total) > 0.02){
          r.carburant = r.total; r.boutique = 0; r.peage = 0; r.lavage = 0; r.litres = 0;
        }
        rows.push(r);
      }
      return rows;
    }

    // === DÉTAIL TRANSACTION PAR TRANSACTION (une ligne = un achat) ===
    // Validé sur une vraie facture Total. Ancre les produits sur leurs libellés connus, prend le
    // TTC = dernier montant à 2 décimales non suivi d'un chiffre (exclut les PU à 4 décimales).
    const TX_PROD = /(Gazole(?: Premier| Excellium)?|Super \d+(?: Sans PL)?|SP\d{2}(?: E\d+)?|Bouteille Gaz|Boissons(?: T[A-Z]{1,2})?|Alimentation(?: T[A-Z]{1,2})?|Produit [Ff]rais|Sandwich|Lavage(?: Progr\.? ?\d)?|Parking|AdBlue|GNR|GPL|E85|Lubrifiant|Lave[- ]?glace|Accessoires?|Huile|Ampoule|Balai)/;
    // Préfixe de STATION à retirer d'un libellé « <n° site/pompe> NOM STATION » (ex. « 79 PAMPRO »)
    // quand le produit exact n'est pas reconnu → sinon le nom de la station pollue le libellé.
    const TX_STATION = /^\s*\d{1,4}\s+[A-ZÉÈÀÂÊÎÔÛÇ][A-Z0-9ÉÈÀÂÊÎÔÛÇ'.\-]+(?:\s+[A-Z0-9ÉÈÀÂÊÎÔÛÇ'.\-]{2,})*\s+/;
    const TX_TTC = /\d[\d ]*[.,]\d{2}(?!\d)/g;
    // ⚠️ SOURCE UNIQUE : la catégorisation vit dans FP.txCat (app.js), partagée avec « Suivi & alertes ».
    function txCat(p){ return (window.FP && FP.txCat) ? FP.txCat(p) : 'autre'; }
    function parseTx(raw, facNum, resolveNom){
      const t = (raw || '').replace(SP, ' ').replace(/[ \t]+/g, ' ');
      const idx = t.indexOf('Votre Facture et son détail');
      const det = idx >= 0 ? t.slice(idx) : t;
      const supRe = /Total Support (\d+)(?: (\d+))? (.+?) Type véh\. (\d+)/g;
      const hits = []; let m;
      while ((m = supRe.exec(det))) hits.push({ i:m.index, end:supRe.lastIndex, carte:m[1], rang:m[2] || '', nom:m[3].trim() });
      const out = []; let prev = 0, seq = 0;
      for (const h of hits){
        const block = det.slice(prev, h.i); prev = h.end;
        const who = (typeof resolveNom === 'function' ? (resolveNom(h.nom, h.carte) || h.nom) : h.nom);
        const plaque = isPlaque(h.nom) ? h.nom : null;
        // ⚠️ Une transaction = « <date6> <heure4> <RÉSEAU> <libellé/produit…> ». Le réseau n'est PAS que
        // TOTAL/GEIE : il y a aussi les PARTENAIRES (parkings INDIGO, SAEMES, EFFIA…). On capture le RÉSEAU
        // à PART (groupe 3, mots EN MAJUSCULES) pour que le PRODUIT (groupe 4) reste propre — sinon le repli
        // prenait « TOTAL TF » comme produit → carburant classé à tort « achat hors carburant ».
        const txRe = /(\d{6}) (\d{4}) ([A-Z]{2,}(?: [A-Z]{2,})?) (.+?)(?=(?:\d{6} \d{4} [A-Z]{2,})|Total\b|$)/gs;
        let x;
        while ((x = txRe.exec(block))){
          const dmy = x[1], tail = x[4];
          const nums = tail.match(TX_TTC) || []; if (!nums.length) continue;
          const ttc = parseFloat(nums[nums.length - 1].replace(/ /g, '').replace(',', '.')); if (!isFinite(ttc)) continue;
          const pm = tail.match(TX_PROD);
          // Produit reconnu → on prend le libellé propre. Sinon repli : on retire d'abord le préfixe
          // de station (« 79 PAMPRO ») puis on garde le début du texte avant le 1er chiffre.
          const produit = pm ? pm[1].replace(/\s+/g, ' ').trim()
            : ((tail.replace(TX_STATION, '').trim().split(/\s+\d/)[0] || '').trim().slice(0, 30) || 'Achat');
          const cat = txCat(produit);
          // ⚠️ FRAIS / commissions / abonnements fournisseur (Frais de Gestion, Frais Station, Frais
          // Parking…) = PAS une conso du collaborateur → on ne crée PAS de transaction (ni conso, ni
          // « Autres », ni anomalie, ni rapprochement). Les vrais Parking/Lavage restent, eux, gardés.
          if (cat === 'frais') continue;
          const y = dmy.slice(4, 6), mo = dmy.slice(2, 4), da = dmy.slice(0, 2);
          out.push({ id: facNum + '-' + (seq++), facnum: facNum, carte: h.carte, conducteur: who, plaque,
            dateTx: '20' + y + '-' + mo + '-' + da, mois: '20' + y + '-' + mo, produit, categorie: cat, montantTtc: +ttc.toFixed(2) });
        }
      }
      return out;
    }

    function tfImpStatus(msg, type){
      const el = $('tf-import-status'); el.classList.remove('hidden');
      const colors = { working:'background:#F1F5F9;color:#475569;', ok:'background:#ECFDF5;color:#047857;', error:'background:#FEF2F2;color:#B91C1C;' };
      el.setAttribute('style', colors[type] || colors.working);
      el.innerHTML = msg;
    }
    function tfImpReset(){
      $('tf-import-status').classList.add('hidden'); $('tf-import-status').innerHTML = '';
      $('tf-import-preview').classList.add('hidden'); $('tf-import-preview').innerHTML = '';
    }

    let _pending = null; // { freshF, conso } en attente de confirmation
    let _pendingTx = []; // détail transaction par transaction en attente

    function showPreview(factures, conso, tx){
      _pendingTx = tx || [];
      const existing = new Set((window.FP_DATA.factures || []).map(f => (f.numeroFacture || '').toUpperCase()));
      const freshF = factures.filter(r => !existing.has(r.numero.toUpperCase()));
      // Factures DÉJÀ enregistrées mais SANS PDF (upload raté à un import précédent) → on rattache le PDF
      // à la ré-importation (sinon le drawer affiche « Aucun PDF stocké » pour toujours).
      const _byNum = {}; (window.FP_DATA.factures || []).forEach(f => { if (f.numeroFacture) _byNum[String(f.numeroFacture).toUpperCase()] = f; });
      const _noPdf = (f) => !f || !f.fileId || /^IMP-/.test(f.fileId);
      const toAttach = factures.filter(r => r._file && existing.has(r.numero.toUpperCase()) && _noPdf(_byNum[r.numero.toUpperCase()]));
      const dupes = factures.length - freshF.length;
      const sumTTC = factures.reduce((s,r)=>s+(r.ttc||0),0);
      const warn = (r) => {
        if (r.ht == null || r.tva == null || r.ttc == null) return ' <span style="color:#B91C1C">! montant manquant</span>';
        if (Math.abs((r.ht + r.tva) - r.ttc) > 0.02) return ' <span style="color:#B45309">! HT+TVA != TTC</span>';
        return '';
      };
      const facLines = factures.map(r => '<tr style="border-top:1px solid var(--fp-border)">'
        + '<td style="font-family:monospace">' + esc(r.numero) + '</td><td>' + esc(r.paysLabel) + '</td>'
        + '<td style="white-space:nowrap">' + esc(r.dmy||'—') + '</td>'
        + '<td style="text-align:right">' + (r.ht!=null?FP.euro(r.ht):'—') + '</td>'
        + '<td style="text-align:right">' + (r.tva!=null?FP.euro(r.tva):'—') + '</td>'
        + '<td style="text-align:right;font-weight:700">' + (r.ttc!=null?FP.euro(r.ttc):'—')
        + (existing.has(r.numero.toUpperCase())?' <span style="color:#94A3B8;font-weight:400">· deja importee</span>':'') + warn(r) + '</td></tr>').join('');

      const sumC = (k) => conso.reduce((s,c)=>s+(c[k]||0),0);
      const consoLines = conso.map(c => '<tr style="border-top:1px solid var(--fp-border)">'
        + '<td>' + esc(c.conducteur || c.plaque || c.carte) + (c.isNew?' <span style="color:#B45309;font-size:11px">! nouvelle carte</span>':'') + '</td>'
        + '<td style="text-align:center;color:#64748B">' + esc(c.type_vehicule||'—') + '</td>'
        + '<td style="text-align:right">' + FP.euro(c.carburant_ttc) + '</td>'
        + '<td style="text-align:right;color:#64748B">' + (c.litres?Math.round(c.litres)+' L':'—') + '</td>'
        + '<td style="text-align:right">' + (c.boutique_ttc?FP.euro(c.boutique_ttc):'—') + '</td>'
        + '<td style="text-align:right">' + (c.peage_ttc?FP.euro(c.peage_ttc):'—') + '</td>'
        + '<td style="text-align:right;font-weight:700">' + FP.euro(c.total_ttc) + '</td></tr>').join('');

      const facBlock = factures.length ? (
        '<div class="text-sm font-semibold mb-2">Factures : ' + factures.length + ' detectee(s) — ' + FP.euro(sumTTC) + ' TTC' + (dupes?(' · ' + dupes + ' deja presente(s)'):'') + '</div>'
        + '<div class="scrollable" style="max-height:200px"><table class="fp-table" style="font-size:13px">'
        + '<thead><tr><th>N°</th><th>Pays</th><th>Date</th><th style="text-align:right">HT</th><th style="text-align:right">TVA</th><th style="text-align:right">TTC</th></tr></thead>'
        + '<tbody>' + facLines + '</tbody></table></div>') : '';
      const consoBlock = conso.length ? (
        '<div class="text-sm font-semibold mt-4 mb-2">Consommation par conducteur : ' + conso.length + ' carte(s) — ' + FP.euro(sumC('total_ttc')) + ' TTC'
        + ' <span style="font-weight:400;color:#64748B">· s\'ajoute (cumul) au detail existant, sans rien ecraser</span></div>'
        + '<div class="scrollable" style="max-height:240px"><table class="fp-table" style="font-size:13px">'
        + '<thead><tr><th>Conducteur</th><th style="text-align:center">Type</th><th style="text-align:right">Carburant</th><th style="text-align:right">Litres</th><th style="text-align:right">Boutique</th><th style="text-align:right">Peage</th><th style="text-align:right">Total</th></tr></thead>'
        + '<tbody>' + consoLines + '</tbody></table></div>') : '';

      const willDo = [];
      if (freshF.length) willDo.push(freshF.length + ' facture(s)');
      if (toAttach.length) willDo.push(toAttach.length + ' PDF à rattacher');
      if (conso.length) willDo.push('la conso de ' + conso.length + ' carte(s)');

      _pending = { freshF, conso, toAttach };
      // Message clair si rien de NOUVEAU côté factures (cas fréquent : déjà importées)
      if (factures.length && !freshF.length) {
        tfImpStatus('✓ Ces <b>' + factures.length + ' facture(s)</b> sont <b>déjà enregistrées</b>' + (toAttach.length ? (' — je vais juste <b>rattacher le PDF</b> à ' + toAttach.length + ' d\'entre elles.') : ' — rien de nouveau à ajouter (elles sont déjà dans le tableau ci-dessous).'), 'ok');
      }
      $('tf-import-preview').classList.remove('hidden');
      $('tf-import-preview').innerHTML = facBlock + consoBlock
        + '<div class="flex gap-2 mt-3">'
        + '<button type="button" class="btn btn-outline text-sm" id="tf-import-cancel">Annuler</button>'
        + '<button type="button" class="btn btn-dark text-sm" id="tf-import-confirm"' + (willDo.length?'':' disabled style="opacity:.5;cursor:not-allowed"') + '>'
        + '<i data-lucide="check" class="w-4 h-4"></i> Enregistrer ' + (willDo.join(' + ') || '—') + '</button></div>';
      if (window.lucide) lucide.createIcons();
      $('tf-import-cancel').addEventListener('click', tfImpReset);
      $('tf-import-confirm').addEventListener('click', commitPending);
      try { ($('tf-import-status').classList.contains('hidden') ? $('tf-import-preview') : $('tf-import-status')).scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
    }

    async function commitPending(){
      if (!_pending) return;
      const freshF = _pending.freshF, conso = _pending.conso, toAttach = _pending.toAttach || [];
      $('tf-import-confirm').disabled = true;
      // Détail de CE qu'on enregistre, montré dans l'overlay.
      const _nF = freshF.length, _nC = conso.length, _nTx = (_pendingTx || []).length, _nA = toAttach.length;
      const _busy = (window.FP && FP.busy) ? FP.busy('Relevé TotalEnergies : ' + _nF + ' facture(s) · ' + _nC + ' carte(s) · ' + _nTx + ' conso datée(s)' + (_nA ? ' · ' + _nA + ' PDF à rattacher' : '') + '…') : null;
      tfImpStatus('<span class="inline-flex items-center gap-2"><span class="fa-spin"></span> Enregistrement...</span>', 'working');
      let okF = 0, okC = 0, okA = 0, attachErr = null, _iF = 0;
      // Rattache le PDF aux factures déjà enregistrées qui n'en avaient pas.
      if (_busy && _nA) _busy.update('Rattachement de ' + _nA + ' PDF…');
      for (const r of toAttach){
        if (!(r._file && FP.uploadScan)) continue;
        try {
          const url = await FP.uploadScan(r._file, 'factures-total', { name: 'TF-' + r.numero });
          if (!url) { if (!attachErr) attachErr = 'upload sans URL'; continue; }
          const fac = (window.FP_DATA.factures || []).find(f => (f.numeroFacture || '').toUpperCase() === String(r.numero).toUpperCase());
          if (fac) { fac.fileId = url; if (r._file) fac.fileName = r._file.name; if (FP.persist && FP.persist.update) await FP.persist.update('factures', fac.id, { fileId: url, fileName: fac.fileName }); okA++; }
        } catch (e) { console.warn('[tf-import attach PDF]', e); if (!attachErr) attachErr = (e && (e.message || e.error || e)) + ''; }
      }
      for (const r of freshF){
        if (_busy) _busy.update('Facture ' + (++_iF) + '/' + _nF + ' · ' + r.numero + ' (' + FP.euro(r.ttc) + ')…');
        // Stocke le PDF d'origine pour pouvoir le rouvrir (bouton « Ouvrir le PDF »)
        let fileUrl = null;
        if (r._file && FP.uploadScan) {
          try { fileUrl = await FP.uploadScan(r._file, 'factures-total', { name: 'TF-' + r.numero }); } catch (e) { console.warn('[tf-import upload PDF]', e); }
        }
        // Ré-import d'un relevé déjà en base (même id TF-numero) : on PRÉSERVE l'affectation manuelle
        // du véhicule et le PDF déjà stocké (sinon l'upsert les écrasait par null).
        const prev = (window.FP_DATA.factures||[]).find(x => x.id === ('TF-' + r.numero));
        const newF = { id:'TF-' + r.numero, date:r.date, vehiculeImmat:(prev && prev.vehiculeImmat) || null, fournisseur:'TotalEnergies',
          numeroFacture:r.numero, description:('Carburant & services flotte — ' + r.paysLabel + ' — releve ' + (r.dmy||'')).trim(),
          type:'carburant', montantHT:r.ht, montantTVA:r.tva, montantTTC:r.ttc,
          fileId: fileUrl || (prev && prev.fileId) || null, fileName: (r._file ? r._file.name : (prev && prev.fileName)) || null };
        const _iTF = (window.FP_DATA.factures||[]).findIndex(x => x.id === newF.id);
        if (_iTF>=0) window.FP_DATA.factures[_iTF]=newF; else window.FP_DATA.factures.push(newF);
        try { await FP.persist.upsert('factures', newF); okF++; } catch (e) { console.error('[tf-import facture]', e); }
      }
      let consoErr = null;
      if (_busy && _nC) _busy.update('Conso par carte : ' + _nC + ' à enregistrer…');
      for (const c of conso){
        const row = { id:(c.mois + '-' + c.carte + '-' + c.facNum), mois:c.mois, carte:c.carte, conducteur:c.conducteur || null,
          plaque:c.plaque || null, typeVehicule:c.type_vehicule || null, carburantTtc:c.carburant_ttc,
          litres:c.litres, boutiqueTtc:c.boutique_ttc, lavageTtc:c.lavage_ttc, peageTtc:c.peage_ttc,
          totalHt:c.total_ht, totalTva:c.total_tva, totalTtc:c.total_ttc };
        try {
          // Écriture DIRECTE (on récupère le VRAI résultat de la base au lieu d'un « OK » de file d'attente).
          let res = null;
          if (FP.db && FP.db.upsert) res = await FP.db.upsert('total_conso', row);
          if (res && res.error) throw res.error;
          if (!res && FP.persist) await FP.persist.upsert('total_conso', row); // repli hors-ligne
          okC++;
        } catch (e) { console.error('[tf-import conso]', e); if (!consoErr) consoErr = (e && (e.message || e.details || e.hint)) || String(e); }
      }
      // Détail transaction par transaction (table total_conso_tx). Best-effort : si la table n'existe
      // pas encore (SQL non lancé), on ignore silencieusement (les alertes retombent sur le mensuel).
      let okTx = 0;
      if (_busy && _nTx) _busy.update('Conso datées (suivi des congés) : ' + _nTx + '…');
      for (const tr of _pendingTx) {
        try { const res = (FP.db && FP.db.upsert) ? await FP.db.upsert('total_conso_tx', tr) : null; if (res && res.error) throw res.error; okTx++; }
        catch (e) { /* table absente ou RLS → silencieux */ break; }
      }
      $('tf-import-preview').classList.add('hidden');
      if (consoErr) {
        tfImpStatus('⚠️ ' + okF + ' facture(s) enregistrée(s), mais la CONSO par conducteur n\'a PAS pu être sauvegardée : <b>' + esc(consoErr) + '</b><br>Copie-moi ce message.', 'error');
        if (_busy) _busy.fail('⚠️ Conso non sauvegardée — voir le détail à l\'écran');
      } else if (attachErr && !okA) {
        // Le stockage du PDF a échoué (bucket Supabase) → message dédié bien visible + cause probable.
        tfImpStatus('⚠️ <b>Le PDF n\'a pas pu être stocké.</b> Erreur exacte : <b>' + esc(attachErr) + '</b>'
          + '<br>Le détail des dépenses fonctionne quand même. Pour l\'aperçu PDF, il faut débloquer le stockage Supabase (bucket « scans »). <b>Copie-moi cette erreur</b> et je te donne le réglage exact.', 'error');
        if (_busy) _busy.fail('⚠️ PDF non stocké (le détail est enregistré) — voir l\'écran');
      } else {
        tfImpStatus('<b>✓ Enregistré</b> : ' + okF + ' facture(s)' + (okA ? ' + ' + okA + ' PDF rattaché(s)' : '') + ' + conso de ' + okC + ' carte(s). Sauvegardé dans la base (visible sur tous les postes).', 'ok');
        if (_busy) _busy.done('✓ Relevé TotalEnergies enregistré — ' + okF + ' facture(s), conso de ' + okC + ' carte(s)');
      }
      _pending = null;
      render();
      consoLoaded = false; loadConso(); // recharge le detail conso depuis la base
    }

    // Résout le NOM du conducteur écrit sur la facture (souvent partiel : « BRAM », « THOMAS H »)
    // en le rapprochant des conducteurs DÉJÀ enregistrés (table conducteurs + chauffeurs des
    // véhicules). Renvoie le nom complet trouvé, sinon le nom du PDF tel quel.
    function resolveConducteurName(pdfNom){
      const raw = (pdfNom || '').trim();
      if (!raw || isPlaque(raw)) return raw || null;
      const norm = s => FP.norm(s || '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      const nRaw = norm(raw);
      if (!nRaw) return raw;
      const cands = [];
      (window.FP_DATA.conducteurs || []).forEach(c => {
        const full = [c.prenom, c.nom].filter(Boolean).join(' ') || c.name || '';
        if (full) cands.push(full);
        if (c.name && c.name !== full) cands.push(c.name);
      });
      (window.FP_DATA.vehicules || []).forEach(v => { if (v.chauffeur && v.chauffeur !== '—') cands.push(v.chauffeur); });
      const uniq = [...new Set(cands.map(x => (x || '').trim()).filter(Boolean))];
      if (!uniq.length) return raw;
      // 1) correspondance exacte (accents/casse ignorés)
      let hit = uniq.find(x => norm(x) === nRaw);
      if (hit) return hit;
      // 2) « PRÉNOM + initiale(s) du nom » : ex. « THOMAS H » → Thomas Hocquet
      const toks = nRaw.split(' ');
      if (toks.length >= 2) {
        const first = toks[0], rest = toks.slice(1).join('');
        hit = uniq.find(x => { const nt = norm(x).split(' '); return nt[0] === first && nt.slice(1).join('').startsWith(rest); });
        if (hit) return hit;
      }
      // 3) prénom seul : « BRAM » → conducteur dont le 1er mot correspond
      hit = uniq.find(x => norm(x).split(' ')[0] === nRaw);
      if (hit) return hit;
      // 4) rapprochement souple (l'un commence par l'autre)
      hit = uniq.find(x => { const n = norm(x); return n.startsWith(nRaw) || nRaw.startsWith(n.split(' ')[0]); });
      return hit || raw;
    }

    async function handleReleves(fileList){
      // ZIP accepté : on le décompresse en mémoire et on ne garde que les FACTURES (FAC*),
      // en IGNORANT le relevé global (RLP*) → anti double-comptage (cf. règle projet + consigne).
      let src = Array.from(fileList || []);
      if (src.some(f => /\.zip$/i.test(f.name) || /zip/i.test(f.type || ''))) {
        tfImpReset(); tfImpStatus('<span class="inline-flex items-center gap-2"><span class="fa-spin"></span> Décompression des ZIP…</span>', 'working');
        const expanded = [];
        for (const f of src) {
          if (/\.zip$/i.test(f.name) || /zip/i.test(f.type || '')) {
            try {
              await loadScript(JSZIP_CDN);
              const zip = await window.JSZip.loadAsync(f);
              for (const nm of Object.keys(zip.files)) {
                const entry = zip.files[nm]; if (entry.dir) continue;
                if (!/\.pdf$/i.test(nm)) continue;
                if (/RLP/i.test(nm)) continue; // relevé global → ignoré (on garde les factures FAC)
                const blob = await entry.async('blob');
                expanded.push(new File([blob], nm.split('/').pop(), { type: 'application/pdf' }));
              }
            } catch (e) { console.warn('[unzip]', f.name, e); }
          } else { expanded.push(f); }
        }
        src = expanded;
      }
      const files = src.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
      if (!files.length){ tfImpReset(); tfImpStatus('Depose un ou plusieurs <b>PDF</b> ou <b>ZIP</b> TotalEnergies (factures detaillees). Le relevé global (RLP) est ignoré automatiquement.', 'error'); return; }
      tfImpReset();
      tfImpStatus('<span class="inline-flex items-center gap-2"><span class="fa-spin"></span> Lecture des PDF…</span>', 'working');
      // Correspondance carte -> conducteur (ne DOIT PAS bloquer l'import si la base tarde/échoue)
      try { if (!consoLoaded) await loadConso(); } catch (e) { console.warn('[loadConso]', e); }
      const cardMap = {};
      (conso || []).forEach(c => { if (c.carte) cardMap[String(c.carte)] = c; });

      const facBySig = new Map();   // numero -> facture (dedup)
      const consoByKey = new Map(); // mois|carte -> conso agregee
      const txOut = [];             // détail transaction par transaction (achats)
      // Résolveur de conducteur pour le détail : carte connue → son conducteur ; sinon nom/plaque du PDF.
      const resolveTxNom = (nom, carte) => {
        // Priorité absolue : n° de carte enregistré sur une fiche CONDUCTEUR (sinon carte du véhicule).
        const att = (window.FP && FP.attributionCarteTotal) ? FP.attributionCarteTotal(carte) : null;
        if (att && att.conducteur) return att.conducteur;
        const ref = cardMap[String(carte)] || {};
        if (ref.conducteur) return ref.conducteur;
        if (nom && !isPlaque(nom)) { const rn = resolveConducteurName(nom); if (rn) return rn; }
        if (nom && isPlaque(nom)) { const np = String(nom).toUpperCase().replace(/[^A-Z0-9]/g, ''); const v = (window.FP_DATA.vehicules || []).find(x => String(x.immat || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === np); if (v && v.chauffeur && v.chauffeur !== '—') return v.chauffeur; }
        return nom || null;
      };
      const failed = []; let read = 0;
      for (const file of files){
        tfImpStatus('<span class="inline-flex items-center gap-2"><span class="fa-spin"></span> Lecture ' + (read + 1) + '/' + files.length + ' : ' + esc(file.name) + '...</span>', 'working');
        try {
          const pdf = await loadPdf(file);
          const text = await pdfTextAll(pdf);
          let used = false;
          const fromRel = parseReleve(text);
          const fromFac = parseFac(text, file.name);
          fromRel.concat(fromFac ? [fromFac] : []).forEach(f => { if (f && f.numero && !facBySig.has(f.numero)) { f._file = file; facBySig.set(f.numero, f); used = true; } });
          const mois = (fromFac && fromFac.date) ? fromFac.date.slice(0,7) : (fromRel[0] ? fromRel[0].date.slice(0,7) : null);
          // facNum = n° de la facture détaillée → sert d'identifiant de contribution
          // (on ne CUMULE jamais en écrasant : 1 ligne par carte ET par facture).
          const facNum = fromFac ? fromFac.numero : (file.name.replace(/\W+/g,'').slice(-10));
          if (mois){
            for (const r of parseConso(text)){
              used = true;
              const key = mois + '|' + r.carte + '|' + facNum;
              // Une carte peut avoir 2 blocs « Total Support » dans la même facture (rangs
              // différents) → on les ADDITIONNE (sinon le 2e écraserait le 1er).
              const a = consoByKey.get(key) || { mois:mois, carte:r.carte, nom:r.nom, type:r.type, facNum:facNum,
                carburant:0, litres:0, boutique:0, peage:0, lavage:0, total:0, ht:0, tva:0 };
              a.carburant+=r.carburant; a.litres+=r.litres; a.boutique+=r.boutique; a.peage+=r.peage;
              a.lavage+=r.lavage; a.total+=r.total; a.ht+=r.ht; a.tva+=r.tva;
              consoByKey.set(key, a);
            }
            // Détail transaction par transaction (une ligne = un achat) → pour la détection au jour/article.
            try { for (const tr of parseTx(text, facNum, resolveTxNom)) { tr.mois = mois || tr.mois; txOut.push(tr); } } catch (e) { console.warn('[parseTx]', e); }
          }
          if (!used) failed.push(file.name);
        } catch (err) { console.error(err); failed.push(file.name); }
        read++;
      }

      const factures = Array.from(facBySig.values());
      const consoOut = Array.from(consoByKey.values()).map(a => {
        const ref = cardMap[String(a.carte)] || {};
        const pdfNom = a.nom || '';
        // Priorité absolue : n° de carte enregistré sur une fiche CONDUCTEUR (sinon carte du véhicule) ;
        // puis nom DÉJÀ mémorisé pour cette carte ; sinon on résout le nom du PDF contre les conducteurs.
        const att = (window.FP && FP.attributionCarteTotal) ? FP.attributionCarteTotal(a.carte) : null;
        let conducteur = (att && att.conducteur) || ref.conducteur || null;
        let plaque = (att && att.plaque) || ref.plaque || (isPlaque(pdfNom) ? pdfNom : null);
        if (!conducteur && !isPlaque(pdfNom)) conducteur = resolveConducteurName(pdfNom);
        // Si on n'a qu'une plaque, on tente le chauffeur du véhicule correspondant.
        if (plaque && !conducteur) {
          const np = String(plaque).toUpperCase().replace(/[^A-Z0-9]/g, '');
          const v = (window.FP_DATA.vehicules || []).find(x => String(x.immat || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === np);
          if (v && v.chauffeur && v.chauffeur !== '—') conducteur = v.chauffeur;
        }
        return { carte:a.carte, mois:a.mois, facNum:a.facNum, conducteur:conducteur, plaque:plaque,
          type_vehicule: ref.type_vehicule || a.type || null,
          carburant_ttc:+a.carburant.toFixed(2), litres:+a.litres.toFixed(2),
          boutique_ttc:+a.boutique.toFixed(2), lavage_ttc:+a.lavage.toFixed(2),
          peage_ttc:+a.peage.toFixed(2), total_ht:+(a.ht||0).toFixed(2), total_tva:+(a.tva||0).toFixed(2), total_ttc:+a.total.toFixed(2),
          isNew: !cardMap[String(a.carte)] };
      }).sort((x,y)=> (y.total_ttc - x.total_ttc));

      if (!factures.length && !consoOut.length){
        tfImpStatus('Aucune donnee detectee. Verifie que ce sont bien des releves / factures <b>TotalEnergies</b>.', 'error');
        return;
      }
      if (failed.length) tfImpStatus('! ' + failed.length + ' fichier(s) non reconnu(s) (ignore.s) : ' + failed.map(esc).join(', ') + '.', 'error');
      else $('tf-import-status').classList.add('hidden');
      showPreview(factures, consoOut, txOut);
    }

    // ============================================================
    //  RECONSTRUIRE LE DÉTAIL (transaction par transaction) SANS RÉIMPORT
    //  Les relevés Total déjà importés sont stockés (PDF) dans Supabase Storage → on les RELIT
    //  automatiquement (fetch → pdf.js → parseTx) et on (re)remplit total_conso_tx. Idempotent
    //  (id de tx stable = n°facture-index → aucun doublon). Aucune manip Supabase pour l'utilisateur.
    // ============================================================
    async function fetchPdfBlob(url){
      // Si c'est une URL Supabase Storage → on télécharge via le SDK (fonctionne même si le bucket
      // n'est PAS public, car l'utilisateur est authentifié). Sinon repli sur un fetch direct.
      try {
        const m = /\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?([^/?]+)\/([^?]+)/.exec(url);
        if (m && FP.supabase && FP.supabase.storage) {
          const bucket = decodeURIComponent(m[1]), path = decodeURIComponent(m[2]);
          const res = await FP.supabase.storage.from(bucket).download(path);
          if (res && res.data && !res.error) return res.data; // Blob
        }
      } catch (e) { /* on tente le fetch direct ci-dessous */ }
      const resp = await fetch(url); if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.blob();
    }
    async function loadPdfFromUrl(url){
      const blob = await fetchPdfBlob(url); return loadPdf(blob); // loadPdf accepte tout Blob (arrayBuffer())
    }
    async function backfillTx(btn, opts){
      opts = opts || {};
      const silent = !!opts.silent;   // pas de toast/alert/pop-up (exécution auto en arrière-plan)
      const force = !!opts.force;      // re-parser TOUT (sinon INCRÉMENTAL : on saute les relevés déjà traités)
      if (!(FP.db && FP.db.upsert)) { if (!silent && FP.toast) FP.toast('Base indisponible.'); return; }
      // INCRÉMENTAL : on récupère la liste des n° de facture DÉJÀ présents dans total_conso_tx pour
      // ne PAS re-télécharger/re-lire les relevés déjà reconstruits (sinon on revérifie tout à chaque
      // fois → insupportable avec 100+ relevés). `force` permet un rebuild complet si besoin.
      const doneFac = new Set();
      let doneOk = false;
      if (!force) {
        try {
          const r = FP.selectAllPaged ? await FP.selectAllPaged('total_conso_tx', null, 'id', 'facnum,societe') : await FP.supabase.from('total_conso_tx').select('facnum,societe'); // PAGINÉ (cap 1000)
          // Isolation : re-filtrer par société active (le CEO reçoit tout via la RLS) → un facnum d'une
          // AUTRE société ne doit pas faire sauter une réimportation légitime de la société consultée.
          const _soc = (FP.activeSociete && FP.activeSociete()) || null; const _s = (_soc && _soc !== '__all__') ? String(_soc).toLowerCase() : null;
          if (r && !r.error) { (r.data || []).forEach(x => { if (!x.facnum) return; if (_s && (x.societe ? String(x.societe).toLowerCase() : 'pxp') !== _s) return; doneFac.add(String(x.facnum).trim().toUpperCase()); }); doneOk = true; }
        } catch (e) { /* lecture impossible */ }
        // En mode AUTO (silencieux), on NE lance PAS un rebuild complet à l'aveugle si on ne sait pas ce
        // qui est déjà fait (sinon on re-télécharge tout l'historique en tâche de fond). On abandonne.
        if (silent && !doneOk) return;
      }
      const dejaFait = (num) => doneFac.has(String(num || '').trim().toUpperCase());
      // ⚠️ Un relevé RÉCENT (≤ 120 j) est TOUJOURS reconstruit (autoritatif depuis son PDF), même s'il
      // est déjà « fait » : sinon un import PARTIEL (ex. l'import API n'a écrit qu'une partie des badges,
      // ou un badge oublié) reste incomplet pour toujours → une conso pendant congé récente n'apparaît
      // jamais. On ne saute (pour la vitesse) que les relevés ANCIENS déjà reconstruits.
      const RECENT_MS = 120 * 24 * 3600 * 1000;
      const estRecent = (f) => { const d = String((f && f.date) || '').slice(0, 10); const t = d ? Date.parse(d) : NaN; return isNaN(t) ? true : (Date.now() - t) <= RECENT_MS; };
      const peutSauter = (f) => !force && f && f.numeroFacture && dejaFait(f.numeroFacture) && !estRecent(f);
      // En mode AUTO (silencieux), on mémorise aussi les relevés ANCIENS DÉJÀ TENTÉS (même sans ligne
      // datée : PDF illisible/sans détail) pour ne pas les re-télécharger à chaque session. Les récents
      // ne sont JAMAIS mis en cache « tenté » → ils se re-vérifient tant qu'ils sont dans la fenêtre.
      let tried = {};
      if (silent && !force) { try { tried = JSON.parse(localStorage.getItem('fp_conso_backfill_tried') || '{}') || {}; } catch (e) {} }
      const dejaTente = (f) => silent && !force && f && f.fileId && tried[f.fileId] && !estRecent(f);
      // Correspondance carte → conducteur (comme à l'import) pour bien nommer les achats.
      try { if (!consoLoaded) await loadConso(); } catch (e) {}
      const cardMap = {}; (conso || []).forEach(c => { if (c.carte) cardMap[String(c.carte)] = c; });
      const resolveTxNom = (nom, carte) => {
        // Priorité absolue : n° de carte enregistré sur une fiche CONDUCTEUR (sinon carte du véhicule).
        const att = (window.FP && FP.attributionCarteTotal) ? FP.attributionCarteTotal(carte) : null;
        if (att && att.conducteur) return att.conducteur;
        const ref = cardMap[String(carte)] || {};
        if (ref.conducteur) return ref.conducteur;
        if (nom && !isPlaque(nom)) { const rn = resolveConducteurName(nom); if (rn) return rn; }
        if (nom && isPlaque(nom)) { const np = String(nom).toUpperCase().replace(/[^A-Z0-9]/g, ''); const v = (window.FP_DATA.vehicules || []).find(x => String(x.immat || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === np); if (v && v.chauffeur && v.chauffeur !== '—') return v.chauffeur; }
        return nom || null;
      };
      // Relevés Total avec un PDF re-téléchargeable (URL http = Supabase Storage) ; on dédoublonne par URL.
      const rele = (window.FP_DATA.factures || []).filter(f => isTotalFleet(f) && f.fileId && /^https?:\/\//.test(f.fileId));
      const byUrl = new Map(); rele.forEach(f => { if (!byUrl.has(f.fileId)) byUrl.set(f.fileId, f); });
      const list = [...byUrl.values()];
      // ⚠️ NE PAS s'arrêter ici s'il n'y a pas de relevé Total : la reconstruction Ulys (plus bas) DOIT
      // quand même tourner. (Bug corrigé : un « return » ici empêchait toute reconstruction Ulys quand
      // la flotte n'avait pas de relevés Total avec PDF stocké → péages toujours en « total du mois ».)
      const old = btn ? btn.innerHTML : ''; if (btn) { btn.disabled = true; }
      let okTx = 0, failed = 0, tableMissing = false, done = 0, skippedDone = 0;
      for (const f of list) {
        // INCRÉMENTAL : relevé déjà reconstruit (son n° de facture est déjà dans total_conso_tx) → on saute
        // SANS re-télécharger le PDF (gain de temps énorme sur un gros historique).
        if (peutSauter(f)) { skippedDone++; done++; continue; }
        if (dejaTente(f)) { done++; continue; }
        if (silent && f.fileId && !estRecent(f)) tried[f.fileId] = 1;
        if (btn) btn.innerHTML = 'Lecture ' + (done + 1) + '/' + list.length + '…';
        try {
          const pdf = await loadPdfFromUrl(f.fileId);
          const text = await pdfTextAll(pdf);
          const fromFac = parseFac(text, f.fileName || '');
          const facNum = (fromFac && fromFac.numero) || f.numeroFacture || String(f.fileId).replace(/\W+/g, '').slice(-10);
          const mois = (f.date || '').slice(0, 7) || (fromFac && fromFac.date ? fromFac.date.slice(0, 7) : null);
          for (const tr of parseTx(text, facNum, resolveTxNom)) {
            tr.mois = mois || tr.mois;
            const res = await FP.db.upsert('total_conso_tx', tr);
            if (res && res.error) { const msg = String((res.error && res.error.message) || res.error); if (/total_conso_tx|relation|exist|schema/i.test(msg)) { tableMissing = true; throw res.error; } throw res.error; }
            okTx++;
          }
        } catch (e) { console.warn('[backfillTx]', f.id, e); if (tableMissing) break; failed++; }
        done++;
      }
      if (btn) { btn.innerHTML = old; btn.disabled = false; }
      if (tableMissing) {
        console.warn('[fleet-views] total_conso_tx absente — infra one-shot : lancer le script SQL « total-conso-tx ».');
        if (!silent) { const m = 'Le détail daté n\'est pas encore disponible (configuration en cours côté plateforme). Réessaie un peu plus tard.'; if (FP.alert) FP.alert(m); else alert(m); }
        return;
      }
      // + Reconstruit AUSSI le détail Ulys DATÉ (péages par jour) depuis les PDF Ulys stockés → même
      // table total_conso_tx (carte « ULYS-… ») pour le suivi des congés. Un seul bouton fait les deux.
      let okUlys = 0, ulSansPdf = 0, ulReleves = 0, ulTxFound = 0, ulErr = '';
      try {
        if (window.FP && FP.ulys && FP.ulys.parse && FP.ulys.pdfToText) {
          const ulAll = (window.FP_DATA.factures || []).filter(f => isUlys(f));
          const ul = ulAll.filter(f => f.fileId && /^https?:\/\//.test(f.fileId));
          ulSansPdf = ulAll.length - ul.length; // relevés Ulys dont le PDF n'est pas stocké (pas relisibles)
          const byU = new Map(); ul.forEach(f => { if (!byU.has(f.fileId)) byU.set(f.fileId, f); });
          for (const f of byU.values()) {
            if (tableMissing) break;
            // INCRÉMENTAL : relevé Ulys déjà reconstruit → on saute (pas de re-téléchargement du PDF).
            if (peutSauter(f)) { continue; }
            if (dejaTente(f)) { continue; }
            if (silent && f.fileId && !estRecent(f)) tried[f.fileId] = 1;
            if (btn) btn.innerHTML = 'Ulys ' + (++ulReleves) + '/' + byU.size + '…';
            try {
              const blob = await fetchPdfBlob(f.fileId);
              const text = await FP.ulys.pdfToText(blob);
              const p = FP.ulys.parse(text); const num = p.numero || f.numeroFacture || '';
              const txs = (p.txConso || []); ulTxFound += txs.length;
              let i = 0;
              for (const c of txs) {
                const seq = i++; if (!c.date || !c.conducteur) continue;
                const tr = { id: 'ULYSTX-' + num + '-' + (c.badge || '') + '-' + seq, facnum: num, carte: 'ULYS-' + (c.badge || ''),
                  conducteur: c.conducteur, plaque: null, dateTx: c.date, mois: (c.date || '').slice(0, 7), produit: 'Péage Ulys',
                  categorie: 'peage', montantTtc: (c.montant != null ? c.montant : 0) };
                const res = await FP.db.upsert('total_conso_tx', tr);
                if (res && res.error) { const msg = String((res.error && res.error.message) || res.error); ulErr = msg; if (/total_conso_tx|relation|exist|schema|column|permission|policy|row-level/i.test(msg)) { tableMissing = /relation|exist|schema|column/i.test(msg); throw res.error; } throw res.error; }
                okUlys++;
              }
            } catch (e) { if (!ulErr) ulErr = String((e && (e.message || e)) || e); console.warn('[backfillTx ulys]', f.id, e); if (tableMissing) break; }
          }
        }
      } catch (e) { if (!ulErr) ulErr = String((e && (e.message || e)) || e); console.warn('[backfillTx ulys]', e); }
      if (btn) { btn.innerHTML = old; btn.disabled = false; }
      if (silent && !force) { try { localStorage.setItem('fp_conso_backfill_tried', JSON.stringify(tried)); } catch (e) {} }
      consoLoaded = false; try { await loadConso(); } catch (e) {}
      try { renderConso(); renderAnalyse(); } catch (e) {}
      // Prévient les autres écrans (ex. Suivi & alertes → conso pendant congé) qu'il y a du neuf.
      if (okTx || okUlys) { try { document.dispatchEvent(new CustomEvent('fp:conso-tx-updated')); } catch (e) {} }
      if (silent) return; // exécution auto en arrière-plan : rien à afficher
      const parts = [];
      parts.push(okTx + ' achat(s) Total' + (list.length ? ' sur ' + list.length + ' relevé(s)' : ''));
      if (okUlys) parts.push(okUlys + ' conso Ulys datées');
      if (failed) parts.push(failed + ' illisible(s)');
      const msg = (okTx || okUlys) ? ('✓ Détail reconstruit : ' + parts.join(' · ')) : 'Détail déjà à jour (rien de nouveau).';
      if (FP.toast) FP.toast(msg);
      // DIAGNOSTIC Ulys clair (une pop-up) — pour comprendre EXACTEMENT ce qui s'est passé côté péages :
      //  - table absente / erreur base → message technique à corriger côté infra ;
      //  - PDF non stockés → réimporter ; conso lues mais non enregistrées → erreur base affichée.
      let diag = '';
      if (tableMissing || (ulErr && /relation|exist|schema|column/i.test(ulErr))) {
        diag = '⚠️ La table « total_conso_tx » semble absente ou incomplète côté base : le détail daté (Total ET Ulys) ne peut pas être enregistré.\n\nErreur : ' + (ulErr || 'table manquante') + '\n\n(C\'est une opération d\'infra à faire une seule fois — dis-le à ton développeur / à Claude pour lancer le script SQL « total-conso-tx ».)';
      } else if (okUlys > 0) {
        diag = '✓ ' + okUlys + ' consommation(s) Ulys datées enregistrées sur ' + ulReleves + ' relevé(s). Rouvre l\'onglet Contrôle : les péages pendant congé s\'affichent aux dates exactes.';
      } else if (ulSansPdf > 0 && ulReleves === 0) {
        diag = 'Aucun relevé Ulys avec PDF stocké (' + ulSansPdf + ' sans PDF) : impossible de relire les dates. Réimporte tes relevés Ulys une fois (le PDF sera alors enregistré).';
      } else if (ulReleves > 0 && ulTxFound === 0) {
        diag = 'Les ' + ulReleves + ' relevé(s) Ulys ont été relus mais AUCUNE ligne datée n\'a été trouvée dedans (structure du PDF non reconnue). Envoie-moi un de ces relevés pour que j\'adapte la lecture.';
      } else if (ulReleves > 0 && ulTxFound > 0 && okUlys === 0) {
        diag = ulTxFound + ' ligne(s) datée(s) lues mais AUCUNE enregistrée — erreur base : ' + (ulErr || 'inconnue') + '.';
      }
      if (diag) { if (FP.alert) FP.alert(diag); else alert(diag); }
    }
    // Bouton manuel « Reconstruire le détail » RETIRÉ (consigne : tout est automatisé). La
    // reconstruction se fait toute seule (auto au chargement ci-dessous + après chaque import).
    // Exposé pour un déclenchement AUTOMATIQUE depuis ailleurs (après une synchro/import Ulys, cf. app.js).
    // Incrémental par défaut → ne relit QUE les relevés pas encore reconstruits (ne revérifie pas tout).
    window.__reconstruireDetailConso = (opts) => backfillTx(null, Object.assign({ silent: true }, opts || {}));
    // AUTO au chargement : reconstruit tout seul, en arrière-plan, le détail des relevés (Total + Ulys)
    // pas encore traités → plus besoin de cliquer « Reconstruire le détail », et la détection « conso
    // pendant congé » se met à jour d'elle-même. Une seule fois par session, différé pour ne pas gêner
    // le 1er affichage. Incrémental → quasi instantané quand tout est déjà à jour.
    if (!FP._consoBackfillAuto) {
      FP._consoBackfillAuto = true;
      setTimeout(() => { try { backfillTx(null, { silent: true }).catch(() => {}); } catch (e) {} }, 2500);
    }

    // Import Total : bouton dans le panneau (visible aussi dans Contrôle) OU bouton du haut.
    if ($('tf-import-btn')) $('tf-import-btn').addEventListener('click', () => $('tf-import-file').click());
    $('tf-import-file').addEventListener('change', (e) => {
      // ⚠️ COPIER les fichiers AVANT de vider l'input : e.target.value='' efface la sélection
      // (FileList est vivante) → sinon l'import croit qu'il n'y a aucun fichier.
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      // Filet de sécurité : toute erreur s'affiche au lieu de « rien ne se passe »
      Promise.resolve().then(() => handleReleves(files)).catch(err => {
        console.error('[import Total Fleet]', err);
        tfImpStatus('Erreur pendant l\'import : ' + esc(err && err.message ? err.message : String(err)) + '. Réessaie ou envoie-moi le PDF.', 'error');
      });
    });

    // ── Exposé pour l'IMPORT EN LOT : router les relevés TotalEnergies vers CE traitement dédié
    //    (reconstruction du détail par conducteur) au lieu d'un simple scan de facture. Le détecteur
    //    lit le TEXTE du PDF et confirme via les MÊMES parseurs (parseConso/parseReleve/parseFac) :
    //    un simple ticket TotalEnergies (sans détail flotte) ne matche pas → il reste en import normal.
    FP._importTotalReleves = handleReleves;
    window.__facIsTotalStatement = async (file) => {
      try {
        if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) return false;
        const pdf = await loadPdf(file); const text = await pdfTextAll(pdf);
        if (!/totalenergies|total\s*energies/i.test(text)) return false;
        return (parseConso(text).length > 0) || (parseReleve(text).length > 0) || !!parseFac(text, file.name);
      } catch (e) { return false; }
    };

  })();

      return true;
    }catch(e){ console.error('[FP.mountTotal]', e); return false; }
  };
})();
