import { loadEnvConfig } from "@next/env";
import Anthropic from "@anthropic-ai/sdk";

loadEnvConfig(process.cwd());
import {
  addStop,
  getItinerary,
  replaceStopsFromTool,
  upsertItineraryFull,
  updateItineraryLine,
  listStops,
  getProfile,
  getTrack,
  getLatestTrackForItinerary,
  insertMapPoi,
  linkTrackToItinerary,
  listMapPois,
  updateTrackMetrics,
} from "@/lib/db";
import { geocodeNominatim } from "@/lib/geocoding";
import { fetchOpenMeteoForecast } from "@/lib/weather";
import { duckDuckGoSearch } from "@/lib/ddg-search";
import type { Feature, LineString, Position } from "geojson";
import { segmentSummariesEqualDistance } from "@/lib/track-stats";
import { rebuildTrackDisplayFromRaw } from "@/lib/track-ingest";

import { getAnthropicApiKey } from "@/lib/env";
import { formatAnthropicErrorForUser, messagesCreateWithRetry } from "@/lib/anthropic-retry";

const MAX_POINTS_SET_ROUTE_LINE = 500;

function lineStringVertexCount(line: LineString): number {
  return Array.isArray(line.coordinates) ? line.coordinates.length : 0;
}

export const PLANNER_MODEL =
  process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";

export type PlannerToolEvent =
  | { kind: "browser_url"; url: string; title?: string }
  | { kind: "draft_email"; to: string; subject: string; body: string }
  | { kind: "weather_overlay"; lat: number; lng: number; zoom: number };

/** Eventi inviati al client durante l’esecuzione (stream) — ragionamento visibile mentre lavori. */
export type PlannerProgressEvent =
  | { type: "assistant_text"; text: string }
  | { type: "tool"; name: string; inputSummary: string };

const SYSTEM = `Sei Trail Planner, assistente per itinerari outdoor (ciclismo, trekking, sci alpinismo, trail running).
Lingua: italiano.
Regole:
- Mentre pianifichi, **spiega sempre in italiano** cosa stai facendo (breve ragionamento) **nei messaggi di testo** che precedono o accompagnano i tool: cosa cerchi, perché scegli certe tappe o coordinate, cosa ti aspetti dal risultato. Non usare solo tool senza testo esplicativo quando il turno è complesso.
- NON chiedere mai all'utente di incollare GPX o migliaia di coordinate: le tracce GPS sono importate dall'app (file) e salvate sul server; tu usi solo get_track_summary, apply_track_to_itinerary o set_route_from_track con track_id.
- set_route_line accetta al massimo ${MAX_POINTS_SET_ROUTE_LINE} punti; per tracce lunghe l'utente deve aver importato GPX (restituisce track_id) oppure usare set_route_from_track.
- Per **ciclismo** (road_bike, mtb, gravel): quando il percorso ha lunghe tratte tra una tappa e l’altra, aggiungi **più waypoint intermedi** lungo la direzione plausibile (città, incroci, valichi) con add_waypoint role=waypoint così il routing stradale ha più vertici e segue meglio le strade. Non limitarti a partenza e arrivo se la distanza è grande.
- Per **punti del percorso** (tappe ordinate) usa **add_waypoint** / **add_stop**. Per **luoghi da esplorare** (rifugi, boschi, strade panoramiche, vette, paesi, punti acqua) senza necessariamente includerli come tappa di navigazione, usa **add_map_poi** con descrizione e opzionale URL foto (https); coordinate da geocode_places.
- Per aggiungere punti sulla mappa usa **add_waypoint** (preferito: waypoint vs destinazione) oppure **add_stop** con segment_type; ottieni lat/lng da geocode_places se l'utente dice un luogo.
- OBBLIGATORIO: per aggiungere o cambiare tappe DEVI invocare i tool (add_waypoint, add_stop, replace_stops, upsert_itinerary). Non dire di aver aggiunto una tappa se non hai eseguito il tool e ricevuto ok nel risultato.
- Usa i tool per salvare itinerari e tappe; per coordinate testuali usa geocode_places.
- Per meteo usa get_weather con date ISO (YYYY-MM-DD) e coordinate reali. Per mostrare vento/precipitazioni sulla mappa (stile Windy) usa **focus_weather_map** con le stesse coordinate; opzionale anche anteprima browser.
- Per link e risorse web usa suggest_links; per aprire una pagina nel pannello browser dell'utente usa propose_browser_url (solo URL https legittimi).
- Per email usa draft_email: l'invio reale richiede conferma utente nell'app.
- Rispetta limiti Nominatim: poche query, testo chiaro.
- Attività sportive: road_bike, mtb, gravel, hiking, running, ski_mountaineering, trail_running, nordic_ski.`;

