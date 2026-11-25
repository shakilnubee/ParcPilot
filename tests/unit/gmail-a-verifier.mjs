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

// --- cartes ---
const amende = { id: 'AV-m6', from_email: 'noreply@antai.gouv.fr', objet: 'Paiement avis 2612744314620', recu_le: '2026-11-25T09:12:00Z', extrait: 'Paiement enregistré.', domaine: 'amende', action: 'amende_payee', statut: 'a_verifier', dossier_ref: { numeroAvis: '2612744314620' }, pieces: [{ filename: 'recu.pdf', attachmentId: 'A6' }] };
const h = A.cardHtml(amende);
t('carte: domaine + action + avis + pièce + 3 boutons', /🅿️ Amende/.test(h) && /Marquer l’amende payée/.test(h) && /avis 2612744314620/.test(h) && /recu\.pdf/.test(h) && /gav-confirm/.test(h) && /gav-correct/.test(h) && /gav-ignore/.test(h));
const traite = Object.assign({}, amende, { statut: 'ignore' });
t('carte traitée: pas de boutons + badge', !/gav-confirm/.test(A.cardHtml(traite)) && /gav-statut/.test(A.cardHtml(traite)));
t('XSS échappé', /&lt;img/.test(A.cardHtml({ id: 'x', from_email: '<img src=x onerror=alert(1)>', domaine: 'inconnu', action: 'a_verifier', statut: 'a_verifier', dossier_ref: {} })));

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
