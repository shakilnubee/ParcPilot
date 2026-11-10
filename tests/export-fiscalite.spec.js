// Test de NON-RÉGRESSION — Fiscalité & TCO branchée sur le CENTRE d'export standard.
// Vérifie que « Exporter » ouvre bien FP.exportCenter (PDF/Excel/CSV + aperçu + colonnes), que l'aperçu
// se remplit pour les 3 formats, et que le bouton « Rapport complet » (classeur 7 feuilles) est conservé.
// LECTURE SEULE : page chargée en local, aucun appel de prod.
import { test, expect } from '@playwright/test';

const AUTH = () => {
  try {
    const tok = { access_token: 't', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: 't' } };
    localStorage.setItem('sb-tzjuptlzoywjeigmyfuj-auth-token', JSON.stringify(tok));
    localStorage.setItem('fp_remember_me', '1');
    localStorage.setItem('fp_societe', 'PXP');
    // Un peu de données en cache pour que la table TCO ait des lignes.
    const veh = [];
    for (let i = 0; i < 6; i++) veh.push({ id: 'v' + i, immat: 'AA' + i + 'BB', marque: 'Peugeot', modele: '208', km: 1000, societe: 'PXP', carburant: 'Essence', chauffeur: 'Jean ' + i, dateImmat: '2022-01-01', prixAchat: 20000 });
    localStorage.setItem('fp_data_cache_v4_PXP', JSON.stringify({ vehicules: veh, amendes: [], factures: [{ id: 'f', montantTTC: 100, societe: 'PXP', vehiculeImmat: 'AA1BB', type: 'entretien' }], conducteurs: [{ key: 'jean-0', societe: 'PXP' }] }));
  } catch (e) {}
};

test('Fiscalité : « Exporter » ouvre le centre d\'export (PDF/Excel/CSV + aperçu) et « Rapport complet » existe', async ({ page }) => {
  await page.addInitScript(AUTH);
  await page.goto('/pages/fiscalite.html', { waitUntil: 'commit', timeout: 20000 });
  await page.waitForTimeout(2800); // laisse FP + la page s'initialiser (cadence des tests de fumée)

  const r = await page.evaluate(async () => {
    const out = {}; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 40; i++) { try { if (fn()) return true; } catch (e) {} await wait(50); } return false; };
    out.hasCenter = !!(window.FP && window.FP.exportCenter);
    out.fullBtn = !!document.getElementById('fx-dash-full');       // « Rapport complet » conservé
    const btn = document.getElementById('fx-dash-export'); out.exportBtn = !!btn;
    if (btn) btn.click();
    // Attente ROBUSTE (anti-flaky CI) : le centre s'ouvre (display:flex) puis l'aperçu se remplit.
    out.centerOpen = await until(() => { const ov = document.getElementById('fp-xc-ov'); return ov && getComputedStyle(ov).display !== 'none'; });
    await until(() => document.querySelectorAll('#fp-xc-preview tr').length > 0);
    out.previewRowsPDF = document.querySelectorAll('#fp-xc-preview tr').length;
    // Excel
    const xls = document.querySelector('.fp-xc-card[data-fmt="xlsx"]'); if (xls) xls.click();
    out.previewXls = await until(() => !!document.querySelector('#fp-xc-preview .fp-xc-xls, #fp-xc-preview table'));
    // CSV
    const csv = document.querySelector('.fp-xc-card[data-fmt="csv"]'); if (csv) csv.click();
    out.previewCsv = await until(() => !!document.querySelector('#fp-xc-preview .fp-xc-csv'));
    return out;
  });

  expect(r.hasCenter, 'FP.exportCenter doit exister').toBe(true);
  expect(r.exportBtn, 'le bouton Exporter doit exister').toBe(true);
  expect(r.fullBtn, 'le bouton « Rapport complet » (7 feuilles) doit être conservé').toBe(true);
  expect(r.centerOpen, '« Exporter » doit ouvrir le centre d\'export').toBe(true);
  expect(r.previewRowsPDF, 'l\'aperçu PDF doit contenir des lignes').toBeGreaterThan(0);
  expect(r.previewXls, 'l\'aperçu Excel doit s\'afficher').toBe(true);
  expect(r.previewCsv, 'l\'aperçu CSV doit s\'afficher').toBe(true);
});
