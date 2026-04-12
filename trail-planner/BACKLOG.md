# Backlog

## Meteo Windy + zoom mappa

Quando l’overlay Windy è attivo e l’utente zooma o sposta la mappa, l’iframe embed può restare disallineato, mostrare ritardi o comportamenti strani rispetto al centro/zoom della mappa OSM sottostante.

**Possibili direzioni:** sincronizzare più spesso su `moveend` / `zoomend`, ridurre debounce, overlay full-screen con pointer-events gestiti diversamente, o aprire Windy solo in scheda esterna.

---

## Altro

- Migliorare qualità/affidabilità foto rifugi da Wikipedia (titoli alternativi, Wikidata).
