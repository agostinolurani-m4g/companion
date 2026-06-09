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

| Principio | Implementazione v1 |
|-----------|-------------------|
| Privato by default | `visibility=private`, nessuna route pubblica |
| Nessun feed | Solo le *tue* tracce su `/map` |
| Nessun follow graph | Nessuna tabella friendships/follows |
| Nessuna gamification | No badge, streak, kudos, classifiche |
| Condivisione minima (futuro) | Solo link read-only per singolo percorso (fase 4) |

## Confronto competitivo (funzionale)

| | Personal Map v1 | Strava | Komoot | AllTrails |
|--|-----------------|--------|--------|-----------|
| Mappa tracce personali | Sì | Sì | Sì | Sì |
| Overview multi-traccia | Sì | Limitato | Sì | Sì |
| POI lungo traccia (OSM) | Sì (snapshot) | No | Sì | Parziale |
| Profilo altimetrico | Sì | Sì | Sì | Sì |
| Offline / PWA | Base | App | App | App |
| Social / feed | **No** | Core | Medio | Medio |
| Pianificazione routing | Fase 3 | No | Core | Sì |
| Prezzo | Self-host / freemium ipotetico | Abbonamento | Abbonamento | Abbonamento |

## Modello di revenue (ipotesi)

- **Gratis:** fino a N tracce, 1 snapshot POI
- **Pro:** snapshot illimitati, export GPX, hosting gestito
- **No ads**, no vendita dati posizione
- **Self-hosted:** pacchetto Docker per utenti che vogliono i propri dati in casa

## Metriche di successo — fase 1

| Metrica | Target |
|---------|--------|
| Uso settimanale dal founder | Sì, come strumento personale |
| Upload GPX → traccia visibile | < 2 min (senza snapshot) |
| Overview `/map` con 20 tracce | Carica < 3 s |
| Snapshot POI completato | < 15 min con `webFast` |

## Roadmap prodotto

1. **Fase 1 (attuale):** libreria GPX, overview map, dettaglio, POI snapshot
2. **Fase 2:** registrazione GPS live (start/stop → `activities`)
3. **Fase 3:** pianificazione percorso (routing OSRM foot/bike)
4. **Fase 4:** share link read-only, export GPX/FIT

## Cosa NON costruiamo

- Feed amici / gruppi / following (già POC in `trail-planner`, fuori scope)
- Marketplace percorsi
- Integrazione wearables in tempo reale (fase 2+)
- AI roadbook / race brief (specifico gara HMR)
