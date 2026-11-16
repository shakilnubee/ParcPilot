// Tests de NON-RÉGRESSION — EMPILEMENT DES POP-UPS FLOTTANTS (z-index).
// Bug corrigé : la liste de recherche d'un sélecteur partagé (FP.conducteurPicker / searchSelect /
// proprioPicker, classe .fp-jsmenu, ancrée au <body>) s'affichait DERRIÈRE la fenêtre modale qui
// l'ouvrait → impossible de cliquer un nom. On vérifie par RENDU RÉEL (elementFromPoint), pas par simple
// présence DOM : la liste ouverte à l'intérieur d'une modale doit être le composant réellement cliquable
// au point où elle s'affiche, et son z-index effectif doit dépasser celui de la modale. LECTURE SEULE.
import { test, expect } from '@playwright/test';

const AUTH = () => {
  try {
    const tok = { access_token: 't', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: 't' } };
    localStorage.setItem('sb-tzjuptlzoywjeigmyfuj-auth-token', JSON.stringify(tok));
    localStorage.setItem('fp_remember_me', '1');
    localStorage.setItem('fp_societe', 'PXP');
  } catch (e) {}
};

test('Pop-up partagé (.fp-jsmenu) ouvert DANS une modale : au-dessus et cliquable', async ({ page }) => {
  await page.addInitScript(AUTH);
  await page.goto('/pages/statistiques.html', { waitUntil: 'commit', timeout: 20000 });
  await page.waitForTimeout(2800);
  await page.waitForFunction(() => window.FP && window.FP.conducteurPicker, { timeout: 8000 });

  const r = await page.evaluate(async () => {
    const FP = window.FP; const out = {};
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    // 1) Fenêtre modale réaliste (même z-index que « Changement de conducteur » dans app.js) avec un champ.
    const modal = document.createElement('div');
    modal.id = 'z-test-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding-top:120px';
    const inp = document.createElement('input');
    inp.id = 'z-test-input'; inp.style.cssText = 'width:260px;padding:10px;font-size:15px';
    modal.appendChild(inp); document.body.appendChild(modal);

    // 2) Sélecteur conducteur partagé + ouverture de la liste.
    FP.conducteurPicker(inp);
    inp.dispatchEvent(new Event('focus', { bubbles: true }));
    inp.value = 'a'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);

    const menu = document.querySelector('.fp-jsmenu');
    out.menuExiste = !!menu;
    out.menuVisible = !!(menu && menu.style.display !== 'none' && menu.getBoundingClientRect().height > 0);
    if (menu) {
      const zMenu = parseInt(getComputedStyle(menu).zIndex, 10);
      const zModal = parseInt(getComputedStyle(modal).zIndex, 10);
      out.zMenu = zMenu; out.zModal = zModal;
      out.menuAuDessus = zMenu > zModal;
      // RENDU RÉEL : le point au centre de la liste doit toucher la liste (pas la modale derrière).
      const b = menu.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + Math.min(20, b.height / 2));
      out.pointToucheLaListe = !!(hit && hit.closest('.fp-jsmenu'));
    }
    // Nettoyage.
    try { menu && menu.remove(); } catch (e) {}
    try { modal.remove(); } catch (e) {}
    return out;
  });

  expect(r.menuExiste, 'la liste .fp-jsmenu doit être créée').toBe(true);
  expect(r.menuVisible, 'la liste doit être visible').toBe(true);
  expect(r.menuAuDessus, `z-index liste (${r.zMenu}) doit dépasser la modale (${r.zModal})`).toBe(true);
  expect(r.pointToucheLaListe, 'la liste doit être le composant réellement cliquable (pas la modale)').toBe(true);
});
