/* HMR Companion — Service Worker (cache mappa + API + shell + aree offline). v4 */
const VERSION = "hmr-sw-v4";
const SHELL = `${VERSION}-shell`;
const API = `${VERSION}-api`;
const TILES = `${VERSION}-tiles`;
const STATIC = `${VERSION}-static`;
/** Aree scaricate dall'utente: nome fuori dal prefisso "hmr-sw-", così non si cancella ad ogni versione. */
const OFFLINE = "hmr-offline-areas-v1";
const OFFLINE_INDEX = "/__offline/areas.json";

/** Tile raster (v1): cache-first con salvataggio. */
const TILE_HOSTS = new Set([
  "tile.openstreetmap.org",
  "a.tile.opentopomap.org",
  "b.tile.opentopomap.org",
  "c.tile.opentopomap.org",
  "demotiles.maplibre.org",
]);
/** Mappa v2: vettoriali, font e DEM. Cache-first se già scaricati; i font si salvano sempre (pochi KB). */
const MAP_HOSTS = new Set(["tiles.openfreemap.org", "tiles.mapterhorn.com"]);

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
  return url.pathname.startsWith("/api/track") || (url.pathname.startsWith("/api/v2/") && !url.pathname.startsWith("/api/v2/notifications"));
}

function isTileRequest(url) {
  return url.protocol === "https:" && TILE_HOSTS.has(url.hostname);
}

function isMapRequest(url) {
  return url.protocol === "https:" && MAP_HOSTS.has(url.hostname);
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
    const hit = (await cache.match(req)) || (await caches.match(req));
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

/**
 * Mappa v2: prima le aree offline e la cache, poi la rete.
 * TileJSON e stili: rete prima (cambiano versione), cache se offline.
 * Font: salvati alla prima richiesta. Tile: salvate solo se fanno parte di un'area.
 */
async function mapRequest(req, url) {
  const isTileJson = url.hostname === "tiles.openfreemap.org" && (url.pathname === "/planet" || url.pathname.startsWith("/styles/"));
  if (isTileJson) return networkFirst(req, TILES);
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok && url.pathname.startsWith("/fonts/")) {
    const cache = await caches.open(TILES);
    await cache.put(req, res.clone());
  }
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
  if (url.origin !== self.location.origin && !isTileRequest(url) && !isMapRequest(url)) return;

  if (isTileRequest(url)) {
    event.respondWith(cacheFirst(req, TILES));
    return;
  }

  if (isMapRequest(url)) {
    event.respondWith(mapRequest(req, url));
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

  // Pagine dell'app (anche v2): rete prima, l'ultima versione vista se offline.
  if (req.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".webmanifest")) {
    event.respondWith(networkFirst(req, SHELL));
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith("/relief/")) {
    event.respondWith(cacheFirst(req, TILES));
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

/* ───────────── Aree offline (v2) ───────────── */

async function readIndex() {
  const cache = await caches.open(OFFLINE);
  const res = await cache.match(OFFLINE_INDEX);
  if (!res) return { areas: [] };
  try {
    return await res.json();
  } catch {
    return { areas: [] };
  }
}

async function writeIndex(index) {
  const cache = await caches.open(OFFLINE);
  await cache.put(OFFLINE_INDEX, new Response(JSON.stringify(index), { headers: { "Content-Type": "application/json" } }));
}

/** Elenco aree senza gli URL (pesanti). */
function publicAreas(index) {
  return index.areas.map(({ urls: _urls, ...rest }) => rest);
}

let downloading = null;

async function downloadArea(area, urls) {
  const cache = await caches.open(OFFLINE);
  let done = 0;
  let failed = 0;
  let bytes = 0;
  const queue = urls.slice();
  const worker = async () => {
    while (queue.length) {
      if (downloading && downloading.cancel) return;
      const u = queue.shift();
      try {
        const existing = await cache.match(u);
        if (existing) {
          const b = await existing.clone().blob();
          bytes += b.size;
        } else {
          const r = await fetch(u, { mode: "cors", credentials: "omit" });
          if (r.ok) {
            const b = await r.clone().blob();
            bytes += b.size;
            await cache.put(u, r);
          } else if (r.status !== 404) failed++;
        }
      } catch {
        failed++;
      }
      done++;
      if (done % 25 === 0) await notifyClients({ type: "OFFLINE_PROGRESS", id: area.id, done, total: urls.length, bytes });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const cancelled = downloading && downloading.cancel;
  const index = await readIndex();
  if (!cancelled) {
    index.areas = index.areas.filter((a) => a.id !== area.id);
    index.areas.push({ ...area, tiles: urls.length, bytes, failed, createdAt: Date.now(), urls });
    await writeIndex(index);
  }
  await notifyClients({ type: cancelled ? "OFFLINE_CANCELLED" : "OFFLINE_DONE", id: area.id, done, failed, bytes, areas: publicAreas(index) });
}

async function deleteArea(id) {
  const index = await readIndex();
  const target = index.areas.find((a) => a.id === id);
  index.areas = index.areas.filter((a) => a.id !== id);
  if (target) {
    // Si cancellano solo gli URL che nessun'altra area usa (le aree possono sovrapporsi).
    const keep = new Set();
    for (const a of index.areas) for (const u of a.urls || []) keep.add(u);
    const cache = await caches.open(OFFLINE);
    for (const u of target.urls || []) if (!keep.has(u)) await cache.delete(u);
  }
  await writeIndex(index);
  return publicAreas(index);
}

self.addEventListener("message", (event) => {
  const d = event.data;
  if (!d || typeof d !== "object") return;
  if (d.type === "SKIP_WAITING") {
    void self.skipWaiting();
    return;
  }
  if (d.type === "OFFLINE_LIST") {
    event.waitUntil(
      (async () => {
        const index = await readIndex();
        await notifyClients({ type: "OFFLINE_AREAS", areas: publicAreas(index), downloading: downloading ? downloading.id : null });
      })()
    );
    return;
  }
  if (d.type === "OFFLINE_DOWNLOAD" && d.area && Array.isArray(d.urls)) {
    if (downloading) {
      void notifyClients({ type: "OFFLINE_BUSY", id: downloading.id });
      return;
    }
    const urls = d.urls.filter((u) => typeof u === "string" && /^https:\/\/tiles\.(openfreemap\.org|mapterhorn\.com)\//.test(u)).slice(0, 6000);
    downloading = { id: d.area.id, cancel: false };
    event.waitUntil(
      downloadArea(d.area, urls).finally(() => {
        downloading = null;
      })
    );
    return;
  }
  if (d.type === "OFFLINE_CANCEL") {
    if (downloading) downloading.cancel = true;
    return;
  }
  if (d.type === "OFFLINE_DELETE" && typeof d.id === "string") {
    event.waitUntil(
      (async () => {
        const areas = await deleteArea(d.id);
        await notifyClients({ type: "OFFLINE_AREAS", areas, downloading: downloading ? downloading.id : null });
      })()
    );
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
