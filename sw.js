// Service Worker für "Rückruf-Radar"
// build-free, GitHub Pages unter Unterpfad /rueckrufe/ -> ausschließlich relative Pfade ("./")

// Cache-Name mit Version. Bei Änderungen der App-Shell die Versionsnummer hochzählen,
// damit alte Caches im activate-Schritt entfernt werden.
const CACHE = 'rueckrufe-v1';

// App-Shell: Dateien, die für den Offline-Betrieb beim Installieren vorgecacht werden.
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

// --- Install: App-Shell vorcachen ---------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => {
      // Jede Ressource einzeln hinzufügen, damit eine fehlende Datei (404) nicht
      // die gesamte Installation scheitern lässt (cache.addAll wäre "alles-oder-nichts").
      return Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => {
            // Fehlende Ressource nur protokollieren, Installation fortsetzen.
            console.warn('[SW] Vorcachen fehlgeschlagen:', url, err);
          })
        )
      );
    })
  );
  // Neuen Service Worker sofort aktivieren, ohne auf das Schließen alter Tabs zu warten.
  self.skipWaiting();
});

// --- Activate: alte Caches entfernen ------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          // Alle Caches mit anderem Namen (ältere Versionen) löschen.
          .filter((key) => key !== CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim()) // sofort Kontrolle über offene Clients übernehmen
  );
});

// --- Fetch: Caching-Strategien ------------------------------------------------
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Nur GET-Anfragen behandeln (POST/PUT etc. unverändert durchreichen).
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nur same-origin behandeln. Externe Hosts (z. B. Quelllinks, externe Bilder)
  // NICHT abfangen -> der Browser holt sie ganz normal selbst.
  if (url.origin !== self.location.origin) return;

  // Strategie 1: Rückruf-Daten -> NETWORK-FIRST (immer möglichst frische Daten).
  if (url.pathname.endsWith('/data/recalls.json')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Strategie 2: App-Shell / sonstige same-origin GETs -> STALE-WHILE-REVALIDATE.
  event.respondWith(staleWhileRevalidate(req));
});

// --- Strategie: Network-First (für recalls.json) ------------------------------
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    // Zuerst das Netzwerk versuchen, um aktuelle Daten zu erhalten.
    const fresh = await fetch(req);
    // Erfolgreiche Antwort im Cache aktualisieren (für späteren Offline-Zugriff).
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    // Netzfehler -> auf zwischengespeicherte Version zurückfallen.
    const cached = await cache.match(req);
    if (cached) return cached;
    // Weder Netz noch Cache: definierte Fehlerantwort statt unbehandelter Exception.
    return new Response(
      JSON.stringify({ error: 'offline', items: [] }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// --- Strategie: Stale-While-Revalidate (App-Shell & übrige Ressourcen) ---------
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);

  // Im Hintergrund das Netzwerk anfragen und den Cache aktualisieren.
  const networkPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null); // Netzfehler robust ignorieren

  // Sofort den Cache-Treffer zurückgeben (schnell), Aktualisierung läuft nebenbei.
  if (cached) return cached;

  // Kein Cache-Treffer: auf die Netzwerkantwort warten.
  const network = await networkPromise;
  if (network) return network;

  // Weder Cache noch Netz: bei Navigationen auf die App-Shell (index.html) zurückfallen,
  // damit die App auch offline und bei tiefen Routen startet.
  if (req.mode === 'navigate') {
    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;
  }

  // Letzter Ausweg: schlichte Fehlerantwort (keine unbehandelte Exception).
  return new Response('Offline', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
