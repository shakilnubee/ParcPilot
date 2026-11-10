// Tests de NON-RÉGRESSION — fermeture des fenêtres par la touche Échap (garde GLOBAL unique).
// Vérifie que le MÊME gestionnaire central ferme les fenêtres modales (centre d'export, fiche
// d'impression) ET qu'il n'interrompt JAMAIS une opération en cours (surcouche « chargement »).
// LECTURE SEULE : page chargée en local, aucun appel de prod (les appels Supabase échouent en silence).
import { test, expect } from '@playwright/test';

const AUTH = () => {
  try {
    const tok = { access_token: 't', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: 't' } };
    localStorage.setItem('sb-tzjuptlzoywjeigmyfuj-auth-token', JSON.stringify(tok));
    localStorage.setItem('fp_remember_me', '1');
    localStorage.setItem('fp_societe', 'PXP');
  } catch (e) {}
};

test('Échap ferme le centre d\'export et la fiche, mais PAS la surcouche de chargement', async ({ page }) => {
  await page.addInitScript(AUTH);
  await page.goto('/pages/statistiques.html', { waitUntil: 'commit', timeout: 20000 });
  // Même cadence que les tests de fumée (fiable en CI) : on laisse le JS s'initialiser (FP prêt) avant
  // d'agir, sans attendre une éventuelle revalidation de session (qui, avec un jeton factice, finirait
  // par rediriger vers login).
  await page.waitForTimeout(2800);
  await page.waitForFunction(() => window.FP && window.FP.exportCenter && window.FP.fiche && window.FP.busy, { timeout: 8000 });

  const r = await page.evaluate(async () => {
    const out = {}; const FP = window.FP;
    const vis = (id) => { const e = document.getElementById(id); return !e ? 'absent' : (getComputedStyle(e).display === 'none' ? 'hidden' : 'visible'); };
    const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    // 1) Centre d'export (#fp-xc-ov, z-index 82, role=dialog) → Échap doit le fermer, MÊME quand un
    //    champ à l'intérieur a le focus (c'était le bug : le garde de champ mangeait Échap).
    FP.exportCenter.open({ key: 't', title: 'T', cols: [{ id: 'a', label: 'A', def: true, get: () => 'x' }], getRows: () => [{ a: 1 }] });
    await wait(250);
    const fld = document.querySelector('#fp-xc-ov input'); if (fld) fld.focus();
    out.xc_focused = document.activeElement && document.activeElement.tagName;
    out.xc_before = vis('fp-xc-ov');
    esc(); await wait(300); out.xc_after = vis('fp-xc-ov');

    // 2) Fiche d'impression (#fp-fiche-ov, z-index 80, bouton ×) → Échap doit la fermer.
    FP.fiche.open({ key: 'f', title: 'F', cols: [{ id: 'a', label: 'A', def: true, get: () => 'x' }], rows: [{ a: 1 }] });
    await wait(250); out.fiche_before = vis('fp-fiche-ov');
    esc(); await wait(300); out.fiche_after = vis('fp-fiche-ov');

    // 3) Surcouche de CHARGEMENT (#fp-busy, sans bouton fermer) → Échap NE doit PAS l'interrompre.
    FP.busy('Enregistrement en cours…');
    await wait(150); out.busy_before = vis('fp-busy');
    esc(); await wait(300); out.busy_after = vis('fp-busy');
    try { document.getElementById('fp-busy').style.display = 'none'; } catch (e) {} // nettoyage
    return out;
  });

  expect(r.xc_focused, 'un champ du centre d\'export doit avoir le focus (reproduit le bug)').toBe('INPUT');
  expect(r.xc_before, 'le centre d\'export doit être ouvert').toBe('visible');
  expect(r.xc_after, 'Échap doit fermer le centre d\'export').toBe('hidden');
  expect(r.fiche_before, 'la fiche doit être ouverte').toBe('visible');
  expect(r.fiche_after, 'Échap doit fermer la fiche').toBe('hidden');
  expect(r.busy_before, 'le chargement doit être visible').toBe('visible');
  expect(r.busy_after, 'Échap ne doit PAS fermer une opération en cours').toBe('visible');
});
