// ============================================================================
//  Parc Pilot — TRADUCTION DE CONTENU DE MESSAGE (FR → EN)
//
//  But (demande explicite de l'utilisateur) : l'interface de gestion reste en FRANÇAIS,
//  mais le CONTENU d'un message envoyé à un conducteur dont la langue n'est PAS le français
//  (SMS / WhatsApp / e-mail / rappel auto / aperçu) doit partir en ANGLAIS. Les MODÈLES
//  d'e-mail sont déjà bilingues (Paramètres → E-mails → 🇬🇧). Ce qui reste à traduire = les
//  parties DYNAMIQUES saisies par le gestionnaire : le MOTIF/intitulé et le texte libre
//  (description/note, lieu).
//
//  MÉTHODE (priorité, conforme à la consigne) :
//    1. DICTIONNAIRE central des motifs connus (MOTIFS_FR_EN) → traduction INSTANTANÉE, SANS IA
//       (ex. « Vidange », « Révision »). On n'appelle JAMAIS l'IA pour un motif connu.
//    2. IA (Claude) UNIQUEMENT pour le texte libre non couvert par le dictionnaire.
//  RÈGLES IA : ne RIEN inventer (aucune date/heure/lieu/instruction ajoutée) ; garder tels
//  quels les noms propres, marques, noms de garage, adresses, plaques, références et les
//  balises {…}. En cas d'échec/incohérence → ok:false sur l'élément concerné (l'appelant
//  affiche une erreur et laisse le gestionnaire vérifier/corriger — jamais d'envoi silencieux
//  de français quand une traduction est attendue).
//
//  ⚠️ FONCTION SELF-CONTAINED (même pattern que km-relance/scan-doc : pas de dossier _shared,
//     pour qu'un souci de bundling ne casse jamais une autre fonction). Le DICTIONNAIRE
//     (donnée) est volontairement MIROIR de celui de `km-relance/index.ts` et de
//     `assets/js/app.js` (FP.MOTIFS_TRAD). ⚠️ Toute nouvelle entrée doit être ajoutée aux 3.
//
//  Sécurité : verify_jwt par défaut (true) → réservé aux utilisateurs connectés. On re-valide
//  le jeton auprès de Supabase (fail-closed). Secret : ANTHROPIC_API_KEY (déjà présent, scan-doc).
//  Déploiement : automatique (deploy-edge-functions.yml au push sur main).
// ============================================================================

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// Modèles essayés dans l'ordre (1er accepté gardé). Haiku d'abord (traduction = tâche simple, rapide/éco).
// IDs connus-valides (mêmes que scan-doc). Surcharge : secret TRANSLATE_MODEL ou ANTHROPIC_MODEL.
const MODELS = (Deno.env.get("TRANSLATE_MODEL") || Deno.env.get("ANTHROPIC_MODEL")
  || "claude-haiku-4-5-20251001,claude-sonnet-5,claude-3-5-sonnet-20241022,claude-3-5-sonnet-latest")
  .split(",").map((s) => s.trim()).filter(Boolean);

// ─── DICTIONNAIRE CENTRAL des motifs connus (FR normalisé → EN). MIROIR app.js / km-relance. ───
const MOTIFS_FR_EN: Record<string, string> = {
  "revision": "Scheduled maintenance",
  "controle technique": "Vehicle inspection",
  "vidange": "Oil change",
  "pneus": "Tyre service",
  "carrosserie": "Bodywork",
  "pare brise": "Windscreen",
  "climatisation": "Air conditioning",
  "diagnostic": "Vehicle diagnostics",
  "lavage": "Car wash",
  "livraison": "Vehicle delivery",
  "restitution": "Vehicle return",
  "expertise": "Vehicle assessment",
  "carte carburant": "Fuel card",
  "badge telepeage": "Toll badge",
  "ampoules": "Bulbs",
  "accessoire": "Accessory",
  "equipement hiver": "Winter equipment",
  "consommable": "Consumable",
  "verifier le permis": "Check driving licence",
  "relancer le garage": "Follow up with the garage",
  "relancer le fournisseur": "Follow up with the supplier",
  "valider un devis": "Approve a quote",
  "recuperer un document": "Collect a document",
  "rendez vous garage": "Garage appointment",
  "reparation": "Repair",
  "reparation au garage": "Garage repair",
  "entretien": "Servicing",
};
// Normalisation : minuscules, sans accents, tout sauf [a-z0-9] → espace, espaces compactés.
function normMotif(s: unknown): string {
  return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function motifEn(fr: unknown): string | null {
  const k = normMotif(fr);
  return k && Object.prototype.hasOwnProperty.call(MOTIFS_FR_EN, k) ? MOTIFS_FR_EN[k] : null;
}

// ─── Appel Claude : traduit un lot de chaînes FR → EN, renvoie un tableau JSON de même taille. ───
async function aiTranslate(apiKey: string, texts: string[]): Promise<{ ok: boolean; out: string[]; error?: string }> {
  if (!texts.length) return { ok: true, out: [] };
  const prompt =
    "You are a professional French→English translator for a vehicle-fleet management app. "
    + "Translate each French string into natural, concise British English suitable for a short message sent to a driver.\n"
    + "STRICT RULES:\n"
    + "- Keep EXACTLY as-is (do not translate or alter): proper nouns, brand and garage names, place names, addresses, "
    + "licence plates, reference/file numbers, phone numbers, and any {placeholder} tokens in curly braces.\n"
    + "- Do NOT add, remove, infer or invent any information (no new dates, times, places, prices or instructions). "
    + "Translate only what is written.\n"
    + "- If a string is already English or is only a proper noun/number, return it unchanged.\n"
    + "- Preserve line breaks within a string.\n"
    + "Return ONLY a JSON array of strings, same length and same order as the input, with no extra text.\n\n"
    + "Input: " + JSON.stringify(texts);
  let lastErr = "aucun modele disponible";
  for (const m of MODELS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    let apiRes: Response;
    try {
      apiRes = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: m, max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      lastErr = (e && (e as Error).name === "AbortError") ? "timeout IA" : ("appel IA echoue: " + ((e as Error)?.message || String(e)));
      continue;
    }
    clearTimeout(timer);
    const rawText = await apiRes.text();
    let parsed: any = null; try { parsed = JSON.parse(rawText); } catch (_) {}
    if (apiRes.ok && parsed) {
      const text = (parsed.content || []).filter((x: any) => x.type === "text").map((x: any) => x.text || "").join("");
      const arr = extractArray(text);
      if (arr && arr.length === texts.length && arr.every((x) => typeof x === "string")) return { ok: true, out: arr };
      lastErr = "reponse IA incoherente";
      return { ok: false, out: [], error: lastErr };
    }
    lastErr = (parsed && parsed.error && parsed.error.message) || ("HTTP " + apiRes.status + " : " + rawText.slice(0, 200));
    if (apiRes.status === 404 && /model/i.test(lastErr)) continue; // modèle absent → suivant
    return { ok: false, out: [], error: lastErr };
  }
  return { ok: false, out: [], error: lastErr };
}
// Extrait le premier tableau JSON d'un texte (robuste aux ```json … ``` et au bavardage).
function extractArray(text: string): string[] | null {
  const cleaned = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = cleaned.indexOf("[");
  const b = cleaned.lastIndexOf("]");
  if (a === -1 || b === -1 || b < a) return null;
  try { const v = JSON.parse(cleaned.slice(a, b + 1)); return Array.isArray(v) ? v : null; } catch (_) { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    const reqH = req.headers.get("Access-Control-Request-Headers") || CORS["Access-Control-Allow-Headers"];
    return new Response("ok", { headers: { ...CORS, "Access-Control-Allow-Headers": reqH } });
  }
  try { return await handle(req); }
  catch (e) { return json({ ok: false, error: "Erreur interne : " + ((e as Error)?.message || String(e)) }, 500); }
});