function tools(): Anthropic.Tool[] {
  return [
    {
      name: "upsert_itinerary",
      description:
        "Crea o aggiorna un itinerario (nome, date, attività). Restituisce id itinerario.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID esistente per aggiornare, altrimenti omesso" },
          name: { type: "string" },
          start_date: { type: "string", description: "YYYY-MM-DD" },
          end_date: { type: "string", description: "YYYY-MM-DD" },
          activity: {
            type: "string",
            description: "Tipo attività principale",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "replace_stops",
      description:
        "Sostituisce tutte le tappe dell'itinerario con l'elenco fornito (ordine array). Tipi: transport, lodging, meal, poi, stop.",
      input_schema: {
        type: "object",
        properties: {
          itinerary_id: { type: "string" },
          stops: {
            type: "array",
            items: {
              type: "object",
              properties: {
                segment_type: { type: "string" },
                name: { type: "string" },
                lat: { type: "number" },
                lng: { type: "number" },
                notes: { type: "string" },
              },
              required: ["segment_type", "name", "lat", "lng"],
            },
          },
        },
        required: ["itinerary_id", "stops"],
      },
    },
    {
      name: "add_stop",
      description:
        "Aggiunge una tappa in coda. Preferisci add_waypoint se il punto è sul percorso o una destinazione finale.",
      input_schema: {
        type: "object",
        properties: {
          itinerary_id: { type: "string" },
          segment_type: { type: "string" },
          name: { type: "string" },
          lat: { type: "number" },
          lng: { type: "number" },
          notes: { type: "string" },
        },
        required: ["itinerary_id", "segment_type", "name", "lat", "lng"],
      },
    },
    {
      name: "add_waypoint",
      description:
        "Aggiunge un punto sulla mappa dell'itinerario attivo: waypoint lungo il percorso (tappa intermedia) oppure destinazione principale (fine obiettivo). Usa lat/lng numerici (es. da geocode_places).",
      input_schema: {
        type: "object",
        properties: {
          itinerary_id: { type: "string" },
          name: { type: "string", description: "Etichetta visibile sulla mappa" },
          lat: { type: "number" },
          lng: { type: "number" },
          role: {
            type: "string",
            enum: ["waypoint", "destination"],
            description:
              "waypoint = tappa sul percorso (poi); destination = destinazione / obiettivo principale (stop)",
          },
          notes: { type: "string" },
        },
        required: ["itinerary_id", "name", "lat", "lng", "role"],
      },
    },
    {
      name: "add_map_poi",
      description:
        "Aggiunge un POI esplorativo sulla mappa (rifugio, bosco, strada panoramica, vetta, paese, acqua, belvedere…): compare con colore per categoria, descrizione e foto opzionale. Non sostituisce le tappe percorso; serve per suggerire cosa vedere nel territorio.",
      input_schema: {
        type: "object",
        properties: {
          itinerary_id: { type: "string" },
          name: { type: "string" },
          lat: { type: "number" },
          lng: { type: "number" },
          description: {
            type: "string",
            description: "Testo descrittivo per il popup (2–6 frasi)",
          },
          image_url: {
            type: "string",
            description: "URL https di un’immagine (es. Wikimedia, sito ufficiale rifugio)",
          },
          category: {
            type: "string",
            enum: [
              "refuge",
              "forest",
              "peak",
              "road",
              "water",
              "town",
              "viewpoint",
              "other",
            ],
            description: "Tipo di luogo per icona/colore sulla mappa",
          },
        },
        required: ["itinerary_id", "name", "lat", "lng", "description", "category"],
      },
    },
    {
      name: "set_route_line",
      description:
        `Solo per LineString brevi (max ${MAX_POINTS_SET_ROUTE_LINE} vertici). Per tracce GPS importate usa set_route_from_track + track_id.`,
      input_schema: {
        type: "object",
        properties: {
          itinerary_id: { type: "string" },
          line_geojson: {
            type: "string",
            description: "Feature o geometry LineString JSON",
          },
        },
        required: ["itinerary_id", "line_geojson"],
      },
    },
    {
      name: "get_track_summary",
      description:
        "Riassunto compatto di una traccia già importata (metriche, bbox, segmenti, encoded preview). Nessun punto grezzo.",
      input_schema: {
        type: "object",
        properties: {
          track_id: { type: "string", description: "ID traccia restituito dall'import GPX" },
          itinerary_id: { type: "string", description: "Se noto, usa la traccia più recente collegata" },
        },
      },
    },
    {
      name: "apply_track_to_itinerary",
      description:
        "Collega una traccia esistente (track_id) a un itinerario e aggiorna la linea sulla mappa dal display semplificato.",
      input_schema: {
        type: "object",
        properties: {
          track_id: { type: "string" },
          itinerary_id: { type: "string" },
        },
        required: ["track_id", "itinerary_id"],
      },
    },
    {
      name: "set_route_from_track",
      description:
        "Ricalcola la linea display da file GPX grezzo sul server (semplificazione). Opzionale: collega a itinerario. Non usare coordinate nel messaggio.",
      input_schema: {
        type: "object",
        properties: {
          track_id: { type: "string" },
          itinerary_id: { type: "string", description: "Opzionale: aggiorna anche questa mappa itinerario" },
          simplify_tolerance_m: {
            type: "number",
            description: "Tolleranza semplificazione in metri (più alta = meno punti)",
          },
          max_display_points: { type: "number", description: "Tetto punti sulla mappa (default ~700)" },
        },
        required: ["track_id"],
      },
    },
    {
      name: "geocode_places",
      description: "Geocoding via OpenStreetMap Nominatim (max 5 risultati per query).",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_weather",
      description: "Previsioni Open-Meteo per coordinate e intervallo date.",
      input_schema: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lng: { type: "number" },
          start_date: { type: "string" },
          end_date: { type: "string" },
        },
        required: ["lat", "lng", "start_date", "end_date"],
      },
    },
    {
      name: "focus_weather_map",
      description:
        "Mostra sulla mappa l’overlay meteo interattivo (Windy: vento, sovrapposizioni). Centra su lat/lng e zoom. Opzionale: apri anche nel pannello browser dell’app.",
      input_schema: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lng: { type: "number" },
          zoom: { type: "number", description: "4–12, default 8" },
          open_in_browser_preview: {
            type: "boolean",
            description: "Se true, propone anche iframe Windy nel mini-browser",
          },
        },
        required: ["lat", "lng"],
      },
    },
    {
      name: "suggest_links",
      description: "Ricerca leggera DuckDuckGo per link e risorse (nessuna API key).",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
    {
      name: "draft_email",
      description:
        "Bozza email per prenotazioni/richieste. L'app mostrerà conferma prima di inviare.",
      input_schema: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["to", "subject", "body"],
      },
    },
    {
      name: "propose_browser_url",
      description:
        "Propone un URL da aprire nel pannello browser dell'app (l'utente confermerà). Solo https.",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["url"],
      },
    },
  ];
}

