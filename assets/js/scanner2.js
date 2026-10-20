/* ============================================================
   PARC PILOT — SCANNER IA v2 (3 étapes) — module autonome (chargé par pages/scanner.html)
   1) Détection du type · 2) Extraction par SCHÉMA du type · 3) Contrôle de cohérence
   Écran de validation : champs incertains surlignés, éditables, JAMAIS d'auto-enregistrement.
   S'appuie sur l'existant : FP.scanIA (Edge Function scan-doc) + FP.persist + FP.dupe.
   N'écrase RIEN des scanners actuels (facture/amende/carte grise) — il vit à côté (opt-in).
   ============================================================ */
(function () {
  const FP2 = {};
  // ⚠️ `data` = le magasin de données LIVE de l'app (mêmes tableaux que window.FP_DATA, mutés en place
  // par supabase-client). Contrairement aux pages de l'app, pages/scanner.html ne définit PAS de global
  // `data` → les références `data.factures`/`data.amendes` de l'enregistrement lançaient « data is not
  // defined » et bloquaient la validation d'une facture/amende. On l'alias donc sur FP_DATA (repli vide).
  const data = (typeof window !== 'undefined' && window.FP_DATA) ? window.FP_DATA : { vehicules: [], amendes: [], factures: [], conducteurs: [] };
  try { if (typeof window !== 'undefined' && !window.data) window.data = data; } catch (e) {} // les gardes « window.data && … » passent aussi → cache mémoire synchronisé
  const J = a => a.join('\n');
  const esc = s => (window.FP && FP.esc) ? FP.esc(s) : String(s == null ? '' : s);

  // ---- Règles transverses communes à toutes les extractions ----
  const BASE_RULES = J([
    "Tu lis un document de gestion de flotte automobile (peut etre incline, scanne, photo, multi-pages : redresse mentalement, lis TOUTES les pages, recto/verso, en-tetes/pieds, tableaux ligne par ligne, observations/reserves).",
    "NE JAMAIS INVENTER : champ absent -> null. Champ present mais difficile a lire -> niveau_confiance 'faible' + verification_humaine_requise true. Ne devine pas un numero, ne deduis pas une date sans preuve, ne transforme pas une donnee incertaine en certaine.",
    "Pour CHAQUE champ demande, renvoie un objet : { champ, valeur_originale, valeur_normalisee, page, libelle_document, niveau_confiance ('eleve'|'moyen'|'faible'), verification_humaine_requise (bool) }.",
    "Normalisation : dates -> valeur_normalisee au format AAAA-MM-JJ (garder l'originale). Montants -> nombre a point decimal. Kilometrages -> entier sans unite. Numeros (VIN, immat, permis, contrat, police, avis) -> ne modifie que les espaces parasites, jamais les chiffres. VIN = 17 caracteres : si different, signale l'anomalie sans corriger.",
    "Renvoie UNIQUEMENT un objet JSON valide, sans texte autour, de forme : { \"type_document\":\"\", \"sous_type\":\"\", \"langue\":\"fr\", \"qualite_document\":\"bonne|moyenne|insuffisante\", \"champs\":[ ... ], \"anomalies\":[ {type, gravite, description} ], \"champs_manquants\":[ {champ, importance} ], \"nouveau_scan_recommande\": false }."
  ]);

  // ---- Étape 1 : détection du type ----
  const DETECT_PROMPT = J([
    "Identifie le TYPE de ce document de gestion de flotte. Ne l'extrais pas encore.",
    "Renvoie UNIQUEMENT un JSON : { \"type_document\":\"<cle>\", \"sous_type\":\"\", \"nombre_pages\":0, \"nombre_documents_detectes\":1, \"qualite_document\":\"bonne|moyenne|insuffisante\", \"langue\":\"fr\", \"confiance\":\"eleve|moyen|faible\" }.",
    "Cles possibles pour type_document : certificat_immatriculation, permis_conduire, carte_identite, contrat_location, attestation_assurance, controle_technique, facture_entretien, facture_carburant, facture_ulys, facture_achat, sinistre, etat_des_lieux, avis_contravention, forfait_post_stationnement, document_inconnu.",
    "Indices : 'Certificat d'immatriculation'/champs A B C D E = certificat_immatriculation ; 'Permis de conduire'/categories B = permis_conduire ; \"Carte nationale d'identite\"/CNI/passeport = carte_identite ; 'Location Longue Duree'/LLD/loyer/loueur = contrat_location ; 'Attestation d'assurance'/police/garanties = attestation_assurance ; 'Controle technique'/PV/defaillances = controle_technique ; 'Avis de contravention'/'amende'/telepaiement = avis_contravention ; 'Forfait Post-Stationnement'/FPS = forfait_post_stationnement ; facture/devis d'entretien-reparation-garage = facture_entretien ; facture TotalEnergies/carburant/gazole/pleins/carte carburant = facture_carburant ; facture de peages Ulys/VINCI Autoroutes/badge de teleage = facture_ulys ; constat amiable/declaration de sinistre/accident = sinistre ; etat des lieux/proces-verbal de restitution/remise du vehicule = etat_des_lieux ; autre facture ou achat = facture_achat."
  ]);

  // ---- Étape 2 : SCHÉMAS d'extraction par type (Phase 1 = 7 types) ----
  // key -> { label, cible (table métier), champs:[[cle,'libelle',(hint)]] }
  const SCHEMAS = {
    certificat_immatriculation: { label: "Carte grise", cible: "vehicules", champs: [
      ["immat", "Immatriculation (A)"], ["date1", "1re mise en circulation (B)"], ["titulaire", "Titulaire (C.1)"],
      ["marque", "Marque (D.1)"], ["version", "Version (D.2)"], ["modele", "Denomination commerciale (D.3)"],
      ["vin", "VIN (E)"], ["ptac", "PTAC en kg = repere F.2 (masse en charge max admissible)"], ["masse", "Masse EN SERVICE en kg = repere G EXACTEMENT (PAS G.1 poids a vide, PAS F.1/F.2 PTAC)"], ["genre", "Genre national (J.1)"],
      ["puissanceKw", "Puissance nette (P.2)"], ["energie", "Energie (P.3)"], ["puissanceFiscale", "Puissance administrative (P.6)"],
      ["places", "Nombre de places (S.1)"], ["co2", "CO2 g/km (V.7)"], ["prochainCT", "Date du PROCHAIN controle technique = repere X.1 UNIQUEMENT, ecrit 'VISITE AVANT LE JJ/MM/AAAA'. Recopie CETTE date exacte. NE JAMAIS prendre le repere I (date d'edition du certificat) ni B (1re immatriculation) a la place. Pour une MOTO/ancienne carte, X.1 peut etre absent → laisser VIDE, ne jamais inventer ni deduire une date."], ["mentionsZ", "Mentions particulieres (Z)"]
    ]},
    permis_conduire: { label: "Permis de conduire", cible: "conducteurs", champs: [
      ["nom", "Nom"], ["prenom", "Prenom"], ["dateNaissance", "Date de naissance"], ["numeroPermis", "Numero du permis"],
      ["dateDelivrance", "Date de delivrance"], ["dateExpirationTitre", "Fin de validite du titre"],
      ["categories", "Categories (liste ; NE PAS extraire le nombre de points)"], ["restrictions", "Restrictions/codes"], ["paysEmetteur", "Pays emetteur"]
    ]},
    contrat_location: { label: "Contrat LLD / location", cible: "leasing", champs: [
      ["loueur", "Loueur"], ["locataire", "Locataire"], ["numeroContrat", "N° de contrat"], ["immat", "Immatriculation"],
      ["vin", "VIN"], ["marque", "Marque"], ["modele", "Modele"], ["energie", "Energie"],
      ["loyerTTC", "Loyer mensuel TTC (par mois, services inclus)"], ["premierLoyer", "1er loyer / majore"], ["apport", "Apport / depot"],
      ["dureeMois", "Duree (mois)"], ["dateDebut", "Date de debut"], ["dateFin", "Date de fin"],
      ["kmAnnuel", "Km annuel"], ["kmTotal", "Km total autorise"], ["prixKmSupp", "Prix du km supplementaire"], ["valeurResiduelle", "Valeur residuelle / option d'achat"]
    ]},
    attestation_assurance: { label: "Assurance", cible: "documents", champs: [
      ["assureur", "Assureur"], ["souscripteur", "Souscripteur"], ["numeroPolice", "N° de police / contrat"], ["immat", "Immatriculation"],
      ["vin", "VIN"], ["dateDebut", "Debut de validite"], ["dateFin", "Fin de validite / echeance"],
      ["garanties", "Garanties"], ["franchises", "Franchises (dommages/vol/bris de glace)"], ["numeroAssistance", "N° d'assistance"]
    ]},
    controle_technique: { label: "Contrôle technique", cible: "vehicules", champs: [
      ["numeroPV", "N° de PV"], ["date", "Date du controle"], ["centre", "Centre"], ["immat", "Immatriculation"], ["vin", "VIN"],
      ["km", "Kilometrage"], ["resultat", "Resultat (favorable/defavorable majeure/defavorable critique)"],
      ["prochainCT", "Date prochain controle"], ["contrevisite", "Contre-visite obligatoire (oui/non)"], ["dateLimiteContrevisite", "Date limite contre-visite"]
    ]},
    facture_entretien: { label: "Facture / devis entretien", cible: "factures", champs: [
      ["typeDoc", "Type (devis/facture/avoir/ordre de reparation)"], ["numero", "N° de facture"], ["date", "Date d'emission"],
      ["fournisseur", "Fournisseur / garage (emetteur, PAS le client)"], ["immat", "Immatriculation"],
      ["km", "Kilometrage"], ["description", "Nature de l'intervention (court)"],
      ["montantHT", "Total HT"], ["montantTVA", "TVA"], ["montantTTC", "Total TTC"], ["acompte", "Acompte"], ["resteAPayer", "Reste a payer"]
    ]},
    avis_contravention: { label: "Amende / avis", cible: "amendes", champs: [
      ["numeroAvis", "N° de l'avis"], ["numeroTelepaiement", "N° de telepaiement"], ["immat", "Immatriculation"],
      ["dateInfraction", "Date de l'infraction (constatee le)"], ["heure", "Heure"], ["lieu", "Lieu"], ["motif", "Nature de l'infraction"],
      ["montantMinore", "Montant MINORE"], ["dateLimiteMinore", "Date limite du minore"], ["montantForfaitaire", "Montant forfaitaire"],
      ["dateLimiteForfaitaire", "Date limite forfaitaire"], ["montantMajore", "Montant MAJORE"], ["dateApplicationMajore", "Date d'application de la majoration"],
      ["points", "Points retires (uniquement si ecrit, sinon null)"]
    ]},
    forfait_post_stationnement: { label: "FPS (post-stationnement)", cible: "amendes", champs: [
      ["numeroFps", "N° de FPS"], ["collectivite", "Collectivite / operateur"], ["immat", "Immatriculation"], ["date", "Date"], ["lieu", "Lieu / zone"],
      ["montantInitial", "Montant initial"], ["montantMinore", "Montant minore"], ["dateLimite", "Date limite de paiement"],
      ["montantMajore", "Montant majore eventuel"], ["recoursDateLimite", "Date limite du recours (RAPO)"]
    ]},
    carte_identite: { label: "Pièce d'identité", cible: "conducteurs", champs: [
      ["nom", "Nom"], ["prenom", "Prenom"], ["dateNaissance", "Date de naissance"],
      ["numeroPiece", "N° du document (CNI/passeport)"], ["dateExpirationTitre", "Date d'expiration du titre"], ["nationalite", "Nationalite"]
    ]},
    facture_achat: { label: "Facture / achat", cible: "factures", factureType: null, champs: [
      ["typeDoc", "Type (facture/devis/avoir)"], ["numero", "N° de facture"], ["date", "Date d'emission"],
      ["fournisseur", "Fournisseur (emetteur, PAS le client)"], ["immat", "Immatriculation (si liee a un vehicule)"],
      ["description", "Nature de l'achat (court)"], ["montantHT", "Total HT"], ["montantTVA", "TVA"], ["montantTTC", "Total TTC"]
    ]},
    facture_carburant: { label: "Carburant / péages TotalEnergies", cible: "factures", factureType: "carburant", fournisseurDefaut: "TotalEnergies", champs: [
      ["numero", "N° de facture"], ["date", "Date d'emission"], ["fournisseur", "Fournisseur"], ["immat", "Immatriculation / n° de carte (si indique)"],
      ["montantHT", "Total HT"], ["montantTVA", "TVA"], ["montantTTC", "Total TTC (net a payer)"], ["litres", "Litres (si indique)"], ["km", "Kilometrage (si indique)"]
    ]},
    sinistre: { label: "Sinistre / constat", cible: "sinistres", champs: [
      ["date", "Date du sinistre"], ["immat", "Immatriculation de NOTRE vehicule"], ["lieu", "Lieu"],
      ["circonstances", "Circonstances (court)"], ["responsabilite", "Responsabilite (responsable / non responsable / partagee / en cours)"],
      ["tiersPlaque", "Plaque du tiers"], ["tiersAssureur", "Assureur adverse"], ["tiersNom", "Conducteur adverse"],
      ["montantTTC", "Montant des dommages (si chiffre)"], ["numeroSinistre", "N° de dossier sinistre (si present)"]
    ]},
    etat_des_lieux: { label: "État des lieux / restitution", cible: "documents", docType: "etat-des-lieux", champs: [
      ["immat", "Immatriculation"], ["date", "Date de l'etat des lieux"], ["km", "Kilometrage releve"],
      ["typeEtat", "Type (entree / sortie / restitution)"], ["dommages", "Dommages / reserves (court)"], ["operateur", "Operateur / loueur"]
    ]}
  };
  // Alias renvoyés parfois par la détection.
  const TYPE_ALIAS = { "carte_grise": "certificat_immatriculation", "carte-grise": "certificat_immatriculation", "amende_forfaitaire_majoree": "avis_contravention", "document_antai": "avis_contravention", "contrat_leasing": "contrat_location", "releve_information_assurance": "attestation_assurance", "devis_reparation": "facture_entretien", "facture_fournisseur": "facture_entretien",
    "carte-identite": "carte_identite", "cni": "carte_identite", "passeport": "carte_identite",
    "facture_total": "facture_carburant", "facture-total": "facture_carburant", "carburant": "facture_carburant", "totalenergies": "facture_carburant",
    "facture-ulys": "facture_ulys", "ulys": "facture_ulys", "peage": "facture_ulys",
    "facture": "facture_achat", "achat": "facture_achat", "facture_divers": "facture_achat",
    "constat": "sinistre", "constat_amiable": "sinistre", "declaration_sinistre": "sinistre", "accident": "sinistre",
    "etat-des-lieux": "etat_des_lieux", "restitution": "etat_des_lieux", "pv_restitution": "etat_des_lieux" };

  // Types détectés qui se traitent mieux dans un outil DÉDIÉ (on ne fait pas d'OCR vision approximatif) → on redirige.
  // Ex. péages Ulys : la lecture précise (montants par collaborateur, colonnes) est faite par l'importateur de la page Factures.
  const REDIRECTS = {
    facture_ulys: { label: "Péages Ulys / VINCI", page: "controle.html?tab=ulys",
      reason: "Les factures de péages Ulys se lisent dans l'importateur dédié (page Factures → onglet Ulys) : il reconstitue les colonnes pour donner les bons montants par collaborateur. Un OCR simple mélangerait les colonnes." }
  };

  function schemaFor(type) { return SCHEMAS[type] || SCHEMAS[TYPE_ALIAS[type]] || null; }
  function normType(type) { return SCHEMAS[type] ? type : (TYPE_ALIAS[type] || type); }

  function buildExtractPrompt(type) {
    const s = schemaFor(type); if (!s) return null;
    const lignes = s.champs.map(c => "- " + c[0] + " : " + c[1]);
    const extra = [];
    if (s.cible === "amendes") extra.push(
      "AMENDES : renvoie TOUJOURS les 3 montants separement (minore, forfaitaire, majore) avec leurs dates limites. NE choisis JAMAIS automatiquement le plus grand. Le montant a payer sera decide par l'application selon la date du jour.",
      "Ne confonds jamais un montant avec un n° d'avis, de telepaiement, de telephone, une annee ou un code postal (le montant est petit, en general 11 a 1500 euros)."
    );
    if (s.cible === "vehicules") extra.push(
      "Immatriculation = plaque francaise AB-123-CD. Ne confonds pas titulaire (C.1) et conducteur habituel.",
      "CARTE GRISE — POIDS (tres important) : le champ 'masse' = la MASSE EN SERVICE, reperee par la lettre « G » SEULE sur la carte grise (masse du vehicule en ordre de marche, en kg, en general 1000 a 2600 kg pour une voiture). NE PAS confondre : « G.1 » = poids a vide national (a IGNORER), « F.1 »/« F.2 » = PTAC / masse en charge maximale (plus eleve, va dans 'ptac'), « F.3 » = ensemble. Recopie le nombre EXACT du repere G en enlevant les espaces (ex '2 102 kg' -> 2102). Verifie bien que tu lis la ligne « G » et pas une ligne « F » ou « G.1 » juste a cote. Si le repere G est illisible/absent, mets null (ne devine pas)."
    );
    if (s.cible === "factures") extra.push(
      "FACTURE : le TTC = le montant 'NET A PAYER' / 'Total TTC' imprime, PAS la somme de tous les nombres de la page. HT + TVA doivent egaler TTC. Le fournisseur est l'EMETTEUR (celui qui facture), jamais le client."
    );
    if (s.cible === "sinistres") extra.push(
      "SINISTRE : 'immat' = la plaque de NOTRE vehicule (le titulaire/assure du document), pas celle du tiers. Distingue bien notre vehicule du vehicule adverse (tiers). Responsabilite = telle qu'ecrite (responsable / non responsable / partagee) sinon 'en cours'."
    );
    return J([
      "Type de document : " + s.label + ". Extrais UNIQUEMENT ces champs (dans l'ordre) :",
      J(lignes),
      extra.length ? J(extra) : "",
      "",
      BASE_RULES
    ]);
  }

  // ---- helpers de lecture des champs renvoyés ----
  function champ(model, key) { try { return (model.champs || []).find(c => c && c.champ === key) || null; } catch (e) { return null; } }
  function val(model, key) { const c = champ(model, key); return c ? (c.valeur_normalisee != null && c.valeur_normalisee !== '' ? c.valeur_normalisee : c.valeur_originale) : null; }
  function num(v) { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(/[\s€]/g, '').replace(',', '.')); return isFinite(n) ? n : null; }
  function intv(v) { const n = num(v); return n == null ? null : Math.round(n); }

  // ---- Étape 3 : contrôle de cohérence (100% côté site, sans IA) ----
  function coherence(model, type) {
    const t = normType(type); const out = Array.isArray(model.anomalies) ? model.anomalies.slice() : [];
    const add = (type2, gravite, description) => out.push({ type: type2, gravite, description, verification_humaine_requise: gravite !== 'basse' });
    // VIN 17 caractères
    const vin = val(model, 'vin'); if (vin && String(vin).replace(/\s/g, '').length !== 17) add('vin_longueur', 'moyenne', `Le VIN « ${vin} » ne fait pas 17 caractères — à vérifier.`);
    // Carte grise : masse en service (champ G) plausible + cohérente avec le PTAC (F.2).
    // Une valeur aberrante = souvent une confusion G / G.1 / PTAC → on alerte pour vérification.
    if (t === 'certificat_immatriculation') {
      const masse = num(val(model, 'masse')), ptac = num(val(model, 'ptac'));
      if (masse != null && (masse < 400 || masse > 5000)) add('masse_suspecte', 'moyenne', `La masse en service lue (${masse} kg) semble anormale : vérifie que c'est bien le repère « G » (pas « G.1 » ni le PTAC « F.2 »).`);
      if (masse != null && ptac != null && masse > ptac) add('masse_ptac_inversees', 'moyenne', `La masse en service (${masse} kg) dépasse le PTAC (${ptac} kg) — tu as probablement inversé le champ « G » et « F.2 ». Vérifie.`);
    }
    // HT + TVA = TTC (tolérance 2 cts) — sur TOUTE facture (entretien, achat, carburant)
    if ((schemaFor(t) || {}).cible === 'factures') { const ht = num(val(model, 'montantHT')), tva = num(val(model, 'montantTVA')), ttc = num(val(model, 'montantTTC')); if (ht != null && tva != null && ttc != null && Math.abs(ht + tva - ttc) > 0.02) add('montants_incoherents', 'elevee', `HT (${ht}) + TVA (${tva}) ≠ TTC (${ttc}). À vérifier avant enregistrement.`); }
    // Amende : les 3 montants, jamais le majoré par défaut
    if (t === 'avis_contravention') { const mi = num(val(model, 'montantMinore')), fo = num(val(model, 'montantForfaitaire')), ma = num(val(model, 'montantMajore')); if (mi == null && fo == null) add('montant_amende_absent', 'moyenne', "Aucun montant minoré/forfaitaire lu — à saisir à la main."); if (ma != null && mi == null && fo == null) add('montant_majore_seul', 'moyenne', "Seul le montant majoré a été lu : ne jamais l'appliquer par défaut, vérifie les dates limites."); }
    // Immatriculation présente dans la flotte ? (info, pas bloquant)
    const immat = val(model, 'immat');
    if (immat && window.data && Array.isArray(data.vehicules)) { const up = (window.FP && FP.normImmat) ? FP.normImmat(immat) : String(immat).toUpperCase().replace(/[^A-Z0-9]/g, ''); const known = data.vehicules.some(v => ((window.FP && FP.normImmat) ? FP.normImmat(v.immat) : String(v.immat || '').toUpperCase().replace(/[^A-Z0-9]/g, '')) === up);
      if (!known && t !== 'certificat_immatriculation') add('vehicule_inconnu', 'basse', `Le véhicule ${immat} n'est pas (encore) dans la flotte.`);
      if (known && t === 'certificat_immatriculation') add('vehicule_existant', 'basse', `⚠️ Le véhicule ${immat} EXISTE DÉJÀ : on ne fera que compléter ses cases vides — aucune donnée déjà saisie ne sera écrasée. Vérifie bien que la plaque est correcte avant d'enregistrer.`); }
    // Dates : fin < début
    const d1 = val(model, 'dateDebut'), d2 = val(model, 'dateFin'); if (d1 && d2 && new Date(d1) > new Date(d2)) add('dates_incoherentes', 'moyenne', "La date de fin est antérieure à la date de début.");
    // CT / assurance expirés (info)
    if (t === 'attestation_assurance') { const fin = val(model, 'dateFin'); if (fin && new Date(fin) < new Date()) add('assurance_expiree', 'elevee', `L'attestation semble expirée (fin ${fin}).`); }
    model.anomalies = out; return model;
  }

  // ---- Pipeline complet ----
  FP2.run = async function (file, onStep) {
    if (!(window.FP && FP.scanIA)) throw new Error("Scanner indisponible (FP.scanIA manquant).");
    onStep && onStep('detect');
    let det = null;
    try { det = await FP.scanIA(file, 'detect', DETECT_PROMPT); } catch (e) { console.warn('[scan2 detect]', e); }
    let type = (det && (det.type_document || det.type)) || 'document_inconnu';
    type = normType(type);
    // Péages Ulys : lecture PRÉCISE (pas d'OCR vision approximatif) via la source unique FP.ulys —
    // reconstruction des colonnes par position + détail par collaborateur ancré sur le badge.
    if (type === 'facture_ulys') {
      const isPdf = (file.type === 'application/pdf') || /\.pdf$/i.test(file.name || '');
      if (isPdf && window.FP && FP.ulys) {
        onStep && onStep('extract', { type, label: 'Péages Ulys' });
        let text = await FP.ulys.pdfToText(file);
        if ((!text || text.replace(/\s/g, '').length < 80) && FP.ocr && FP.ocr.fileToText) { try { text = await FP.ocr.fileToText(file, 99); } catch (e) {} }
        const p = FP.ulys.parse(text || '');
        if (p && p.numero && p.ttc != null) {
          onStep && onStep('coherence');
          const rows = (p.conso || []).map(c => Object.assign({ mois: p.mois, numero: p.numero }, c));
          return { type_document: 'facture_ulys', cible: 'factures', qualite_document: (det && det.qualite_document) || 'bonne',
            _ulys: { fac: [p], rows }, champs: [] };
        }
      }
      // PDF illisible ou photo (pas de couche texte) → on oriente vers l'importateur dédié.
      return { type_document: type, _redirect: REDIRECTS[type], qualite_document: (det && det.qualite_document) || '', champs: [] };
    }
    if (REDIRECTS[type]) {
      return { type_document: type, _redirect: REDIRECTS[type], qualite_document: (det && det.qualite_document) || '', champs: [] };
    }
    if (!schemaFor(type)) {
      // type non couvert : on tente une extraction "facture / achat" générique (neutre).
      type = 'facture_achat';
    }
    onStep && onStep('extract', { type, label: (schemaFor(type) || {}).label });
    const prompt = buildExtractPrompt(type);
    // Extraction verbeuse (provenance/confiance par champ) → autoriser plus de jetons pour ne pas tronquer le JSON.
    let model = await FP.scanIA(file, type, prompt, { maxTokens: 4096 });
    if (!model || typeof model !== 'object') model = { champs: [] };
    model.type_document = type;
    model.sous_type = (det && det.sous_type) || model.sous_type || '';
    if (!model.qualite_document && det && det.qualite_document) model.qualite_document = det.qualite_document;
    onStep && onStep('coherence');
    model = coherence(model, type);
    model.cible = (schemaFor(type) || {}).cible || null;
    return model;
  };

  // ============================================================
  //  ENREGISTREMENT (après validation humaine) — route vers la bonne table
  // ============================================================
  function societe() { try { return (FP.activeSociete && FP.activeSociete()) || 'PXP'; } catch (e) { return 'PXP'; } }
  function nextVehId() { let m = 0; try { (data.vehicules || []).forEach(v => { const x = String(v.id || '').match(/(\d+)/); if (x) m = Math.max(m, +x[1]); }); } catch (e) {} return 'V-' + String(m + 1).padStart(3, '0'); }
  function normI(s) { return (window.FP && FP.normImmat) ? FP.normImmat(s) : String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function findVeh(immat) { if (!immat) return null; const up = normI(immat); try { return (data.vehicules || []).find(v => normI(v.immat) === up) || null; } catch (e) { return null; } }
  function uid(p) { return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // Garde-fou multi-sociétés (défense en profondeur) : jamais d'enregistrement en vue « Toutes les sociétés ».
  function bloqueSiToutesSocietes() { if (window.FP && FP.estVueToutesSocietes && FP.estVueToutesSocietes()) throw new Error("Choisis d'abord la société du client (tu es sur « Toutes les sociétés ») avant d'enregistrer."); }
  // Lit les valeurs éditées depuis l'UI (map champ->valeur) fusionnées avec le modèle.
  FP2.save = async function (model, edited) {
    bloqueSiToutesSocietes();
    const g = k => (edited && Object.prototype.hasOwnProperty.call(edited, k)) ? edited[k] : val(model, k);
    const t = normType(model.type_document);
    const cible = (schemaFor(t) || {}).cible;
    let target = { table: null, id: null };

    if (cible === 'vehicules') {
      const immat = (g('immat') || '').toUpperCase().trim();
      if (!immat) throw new Error("Immatriculation manquante.");
      const existing = findVeh(immat);
      const rec = existing ? { ...existing } : { id: nextVehId(), immat, statut: 'actif', groupes: ['non-classe'], societe: societe() };
      // ⚠️ RÈGLE : sur un véhicule DÉJÀ existant, on ne fait QUE COMPLÉTER les cases vides — on
      // n'écrase JAMAIS une valeur déjà saisie (sinon un mauvais scan corrompt une fiche existante).
      // Sur un véhicule NEUF, tout est vide → tout est rempli.
      const setE = (k, v) => { if (v == null || v === '') return; if (!existing || rec[k] == null || rec[k] === '') rec[k] = v; };
      if (t === 'certificat_immatriculation') {
        setE('marque', g('marque')); setE('modele', g('modele')); setE('version', g('version'));
        setE('vin', g('vin')); setE('co2', num(g('co2')));
        setE('puissanceFiscale', intv(g('puissanceFiscale')));
        setE('carburant', g('energie')); setE('dateMiseEnCirculation', g('date1'));
        setE('prochainCT', g('prochainCT'));
        // Masse : réglage séparé, on ne remplit que s'il est vide.
        if (intv(g('masse')) != null) { try { const s = FP.settings.get(); s.vehMasse = s.vehMasse || {}; if (s.vehMasse[rec.id] == null || s.vehMasse[rec.id] === '') { s.vehMasse[rec.id] = intv(g('masse')); FP.settings.save(s); } } catch (e) {} }
      } else if (t === 'controle_technique') {
        // Un CT met légitimement à jour les dates de CT (info plus récente).
        if (g('date')) rec.dateDernierCT = g('date'); if (g('prochainCT')) rec.prochainCT = g('prochainCT');
        // Le km ne peut que MONTER : on n'écrit que s'il est supérieur au km connu.
        const kmLu = intv(g('km')); if (kmLu != null && (!(Number(rec.km) > 0) || kmLu >= Number(rec.km))) rec.km = kmLu;
      }
      if (existing) {
        // ⚠️ SÉCURITÉ DONNÉES : n'envoyer QUE les champs que le scan a réellement changés (diff avec
        // la copie en mémoire), pas toute la fiche. Sinon, si `existing` venait du snapshot data.js
        // (chauffeur vidé pour le RGPD), on réécrivait chauffeur='' et on effaçait le conducteur réel.
        const patch = { id: rec.id };
        Object.keys(rec).forEach(k => { if (k !== 'id' && rec[k] !== existing[k]) patch[k] = rec[k]; });
        try { await FP.persist.update('vehicules', rec.id, patch); } catch (e) { try { await FP.persist.upsert('vehicules', patch); } catch (e2) {} }
        try { if (window.data && Array.isArray(data.vehicules)) { const i = data.vehicules.findIndex(v => v.id === rec.id); if (i >= 0) data.vehicules[i] = rec; } } catch (e) {}
      }
      else { try { await FP.persist.insert('vehicules', rec); } catch (e) {} try { if (window.data && Array.isArray(data.vehicules)) data.vehicules.push(rec); } catch (e) {} }
      target = { table: 'vehicules', id: rec.id, existing: !!existing };
      // ⚠️ RÈGLE (CLAUDE.md) : un CONTRÔLE TECHNIQUE met à jour les dates du véhicule (ci-dessus) ET doit
      // AUSSI apparaître dans la fiche → section « Documents » (table documents, type controle-technique),
      // avec le PDF scanné. Sans ça, le CT scanné ne se retrouvait nulle part dans « les documents ».
      if (t === 'controle_technique' && model._fileUrl) {
        try {
          const url = model._fileUrl;
          const driveId = ((String(url).match(/\/d\/([-\w]{20,})/) || [])[1]) || ((String(url).match(/[?&]id=([-\w]{20,})/) || [])[1]) || null;
          // ⚠️ TITRE SIMPLE (consigne utilisateur) : le libellé du document = juste le TYPE (« Contrôle
          // technique »), JAMAIS toute la description scannée (centre, dates…). Les détails du CT sont déjà
          // enregistrés sur la fiche véhicule (dateDernierCT / prochainCT) → inutile de les répéter dans le titre.
          const drec = { id: uid('D'), societe: societe(), vehiculeId: rec.id, type: 'controle-technique',
            label: 'Contrôle technique', url: url, driveId: driveId };
          await FP.persist.insert('documents', drec);
          try { if (window.data && Array.isArray(data.documents)) data.documents.push(drec); } catch (e) {}
        } catch (e) { console.warn('[scan2 CT→document]', e); }
      }
    }
    else if (cible === 'factures') {
      const sc = schemaFor(t) || {};
      // Sous-type de facture : 'entretien' pour un devis/facture garage, 'carburant' pour TotalEnergies, sinon libre (null).
      const factureType = (t === 'facture_entretien') ? 'entretien' : (Object.prototype.hasOwnProperty.call(sc, 'factureType') ? sc.factureType : null);
      // ⚠️ La colonne DB s'appelle `numeroFacture` (→ numero_facture), PAS `numero` : écrire
      // `numero` faisait rejeter tout l'INSERT (facture jamais enregistrée). Plaque normalisée
      // via le helper canonique (tirets/espaces) pour rattacher au bon véhicule.
      const rec = { id: uid('F'), societe: societe(), date: g('date') || '', fournisseur: g('fournisseur') || sc.fournisseurDefaut || '', numeroFacture: g('numero') || '',
        montantHT: num(g('montantHT')), montantTVA: num(g('montantTVA')), montantTTC: num(g('montantTTC')),
        vehiculeImmat: FP.normImmat ? FP.normImmat(g('immat')) : (g('immat') || '').toUpperCase(), km: intv(g('km')), description: g('description') || '', type: factureType,
        fileId: model._fileUrl || null };  // PDF scanné rattaché → bouton « Voir » sur la fiche facture
      // Anti-doublon central (règle plateforme) : n° + TTC, sinon fournisseur+TTC+date.
      if (FP.dupe && FP.dupe.confirmAdd && !(await FP.dupe.confirmAdd('factures', rec, data.factures || []))) return { table: 'factures', id: null, annule: true };
      await FP.persist.insert('factures', rec); try { if (window.data && Array.isArray(data.factures)) data.factures.push(rec); } catch (e) {}
      // Propager le km (et dernière révision / pneus) à la fiche véhicule — MÊME helper canonique que
      // la page Factures (km à la hausse uniquement, persiste tout seul). Sans ça, un km lu sur la
      // facture n'arrivait jamais dans la fiche véhicule.
      try { if (FP.applyFactureToVehicule) FP.applyFactureToVehicule(rec, data.vehicules); } catch (e) {}
      target = { table: 'factures', id: rec.id };
    }
    else if (cible === 'sinistres') {
      // Un sinistre = une facture type 'sinistre' (comme la déclaration QR / la page Sinistres).
      const tiers = [g('tiersPlaque') && ('plaque ' + g('tiersPlaque')), g('tiersAssureur') && ('assureur ' + g('tiersAssureur')), g('tiersNom')].filter(Boolean).join(', ');
      const descFull = [g('circonstances'), g('lieu') ? ('Lieu : ' + g('lieu')) : '', tiers ? ('Tiers : ' + tiers) : ''].filter(Boolean).join(' · ') || 'Sinistre déclaré';
      const rec = { id: 'F-SIN-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), societe: societe(),
        date: g('date') || '', vehiculeImmat: FP.normImmat ? FP.normImmat(g('immat')) : (g('immat') || '').toUpperCase(), description: descFull, type: 'sinistre', montantTTC: num(g('montantTTC')),
        fileId: model._fileUrl || null };  // pièce scannée rattachée → bouton « Voir »
      // Anti-doublon (règle plateforme) : un sinistre n'a ni n° ni fournisseur, donc la règle
      // générique « factures » ne le rattrape pas → contrôle dédié : même véhicule + même date +
      // (même TTC ou même description). Évite de recréer le même constat à chaque re-scan.
      const _dupSin = (window.data && Array.isArray(data.factures) ? data.factures : []).find(f => f && (f.type || '').toLowerCase() === 'sinistre'
        && (FP.normImmat ? FP.normImmat(f.vehiculeImmat) : f.vehiculeImmat) === rec.vehiculeImmat
        && (f.date || '') === (rec.date || '')
        && ((rec.montantTTC != null && f.montantTTC != null && Math.abs((+f.montantTTC) - (+rec.montantTTC)) <= 0.02) || String(f.description || '') === String(rec.description || '')));
      if (_dupSin && FP.confirm && !(await FP.confirm('Un sinistre identique semble déjà exister (même véhicule, même date). L\'ajouter quand même ?'))) return { table: 'factures', id: null, annule: true };
      await FP.persist.insert('factures', rec); try { if (window.data && Array.isArray(data.factures)) data.factures.push(rec); } catch (e) {}
      // Statut de remboursement par défaut = « en attente » (comme l'import sinistre de la page Sinistres)
      // → l'incident est compté dans le suivi « en attente de remboursement » dès sa création.
      try { const s = FP.settings.get(); s.sinistreStatut = (s.sinistreStatut && typeof s.sinistreStatut === 'object') ? s.sinistreStatut : {}; if (!s.sinistreStatut[rec.id]) { s.sinistreStatut[rec.id] = 'attente'; FP.settings.save(s); } } catch (e) {}
      target = { table: 'factures', id: rec.id };
    }
    else if (cible === 'amendes') {
      // ⚠️ Colonnes DB réelles = `montant` (montant qui fait foi, lu par FP.montantDu), `prenom`,
      // `numeroAvis`, `date`, `annee`, `motif`, `statut`, `numeroTelepaiement`. Il n'y a PAS de
      // colonnes montantTTC / montantMinore / montantForfaitaire / montantMajore / vehiculeImmat /
      // dateLimite* sur `amendes` → les écrire faisait rejeter l'INSERT (amende jamais enregistrée
      // et affichée à 0 €). La ventilation des 3 montants + dates limites se stocke dans les
      // réglages société via FP.setAmendeMontants (même source que la page Amendes, règle 0-source).
      const mi = num(g('montantMinore')), fo = num(g('montantForfaitaire')), ini = num(g('montantInitial'));
      const montant = (mi != null ? mi : (fo != null ? fo : (ini != null ? ini : 0))); // JAMAIS le majoré par défaut
      // ⚠️ M6 — un avis SANS montant minoré/forfaitaire lisible (typiquement un AVIS DE MAJORATION, ou un
      // scan illisible) créerait une amende FANTÔME à 0 € sans rattacher l'amende d'origine. On BLOQUE la
      // création depuis le scanner du tableau de bord et on renvoie vers la page « Amendes » (qui, elle,
      // sait détecter une majoration et la rattacher à l'avis initial via lierMajoration).
      if (!(Number(montant) > 0)) {
        try { if (FP.notifyError) FP.notifyError("Cet avis n'a pas de montant à payer lisible (c'est peut-être un AVIS DE MAJORATION). Ouvre-le dans la page « Amendes » pour le rattacher à l'amende d'origine."); } catch (e) {}
        return { table: 'amendes', id: null, annule: true };
      }
      const immat = FP.normImmat ? FP.normImmat(g('immat')) : (g('immat') || '').toUpperCase();
      const dateAm = g('dateInfraction') || g('date') || '';
      // Conducteur : déduit via la plaque → chauffeur du véhicule (comme la page Amendes).
      let prenom = '';
      try { const veh = (data.vehicules || []).find(v => (FP.normImmat ? FP.normImmat(v.immat) : String(v.immat || '').toUpperCase()) === immat); if (veh && veh.chauffeur) prenom = veh.chauffeur; } catch (e) {}
      // Points retirés : lus par l'IA sur l'avis (FPS = 0, ne retire jamais de point). Sans ça, une
      // amende scannée n'alimentait PAS le compteur de points (KPI, colonne, podium conducteur, total flotte).
      const pts = (t === 'forfait_post_stationnement') ? 0 : intv(g('points'));
      const rec = { id: uid('A'), societe: societe(), numeroAvis: g('numeroAvis') || g('numeroFps') || '',
        numeroTelepaiement: g('numeroTelepaiement') || '', prenom, date: dateAm, annee: (dateAm || '').slice(0, 4),
        motif: g('motif') || (t === 'forfait_post_stationnement' ? 'Stationnement (FPS)' : ''),
        points: pts, retraitPoints: (Number(pts) || 0) > 0,
        montant, statut: 'à payer', avisUrl: model._fileUrl || null };  // avis scanné rattaché → bouton « Voir » sur la fiche amende
      // Anti-doublon central (règle plateforme) : n° d'avis + montant, sinon prénom+date+montant.
      if (FP.dupe && FP.dupe.confirmAdd && !(await FP.dupe.confirmAdd('amendes', rec, data.amendes || []))) return { table: 'amendes', id: null, annule: true };
      // ⚠️ M6 — repli quand le n° d'avis est absent/illisible (FP.dupe ne clé alors sur rien → 2 scans du
      // même avis = 2 amendes). On re-scanne par prénom + date + montant et on DEMANDE avant de doubler.
      if (!(rec.numeroAvis && rec.numeroAvis.length >= 4)) {
        try {
          const dj = (data.amendes || []).find(a => a && (a.prenom || '') === (rec.prenom || '') && (a.date || '') === (rec.date || '') && Math.abs((Number(a.montant) || 0) - (Number(rec.montant) || 0)) < 0.5);
          if (dj) { const okDup = FP.confirm ? await FP.confirm('Une amende identique (même conducteur, date et montant) existe déjà. L\'ajouter quand même ?') : true; if (!okDup) return { table: 'amendes', id: null, annule: true }; }
        } catch (e) {}
      }
      await FP.persist.insert('amendes', rec); try { if (window.data && Array.isArray(data.amendes)) data.amendes.push(rec); } catch (e) {}
      // Ventilation lue par l'IA → réglages société (pas de colonne DB), pour ne rien perdre.
      try { if (FP.setAmendeMontants) FP.setAmendeMontants(rec.id, { montantMinore: mi, montantForfaitaire: fo, montantMajore: num(g('montantMajore')), dateLimiteMinore: g('dateLimiteMinore') || g('dateLimite') || '', dateLimiteForfaitaire: g('dateLimiteForfaitaire') || '' }); } catch (e) {}
      target = { table: 'amendes', id: rec.id };
    }
    else if (cible === 'conducteurs') {
      // ⚠️ La table `conducteurs` a pour clé primaire `key` (PAS de colonne `id`) : l'ancien code
      // écrivait `id` + `idNumero`/`idExpiration` (colonnes inexistantes) → INSERT rejeté (permis
      // jamais enregistré). On passe par le helper canonique FP.conducteurs.create/find (gère la
      // clé, l'anti-doublon, la société et la persistance), puis on complète les cases VIDES.
      const prenom = g('prenom') || '', nom = g('nom') || '';
      const name = [prenom, nom].filter(Boolean).join(' ').trim() || nom || prenom;
      if (!name) throw new Error("Nom du conducteur manquant.");
      let cond = null;
      try { cond = (FP.conducteurs && FP.conducteurs.find) ? FP.conducteurs.find(name) : null; } catch (e) {}
      if (!cond) {
        const info = { name, prenom, nom };
        if (t === 'permis_conduire') { info.permisNumero = g('numeroPermis') || null; info.permisType = Array.isArray(g('categories')) ? g('categories').join(', ') : (g('categories') || null); }
        try { cond = await FP.conducteurs.create(info); } catch (e) {}
      }
      const key = cond ? cond.key : (FP.normPrenom ? FP.normPrenom(name) : name.toLowerCase().replace(/\s+/g, '-'));
      // Champs additionnels du permis / de la pièce d'identité — ne remplir que les cases vides
      // (colonnes réelles : permisNumero, permisType, permisObtention, permisExpiration, dateNaissance).
      const patch = {};
      const setIfEmpty = (k, v) => { if (v == null || v === '') return; if (!cond || cond[k] == null || cond[k] === '') patch[k] = v; };
      if (t === 'permis_conduire') {
        setIfEmpty('permisNumero', g('numeroPermis')); setIfEmpty('permisObtention', g('dateDelivrance'));
        setIfEmpty('permisExpiration', g('dateExpirationTitre'));
        setIfEmpty('permisType', Array.isArray(g('categories')) ? g('categories').join(', ') : g('categories'));
        setIfEmpty('permisUrl', model._fileUrl);  // scan du permis rattaché → visible sur la fiche conducteur
      } else if (t === 'carte_identite') {
        setIfEmpty('dateNaissance', g('dateNaissance'));
        // Pas de colonne dédiée au n° de pièce → on le consigne dans la note (case vide) pour ne rien perdre.
        const cni = [g('numeroPiece') && ('CNI/titre n° ' + g('numeroPiece')), g('dateExpirationTitre') && ('exp. ' + g('dateExpirationTitre'))].filter(Boolean).join(' · ');
        if (cni) setIfEmpty('note', cni);
      }
      if (Object.keys(patch).length) { try { await FP.persist.upsert('conducteurs', { key, ...patch }); if (cond) Object.assign(cond, patch); } catch (e) {} }
      target = { table: 'conducteurs', id: key };
    }
    else if (cible === 'leasing') {
      const rec = { conducteur: '', immat: (g('immat') || '').toUpperCase(), marque: g('marque') || '', modele: g('modele') || '',
        loueur: g('loueur') || '', loyerTTC: num(g('loyerTTC')), dureeMois: intv(g('dureeMois')), kmTotal: intv(g('kmTotal')),
        debut: g('dateDebut') || null, fin: g('dateFin') || null, offre: g('numeroContrat') || '', kmSupp: num(g('prixKmSupp')), docs: [] };
      try { const s = FP.settings.get(); const l = Array.isArray(s.localeaseContrats) ? s.localeaseContrats : []; l.push(rec); s.localeaseContrats = l; FP.contratsLLD.sauver(s); } catch (e) {}
      target = { table: 'leasing', id: rec.immat };
    }
    else if (cible === 'documents') {
      // ⚠️ Colonnes DB réelles de `documents` : id, vehiculeId (→ vehicule_id), type, label, url,
      // driveId (→ drive_id), societe. Il n'y a PAS de colonne `date` ni `note` → les écrire faisait
      // rejeter l'INSERT (attestation / état des lieux jamais enregistrés). On consigne les détails
      // (échéance, km…) dans le `label` pour rester visible sans colonne supplémentaire.
      const immat = FP.normImmat ? FP.normImmat(g('immat')) : (g('immat') || '').toUpperCase(); const veh = findVeh(immat);
      const url = model._fileUrl || null;
      const driveId = url ? (((String(url).match(/\/d\/([-\w]{20,})/) || [])[1]) || ((String(url).match(/[?&]id=([-\w]{20,})/) || [])[1]) || null) : null;
      const dfmt = d => { try { return d ? (FP.date ? FP.date(d) : d) : ''; } catch (e) { return d || ''; } };
      let rec;
      if (t === 'etat_des_lieux') {
        // TITRE SIMPLE : type + éventuellement « entrée / sortie » (vraie distinction de type, courte) —
        // pas le km ni la date, qui alourdissent le titre inutilement.
        const te = String(g('typeEtat') || '').trim();
        rec = { id: uid('D'), societe: societe(), vehiculeId: veh ? veh.id : null, type: 'etat-des-lieux',
          label: 'État des lieux' + (te ? ' — ' + te : ''), url, driveId };
      } else {
        // Assurance (carte verte / attestation) : on garde la trace PDF dans `documents`, ET on alimente
        // le MODÈLE STRUCTURÉ (assureur + n° police + rattachement véhicule + période de validité) via le
        // helper canonique FP.assuranceApplyScan → même source unique que la page Contrats (fini la ressaisie).
        try {
          if (window.FP && FP.assuranceApplyScan) FP.assuranceApplyScan({
            assureur: g('assureur'), numeroPolice: g('numeroPolice'), immat: g('immat'),
            dateDebut: g('dateDebut'), dateFin: g('dateFin'), numeroAssistance: g('numeroAssistance')
          }, veh);
        } catch (e) { console.warn('[scan2 assurance→modèle]', e); }
        // TITRE SIMPLE : juste le type. Assureur / n° police / échéance sont déjà enregistrés dans le
        // modèle structuré (FP.assuranceApplyScan → page Contrats), inutile de les répéter dans le titre.
        rec = { id: uid('D'), societe: societe(), vehiculeId: veh ? veh.id : null, type: 'assurance',
          label: 'Attestation assurance', url, driveId };
      }
      await FP.persist.insert('documents', rec);
      target = { table: 'documents', id: rec.id };
    }
    else { throw new Error("Type non pris en charge pour l'enregistrement (Phase 1)."); }

    // Traçabilité : archive le scan (table 'scans') — best effort.
    try {
      const srec = { id: uid('sc'), societe: societe(), type_document: t, sous_type: model.sous_type || '', statut: 'valide',
        qualite: model.qualite_document || '', fichier_url: model._fileUrl || null,
        extraction: { champs: model.champs, anomalies: model.anomalies, champs_manquants: model.champs_manquants, edited: edited || {} },
        cible_table: target.table, cible_id: target.id };
      if (FP.persist && FP.persist.insert) FP.persist.insert('scans', srec);
    } catch (e) { console.warn('[scan2 trace]', e); }
    return target;
  };

  // Enregistrement d'un relevé Ulys lu précisément (facture type 'peage' + détail ulys_conso) —
  // MÊME logique/format que l'import de la page Factures (via FP.ulys.*).
  FP2.saveUlys = async function (model) {
    bloqueSiToutesSocietes();
    if (!(model && model._ulys && window.FP && FP.ulys)) throw new Error("Aucun relevé Ulys à enregistrer.");
    const soc = societe(); let okF = 0, okC = 0, firstId = null;
    for (const p of (model._ulys.fac || [])) {
      const _prevU = (data.factures || []).find(x => x.id === ('ULYS-' + p.numero));
      const rec = FP.ulys.factureRecord(p, _prevU); // ré-import : préserve l'affectation manuelle du véhicule
      try { const i = (data.factures || []).findIndex(x => x.id === rec.id); if (i >= 0) data.factures[i] = rec; else if (window.data && Array.isArray(data.factures)) data.factures.push(rec); } catch (e) {}
      try { await FP.persist.upsert('factures', rec); okF++; } catch (e) { console.error('[scan2 ulys facture]', e); }
      if (!firstId) firstId = rec.id;
    }
    for (const c of (model._ulys.rows || [])) {
      if (c.ttc == null) continue;
      const row = FP.ulys.consoRecord(c, soc);
      try { await FP.persist.upsert('ulys_conso', row); okC++; } catch (e) { console.error('[scan2 ulys conso]', e); }
    }
    const target = { table: 'factures', id: firstId };
    try {
      const srec = { id: uid('sc'), societe: soc, type_document: 'facture_ulys', sous_type: '', statut: 'valide',
        qualite: model.qualite_document || '', fichier_url: model._fileUrl || null,
        extraction: { fac: model._ulys.fac, rows: model._ulys.rows, okFactures: okF, okConso: okC },
        cible_table: 'factures', cible_id: firstId };
      if (FP.persist && FP.persist.insert) FP.persist.insert('scans', srec);
    } catch (e) { console.warn('[scan2 trace ulys]', e); }
    return target;
  };

  FP2.SCHEMAS = SCHEMAS; FP2.schemaFor = schemaFor; FP2.normType = normType; FP2.champ = champ; FP2.val = val;
  window.FP2 = FP2;
})();
