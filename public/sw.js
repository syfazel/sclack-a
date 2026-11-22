// sclack_A service worker (v0.11.0) — installability only, no caching.
// The app shell and data always come from the network; this worker only
// exists so Android Chrome can offer "Add to Home screen" / install.
self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', () => { self.clients.claim() })
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})
