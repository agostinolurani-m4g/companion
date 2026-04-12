---
name: outdoor-mcp-stack
description: MCP server esterni utili a itinerari outdoor (mappe, browser, prenotazioni) e limiti di Strava/Komoot. Da copiare in Cursor/Claude Desktop per configurare la LLM dell’utente, non solo l’assistente in-editor.
---

# Stack MCP per trail / mappe / web

## OpenStreetMap ([open-streetmap-mcp](https://github.com/jagan-shanmugam/open-streetmap-mcp))

**Ha senso sì**, se la LLM lavora **fuori** da Trail Planner (es. Claude Desktop) e ti serve geocoding, POI, routing testuale su dati OSM. Offre tool tipo `geocode_address`, `find_nearby_places`, `get_route_directions`, ecc.

**In Trail Planner** l’app ha già **Nominatim + OSRM + Overpass** lato server: non serve duplicare lo stesso MCP nel backend Next, ma puoi **aggiungere questo MCP all’host** (Cursor / Desktop) per sessioni di pianificazione generiche.

Configurazione tipica (README del repo):

```json
"mcpServers": {
  "osm-mcp-server": {
    "command": "uvx",
    "args": ["osm-mcp-server"]
  }
}
```

## Browser

- MCP “browser” dipende dall’host (Playwright, Puppeteer, estensioni). Utile per **compiti di lettura pagina / automazione**, non per sostituire il mini-browser integrato di Trail Planner (`propose_browser_url`).

## Prenotazioni / travel

- Non esiste uno standard unico: cercare MCP specifici (Booking, Amadeus, GDS) aggiornati; quasi sempre richiedono **chiavi API** e **policy** strette. In MVP conviene **link esterni** + conferma utente.

## Strava / Komoot

- **Strava**: API con **OAuth**, segmenti e attività soggetti a [termini](https://www.strava.com/legal/api); niente integrazione “magica” senza app registrata e token utente.
- **Komoot**: API/contenuti in gran parte chiusi; le **foto tour** non sono un feed pubblico stabile per una POC.
- **Alternative**: tracce **GPX** esportate dall’utente, oppure **OSM + Wikimedia** per luoghi; in app abbiamo ricerca **fontane / acqua** via Overpass (dati OSM).

## Allineamento con Trail Planner

Quando l’utente usa **la chat dentro l’app**, le tappe devono essere create con i **tool server-side** (`add_waypoint`, `add_stop`, …) così il DB e la mappa si aggiornano. Gli MCP esterni sono complementari per ricerca nel browser o sessioni fuori app.
