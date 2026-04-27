# HMR Companion · Hellenic Mountain Race 2026

Mini-app standalone (Next.js 16 + MapLibre + SQLite locale) che fa da "mappa
intelligente" per la [Hellenic Mountain Race 2026](https://hellenicmountainrace.com/)
(bikepacking, 920 km, 27.800 m D+, 23–30 maggio).

L'idea è semplice: pre-computiamo una volta la traccia ufficiale + tutti i POI
utili lungo il percorso (acqua, rifugi, hotel, supermercati, ristoranti,
farmacie, ATM, fermate bus), poi in gara la mappa risponde al volo alla
domanda "vado avanti o mi fermo?".

Non è dinamica, non chiama backend proprietari a runtime: tutto parte da uno
**snapshot statico** salvato in `data/hmr.db`.

## Cosa c'è dentro

- **Mappa fullscreen** (MapLibre, tile OSM + OpenTopoMap) con traccia spessa,
  km markers ogni 10 km, segmenti "toughest" colorati dal manuale, resupply
  ufficiali e POI OSM togglabili per categoria.
- **Bottom sheet mobile-first** con 3 snap point (peek / half / full) e 3 tab:
  - **Qui e ora** — GPS o km manuale, mostra il prossimo di ogni categoria
    entro 60 km ("prossima acqua +3.2 km, prossimo letto +18 km, …").
  - **Lista POI** — scroll cronologico lungo il km, filtri categoria + slider
    di range km + slider detour max, telefono tappabile, link a Google Maps,
    sito web.
  - **Checkpoint** — ETA per CP1/CP2/CP3/Finish con pace bici configurabile
    (asfalto / sterrato / hike-a-bike / fatica) salvato in localStorage, badge
    verde/giallo/rosso rispetto ai cutoff ufficiali.
- **Profilo altimetrico** (SVG custom, niente dipendenze extra) con sfondo
  colorato per i tratti duri, marker dei checkpoint e della posizione attuale.

## Stack

- Next.js 16 (App Router), React 19, TypeScript 5.
- MapLibre GL 5 (`maplibre-gl`).
- `better-sqlite3` per lo storage locale.
- Tailwind CSS v4.
- Vitest per i test lib-side.

## Setup veloce

```bash
cd hmr-companion
npm install
cp .env.example .env.local    # solo INGEST_TOKEN è obbligatorio
```

Metti il GPX ufficiale in `data/Hellenic_Mountain_Race_2026.gpx` (già committato
una volta fornito). Poi:

```bash
npm run ingest      # 1) parse GPX + semplifica + calcola cumulato + seed CP/resupply/sections
npm run snapshot    # 2) chiama Overpass API lungo il corridoio e popola `pois`
npm run dev         # http://localhost:3002
```

`npm run seed` è lo shortcut di `ingest` + `snapshot`.

Lo snapshot fa una query Overpass per **cella bbox** (default 4×5 = 20 celle)
× 7 categorie = ~140 round-trip totali, invece che centinaia di `around:`.
Ogni cella è cachata in `.ingest-cache/<categoria>/<lat_lng__lat_lng>.json`,
quindi se qualcosa crasha (504 persistenti, rete giù, Ctrl-C) basta
rilanciare `npm run snapshot` e riprende dalla prima cella non cachata.

Tempo reale stimato: 5–15 minuti a seconda dei mirror.

Se Overpass è sotto stress puoi aumentare il grid (celle più piccole =
query più leggere ma più numerose):

```bash
HMR_SNAPSHOT_GRID_COLS=6 HMR_SNAPSHOT_GRID_ROWS=8 npm run snapshot
```

Su errori transient (504 / "server too busy") lo script retryerà 2 volte con
backoff esponenziale, poi splitta la cella in 4 ricorsivamente fino a 4
livelli. Se anche le sotto-celle falliscono, la cella viene scartata con un
warning e lo snapshot continua: puoi rilanciare dopo (la cache si
preserva e le celle mancanti verranno ri-richieste).

## Variabili d'ambiente

| Nome | Obbligatoria | Default | Note |
|---|---|---|---|
| `INGEST_TOKEN` | sì (in prod) | — | proteggere `POST /api/admin/ingest` |
| `HMR_DB_PATH` | no | `data/hmr.db` | path del file SQLite |
| `HMR_GPX_FILENAME` | no | `Hellenic_Mountain_Race_2026.gpx` | nome del GPX da ingest |
| `HMR_OVERPASS_UA` | no | `hmr-companion/0.1` | User-Agent per Overpass |
| `HMR_OVERPASS_MIRROR` | no | lista default | mirror Overpass, separati da virgola |
| `HMR_OVERPASS_TIMEOUT_MS` | no | `55000` | timeout per singola call a un mirror |
| `HMR_SNAPSHOT_GRID_COLS` | no | `4` | colonne griglia bbox |
| `HMR_SNAPSHOT_GRID_ROWS` | no | `5` | righe griglia bbox |
| `HMR_SNAPSHOT_PAUSE_MS` | no | `600` | ms di pausa tra celle per worker |
| `HMR_SNAPSHOT_CONCURRENCY` | no | `2` | celle in parallelo (Overpass ammette 2) |
| `HMR_SNAPSHOT_RETRIES` | no | `2` | retry prima dello split adattivo |
| `HMR_SNAPSHOT_SPLIT_DEPTH` | no | `4` | profondità max dello split (4^depth sub-celle) |
| `HMR_SNAPSHOT_BBOX_PAD` | no | `0.03` | padding (gradi) attorno alla bbox della traccia |

