# Ricerca di mercato: app outdoor simili (novembre 2026)

Obiettivo: capire punti di forza e lacune delle app concorrenti e portare in
HMR Companion v2 quello che manca. Fonti in fondo.

## Panoramica concorrenti

| App | Punti di forza | Lacune / critiche ricorrenti |
|---|---|---|
| **Strava** | Segmenti con classifica (tempo migliore, KOM/QOM) e **Local Legend** (chi passa più volte in 90 giorni: premia la costanza). Heatmap globale/notturna/settimanale, route AI dalla heatmap, mappe 3D, nel 2026 nuove funzioni hiking | Molto dietro abbonamento (heatmap 3D, istogramma Local Legend, route). Pianificazione outdoor e sicurezza montagna deboli. Le API vietano di mostrare i dati di un atleta ad altri |
| **Komoot** | **Highlights** (luoghi/tratti consigliati con foto e consigli), **Trail View**: foto della community sulla mappa (pallini cliccabili, filtro AI di volti/cibo) | Modello di acquisto confuso (regioni, pacchetti, Premium); errori di instradamento fuori sentiero; batteria; malcontento dopo il cambio di proprietà |
| **FATMAP** (chiusa 1/10/2024) → **Outmap**, **onX Backcountry** | 3D, layer pendenza ed esposizione, linee di sci, offline | onX: tre app separate, batteria, privacy; copertura valanghe solo USA |
| **Skitourenguru** | **Indicatore di rischio a 3 colori per itinerario**, calcolato 2 volte al giorno dal bollettino + terreno (pendenza, forma e dimensione del pendio, copertura), colorato **tratto per tratto** | Solo itinerari del suo catalogo (una traccia disegnata male dà un punteggio poco informativo); niente pianificazione libera |
| **White Risk / alpenvereinaktiv / Outdooractive** | Bollettino dettagliato, layer pendenza, buona copertura europea | Layer pendenza solo Pro (Outdooractive); poca parte social |
| **PeakFinder** | Panorama con nome delle vette **completamente offline**, oltre 1 milione di vette, AR sulla fotocamera, linea del sole | Solo identificazione vette: nessuna pianificazione o traccia |
| **PeakVisor** | 3D con vette, modalità inverno, **overlay esposizioni con riepilogo dell'aspetto per gita/pista**, planner sci con snap ai percorsi (2026) | Abbonamento; social limitato |
| **Mountain Maps** (Mountain Maps s.r.l.) | Mappe offline di tutta Europa, curve di livello, 3D, **layer pendenza e altezza neve**, GPX | Nessuna recensione indipendente; abbonamenti settimanali |
| **AllTrails / Gaia GPS** | AllTrails semplice e popolare; Gaia affidabile offline | AllTrails: mappe offline che falliscono, poco adatto al fuori traccia. Gaia: curva di apprendimento ripida |

## Dove era già forte HMR Companion

Pianificazione multi-sport con routing e superfici, gite (piano + resoconto),
heatmap personale/community, import Strava/GPX/FIT, segnalazioni sul campo con
conferme, bollettino valanghe EAWS/AINEVA e overlay pendenza, meteo di
precisione, gruppi. Tutto gratis e su dati aperti (OSM, DEM Terrarium).

## Lacune trovate nella nostra app → cosa è stato aggiunto

| Lacuna | Ispirazione | Implementato |
|---|---|---|
| Nessuna competizione / motivazione sui tratti | Strava segmenti + Local Legend | **Segmenti** (`/v2/segmenti`): crei un segmento da un tratto di un'attività o di un percorso (salite proposte in automatico), i passaggi vengono trovati da soli in tutte le attività importate (anche passate), classifica tempi (sempre / 12 mesi / 30 giorni), **Local Legend 90 giorni**, record personale e storico. Segmenti visibili e cliccabili in Esplora. Le attività Strava contano solo per il proprietario (regole API Strava); i tempi Strava si recuperano dagli stream su richiesta |
| Foto come pallini rosa non cliccabili | Komoot Trail View | **Miniature foto sulla mappa** raggruppate con contatore, zoom sul gruppo, **galleria a schermo intero** (frecce, swipe, Esc). In Esplora e nella pagina gita (anche la griglia foto apre la galleria) |
| Nessun modo di sapere "che vetta è quella?" | PeakFinder / PeakVisor | **Panorama vette** (`/v2/panorama`, oppure "Panorama da qui" su vette, passi, rifugi, punti panoramici): orizzonte calcolato dal DEM fino a 80 km con curvatura e rifrazione, creste a tono per distanza, vette visibili con quota e distanza (OSM via DB locale + Overpass con cache), **bussola del telefono** per orientare il panorama |
| Esposizioni solo dai metadati camptocamp; pendenza solo come overlay | PeakVisor (riepilogo esposizioni), Skitourenguru (rischio per tratto) | **Terreno valanghivo** nel planner scialpinismo: pendenza ed esposizione del **versante** in ogni punto dal DEM, rosa delle esposizioni (tratti ≥30° evidenziati), classi di pendenza, **rischio per tratto a 3 colori** incrociando il bollettino del giorno (grado per quota/esposizione, problemi valanghivi) con un metodo di riduzione semplificato; opzione "Colora la traccia per rischio" |

## Secondo giro (novembre 2026): fatto