/** Aggiornato dai tool che toccano un itinerario (per sincronizzare la UI client). */
type ItineraryFocus = { id: string | null };

async function runTool(
  name: string,
  input: Record<string, unknown>,
  events: PlannerToolEvent[],
  focus: ItineraryFocus
): Promise<string> {
  switch (name) {
    case "upsert_itinerary": {
      const row = upsertItineraryFull({
        id: input.id as string | undefined,
        name: input.name as string,
        start_date: (input.start_date as string) ?? null,
        end_date: (input.end_date as string) ?? null,
        activity: (input.activity as string) ?? "hiking",
      });
      focus.id = row.id;
      return JSON.stringify({ ok: true, itinerary: row });
    }
    case "replace_stops": {
      const itinerary_id = input.itinerary_id as string;
      focus.id = itinerary_id;
      const stops = input.stops as Array<{
        segment_type: string;
        name: string;
        lat: number;
        lng: number;
        notes?: string;
      }>;
      replaceStopsFromTool(itinerary_id, stops);
      return JSON.stringify({ ok: true, count: stops.length });
    }
    case "add_stop": {
      focus.id = input.itinerary_id as string;
      const s = addStop({
        itinerary_id: input.itinerary_id as string,
        segment_type: input.segment_type as string,
        name: input.name as string,
        lat: input.lat as number,
        lng: input.lng as number,
        notes: (input.notes as string) ?? null,
      });
      return JSON.stringify({ ok: true, stop: s });
    }
    case "add_waypoint": {
      focus.id = input.itinerary_id as string;
      const role = input.role as string;
      const segment_type = role === "destination" ? "stop" : "poi";
      const s = addStop({
        itinerary_id: input.itinerary_id as string,
        segment_type,
        name: input.name as string,
        lat: input.lat as number,
        lng: input.lng as number,
        notes: (input.notes as string) ?? null,
      });
      return JSON.stringify({
        ok: true,
        stop: s,
        role_applied: role === "destination" ? "destination (segment_type=stop)" : "waypoint (segment_type=poi)",
      });
    }
    case "add_map_poi": {
      const itinerary_id = input.itinerary_id as string;
      focus.id = itinerary_id;
      let image_url = (input.image_url as string | undefined)?.trim() || null;
      if (image_url && !/^https:\/\//i.test(image_url)) {
        image_url = null;
      }
      const row = insertMapPoi({
        itinerary_id,
        name: input.name as string,
        lat: input.lat as number,
        lng: input.lng as number,
        description: (input.description as string) ?? "",
        image_url,
        category: (input.category as string) ?? "other",
        source: "chat",
      });
      return JSON.stringify({ ok: true, map_poi: row });
    }
    case "set_route_line": {
      const itinerary_id = input.itinerary_id as string;
      focus.id = itinerary_id;
      const raw = input.line_geojson as string;
      let line: LineString;
      try {
        const parsed = JSON.parse(raw) as LineString | { geometry: LineString };
        line =
          "geometry" in parsed && parsed.geometry?.type === "LineString"
            ? parsed.geometry
            : (parsed as LineString);
      } catch {
        return JSON.stringify({ ok: false, error: "JSON non valido" });
      }
      if (line.type !== "LineString" || !Array.isArray(line.coordinates)) {
        return JSON.stringify({ ok: false, error: "Serve LineString" });
      }
      const n = lineStringVertexCount(line);
      if (n > MAX_POINTS_SET_ROUTE_LINE) {
        return JSON.stringify({
          ok: false,
          error: `Troppi vertici (${n}). Massimo ${MAX_POINTS_SET_ROUTE_LINE}. Importa GPX nell'app e usa track_id con get_track_summary / set_route_from_track.`,
        });
      }
      const feature = JSON.stringify({
        type: "Feature",
        properties: {},
        geometry: line,
      });
      updateItineraryLine(itinerary_id, feature);
      return JSON.stringify({ ok: true, vertices: n });
    }
    case "get_track_summary": {
      const tid = input.track_id as string | undefined;
      const iid = input.itinerary_id as string | undefined;
      if (!tid?.trim() && !iid?.trim()) {
        return JSON.stringify({
          ok: false,
          error: "Specificare track_id oppure itinerary_id",
        });
      }
      let row = tid?.trim() ? getTrack(tid.trim()) : undefined;
      if (!row && iid?.trim()) row = getLatestTrackForItinerary(iid.trim());
      if (!row) {
        return JSON.stringify({
          ok: false,
          error:
            "Traccia non trovata. L'utente deve importare GPX dall'app (si ottiene track_id) oppure passare itinerary_id con traccia già collegata.",
        });
      }
      let feat: Feature<LineString>;
      try {
        feat = JSON.parse(row.display_line_geojson) as Feature<LineString>;
      } catch {
        return JSON.stringify({ ok: false, error: "Geometria display non valida" });
      }
      const coords = feat.geometry.coordinates as Position[];
      const eles = coords.map((c) => (c.length > 2 ? c[2] : undefined));
      const segments = segmentSummariesEqualDistance(coords, eles, 4);
      return JSON.stringify({
        ok: true,
        track_id: row.id,
        itinerary_id: row.itinerary_id,
        point_count: row.point_count,
        distance_m: row.distance_m,
        elevation_gain_m: row.elev_gain_m,
        elevation_loss_m: row.elev_loss_m,
        bbox: JSON.parse(row.bbox_json),
        duration_sec: row.duration_sec,
        display_point_count: row.display_point_count,
        has_elevation: !!row.has_elevation,
        encoded_preview: row.encoded_preview,
        segments_equal_quarters: segments,
        warnings:
          row.point_count > 50_000
            ? ["Traccia originale molto densa; sulla mappa è mostrata una versione semplificata"]
            : [],
      });
    }
    case "apply_track_to_itinerary": {
      const track_id = input.track_id as string;
      const itinerary_id = input.itinerary_id as string;
      focus.id = itinerary_id;
      const row = getTrack(track_id);
      if (!row) return JSON.stringify({ ok: false, error: "track_id non trovato" });
      linkTrackToItinerary(track_id, itinerary_id);
      updateItineraryLine(itinerary_id, row.display_line_geojson);
      return JSON.stringify({
        ok: true,
        message: "Traccia collegata all'itinerario e linea aggiornata sulla mappa.",
      });
    }
    case "set_route_from_track": {
      const track_id = input.track_id as string;
      const itinerary_id = input.itinerary_id as string | undefined;
      const tolM = input.simplify_tolerance_m as number | undefined;
      const maxPts = input.max_display_points as number | undefined;
      const epsilonDeg = tolM != null ? Math.max(tolM / 85000, 0.00001) : undefined;
      let rebuilt;
      try {
        rebuilt = rebuildTrackDisplayFromRaw(track_id, {
          epsilonDeg,
          maxPoints: maxPts,
        });
      } catch (e) {
        return JSON.stringify({
          ok: false,
          error: e instanceof Error ? e.message : "Ricalcolo traccia fallito",
        });
      }
      const s = rebuilt.summary;
      updateTrackMetrics(track_id, {
        point_count: s.point_count,
        distance_m: s.distance_m,
        elev_gain_m: s.elevation_gain_m,
        elev_loss_m: s.elevation_loss_m,
        bbox_json: JSON.stringify(s.bbox),
        duration_sec: s.duration_sec,
        display_point_count: s.display_point_count,
        display_line_geojson: JSON.stringify(rebuilt.displayFeature),
        has_elevation: s.has_elevation,
        encoded_preview: s.encoded_preview,
      });
      const tr = getTrack(track_id);
      if (tr?.itinerary_id) {
        focus.id = tr.itinerary_id;
        updateItineraryLine(tr.itinerary_id, tr.display_line_geojson);
      }
      if (itinerary_id?.trim()) {
        const iid = itinerary_id.trim();
        focus.id = iid;
        linkTrackToItinerary(track_id, iid);
        updateItineraryLine(iid, tr!.display_line_geojson);
      }
      return JSON.stringify({
        ok: true,
        points_stored_display: s.display_point_count,
        distance_km: s.distance_m / 1000,
        elevation_gain_m: s.elevation_gain_m,
        vertices_original: s.point_count,
      });
    }
    case "geocode_places": {
      const results = await geocodeNominatim(input.query as string);
      return JSON.stringify({ results });
    }
    case "get_weather": {
      const w = await fetchOpenMeteoForecast(
        input.lat as number,
        input.lng as number,
        input.start_date as string,
        input.end_date as string
      );
      return JSON.stringify(w);
    }
    case "focus_weather_map": {
      const lat = input.lat as number;
      const lng = input.lng as number;
      let zoom = Number(input.zoom ?? 8);
      if (!Number.isFinite(zoom)) zoom = 8;
      zoom = Math.min(12, Math.max(4, Math.round(zoom)));
      events.push({ kind: "weather_overlay", lat, lng, zoom });
      if (input.open_in_browser_preview) {
        const u = `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lng}&zoom=${zoom}&overlay=wind&product=ecmwf&level=surface`;
        events.push({ kind: "browser_url", url: u, title: "Windy — meteo" });
      }
      return JSON.stringify({
        ok: true,
        message: "Overlay meteo sulla mappa aggiornato (Windy).",
      });
    }
    case "suggest_links": {
      const d = await duckDuckGoSearch(input.query as string);
      return JSON.stringify(d);
    }
    case "draft_email": {
      const to = input.to as string;
      const subject = input.subject as string;
      const body = input.body as string;
      events.push({ kind: "draft_email", to, subject, body });
      return JSON.stringify({
        ok: true,
        message: "Bozza registrata: l'utente vedrà il dialogo di conferma nell'app.",
      });
    }
    case "propose_browser_url": {
      let url = String(input.url ?? "").trim();
      const title = input.title as string | undefined;
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = "https://" + url;
      }
      try {
        const u = new URL(url);
        if (u.protocol !== "https:" && u.protocol !== "http:") {
          return JSON.stringify({ ok: false, error: "Protocollo non supportato" });
        }
      } catch {
        return JSON.stringify({ ok: false, error: "URL non valido" });
      }
      events.push({ kind: "browser_url", url, title });
      return JSON.stringify({
        ok: true,
        message: "URL proposto al pannello browser (conferma utente).",
      });
    }
    default:
      return JSON.stringify({ ok: false, error: "Tool sconosciuto" });
  }
}

