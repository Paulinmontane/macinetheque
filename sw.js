// ============================================================================
//  Service worker minimal : rend le site installable et permet d'ouvrir
//  l'application même sans réseau (l'interface s'affiche ; les données, elles,
//  ont besoin d'internet).
//
//  Stratégie « réseau d'abord » : on télécharge toujours la dernière version
//  des fichiers du site, et on ne se sert de la copie en cache qu'en cas de
//  coupure. Ainsi, une mise à jour poussée sur GitHub apparaît tout de suite.
//  Les appels aux API (Supabase, TVMaze, iTunes, Wikidata…) ne sont jamais
//  mis en cache ici.
// ============================================================================
const CACHE = 'macinetheque-v3'; // à augmenter à chaque changement d'icône ou de liste de fichiers
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'lib/supabase.js',
  'js/app.js', 'js/config.js', 'js/utils.js', 'js/supabase.js', 'js/store.js', 'js/catalog.js',
  'js/api/tvmaze.js', 'js/api/itunes.js', 'js/api/wikidata.js', 'js/api/translate.js',
  'js/ui/search.js', 'js/ui/stars.js', 'js/ui/cards.js', 'js/ui/charts.js', 'js/ui/logo.js',
  'js/ui/datepicker.js', 'js/ui/confirm.js', 'js/ui/password.js', 'js/ui/quickrate.js',
  'js/reco/profile.js', 'js/reco/engine.js', 'js/views/foryou.js',
  'js/theme.js', 'js/stats/core.js', 'js/stats/complete.js', 'js/recap/service.js', 'js/recap/story.js', 'js/recap/share.js',
  'js/views/recaps.js', 'js/views/settings.js',
  'js/views/auth.js', 'js/views/collection.js', 'js/views/watchlist.js', 'js/views/stats.js',
  'js/views/item.js', 'js/views/results.js', 'js/views/account.js',
  'icons/icon-192.png', 'icons/favicon.svg', 'icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // On ne s'occupe que des fichiers du site lui-même.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request, { ignoreSearch: true }))
        || (request.mode === 'navigate' ? caches.match('index.html') : Response.error())),
  );
});
