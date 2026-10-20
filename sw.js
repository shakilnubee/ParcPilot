/* Parc Pilot — Service Worker
   Deux stratégies, choisies selon le type de requête :
   • ASSETS STATIQUES same-origin (JS/CSS/icônes, tous versionnés par ?v=AAAAMMJJx) → CACHE-FIRST.
     Comme l'URL change à chaque déploiement (bump du ?v=), le cache est toujours frais après
     une mise à jour → navigations répétées SANS aller-retour réseau (chargement quasi instantané).
   • NAVIGATIONS HTML → NETWORK-FIRST (en ligne = toujours la version fraîche ; le cache ne
     sert qu'en secours hors-ligne). Évite toute « page périmée ».
   On NE touche PAS aux autres origines (Supabase, Google Fonts, CDN) : réseau direct. */
const CACHE = 'parcpilot-v20261021c';

// PRÉ-CHARGEMENT hors ligne : à l'installation du SW (après un déploiement), on met en cache les
// pages principales pour qu'elles soient consultables SANS réseau MÊME si l'utilisateur ne les a
// jamais ouvertes. Les assets versionnés (app.min.js?v=…, CSS…) restent en cache-first à la demande
// (ils sont partagés par toutes les pages et déjà mis en cache dès la 1ʳᵉ navigation en ligne).
// allSettled + cache:'reload' : un échec (page absente / réseau) ne bloque JAMAIS l'installation.
const PRECACHE = [
  './dashboard.html',
  './pages/vehicules.html', './pages/amendes.html', './pages/factures.html',
  './pages/conducteurs.html', './pages/notifications.html', './pages/contrats.html',
  './pages/statistiques.html', './pages/entretiens.html', './pages/sinistres.html',
  './pages/emprunts.html', './pages/controle.html', './pages/budget.html',
  './pages/taches.html', './pages/a-vendre.html', './pages/parametres.html',
  './pages/manuel.html', './pages/scanner.html', './liens.html'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .catch(() => {})
  );
});

/* ─────────────────────────────────────────────────────────────
   NOTIFICATIONS PUSH (Web Push)
   • 'push'            → affiche la notification envoyée par le serveur
                        (edge function km-collect, via VAPID).
   • 'notificationclick' → ouvre/rapproche l'onglet Parc Pilot sur l'URL
                        cible (ex. la fiche véhicule / la page Alertes).
   Le corps du push est un JSON { title, body, url, tag, icon }.
   ───────────────────────────────────────────────────────────── */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {
    try { d = { body: e.data && e.data.text() }; } catch (__) { d = {}; }
  }
  const title = d.title || 'Parc Pilot';
  const opts = {
    body: d.body || '',
    icon: d.icon || './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || './pages/notifications.html' },
    requireInteraction: false
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './pages/notifications.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cls) => {
      // Si un onglet Parc Pilot est déjà ouvert : le focaliser et le router.
      for (const c of cls) {
        if ('focus' in c) {
          try { c.navigate ? c.navigate(target) : null; } catch (_) {}
          return c.focus();
        }
      }
      // Sinon : ouvrir un nouvel onglet.
      return self.clients.openWindow ? self.clients.openWindow(target) : null;
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isHtml(req) {
  return req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return; // Supabase / CDN / fonts : réseau direct

  // version.json = sonde « quelle version est en ligne ? » (anti-cache ?cb=…) → RÉSEAU SEUL,
  // jamais mise en cache (sinon on comparerait à une version périmée + bloat du cache).
  if (url.pathname.endsWith('/version.json') || url.pathname.endsWith('version.json')) {
    e.respondWith(fetch(req, { cache: 'no-store' }).catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  if (isHtml(req)) {
    // NETWORK-FIRST + `cache: 'no-store'` : on court-circuite le cache HTTP du navigateur
    // (GitHub Pages renvoie max-age=600 = 10 min) pour TOUJOURS obtenir la page fraîche en
    // ligne → plus besoin de Ctrl+Maj+R après un déploiement. Le cache ne sert qu'hors-ligne.
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./dashboard.html')))
    );
    return;
  }

  // CACHE-FIRST pour les assets (versionnés) : instantané en visite répétée
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