export async function runPlannerTurn(params: {
  userMessage: string;
  itineraryId: string | null;
  priorMessages?: Anthropic.MessageParam[];
  onProgress?: (e: PlannerProgressEvent) => void;
}): Promise<{ reply: string; events: PlannerToolEvent[]; activeItineraryId: string | null }> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    return {
      reply:
        "Chiave API non trovata nel server Next. Metti `ANTHROPIC_API_KEY=sk-...` nel file `.env.local` nella cartella del progetto trail-planner (accanto a `package.json`), riavvia `npm run dev`. Se la chiave è nel repo `poc`, copiala in trail-planner/.env.local.",
      events: [],
      activeItineraryId: params.itineraryId,
    };
  }

  const client = new Anthropic({ apiKey, maxRetries: 0 });
  const events: PlannerToolEvent[] = [];
  const focus: ItineraryFocus = { id: params.itineraryId };

  let itineraryContext = "";
  if (params.itineraryId) {
    const it = getItinerary(params.itineraryId);
    const stops = listStops(params.itineraryId);
    const mapPois = listMapPois(params.itineraryId);
    const prof = getProfile();
    const latestTr = getLatestTrackForItinerary(params.itineraryId);
    const trLine = latestTr
      ? `- Ultima traccia GPX: track_id=${latestTr.id}, ~${(latestTr.distance_m / 1000).toFixed(1)} km, ${latestTr.point_count} punti originali (usa get_track_summary, non chiedere il GPX in chat)\n`
      : "";
    const poiLine =
      mapPois.length > 0
        ? `- POI esplorativi già sulla mappa (${mapPois.length}): ${mapPois
            .map((p) => `${p.name} [${p.category}]`)
            .slice(0, 15)
            .join("; ")}${mapPois.length > 15 ? "…" : ""}\n`
        : "";
    itineraryContext = `\nContesto attuale:\n- Itinerario id: ${params.itineraryId}\n- Nome: ${it?.name ?? "?"}\n- Date: ${it?.start_date ?? "?"} → ${it?.end_date ?? "?"}\n- Attività: ${it?.activity ?? "?"}\n${trLine}${poiLine}- Tappe:\n${stops.map((s) => `  - ${s.name} (${s.segment_type}) ${s.lat},${s.lng}`).join("\n")}\n- Soglie allerta profilo: pioggia > ${prof.rain_mm_h} mm/h equiv., vento > ${prof.wind_ms} m/s, gelo < ${prof.frost_temp_c}°C\n`;
  }

  const messages: Anthropic.MessageParam[] = [
    ...(params.priorMessages ?? []),
    {
      role: "user",
      content: itineraryContext + params.userMessage,
    },
  ];

  let replyText = "";

  try {
  for (let step = 0; step < 16; step++) {
    const res = await messagesCreateWithRetry(client, {
      model: PLANNER_MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: tools(),
      messages,
      stream: false,
    });

    const assistantBlocks = res.content;
    messages.push({ role: "assistant", content: assistantBlocks });

    for (const b of assistantBlocks) {
      if (b.type === "text" && b.text?.trim()) {
        params.onProgress?.({ type: "assistant_text", text: b.text });
      }
    }

    const toolUses: Anthropic.ToolUseBlock[] = [];
    for (const b of assistantBlocks) {
      if (b.type === "tool_use") toolUses.push(b);
    }

    if (toolUses.length === 0) {
      for (const b of assistantBlocks) {
        if (b.type === "text") replyText += b.text;
      }
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const input = (tu.input ?? {}) as Record<string, unknown>;
      let inputSummary = "";
      try {
        inputSummary = JSON.stringify(input).slice(0, 720);
      } catch {
        inputSummary = "(input)";
      }
      params.onProgress?.({ type: "tool", name: tu.name, inputSummary });
      const out = await runTool(tu.name, input, events, focus);
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: out,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return {
    reply: replyText.trim() || "Fatto.",
    events,
    activeItineraryId: focus.id,
  };
  } catch (e) {
    return {
      reply: formatAnthropicErrorForUser(e),
      events: [],
      activeItineraryId: params.itineraryId,
    };
  }
}
