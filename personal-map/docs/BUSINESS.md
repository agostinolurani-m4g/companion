# Personal Map — Documentazione business

## Problema

Strava e Komoot sono eccellenti per scoprire percorsi e condividere attività, ma per molti utenti outdoor il valore reale è **navigare e ricordare** — non competere su feed, kudos e leaderboard. I prodotti mainstream sono sempre più social, con abbonamenti per funzioni base e notifiche che distolgono dall’esperienza sul terreno.

## Posizionamento

**"La mappa delle tue uscite, senza distrazioni."**

Personal Map è uno strumento privato: importi GPX, vedi tutto su una mappa, apri il dettaglio con altimetria e POI utili. Niente feed globale, niente follower.

## Target iniziale

- Escursionisti, bikepacker e trail runner che **già esportano GPX** da watch/app
- Utenti tech-savvy che vogliono controllo sui propri dati (SQLite locale, self-host)
- Cerchia ristretta (famiglia/amici) — non mass market social

## Principi prodotto (anti-social)

| Principio | Implementazione |
|-----------|-------------------|
| Privato by default | `visibility=private`, nessuna route pubblica |
| Nessun feed | Solo le *tue* tracce su `/map` |
| Nessun follow graph | Nessuna tabella friendships/follows |
| Gamification solo personale | Completezza diario (%), no leaderboard/kudos |
| Segnalazioni funzionali | Consensus per cella geo (frana/valanga/tecnico), no profili pubblici |
| Condivisione minima (futuro) | Solo link read-only per singolo percorso (fase 5) |

## Roadmap prodotto

1. **Fase 1 ✓:** libreria GPX, overview map, dettaglio, POI snapshot
2. **Fase 2 ✓:** diario outdoor (Gulliver-style), auto-difficoltà, segnalazioni geo, sport modes
3. **Fase 3 ✓:** registrazione GPS live (`/record` → `activities` → traccia `gps_record`)
4. **Fase 4:** pianificazione percorso (routing OSRM foot/bike)
5. **Fase 5:** share link read-only, export GPX/FIT

## Metriche di successo — fase 2

| Metrica | Target |
|---------|--------|
| Aggiungere foto+nota al km | < 10 s |
| Segnalazione frana/valanga | < 15 s |
| Upload → segmenti difficoltà | < 30 s |
| Completezza diario post-uscita | Founder usa ≥1 traccia/settimana |

## Cosa NON costruiamo

- Feed amici / gruppi / following (già POC in `trail-planner`, fuori scope)
- Marketplace percorsi
- Integrazione wearables in tempo reale
- AI roadbook / race brief (specifico gara HMR)
