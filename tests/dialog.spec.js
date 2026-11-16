// Tests de NON-RÉGRESSION — FP.dialog avec 3ᵉ bouton optionnel (« Déclasser » vs « Supprimer »).
// Vérifie le flux « anti-perte » : un 3ᵉ choix résout sa propre valeur, la suppression reste
// accessible, Échap annule, et le focus par défaut va sur l'option NON destructive (une Entrée
// réflexe ne supprime jamais). LECTURE SEULE : page locale, aucun appel de prod.
import { test, expect } from '@playwright/test';

const AUTH = () => {
  try {
    const tok = { access_token: 't', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: 't' } };
    localStorage.setItem('sb-tzjuptlzoywjeigmyfuj-auth-token', JSON.stringify(tok));
    localStorage.setItem('fp_remember_me', '1');
    localStorage.setItem('fp_societe', 'PXP');
  } catch (e) {}
};

test('FP.dialog : 3ᵉ bouton (déclasser), suppression, annulation, focus sûr', async ({ page }) => {
  await page.addInitScript(AUTH);
  await page.goto('/pages/statistiques.html', { waitUntil: 'commit', timeout: 20000 });
  await page.waitForTimeout(2800);
  await page.waitForFunction(() => window.FP && window.FP.dialog, { timeout: 8000 });

  const r = await page.evaluate(async () => {
    const FP = window.FP; const out = {};
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    // Vise TOUJOURS le dernier backdrop (les précédents persistent ~150 ms le temps du cleanup).
    const card = () => [...document.querySelectorAll('.fp-dlg-backdrop')].pop();
    const q = (sel) => { const c = card(); return c ? c.querySelector(sel) : null; };
    const openOpts = { type: 'confirm', danger: true, message: 'm', extraText: '↩ Déclasser', extraValue: 'declass', okText: 'Supprimer', cancelText: 'Annuler' };

    // 1) Trois boutons présents + focus par défaut sur le bouton secondaire (non destructif).
    let p = FP.dialog(openOpts);
    await wait(130);
    out.nbBoutons = card().querySelectorAll('.fp-dlg-actions .fp-dlg-btn').length;
    out.aExtra = !!q('.fp-dlg-alt');
    out.focusSurExtra = !!(document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('fp-dlg-alt'));
    // Entrée réflexe sur l'élément FOCALISÉ → doit déclencher « déclasser », JAMAIS la suppression.
    (document.activeElement || document).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    out.enterReflexe = await p; await wait(220);

    // 2) Clic sur « Supprimer » → résout true.
    p = FP.dialog(openOpts); await wait(90);
    q('.fp-dlg-ok').click();
    out.clicSupprimer = await p; await wait(220);

    // 3) Clic sur « Déclasser » → résout 'declass'.
    p = FP.dialog(openOpts); await wait(90);
    q('.fp-dlg-alt').click();
    out.clicDeclasser = await p; await wait(220);

    // 4) Échap → annule (false), aucune suppression déclenchée par défaut.
    p = FP.dialog(openOpts); await wait(90);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    out.echap = await p; await wait(220);

    // 5) Rétro-compatibilité : un confirm classique (sans extraText) n'a que 2 boutons.
    p = FP.dialog({ type: 'confirm', message: 'm2', okText: 'OK' }); await wait(90);
    out.nbBoutonsClassique = card().querySelectorAll('.fp-dlg-actions .fp-dlg-btn').length;
    q('.fp-dlg-ok').click();
    out.confirmClassique = await p;

    return out;
  });

  expect(r.nbBoutons).toBe(3);            // Annuler + Déclasser + Supprimer
  expect(r.aExtra).toBe(true);
  expect(r.focusSurExtra).toBe(true);     // focus sur l'option NON destructive
  expect(r.enterReflexe).toBe('declass'); // Entrée réflexe = déclasser, jamais supprimer
  expect(r.clicSupprimer).toBe(true);
  expect(r.clicDeclasser).toBe('declass');
  expect(r.echap).toBe(false);
  expect(r.nbBoutonsClassique).toBe(2);   // rétro-compatible
  expect(r.confirmClassique).toBe(true);
});
