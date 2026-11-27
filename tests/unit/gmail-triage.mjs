/* Test unitaire du moteur de tri Gmail (SOURCE UNIQUE supabase/functions/_shared/triage.mjs,
 * utilisée aussi par la fonction serveur gmail-actions en Deno).
 * Couvre les 8 scénarios imposés : mail flotte non libellé, mail archivé libellé,
 * mail vu dans les deux sources, réponse dans un fil déjà traité, mail RH, reçu
 * valide, RDV reporté, dossier ambigu. Pur, sans réseau. Exécuter : node tests/unit/gmail-triage.mjs
 */
import { T } from '../../supabase/functions/_shared/triage.mjs';

let ok = 0, ko = 0;
function check(label, cond, got) {
  if (cond) { ok++; console.log('✅', label); }
  else { ko++; console.log('❌', label, got !== undefined ? '\n   obtenu: ' + JSON.stringify(got) : ''); }
}

// Contexte flotte fictif
const ctx = {
  vehicules: [{ immat: 'HL-724-CD' }, { immat: 'GP-333-QJ' }, { immat: 'AA-123-BB' }],
  amendes: [{ numeroAvis: '2612744314620' }, { numeroAvis: '9988776655443' }],
  sinistres: [
    { key: 'sin-aa123-01', plaque: 'AA-123-BB' },
    { key: 'sin-aa123-02', plaque: 'AA-123-BB' }, // 2 dossiers sur la même plaque → ambigu
    { key: 'sin-gp333-01', plaque: 'GP-333-QJ' },
  ],
};

// 1) Mail de flotte NON libellé — confirmation de RDV garage (véhicule connu)
let r = T.classify({
  id: 'm1', from: 'Garage Martin <contact@garage-martin.fr>',
  subject: 'Confirmation rendez-vous révision HL-724-CD',
  snippet: 'Bonjour, nous confirmons votre rendez-vous pour la révision du véhicule HL-724-CD le 2 décembre à 9h.',
}, ctx);
check('1. flotte non libellé → maintenance rdv_update confirme', r.domaine === 'maintenance' && r.action === 'rdv_update' && r.statutRdv === 'confirme' && !r.bloque, r);

// 2) Mail ARCHIVÉ avec le libellé « Parc Pilot », sans mot-clé flotte évident
r = T.classify({
  id: 'm2', from: 'compta@fournisseur-x.fr', subject: 'Votre document',
  snippet: 'Veuillez trouver le document demandé en pièce jointe.',
  labels: ['Parc Pilot'], hasPdf: true, pdfs: [{ filename: 'doc.pdf', attachmentId: 'A2' }],
}, ctx);
check('2. archivé + libellé Parc Pilot → jamais ignoré (à vérifier)', r.action === 'a_verifier' && r.domaine !== 'horsflotte', r);

// 3) Même mail vu dans la boîte ET sous le libellé (même messageId) → traité une seule fois
const sim3 = T.simuler([
  { id: 'dup1', subject: 'RDV révision HL-724-CD confirmé', snippet: 'Nous confirmons le rendez-vous.' },
  { id: 'dup1', subject: 'RDV révision HL-724-CD confirmé', snippet: 'Nous confirmons le rendez-vous.', labels: ['Parc Pilot'] },
], ctx);
check('3. vu dans les 2 sources → 2e occurrence ignorée (idempotence)', sim3[0].skip === false && sim3[1].skip === true, sim3);

// 4) Nouvelle réponse dans un fil DÉJÀ traité (nouveau messageId, même thread) → traitable
const ledger = new Set([T.cleIdempotence('old-msg', null)]);
const traiteAvant = T.dejaTraite('old-msg', null, ledger);
const traiteReponse = T.dejaTraite('new-reply', null, ledger);
check('4. réponse (nouveau messageId) dans un fil déjà traité → traitable', traiteAvant === true && traiteReponse === false, { traiteAvant, traiteReponse });

