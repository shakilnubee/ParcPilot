#!/usr/bin/env node
// ============================================================================
//  Parc Pilot — Fondations quota Google (Lot 2a) : garde-fous de sécurité/correction
// ============================================================================
//  On ne peut pas exécuter le SQL ni Deno dans le CI node → on VERROUILLE les
//  invariants critiques par lecture des fichiers : comptage atomique anti-course,
//  écriture réservée au service_role, lecture isolée par société (RLS), coupure à
//  90 %, tolérance « table absente », clés serveur, et câblage de l'écran.
//  Usage : node tests/unit/google-quota.mjs
// ============================================================================
import fs from 'node:fs';
import assert from 'node:assert/strict';

const mig = fs.readFileSync(new URL('../../supabase/migrations/20261120170000_google_quota_compteur.sql', import.meta.url), 'utf8');
const fn = fs.readFileSync(new URL('../../supabase/functions/google-quota/index.ts', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const par = fs.readFileSync(new URL('../../pages/parametres.html', import.meta.url), 'utf8');

let ok = 0, ko = 0;
const test = (nom, fn2) => { try { fn2(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + (e.message || e)); } };

console.log('\nMigration SQL (idempotente, sûre, anti-course)');
test('table créée en IF NOT EXISTS + unicité (societe, api, periode)', () => {
  assert.match(mig, /create table if not exists public\.google_api_usage/);
  assert.match(mig, /unique \(societe, api, periode\)/);
});
test('écriture INTERDITE au client (revoke insert/update/delete authenticated)', () => {
  assert.match(mig, /revoke insert, update, delete on public\.google_api_usage from authenticated/);
  assert.match(mig, /revoke all on public\.google_api_usage from anon/);
});
test('RLS activée + lecture isolée par société (tenant policy)', () => {
  assert.match(mig, /enable row level security/);
  assert.match(mig, /coalesce\(societe, 'PXP'\) = fp_societe\(\)/);
});
test('fonction atomique : verrou consultatif par (société, api, mois)', () => {
  assert.match(mig, /pg_advisory_xact_lock\(hashtext\('fp_quota:'/);
});
test('coupure à 90 % du plafond', () => {
  assert.match(mig, /v_plafond \* 0\.90/);
});
test('fonction SECURITY DEFINER + search_path + exécution réservée au service_role', () => {
  assert.match(mig, /security definer/);
  assert.match(mig, /set search_path = public/);
  assert.match(mig, /revoke all on function public\.fp_quota_consommer\(text, text, integer, bigint\) from public, anon, authenticated/);
  assert.match(mig, /grant execute on function public\.fp_quota_consommer\(text, text, integer, bigint\) to service_role/);
});
test('retour arrière documenté', () => {
  assert.match(mig, /RETOUR ARRIÈRE/);
  assert.match(mig, /drop table if exists public\.google_api_usage/);
});

console.log('\nEdge Function google-quota (secrets serveur, tolérante, 80/90 %)');
test('jeton utilisateur obligatoire (fail-closed)', () => {
  assert.match(fn, /Non connecté/);
  assert.match(fn, /auth\/v1\/user/);
});
test('société résolue depuis profiles (jamais user_metadata)', () => {
  assert.match(fn, /rest\/v1\/profiles\?id=eq\.\$\{encodeURIComponent\(callerId\)\}&select=societe/);
});
test('plafonds AUTHORITATIFS côté serveur + seuils 80/90 %', () => {
  assert.match(fn, /const PLAFONDS/);
  assert.match(fn, /SEUIL_ALERTE = 0\.80/);
  assert.match(fn, /SEUIL_COUPURE = 0\.90/);
});
test('consume passe par la fonction SQL avec le plafond SERVEUR (pas celui du client)', () => {
  assert.match(fn, /rpc\/fp_quota_consommer/);
  assert.match(fn, /p_plafond: cfg\.plafond/);
});
test('tolérant si la table/fonction est absente en prod (ne casse pas)', () => {
  assert.match(fn, /configured = false/);
  assert.match(fn, /Quota non initialisé/);
});
test('aucune clé Google dans la fonction (Lot 2a)', () => {
  assert.ok(!/AIza|GOOGLE_MAPS|MAPS_API_KEY/.test(fn), 'aucune clé Google ne doit apparaître au Lot 2a');
  assert.match(fn, /cleConfiguree: false/);
});

console.log('\nClient + écran Paramètres');
test('FP.googleQuota (status/consume) + seuils', () => {
  assert.match(app, /FP\.GOOGLE_QUOTA_SEUILS = \{ alerte: 0\.80, coupure: 0\.90 \}/);
  assert.match(app, /FP\.googleQuota = \{/);
  assert.match(app, /invoke\('google-quota', \{ body: \{ action: 'status' \}/);
  assert.match(app, /invoke\('google-quota', \{ body: \{ action: 'consume'/);
});
test('onglet + section + rendu « Intégrations Google »', () => {
  assert.match(par, /data-sec="google"/);
  assert.match(par, /id="google-quota-box"/);
  assert.match(par, /if \(sec === 'google'\) \{ try \{ renderGoogleQuota\(\)/);
  assert.match(par, /async function renderGoogleQuota\(\)/);
});

console.log(`\n${ko ? '❌' : '✅'} google-quota : ${ok} ok, ${ko} ko\n`);
process.exit(ko ? 1 : 0);
