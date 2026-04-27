/* HMR Companion — Service Worker (cache mappa + API + shell). v3 */
const VERSION = "hmr-sw-v3";
const SHELL = `${VERSION}-shell`;
const API = `${VERSION}-api`;
const TILES = `${VERSION}-tiles`;
const STATIC = `${VERSION}-static`;

const TILE_HOSTS = new Set([
  "tile.openstreetmap.org",
  "a.tile.opentopomap.org",
  "b.tile.opentopomap.org",
  "c.tile.opentopomap.org",
  "demotiles.maplibre.org",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      const urls = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];
      await Promise.all(urls.map((u) => cache.add(u).catch(() => {})));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => {
          if (!k.startsWith(VERSION) && k.startsWith("hmr-sw-")) return caches.delete(k);
          return Promise.resolve();
        })
      );
      await self.clients.claim();
    })()
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/track");
}

function isTileRequest(url) {
  return url.protocol === "https:" && TILE_HOSTS.has(url.hostname);
}

function isStaticNext(url) {
  return url.pathname.startsWith("/_next/static/");
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) await cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw new Error("offline-no-cache");
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) await cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) {
    void fetchPromise;
    return hit;
  }
  const res = await fetchPromise;
  if (res) return res;
  throw new Error("swr-fail");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin && !isTileRequest(url)) return;

  if (isTileRequest(url)) {
    event.respondWith(cacheFirst(req, TILES));
    return;
  }

  if (isApiRequest(url)) {
    event.respondWith(networkFirst(req, API));
    return;
  }

  if (isStaticNext(url)) {
    event.respondWith(staleWhileRevalidate(req, STATIC));
    return;
  }

  if (url.origin === self.location.origin && (url.pathname === "/" || url.pathname.endsWith(".webmanifest"))) {
    event.respondWith(networkFirst(req, SHELL));
    return;
  }
});

function lon2tile(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

function lat2tile(lat, z) {
  const latRad = (lat * Math.PI) / 180;
  const n = Math.pow(2, z);
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
}

function tilesForBBox(minLng, maxLng, minLat, maxLat, z, maxTiles) {
  const x0 = lon2tile(minLng, z);
  const x1 = lon2tile(maxLng, z);
  const yN = lat2tile(maxLat, z);
  const yS = lat2tile(minLat, z);
  const xmin = Math.min(x0, x1);
  const xmax = Math.max(x0, x1);
  const ymin = Math.min(yN, yS);
  const ymax = Math.max(yN, yS);
  const urls = [];
  const otmHosts = ["a.tile.opentopomap.org", "b.tile.opentopomap.org", "c.tile.opentopomap.org"];
  let i = 0;
  outer: for (let y = ymin; y <= ymax; y++) {
    for (let x = xmin; x <= xmax; x++) {
      if (urls.length >= maxTiles) break outer;
      urls.push(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`);
      const h = otmHosts[i % otmHosts.length];
      i++;
      urls.push(`https://${h}/${z}/${x}/${y}.png`);
    }
  }
  return urls;
}

async function notifyClients(payload) {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of list) c.postMessage(payload);
}

self.addEventListener("message", (event) => {
  const d = event.data;
  if (!d || typeof d !== "object") return;
  if (d.type === "SKIP_WAITING") {
    void self.skipWaiting();
    return;
  }
  if (d.type === "PREFETCH_TILES" && d.bbox) {
    const { minLng, maxLng, minLat, maxLat } = d.bbox;
    const maxTiles = typeof d.maxTiles === "number" ? Math.min(600, Math.max(50, d.maxTiles)) : 400;
    const zooms = Array.isArray(d.zooms) && d.zooms.length > 0 ? d.zooms : [12, 13, 14];
    event.waitUntil(
      (async () => {
        const cache = await caches.open(TILES);
        let done = 0;
        let failed = 0;
        outer: for (const z of zooms) {
          const urls = tilesForBBox(minLng, maxLng, minLat, maxLat, z, maxTiles - done);
          for (const u of urls) {
            if (done >= maxTiles) break outer;
            try {
              const r = await fetch(u, { mode: "cors", credentials: "omit" });
              if (r.ok) await cache.put(u, r.clone());
              done++;
              if (done % 20 === 0) await notifyClients({ type: "PREFETCH_PROGRESS", done, max: maxTiles });
            } catch {
              failed++;
            }
          }
        }
        await notifyClients({ type: "PREFETCH_DONE", done, failed });
      })()
    );
  }
});