// 5) Mail RH / hors flotte → écarté, aucune IA
r = T.classify({
  id: 'm5', from: 'rh@tjmax.fr', subject: 'Bulletin de paie novembre',
  snippet: 'Bonjour, votre bulletin de paie du mois de novembre est disponible.',
}, ctx);
check('5. mail RH → horsflotte, ignore, besoinIA=false', r.domaine === 'horsflotte' && r.action === 'ignore' && r.besoinIA === false, r);

// 6) Reçu valide : justificatif de paiement d'une amende (n° d'avis connu + PDF)
r = T.classify({
  id: 'm6', from: 'noreply@antai.gouv.fr', subject: 'Paiement de votre avis 2612 744 314 620',
  snippet: 'Votre paiement a bien été enregistré. Reçu en pièce jointe.',
  hasPdf: true, pdfs: [{ filename: 'recu.pdf', attachmentId: 'A6' }],
}, ctx);
check('6. reçu valide amende (avis connu) → amende_payee non bloqué', r.domaine === 'amende' && r.action === 'amende_payee' && !r.bloque && r.refs.numeroAvis === '2612744314620', r);

// 7) RDV reporté (véhicule connu)
r = T.classify({
  id: 'm7', from: 'Garage Martin <contact@garage-martin.fr>',
  subject: 'Report du rendez-vous GP-333-QJ',
  snippet: 'Bonjour, nous devons reporter le rendez-vous de révision à une nouvelle date : le 5 décembre.',
}, ctx);
check('7. RDV reporté → maintenance rdv_update reporte non bloqué', r.domaine === 'maintenance' && r.action === 'rdv_update' && r.statutRdv === 'reporte' && !r.bloque, r);

// 8) Dossier ambigu : réponse assureur avec UNE plaque qui a DEUX dossiers sinistres
r = T.classify({
  id: 'm8', from: 'gestion@assureur.fr', subject: 'Votre sinistre - véhicule AA-123-BB',
  snippet: 'Suite à votre déclaration de sinistre concernant le véhicule AA-123-BB, veuillez nous transmettre le constat.',
}, ctx);
check('8. plaque ambiguë (2 sinistres) → à vérifier, bloqué', r.domaine === 'sinistre' && r.action === 'a_verifier' && r.bloque === true && /plusieurs dossiers/i.test(r.motif), r);

// Bonus : proposition de créneau (pas une confirmation) → à vérifier, jamais de MAJ auto
r = T.classify({
  id: 'm9', from: 'garage@x.fr', subject: 'Révision HL-724-CD',
  snippet: 'Je vous propose un créneau le mardi, êtes-vous disponible ?',
}, ctx);
check('bonus. proposition de créneau → a_verifier (pas de MAJ auto)', r.domaine === 'maintenance' && r.action === 'a_verifier' && r.bloque === true, r);

// Bonus : réponse sur un fil PP (ancre déterministe) → lien fort sans stockage
r = T.classify({
  id: 'm10', from: 'gestion@assureur.fr', subject: 'Re: Sinistre',
  snippet: 'Nous accusons réception de votre constat.',
  headers: { references: '<pp-sinistre-sin-gp333-01@parc-pilot.fr>' },
}, ctx);
check('bonus. ancre de fil PP → sinistre rattaché par fil', r.domaine === 'sinistre' && r.refs.sinistreKey === 'sin-gp333-01' && r.confidence === 'haute', r);

// 9) buildProposal : ligne gmail_a_verifier déterministe et complète (pour la file « À vérifier »)
const msg6 = { id: 'm6', fromEmail: 'noreply@antai.gouv.fr', subject: 'Paiement avis 2612 744 314 620', snippet: 'Reçu joint.', threadId: 't6', dateISO: '2026-11-25T09:00:00Z', hasPdf: true, pdfs: [{ filename: 'recu.pdf', attachmentId: 'A6' }] };
const dec6 = T.classify(msg6, ctx);
const prop = T.buildProposal(msg6, dec6, 'PXP');
check('9. buildProposal : id déterministe + société + action + ref avis',
  prop.id === 'AV-m6' && prop.societe === 'PXP' && prop.domaine === 'amende' && prop.action === 'amende_payee'
  && prop.dossier_ref.numeroAvis === '2612744314620' && prop.statut === 'a_verifier' && Array.isArray(prop.pieces) && prop.pieces.length === 1,
  prop);
