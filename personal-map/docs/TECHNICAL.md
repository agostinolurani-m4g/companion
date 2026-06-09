# Personal Map — Documentazione tecnica

## Architettura

| Layer | Tecnologia |
|-------|------------|
| Framework | Next.js 16.2 (App Router, `output: "standalone"`) |
| UI | React 19, Tailwind CSS v4 |
| Mappe | MapLibre GL 5, tile OSM + OpenTopoMap |
| Database | SQLite via `better-sqlite3`, WAL, `data/personal.db` |
| Auth | Session cookie, utenti fissi in `src/lib/auth.ts` |
| Geo pipeline | GPX parse → Douglas-Peucker → cumKm → Overpass snapshot |

```
GPX upload → track-ingest.ts → tracks (SQLite)
GPS record → activities → ingestPositionsToDb → tracks (source=gps_record)
                    ↓
         analyze-track-difficulty.ts → track_difficulty_segments
                    ↓
         /map (geojson)  /track/[id] (mappa + diario + attenzione)
```

## Modello dati (fase 2+)

- `tracks` — `sport_mode`, `journal_summary`, `source` (`gpx_upload` | `gps_record`)
- `track_journal_entries` — voci al km (note, foto, condizioni)
- `track_difficulty_segments` — auto_steep, auto_osm, geo_consensus
- `geo_hazard_cells` + `geo_hazard_reports` — consensus geohash (soglia 10 utenti)
- `activities` — recording GPS live (fase 3)

## API contract (estratto)

| Route | Metodo | Descrizione |
|-------|--------|-------------|
| `/api/track/[id]/journal` | GET/POST | Diario |
| `/api/track/[id]/journal/upload` | POST | Foto al km |
| `/api/track/[id]/difficulty` | GET/POST | Segmenti difficoltà |
| `/api/track/[id]/summary` | PATCH | Relazione + sport_mode |
| `/api/hazards/report` | POST | Segnalazione funzionale |
| `/api/hazards/cells` | GET | Celle confermate in bbox |
| `/api/activities` | GET/POST | Lista / avvia recording |
| `/api/activities/[id]` | PATCH | Append punti / stop / discard |
| `/api/activities/active` | GET | Recording corrente |
| `/record` | page | UI registrazione GPS |

## Limitazioni

- GPS recording: tab deve restare aperta (no background SW)
- Overpass `sac_scale`/`mtb:scale`: estensione futura snapshot dedicato
- Auth a utenti fissi (POC cerchia ristretta)

## Deploy

- `PERSONAL_DB_PATH` — percorso DB
- Volume `data/` per DB + `uploads/journal/` + `uploads/recordings/`