## API interne

- `GET /api/track/default` — metadata + bbox della traccia principale.
- `GET /api/track/:id` — metadata completi + coords compatte `[lng,lat,elev|null,cumKm]`.
- `GET /api/track/:id/pois?categories=water,shop&fromKm=200&toKm=260&maxDetourM=1500` — POI filtrati.
- `GET /api/track/:id/ahead?atKm=210&windowKm=60` — prossimo POI per ogni categoria + next CP + next resupply.
- `GET /api/track/:id/checkpoints` — checkpoint con cutoff in ms epoch UTC.
- `GET /api/track/:id/resupply` — tabella resupply ufficiale (manuale pag.7).
- `GET /api/track/:id/sections` — "toughest sections" (manuale pag.8).
- `GET /api/track/:id/nearest?lat=…&lng=…` — proietta un punto sulla traccia.
- `GET /api/track/:id/gpx` — scarica il GPX originale.
- `POST /api/admin/ingest` — controllo token (l'ingest vero gira via CLI).

## Uso in gara (suggerimenti)

1. Prima della partenza: apri l'app, dai il permesso di geolocalizzazione,
   tappa "GPS attivo". Imposta il **pace** nella tab Checkpoint.
2. Mantieni la pagina aperta durante le tappe; in peek la mappa è fullscreen.
3. Se la batteria è bassa: disattiva il GPS, usa lo slider manuale dei km
   (Dashboard → Manuale) per continuare a vedere "prossimo rifornimento".
4. Il GPX ufficiale è scaricabile da `/api/track/hmr-2026/gpx` come backup
   per Wahoo / Garmin.

## Note sui dati

- Tutti i `along_km` dei checkpoint e dei resupply sono quelli dichiarati dal
  manuale. In ingest proiettiamo a) la coordinata dichiarata sulla traccia, e
  b) il km dichiarato. Se la coordinata è entro 1.5 km dalla traccia usiamo
  quella, altrimenti scegliamo il km → più robusto rispetto a piccole
  imprecisioni nel PDF.
- I cutoff del manuale sono un po' ambigui (riporta "GMT+1" ma la gara è in
  Grecia che a maggio è GMT+3): abbiamo usato **Europe/Athens (UTC+3)**. Se
  gli organizzatori confermeranno diversamente basta editare
  `EEST_OFFSET_MIN` in `src/lib/seed-static.ts` e rilanciare `npm run ingest`.
- Le "toughest sections" sono 9: i km sono quelli della tabella a pag.8 del
  manuale, la severity `warn`/`hard` è un best-guess dal testo libero.

## Deploy su VPS (~4€/mese, es. Hetzner)

Stack consigliato: **Docker** + **Caddy** (HTTPS automatico) + volume Docker per `hmr.db` (persistente tra i restart). Indipendente da altri progetti (es. Amaro su Render).

1. Sul PC: genera `data/hmr.db` con `npm run seed` (e opzionale `npm run snapshot:surface`), poi icone PWA: `npm run icons:pwa`.
2. Copia `deploy/.env.example` in `deploy/.env` e imposta `HMR_DOMAIN` (DNS A/AAAA verso il VPS) e `INGEST_TOKEN`.
3. Sul VPS (Ubuntu): installa [Docker Engine](https://docs.docker.com/engine/install/) + Compose plugin; apri firewall **22**, **80**, **443**.
4. Carica il repo (o solo la cartella `hmr-companion`), poi da `hmr-companion/deploy/`:

```bash
docker compose build --pull
docker compose up -d
```

Al primo avvio, se l’immagine è stata buildata **con** `data/hmr.db` presente nel contesto, il container copia il seed in `/data/hmr.db`. In alternativa monta un file esistente (vedi sotto).

**Backup:** prima della gara copia il DB dal container, ad es.  
`docker compose cp hmr:/data/hmr.db ./hmr-backup-$(date +%F).db`  
(eseguito dalla cartella `deploy/`). In alternativa sostituisci il volume nominato con un bind mount `./data:/data` e fai backup del file sul disco del VPS.

**PWA offline:** in produzione (`next build` + HTTPS) il browser registra `public/sw.js`. Dalla app usa **Online / Offline** in basso a sinistra → **Prepara offline** (Wi‑Fi) prima della partenza, poi *Aggiungi a schermata Home*.

## Tests

```bash
npm test
```

Copre geometria traccia e calcolo ETA/pace. I componenti UI sono visualmente
testabili lanciando il dev server e aprendo la pagina.