check('9b. buildProposal : pas d’ancres bruitées dans dossier_ref', prop.dossier_ref.ancres === undefined, prop.dossier_ref);

// 10) FACTURE : « facture » + plaque reconnue → domaine facture, oriente vers le formulaire, PAS d'IA au tri
r = T.classify({
  id: 'm11', from: 'CAR WORLD CONSULTING <compta@carworld.fr>',
  subject: 'FACTURE MG 4 / HL-724-CD', snippet: 'Bonjour, voici votre facture. Cordialement.',
  hasPdf: true, pdfs: [{ filename: 'Facture-F-2026-627.pdf', attachmentId: 'A11' }],
}, ctx);
check('10. facture + plaque → domaine facture, facture_saisir, véhicule proposé, besoinIA=false',
  r.domaine === 'facture' && r.action === 'facture_saisir' && r.refs.plaque === 'HL724CD' && r.besoinIA === false && r.bloque === true, r);

// 10b) DURCI : un PDF nommé « Facture » SANS aucun indice flotte ne suffit PLUS → écarté.
r = T.classify({ id: 'm11b', from: 'compta@x.fr', subject: 'Votre facture', snippet: 'Facture en pièce jointe.', hasPdf: true, pdfs: [{ filename: 'Facture-2026-044.pdf', attachmentId: 'B' }] }, ctx);
check('10b. facture (PDF « Facture… ») sans AUCUN indice flotte → ignore (durci)', r.action === 'ignore', r);

// 10c) « facture » dans le corps mais PDF au nom générique (f.pdf), zéro contexte flotte → écarté (durcissement)
r = T.classify({ id: 'm11c', from: 'compta@x.fr', subject: 'Votre document', snippet: 'Facture en pièce jointe.', hasPdf: true, pdfs: [{ filename: 'f.pdf', attachmentId: 'B' }] }, ctx);
check('10c. « facture » seule + PDF générique + rien d’auto → ignore', r.action === 'ignore', r);

// 11) Libellé surveillé identifié par son ID Gmail (ctx.watchLabelId, propre à la société) → force
r = T.classify({
  id: 'm12', from: 'inconnu@x.fr', subject: 'Document', snippet: 'Pièce jointe.',
  labels: ['Label_42', 'INBOX'],
}, { ...ctx, watchLabelId: 'Label_42' });
check('11. libellé surveillé par ID → forcé (jamais ignoré)', r.action === 'a_verifier' && r.domaine !== 'horsflotte', r);

// 12) Exclusion PRIORITAIRE : mail en Promotions MÊME avec le libellé surveillé → ignoré
r = T.classify({
  id: 'm13', from: 'promo@shop.fr', subject: 'Facture -70% Black Friday HL-724-CD',
  snippet: 'Votre facture promotionnelle, profitez-en !',
  labels: ['Label_42', 'CATEGORY_PROMOTIONS'], hasPdf: true, pdfs: [{ filename: 'promo.pdf', attachmentId: 'C' }],
}, { ...ctx, watchLabelId: 'Label_42' });
check('12. Promotions + libellé surveillé → exclu (priorité)', r.domaine === 'horsflotte' && r.action === 'ignore', r);

// 12b) Réseaux sociaux → exclu
r = T.classify({ id: 'm13b', from: 'x@linkedin.com', subject: 'Votre profil', snippet: '...', labels: ['CATEGORY_SOCIAL'] }, ctx);
check('12b. Réseaux sociaux → exclu', r.domaine === 'horsflotte' && r.action === 'ignore', r);

// 13) Commission de sécurité (bâtiment) avec « intervention » → ÉCARTÉ (pas de lien flotte)
r = T.classify({ id: 'm14', from: 'secretariat@mairie.fr', subject: 'Commission de sécurité - intervention prévue',
  snippet: 'Bonjour, une intervention de la commission de sécurité est prévue dans vos locaux.' }, ctx);