| Lacuna | Ispirazione | Implementato |
|---|---|---|
| Nessun "posto da non perdere" condiviso | Komoot Highlights | **Highlights** (Esplora → "Consiglia un posto"): nome, consiglio, sport, copertina dalle foto vicine, "consigliato da N" con voto. Stelle sulla mappa; nel planner l'elenco degli highlights entro 400 m dal percorso con **"Tappa"** per passarci |
| Foto solo sulla mappa di Esplora | Komoot | **Foto lungo il percorso** nel planner: striscia delle foto entro 300 m con il km, miniature sulla mappa, galleria |
| Offline solo come cache PWA del v1 | Gaia, Mountain Maps | **Mappe offline** (Livelli → Mappe offline): scarica l'area visibile (carta vettoriale fino a z14, DEM per rilievo e curve, font), avanzamento, elenco e cancellazione; pagine e API v2 già viste restano disponibili senza rete |
| Niente neve, niente linee di discesa | Mountain Maps, FATMAP | Livelli **Altezza neve** (modello Open-Meteo su griglia ~2 km, cache 3 h) e **Linee di sci** (discese degli itinerari pubblici colorate per grado Toponeige) |
| Panorama solo disegnato | PeakFinder | **Linea del sole** sul panorama con ore, scelta del giorno e **alba/tramonto reali dietro le creste**; modalità **AR** con fotocamera, bussola e inclinazione (campo visivo e correzione regolabili) |
| Segmenti senza notizie, solo salite | Strava | **Notifiche** (campanella): nuovo record personale, corona presa e persa. **Discese** proposte per MTB/sci, filtri per sport e tipo, classifiche per **genere facoltativo** (impostato nel profilo) |
| Rischio solo dalla pendenza sotto i piedi | Skitourenguru | **Dimensione** del pendio ripido collegato, **forma** (canale/conca vs cresta) e **pendii a monte** entro 500 m visti con angolo ≥ 22° (una valanga può arrivare anche su una traccia in piano) |

## Prossimi passi possibili

1. Highlights come **tratti** (non solo punti) e proposta automatica durante il routing.
2. Offline: anche il **rilievo pre-calcolato** e le sovrapposizioni raster (pendenza) nell'area scaricata.
3. Neve: osservazioni delle stazioni (dove ci sono dati aperti) accanto al modello.
4. AR: calibrazione automatica della bussola allineando l'orizzonte calcolato.

## Fonti

- Strava Local Legend: [BikeRadar](https://www.bikeradar.com/news/strava-local-legend/), [Cycling Weekly](https://cyclingweekly.com/news/latest-news/strava-unveil-new-segment-feature-that-lets-you-a-top-leaderboards-without-being-fastest-457564), [Runner's World 2026](https://www.runnersworld.co.za/race-news/strava-rewards-consistency-not-speed-so-why-divide-local-legends-by-gender/)
- Strava 2026: [the5krunner](https://the5krunner.com/2026/06/12/strava-hiking-features-ipo/), [9to5Mac](https://9to5mac.com/2026/06/11/strava-expands-hiking-tools-with-better-maps-route-planning-and-trail-navigation/), [BikeRadar heatmap 3D](https://www.bikeradar.com/news/strava-global-heatmap-3d-terrain/)
- Komoot: [Trail View, BikeRadar](https://www.bikeradar.com/news/komoot-trail-view/), [Bike Magazin](https://www.bike-magazin.de/en/bike-computer/trail-view-komoot-shows-photos-of-paths-and-trails-on-the-map/), [Highlights, supporto Komoot](https://support.komoot.com/hc/articles/10364710659994), [recensioni store 2026](https://clickyourapp.com/de/charts/google-play/de.komoot.android/)
- Scialpinismo: [Powderguide, app per skitour](https://powderguide.com/en/magazine/news/map-apps-f-r-ski-tours-an-overview), [SnowBrains su Outmap](https://snowbrains.com/the-outmap-app-is-the-clear-successor-to-fatmap-for-backcountry-planning/), [OnTheSnow](https://www.onthesnow.com/news/the-best-skiing-apps/)
- Skitourenguru: [DAV](https://www.alpenverein.de/artikel/skitourenguru-realitaetscheck-chancen-grenzen-anwendung_38dad1cf-9c2f-476c-a7c4-f338a2cf0508), [ISSW 2024](https://arc.lib.montana.edu/snow-science/objects/ISSW2024_O11.9.pdf), [Powderguide intervista](https://powderguide.com/en/magazine/schneegest-ber/schneegest-ber-2-2018-19-interview-with-skitouring-guru-nter-schmudlach)
- PeakFinder: [sito](https://www.peakfinder.org/mobile), [App Store](https://apps.apple.com/app/id357421934); PeakVisor: [App Store](https://apps.apple.com/us/app/3d-map-peaks-id-peakvisor/id1187259191), [novità](https://peakvisor.com/en/news/app-updates.html)
- Mountain Maps: [App Store](https://apps.apple.com/app/id1568561263)
- Confronti/critiche: [Unstar 2026](https://unstar.app/blog/alltrails-komoot-gaia-gps-onx-backcountry-farout-hiking-apps-ranked-2026), [BikeTips](https://biketips.com/komoot-vs-alltrails-vs-gaia-gps/)
