/** Sport / outdoor activity (estensibile). */
export type ActivityType =
  | "road_bike"
  | "mtb"
  | "gravel"
  | "hiking"
  | "running"
  | "ski_mountaineering"
  | "trail_running"
  | "nordic_ski";

export type SegmentType =
  | "transport"
  | "lodging"
  | "meal"
  | "poi"
  | "stop";

export interface StopRow {
  id: string;
  itinerary_id: string;
  segment_type: SegmentType;
  name: string;
  order_index: number;
  lat: number;
  lng: number;
  notes: string | null;
  /** URL immagine (es. rifugio) — opzionale. */
  image_url: string | null;
  /** Link al sito web (es. rifugio CAI) — opzionale. */
  website_url: string | null;
}

export interface ItineraryRow {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  activity: ActivityType | string;
  line_geojson: string | null;
  created_at: string;
}

export interface ProfileRow {
  id: number;
  display_name: string;
  units: "km" | "mi";
  sports_json: string;
  rain_mm_h: number;
  wind_ms: number;
  frost_temp_c: number;
  timezone: string;
}

export interface ExplorePlaceRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  description: string;
  image_url: string;
  rating: number;
  review_count: number;
}

/** POI esplorativi (chat / suggerimenti) distinti dalle tappe percorso. */
export type MapPoiCategory =
  | "refuge"
  | "forest"
  | "peak"
  | "road"
  | "water"
  | "town"
  | "viewpoint"
  | "other";

export interface MapPoiRow {
  id: string;
  itinerary_id: string;
  name: string;
  lat: number;
  lng: number;
  description: string;
  image_url: string | null;
  category: MapPoiCategory | string;
  source: string;
  created_at: string;
}

/** Metadati traccia GPS (geometria display in `display_line_geojson`; raw in `data/tracks/<id>.gpx`). */
export interface TrackRow {
  id: string;
  itinerary_id: string | null;
  source: string;
  point_count: number;
  distance_m: number;
  elev_gain_m: number;
  elev_loss_m: number;
  bbox_json: string;
  duration_sec: number | null;
  display_point_count: number;
  display_line_geojson: string;
  has_elevation: number;
  encoded_preview: string;
  created_at: string;
}