check('13. commission de sécurité → horsflotte/ignore', r.domaine === 'horsflotte' && r.action === 'ignore', r);

// 13b) Newsletter électroménager (« réparation / garantie ») → ÉCARTÉ (mot générique seul)
r = T.classify({ id: 'm15', from: 'news@electrodepot.fr', subject: '[Comme d’hab Friday] c’est lancé !',
  snippet: 'Profitez de notre service réparation et garantie sur tout le magasin.' }, ctx);
check('13b. newsletter « réparation » seule → ignore (pas d’indice flotte)', r.action === 'ignore', r);

// 13c) Mail informatique (« logiciel / maintenance ») → ÉCARTÉ
r = T.classify({ id: 'm16', from: 'support@editeur.fr', subject: 'Maintenance logicielle planifiée',
  snippet: 'La maintenance de votre logiciel et de votre serveur informatique aura lieu ce soir.' }, ctx);
check('13c. maintenance informatique → ignore', r.domaine === 'horsflotte' && r.action === 'ignore', r);

// 14) VRAI garage, objet vague, SANS plaque mais contexte véhicule → RETENU (à vérifier)
r = T.classify({ id: 'm17', from: 'contact@garage-dupont.fr', subject: 'Votre rendez-vous',
  snippet: 'Bonjour, nous confirmons le rendez-vous pour la révision de votre véhicule au garage.' }, ctx);
check('14. garage + véhicule (sans plaque) → retenu (maintenance, pas ignore)', r.domaine === 'maintenance' && r.action !== 'ignore', r);

// 14b) VRAIE amende ANTAI, objet vague, sans n° reconnu → RETENU
r = T.classify({ id: 'm18', from: 'noreply@antai.gouv.fr', subject: 'Votre avis',
  snippet: 'Vous avez reçu un avis de contravention pour excès de vitesse.' }, ctx);
check('14b. amende ANTAI (terme spécifique) → retenu', r.domaine === 'amende' && r.action !== 'ignore', r);

// 14c) Mail court « Voici votre facture » + PDF facture nommé avec plaque INCONNUE → retenu facture
r = T.classify({ id: 'm19', from: 'compta@fourn.fr', subject: 'Votre document', snippet: 'Voici votre facture.',
  hasPdf: true, pdfs: [{ filename: 'Facture-ZZ-999-ZZ-F-2026-001.pdf', attachmentId: 'P' }] }, ctx);
check('14c. mail court + PDF facture (plaque format dans le nom) → retenu facture', r.domaine === 'facture' && r.action !== 'ignore', r);

// 14d) Expéditeur connu (knownSenders) + 1 mot générique → retenu
r = T.classify({ id: 'm20', from: 'Garage Martin <contact@garage-martin.fr>', subject: 'Facture', snippet: 'Votre facture est disponible.' },
  { ...ctx, knownSenders: ['garage-martin.fr'] });
check('14d. expéditeur connu + « facture » → retenu', r.action !== 'ignore', r);

// 14e) Mot « facture » SEUL, expéditeur inconnu, aucun contexte → ignoré
r = T.classify({ id: 'm21', from: 'hello@mpg.football', subject: 'Il grandit si vite', snippet: 'Votre facture de la semaine.' }, ctx);
check('14e. « facture » seule, inconnu, zéro contexte auto → ignore', r.action === 'ignore', r);

// ========================================================================================
//  DURCISSEMENT FILTRE FACTURES — les factures hors flotte n'arrivent plus dans « À vérifier »
//  (« facture » + PDF + nom de société ne suffisent pas). Carburant/péage sans plaque = retenu.
// ========================================================================================
// F1) Babilou (crèche) — facture + PDF « FACTURE » + société TJMAX, AUCUN lien flotte → ignore
r = T.classify({ id: 'f-babilou', from: 'facturation@babilou.com', subject: 'Fwd: BABILOU - TJMAX - FACTURE N°EVA-2125022',
  snippet: 'Veuillez trouver votre facture en pièce jointe.', hasPdf: true, pdfs: [{ filename: 'BABILOU-FACTURE-EVA-2125022.pdf', attachmentId: 'B1' }] }, ctx);
