/**
 * Génère UN clip vidéo via l'API Higgsfield (Seedance 2.5) et le télécharge en .mp4.
 *
 * - Ne fait AUCUN appel payant tant qu'il n'est pas lancé explicitement.
 * - Lit la clé depuis l'environnement (HF_CREDENTIALS) OU depuis .env.local.
 * - N'affiche, ne journalise, ne commite JAMAIS la valeur de la clé.
 * - Ne prétend JAMAIS au succès : il faut status === "completed" ET une URL vidéo.
 *   Tout statut failed / canceled / moderated (nsfw) → sortie en erreur.
 *
 * Paramètres via variables d'environnement (ou .env.local) :
 *   PROMPT       (obligatoire) description de la scène
 *   DURATION     défaut 8      (4..30 s)
 *   RESOLUTION   défaut 720p   (480p | 720p | 1080p)
 *   ASPECT       défaut 9:16   (16:9 | 4:3 | 1:1 | 3:4 | 9:16 | 21:9)
 *   OUT          défaut out/clip.mp4
 *   MODEL        défaut bytedance/seedance-2.5/text-to-video
 *                (pour l'image-to-video, passer le modèle i2v + IMAGE_URL)
 *   IMAGE_URL    optionnel : image de référence (continuité conducteur/voiture/décor)
 */
import { config as loadEnv } from "dotenv";
import { config, higgsfield } from "@higgsfield/client/v2";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// Charge .env.local sans écraser un secret d'environnement déjà présent.
loadEnv({ path: ".env.local" });

const credentials = process.env.HF_CREDENTIALS;
if (!credentials || !credentials.includes(":")) {
  console.error(
    "✗ HF_CREDENTIALS absente ou mal formée (attendu « key-id:key-secret »).\n" +
      "  Renseignez-la en secret d'environnement de la session cloud, OU dans higgsfield/.env.local."
  );
  process.exit(2);
}
config({ credentials });

const PROMPT = process.env.PROMPT;
if (!PROMPT || !PROMPT.trim()) {
  console.error("✗ PROMPT manquant.");
  process.exit(2);
}
const DURATION = Number(process.env.DURATION ?? 8);
const RESOLUTION = process.env.RESOLUTION ?? "720p";
const ASPECT = process.env.ASPECT ?? "9:16";
const OUT = process.env.OUT ?? "out/clip.mp4";
const MODEL = process.env.MODEL ?? "bytedance/seedance-2.5/text-to-video";
const IMAGE_URL = process.env.IMAGE_URL;

const input: Record<string, unknown> = {
  prompt: PROMPT,
  duration: DURATION,
  resolution: RESOLUTION,
  aspect_ratio: ASPECT,
};
if (IMAGE_URL) input.image_url = IMAGE_URL; // continuité (image-to-video) — à confirmer selon le modèle

function pickUrl(r: any): string | undefined {
  const v = r?.video;
  if (!v) return undefined;
  if (typeof v === "string") return v;
  if (v.url) return v.url;
  if (Array.isArray(v) && v[0]?.url) return v[0].url;
  return r?.url;
}

async function main() {
  console.log(`→ Modèle    : ${MODEL}`);
  console.log(`→ Format    : ${ASPECT}, ${RESOLUTION}, ${DURATION}s`);
  console.log(`→ Prompt    : ${PROMPT!.slice(0, 80)}${PROMPT!.length > 80 ? "…" : ""}`);
  console.log("→ Envoi de la requête (appel facturé)…");

  const result: any = await higgsfield.subscribe(MODEL, { input, withPolling: true });

  const status = result?.status != null ? String(result.status).toLowerCase() : null;
  const url = pickUrl(result);

  if (status === "completed" && url) {
    await mkdir(dirname(OUT), { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Téléchargement échoué : HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(OUT, buf);
    console.log(`✓ Terminé. URL : ${url}`);
    console.log(`✓ Enregistré : ${OUT} (${(buf.length / 1e6).toFixed(1)} Mo)`);
    return;
  }

  console.error("✗ La génération ne s'est PAS terminée avec succès — aucun succès revendiqué.");
  console.error(`  Statut : ${status ?? "(absent)"}${url ? " / URL présente mais statut non 'completed'" : " / pas d'URL"}`);
  console.error("  Réponse brute :");
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

main().catch((err) => {
  console.error("✗ Erreur pendant la génération :", err?.message ?? err);
  process.exit(1);
});
