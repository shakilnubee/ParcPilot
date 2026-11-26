/* Test unitaire de l'écran « À vérifier » (assets/js/gmail-a-verifier.js).
 * Couvre le rendu PUR des cartes et la résolution du lien de finalisation (Phase 5).
 * Pur, sans réseau ni navigateur réel (on stube window.FP). node tests/unit/gmail-a-verifier.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Stub minimal de l'environnement navigateur attendu par le module.
globalThis.window = {
  FP: {
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    normImmat: (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''),
    vehByImmat: (p) => {
      const k = String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      return ({ HL724CD: { id: 'v1', immat: 'HL-724-CD' }, GP333QJ: { id: 'v2', immat: 'GP-333-QJ' } })[k] || null;
    },
  },
};
globalThis.FP = globalThis.window.FP; // en navigateur, FP est un global (= window.FP)
const A = require('../../assets/js/gmail-a-verifier.js');

let ok = 0, ko = 0;
const t = (l, c, g) => { if (c) { ok++; console.log('✅', l); } else { ko++; console.log('❌', l, g !== undefined ? JSON.stringify(g) : ''); } };

// --- item de liste + détail ---
const amende = { id: 'AV-m6', message_id: 'm6', from_email: 'noreply@antai.gouv.fr', objet: 'Paiement avis 2612744314620', recu_le: '2026-11-25T09:12:00Z', extrait: 'Paiement enregistré.', domaine: 'amende', action: 'amende_payee', statut: 'a_verifier', dossier_ref: { numeroAvis: '2612744314620' }, pieces: [{ filename: 'recu.pdf', attachmentId: 'A6' }] };
const li = A.listItemHtml(amende, 'AV-m6');
t('item: domaine + objet + sélection + pièces', /🅿️ Amende/.test(li) && /Paiement avis/.test(li) && /gav-item sel/.test(li) && /1 pièce/.test(li));
const det = A.detailHtml(amende);
t('détail: expéditeur + action + avis + pièce ouvrable + 3 actions', /antai\.gouv\.fr/.test(det) && /Ouvrir le dossier amende/.test(det) && /avis 2612744314620/.test(det) && /data-piece="0"/.test(det) && /gav-go/.test(det) && /gav-correct/.test(det) && /gav-ignore/.test(det));
const traite = Object.assign({}, amende, { statut: 'applique' });
t('détail traité: pas de bouton action + mention « traité »', !/gav-go/.test(A.detailHtml(traite)) && /Déjà traité/.test(A.detailHtml(traite)));
t('XSS échappé (item + détail)', /&lt;img/.test(A.listItemHtml({ id: 'x', from_email: '<img src=x onerror=alert(1)>', domaine: 'inconnu', action: 'a_verifier', statut: 'a_verifier', dossier_ref: {} })) && /&lt;img/.test(A.detailHtml({ id: 'x', from_email: '<img src=x onerror=alert(1)>', domaine: 'inconnu', action: 'a_verifier', statut: 'a_verifier', dossier_ref: {}, pieces: [] })));

// --- libellé du bouton d'action : HONNÊTETÉ — il n'annonce que ce qu'il fait vraiment ---
// Seule la FACTURE écrit en base ; les autres domaines OUVRENT le dossier (saisie manuelle), aucun « Enregistrer/Valider » menteur.
t('bouton facture → « Vérifier la facture »', /Vérifier la facture/.test(A.actionBtnLabel({ action: 'facture_saisir' })));
t('bouton rdv → « Ouvrir le rendez-vous » (pas « Valider »)', /Ouvrir le rendez-vous/.test(A.actionBtnLabel({ action: 'rdv_update' })) && !/Valider/.test(A.actionBtnLabel({ action: 'rdv_update' })));
t('bouton amende → « Ouvrir le dossier amende » (pas « Enregistrer »)', /Ouvrir le dossier amende/.test(A.actionBtnLabel({ action: 'amende_payee' })) && !/Enregistrer/.test(A.actionBtnLabel({ action: 'amende_payee' })));
t('bouton sinistre → « Ouvrir le dossier sinistre » (pas « Enregistrer la pièce »)', /Ouvrir le dossier sinistre/.test(A.actionBtnLabel({ action: 'sinistre_piece' })) && !/Enregistrer/.test(A.actionBtnLabel({ action: 'sinistre_piece' })));
t('détail facture: bouton « Vérifier la facture »', /Vérifier la facture/.test(A.detailHtml({ id: 'f1', domaine: 'facture', action: 'facture_saisir', statut: 'a_verifier', dossier_ref: { plaque: 'HL724CD' }, pieces: [{ filename: 'f.pdf', attachmentId: 'Z' }] })));
// Statut « ouvert » (non facture, finalisation manuelle) : dit « à finaliser », JAMAIS « traité », et garde un bouton d'ouverture.
const ouv = A.detailHtml(Object.assign({}, amende, { statut: 'ouvert' }));
t('détail « ouvert » : « à finaliser » + pas « Déjà traité » + bouton rouvrir', /à finaliser/.test(ouv) && !/Déjà traité/.test(ouv) && /gav-go/.test(ouv) && /gav-retirer/.test(ouv));

// --- liens de finalisation (Phase 5) ---
t('lien amende → fiche par n° d’avis', A.lienDossier({ domaine: 'amende', dossier_ref: { numeroAvis: '2612744314620' } }) === 'amendes.html?avis=2612744314620');
t('lien maintenance (plaque connue) → fiche véhicule', A.lienDossier({ domaine: 'maintenance', dossier_ref: { plaque: 'HL724CD' } }) === 'vehicules.html?veh=v1', A.lienDossier({ domaine: 'maintenance', dossier_ref: { plaque: 'HL724CD' } }));
t('lien sinistre (plaque inconnue) → page sinistres', A.lienDossier({ domaine: 'sinistre', dossier_ref: { plaque: 'ZZ999ZZ' } }) === 'sinistres.html');
t('lien maintenance sans plaque → entretiens', A.lienDossier({ domaine: 'maintenance', dossier_ref: {} }) === 'entretiens.html');

// --- résumé de référence ---
t('refSummary avis+plaque', A.refSummary({ numeroAvis: '123', plaque: 'HL724CD' }) === 'avis 123 · plaque HL724CD');
t('refSummary vide → à préciser', /à préciser/.test(A.refSummary({})));

// --- recherche (objet / expéditeur / immat normalisée / n° facture / pièce), insensible casse+accents ---
const mg4 = { id: 'AV-x', objet: 'FACTURE MG 4 / GT-818-LC /', from_email: 'carworldconsultingfrance@gmail.com', statut: 'confirme', dossier_ref: { plaque: 'GT818LC' }, pieces: [{ filename: 'Facture-TJMAX-CAR WORLD CONSULTING FRANCE-F-2026-627.pdf', attachmentId: 'A' }] };
t('recherche vide → tout passe', A._match(mg4, ''));
t('recherche plaque « GT818LC »', A._match(mg4, 'GT818LC'));
t('recherche plaque « GT-818-LC » (tirets)', A._match(mg4, 'GT-818-LC'));
t('recherche plaque « gt 818 lc » (espaces+minuscules)', A._match(mg4, 'gt 818 lc'));
t('recherche n° facture « F-2026-627 »', A._match(mg4, 'F-2026-627'));
t('recherche expéditeur « Car World »', A._match(mg4, 'car world'));
t('recherche nom de pièce « 627 »', A._match(mg4, '627'));
t('recherche sans correspondance → false', A._match(mg4, 'peugeot zzz') === false);

// --- reprise : n° de facture + état « à reprendre » ---
t('numFacture extrait F-2026-627', /2026[-_ ]?627/.test(A.numFacture('Facture-...-F-2026-627.pdf')));
t('« à reprendre » = facture confirmée avec PDF', A._estAReprendre(mg4) === true);
t('pas « à reprendre » si enregistrée (applique)', A._estAReprendre(Object.assign({}, mg4, { statut: 'applique' })) === false);

// --- classification des pièces jointes (facture à importer vs relevé à écarter) ---
t('rôle E-SUMMARY → relevé', A.roleDePiece('4302800060_2026-11-23_E-SUMMARY_26-656273356-000.pdf') === 'releve');
t('rôle E-INVOICE → facture', A.roleDePiece('4302800060_2026-11-23_FR_E-INVOICE_26-656273356-001.pdf') === 'facture');
t('rôle inconnu → autre', A.roleDePiece('document-xyz.pdf') === 'autre');
const dkv = { id: 'AV-dkv', message_id: 'mdkv', pieces: [
  { filename: '4302800060_2026-11-23_E-SUMMARY_26-656273356-000.pdf', attachmentId: 'S0' },
  { filename: '4302800060_2026-11-23_FR_E-INVOICE_26-656273356-001.pdf', attachmentId: 'I1' },
] };
A._pieceSel = {};
let cdkv = A.classerPieces(dkv);
t('DKV : la FACTURE sélectionnée = E-INVOICE (idx 1), pas le relevé (idx 0)', cdkv.factureIdx === 1, cdkv.factureIdx);
t('DKV : pas de choix requis (une seule facture claire)', cdkv.choixRequis === false);
t('DKV : pieceFactureIdx = 1', A.pieceFactureIdx(dkv) === 1);
// choix manuel l'emporte (ex. l'utilisateur force le relevé)
A._pieceSel['AV-dkv'] = 0;
t('choix manuel prioritaire → idx 0', A.pieceFactureIdx(dkv) === 0);
A._pieceSel = {};
// deux factures plausibles → choix requis (factureIdx null)
const deux = { id: 'AV-2', pieces: [ { filename: 'FR_E-INVOICE_A.pdf', attachmentId: 'a' }, { filename: 'FR_E-INVOICE_B.pdf', attachmentId: 'b' } ] };
let c2 = A.classerPieces(deux);
t('2 factures plausibles → choix requis (factureIdx null)', c2.factureIdx === null && c2.choixRequis === true);
// un seul PDF non classé → c'est lui
const un = { id: 'AV-1', pieces: [ { filename: 'scan-document.pdf', attachmentId: 'x' } ] };
t('un seul PDF (non classé) → sélectionné', A.pieceFactureIdx(un) === 0);
// aucun PDF
t('aucun PDF → aucun=true, factureIdx null', (function(){ const c = A.classerPieces({ id:'AV-0', pieces: [] }); return c.aucun === true && c.factureIdx === null; })());
// le détail affiche les rôles + la sélection
const detDkv = A.detailHtml(dkv);
t('détail DKV : « Facture · sélectionnée pour l’import » + « Relevé · exclu »', /Facture · sélectionnée pour l’import/.test(detDkv) && /Relevé · exclu de l’import/.test(detDkv));

console.log(`\n${ok}/${ok + ko} OK`);
process.exit(ko ? 1 : 0);