check('F1. Babilou (crèche, facture+PDF, aucun lien flotte) → ignore', r.action === 'ignore', r);

// F2) SCI (loyer immobilier) → ignore
r = T.classify({ id: 'f-sci', from: 'frederic.beun@projectxparis.fr', subject: 'Fwd: reference I17/AF249 : SCi FIVE STARS 5888 / CO TJ MAX',
  snippet: 'Facture de loyer trimestriel SCI.', hasPdf: true, pdfs: [{ filename: 'Facture-SCI-FIVE-STARS.pdf', attachmentId: 'S1' }] }, ctx);
check('F2. SCI (loyer immobilier) → ignore', r.action === 'ignore', r);

// F3) Restaurant (Westfield) → ignore
r = T.classify({ id: 'f-resto', from: 'compta@zhao.fr', subject: 'Facture n°2026/1000001233 - SAS ZHAO PARLY - WESTFIELD PARLY 2',
  snippet: 'Votre facture restaurant du mois.', hasPdf: true, pdfs: [{ filename: 'facture-zhao-parly.pdf', attachmentId: 'R1' }] }, ctx);
check('F3. Restaurant (Westfield) → ignore', r.action === 'ignore', r);

// F4) DKV SANS plaque — fournisseur carburant reconnu par son CONTENU → retenu facture (société)
r = T.classify({ id: 'f-dkv', from: 'admin@projectxparis.fr', subject: 'Fwd: Facture électronique 23.11.2026, Votre numéro client DKV4302800060',
  snippet: 'Facture DKV EURO SERVICE — cartes carburant de la flotte.', hasPdf: true, pdfs: [{ filename: 'DKV_FR_E-INVOICE_26-656273356-001.pdf', attachmentId: 'D1' }] }, ctx);
check('F4. DKV (carburant, sans plaque) → retenu facture (société)', r.domaine === 'facture' && r.action !== 'ignore', r);

// F5) TotalEnergies CARBURANT → retenu
r = T.classify({ id: 'f-total-carb', from: 'facture@totalenergies.fr', subject: 'Facture TotalEnergies — carte carburant',
  snippet: 'Votre relevé de carte carburant du mois (station-service).', hasPdf: true, pdfs: [{ filename: 'TotalEnergies-carburant.pdf', attachmentId: 'T1' }] }, ctx);
check('F5. TotalEnergies CARBURANT → retenu facture', r.domaine === 'facture' && r.action !== 'ignore', r);

// F6) TotalEnergies ÉLECTRICITÉ pour une boutique → écarté (même fournisseur, mais hors carburant/péage)
r = T.classify({ id: 'f-total-elec', from: 'facture@totalenergies.fr', subject: 'Facture TotalEnergies — électricité boutique',
  snippet: "Votre facture d'électricité (kWh) pour votre magasin.", hasPdf: true, pdfs: [{ filename: 'TotalEnergies-electricite-boutique.pdf', attachmentId: 'T2' }] }, ctx);
check('F6. TotalEnergies ÉLECTRICITÉ (boutique) → ignore (hors flotte)', r.action === 'ignore', r);

// F7) Garage avec contexte auto (plaque seulement dans le PDF) → retenu facture, véhicule à préciser
r = T.classify({ id: 'f-garage', from: 'compta@garage-x.fr', subject: 'Facture réparation garage',
  snippet: 'Facture de réparation effectuée au garage, détails en pièce jointe.', hasPdf: true, pdfs: [{ filename: 'facture-reparation.pdf', attachmentId: 'G1' }] }, ctx);
check('F7. Garage (contexte auto ; plaque dans le PDF) → retenu (à préciser)', r.action !== 'ignore', r);

console.log(`\n${ok}/${ok + ko} OK`);
process.exit(ko ? 1 : 0);
