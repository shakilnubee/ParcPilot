#!/usr/bin/env node
// Garde-fous du rendu PDF de la visionneuse (FP.docReview._pdfView) : ajustement initial fiable + netteté.
import fs from 'node:fs'; import assert from 'node:assert/strict';
const app = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
let ok=0,ko=0; const t=(n,f)=>{try{f();ok++;console.log('  ✅ '+n);}catch(e){ko++;console.log('  ❌ '+n+'\n     '+(e.message||e));}};
t('fitScale déduit le padding RÉEL (pas de bas coupé / barre résiduelle)', ()=>{ assert.match(app,/getComputedStyle\(o\.wrap\)/); assert.match(app,/padX = \(parseFloat\(cs\.paddingLeft\)/); });
t('ResizeObserver re-fit quand la boîte atteint sa taille finale (plus besoin de +/-)', ()=>{ assert.match(app,/new ResizeObserver\(\(\) => \{/); assert.match(app,/ro\.observe\(o\.wrap\)/); assert.match(app,/if \(ro\) ro\.disconnect\(\)/); });
t('anti-boucle (seuil 2px) + uniquement en mode ajusté (zoom===1)', ()=>{ assert.match(app,/Math\.abs\(w - lastW\) < 2 && Math\.abs\(h - lastH\) < 2/); assert.match(app,/S\.dead \|\| S\.zoom !== 1/); });
t('suréchantillonnage conservé (netteté >=2x)', ()=>{ assert.match(app,/const over = Math\.max\(2, Math\.min\(3,/); });
t('défaut inline = PAGE ENTIÈRE ; plein écran = LARGEUR (texte lisible)', ()=>{ assert.match(app,/mode: \(o\.initMode === 'width' \? 'width' : 'page'\)/); assert.match(app,/initMode: 'width'/); });
t('plancher de netteté : backing à un minimum absolu (~2.5x DPI) même affiché petit', ()=>{ assert.match(app,/let renderScale = Math\.max\(scale \* over, 2\.5 \* dpr\)/); });
t('ÉCHAP plein écran = capture + stopImmediatePropagation (ne ferme PAS la modale parente)', ()=>{ assert.match(app,/st\.fullKey = function \(e\) \{ if \(e\.key === 'Escape'[\s\S]*?stopImmediatePropagation\(\); close\(\); \} \};/); assert.match(app,/document\.addEventListener\('keydown', st\.fullKey, true\)/); });
console.log(`\n${ko?'❌':'✅'} viewer-fit : ${ok} ok, ${ko} ko\n`); process.exit(ko?1:0);
