# Trail Planner AI (locale)

Webapp Next.js: mappa a destra, mini-browser + chat a sinistra; SQLite; planner con Claude (opzionale), meteo Open-Meteo, profilo con soglie allerte, profilo altimetrico, import/export GPX, export ICS.

## Avvio

```bash
npm install
cp .env.example .env.local
# Aggiungi ANTHROPIC_API_KEY per la chat AI
npm run dev
```

Il dev server è su **porta 3001** (`next dev -p 3001`).

## Git

Questa cartella può essere usata **solo in locale** (nessun remoto obbligatorio). Aggiungi `.env.local` e la cartella `data/` non vanno committate (vedi `.gitignore`).

## Note

- Geocoding: Nominatim richiede User-Agent identificabile in produzione (`NOMINATIM_USER_AGENT`).
- Tile mappe: OSM — rispetta le [policy di utilizzo](https://operations.osmfoundation.org/policies/tiles/).
