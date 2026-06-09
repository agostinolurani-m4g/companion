# Personal Map

Mappa outdoor **privata e funzionale**: importi GPX, vedi tutte le tue tracce su una mappa overview, apri il dettaglio con profilo altimetrico e POI lungo traccia. Quasi zero social.

Derivato dallo stack di [hmr-companion](../hmr-companion/) (Next.js 16 + MapLibre + SQLite).

## Avvio

```bash
cd personal-map
npm install
npm run dev    # http://localhost:3003
```

Login: stessi utenti di HMR Companion (`ago`, `ale`, …) — vedi `src/lib/auth.ts`.

## Flusso

1. **`/`** — libreria tracce personali + upload GPX
2. **`/map`** — overview: tutte le tracce come linee colorate
3. **`/track/[id]`** — dettaglio: mappa, profilo, POI, GPS

## Seed demo (dogfood)

```bash
npx tsx scripts/seed-demo.ts
npx tsx scripts/verify-db.ts
```

## Documentazione

- [docs/TECHNICAL.md](docs/TECHNICAL.md)
- [docs/BUSINESS.md](docs/BUSINESS.md)
