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
t('détail: expéditeur + action + avis + pièce ouvrable + 3 actions', /antai\.gouv\.fr/.test(det) && /Marquer l’amende payée/.test(det) && /avis 2612744314620/.test(det) && /data-piece="0"/.test(det) && /gav-go/.test(det) && /gav-correct/.test(det) && /gav-ignore/.test(det));
const traite = Object.assign({}, amende, { statut: 'applique' });
t('détail traité: pas de bouton action + mention « traité »', !/gav-go/.test(A.detailHtml(traite)) && /Déjà traité/.test(A.detailHtml(traite)));
t('XSS échappé (item + détail)', /&lt;img/.test(A.listItemHtml({ id: 'x', from_email: '<img src=x onerror=alert(1)>', domaine: 'inconnu', action: 'a_verifier', statut: 'a_verifier', dossier_ref: {} })) && /&lt;img/.test(A.detailHtml({ id: 'x', from_email: '<img src=x onerror=alert(1)>', domaine: 'inconnu', action: 'a_verifier', statut: 'a_verifier', dossier_ref: {}, pieces: [] })));

// --- libellé du bouton d'action (il ANNONCE l'action) ---
t('bouton facture → « Vérifier la facture »', /Vérifier la facture/.test(A.actionBtnLabel({ action: 'facture_saisir' })));
t('bouton rdv → « Valider le rendez-vous »', /Valider le rendez-vous/.test(A.actionBtnLabel({ action: 'rdv_update' })));
t('bouton amende → « Enregistrer le justificatif »', /Enregistrer le justificatif/.test(A.actionBtnLabel({ action: 'amende_payee' })));
t('détail facture: bouton « Vérifier la facture »', /Vérifier la facture/.test(A.detailHtml({ id: 'f1', domaine: 'facture', action: 'facture_saisir', statut: 'a_verifier', dossier_ref: { plaque: 'HL724CD' }, pieces: [{ filename: 'f.pdf', attachmentId: 'Z' }] })));

// --- liens de finalisation (Phase 5) ---
t('lien amende → fiche par n° d’avis', A.lienDossier({ domaine: 'amende', dossier_ref: { numeroAvis: '2612744314620' } }) === 'amendes.html?avis=2612744314620');
t('lien maintenance (plaque connue) → fiche véhicule', A.lienDossier({ domaine: 'maintenance', dossier_ref: { plaque: 'HL724CD' } }) === 'vehicules.html?veh=v1', A.lienDossier({ domaine: 'maintenance', dossier_ref: { plaque: 'HL724CD' } }));
t('lien sinistre (plaque inconnue) → page sinistres', A.lienDossier({ domaine: 'sinistre', dossier_ref: { plaque: 'ZZ999ZZ' } }) === 'sinistres.html');
t('lien maintenance sans plaque → entretiens', A.lienDossier({ domaine: 'maintenance', dossier_ref: {} }) === 'entretiens.html');

// --- résumé de référence ---
t('refSummary avis+plaque', A.refSummary({ numeroAvis: '123', plaque: 'HL724CD' }) === 'avis 123 · plaque HL724CD');
t('refSummary vide → à préciser', /à préciser/.test(A.refSummary({})));

console.log(`\n${ok}/${ok + ko} OK`);
process.exit(ko ? 1 : 0);