async function handle(req: Request) {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  // SÉCURITÉ : on VALIDE le jeton auprès de Supabase (fail-closed si variables absentes) — miroir scan-doc.
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "unauthorized" }, 401);
  {
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    const SUPA = Deno.env.get("SUPABASE_URL"); const ANON = Deno.env.get("SUPABASE_ANON_KEY");
    if (!SUPA || !ANON) return json({ ok: false, error: "unauthorized" }, 401);
    try {
      const u = await fetch(`${SUPA}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON } });
      if (!u.ok) return json({ ok: false, error: "unauthorized" }, 401);
    } catch (_) { return json({ ok: false, error: "unauthorized" }, 401); }
  }

  let payload: any;
  try { payload = await req.json(); } catch (_) { return json({ ok: false, error: "corps invalide" }, 400); }
  const target = String(payload.target || "en").toLowerCase();
  // Entrée : items = [{text, kind?}] (kind 'motif' => dico d'abord). Rétro-compat : {texts:[...]}.
  let items: Array<{ text: string; kind?: string }> = [];
  if (Array.isArray(payload.items)) items = payload.items.map((it: any) => ({ text: String(it && it.text != null ? it.text : ""), kind: it && it.kind }));
  else if (Array.isArray(payload.texts)) items = payload.texts.map((t: any) => ({ text: String(t == null ? "" : t) }));
  if (!items.length) return json({ ok: true, out: [] });
  if (items.length > 20) items = items.slice(0, 20);

  // Cible non-anglaise (ex. 'fr') → on ne traduit pas : renvoi tel quel (comportement documenté).
  if (target !== "en") {
    return json({ ok: true, out: items.map((it) => ({ text: it.text, ok: true, source: "none" })) });
  }

  // 1) Dictionnaire d'abord (instantané, sans IA). 2) IA pour le reste du texte libre.
  const out: Array<{ text: string; ok: boolean; source: string }> = items.map(() => ({ text: "", ok: false, source: "" }));
  const toAi: number[] = [];
  items.forEach((it, i) => {
    const raw = it.text;
    if (!raw || !raw.trim()) { out[i] = { text: raw, ok: true, source: "none" }; return; }
    const d = motifEn(raw);
    if (d) { out[i] = { text: d, ok: true, source: "dict" }; return; }
    toAi.push(i);
  });

  if (toAi.length) {
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      // Pas de clé IA : on ne peut pas traduire le texte libre → échec explicite (jamais de FR silencieux).
      toAi.forEach((i) => { out[i] = { text: items[i].text, ok: false, source: "error" }; });
      return json({ ok: false, error: "Aucune clé IA configurée (ANTHROPIC_API_KEY)", out });
    }
    const res = await aiTranslate(anthropicKey, toAi.map((i) => items[i].text));
    if (res.ok) {
      toAi.forEach((i, k) => { out[i] = { text: res.out[k], ok: true, source: "ia" }; });
    } else {
      // Échec IA : on renvoie le FR d'origine + ok:false (l'appelant affiche l'erreur, ne masque rien).
      toAi.forEach((i) => { out[i] = { text: items[i].text, ok: false, source: "error" }; });
      return json({ ok: false, error: res.error || "traduction impossible", out });
    }
  }

  return json({ ok: out.every((o) => o.ok), out });
}
