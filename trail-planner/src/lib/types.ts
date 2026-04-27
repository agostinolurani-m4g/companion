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

/** Ruolo della tappa lungo l’itinerario (partenza/arrivo/tappa/intermedio/passaggio). */
export type WaypointRole =
  | "trip_start"
  | "trip_end"
  | "leg_start"
  | "leg_end"
  | "via"
  | "poi";

export interface StopRow {
  id: string;
  itinerary_id: string;
  segment_type: SegmentType;
  /** Ruolo strutturale (partenza totale, tappa, passaggio, …). */
  waypoint_role: WaypointRole;
  /**
   * Giornata / segmento percorso (0 = primo giorno). Ogni giornata ha partenza, arrivo e passaggi opzionali.
   * Due punti ⇒ al massimo una giornata; per il giorno successivo serve almeno 2 punti nel giorno corrente.
   */
  leg_index: number;
  name: string;
  order_index: number;
  lat: number;
  lng: number;
  notes: string | null;
  /** URL immagine (es. rifugio) — opzionale. */
  image_url: string | null;
  /** Link al sito web (es. rifugio CAI) — opzionale. */
  website_url: string | null;
  /** Telefono (rifugio / struttura) — opzionale. */
  phone: string | null;
}

/** Conferme manuali checklist sicurezza (se assente, si usa solo il calcolo automatico in UI). */
export type SafetyChecklistManual = Partial<{
  dates: boolean;
  weather: boolean;
  route: boolean;
  gpx: boolean;
  ski: boolean;
}>;

export interface ItineraryRow {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  activity: ActivityType | string;
  line_geojson: string | null;
  /** Variante di percorso attualmente mostrata (se presente). */
  active_route_variant_id?: string | null;
  created_at: string;
  /** JSON serializzato `SafetyChecklistManual`. */
  safety_checklist_json?: string | null;
  /** Note libere per il piano (visibili anche nel riepilogo stampabile). */
  planner_notes?: string | null;
}

/** Alternativa di percorso confrontabile (stesso itinerario). */
export interface RouteVariantRow {
  id: string;
  itinerary_id: string;
  label: string;
  line_geojson: string;
  sort_order: number;
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
  /** Utente “io” nel POC social (tabella users). */
  active_user_id?: string | null;
}

export type SocialUserRole = "standard" | "guide" | "operator" | "club_admin";

export interface UserRow {
  id: string;
  display_name: string;
  handle: string | null;
  role: SocialUserRole | string;
  cert_metadata_json: string | null;
  created_at: string;
}

export interface FriendshipRow {
  id: string;
  user_id: string;
  peer_user_id: string;
  status: "pending" | "accepted";
  created_at: string;
}

export type GroupKind = "friends_circle" | "club" | "global_feed";

export interface GroupRow {
  id: string;
  name: string;
  slug: string;
  kind: GroupKind | string;
  description: string;
  created_at: string;
}

export interface GroupMemberRow {
  group_id: string;
  user_id: string;
  role: "member" | "admin";
}

export interface FollowRow {
  follower_user_id: string;
  target_user_id: string;
  created_at: string;
}

/** Percorso canonico (geometria condivisa tra più uscite). */
export interface CanonicalRouteRow {
  id: string;
  name: string;
  line_geojson: string;
  summary: string;
  bbox_json: string;
  activity_kind: string;
  region: string | null;
  source: string;
  promoted_from_itinerary_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
}

export type OutingVisibility = "private" | "friends" | "group" | "followers" | "public";

export interface OutingRow {
  id: string;
  route_id: string;
  author_user_id: string;
  started_at: string;
  visibility: OutingVisibility | string;
  group_id: string | null;
  snow_conditions_text: string | null;
  weather_snapshot_json: string | null;
  notes: string | null;
  itinerary_id: string | null;
  track_id: string | null;
  created_at: string;
}

export interface OutingParticipantRow {
  outing_id: string;
  user_id: string;
}

/** Uscita nell’hub “Io”: percorso, autore e ruolo (autore vs partecipante). */
export interface OutingForUserListRow extends OutingRow {
  route_name: string;
  author_display_name: string;
  role: "author" | "participant";
}

export interface OutingMediaRow {
  id: string;
  outing_id: string;
  url: string;
  caption: string | null;
  sort_order: number;
}

export interface OutingPoiNoteRow {
  id: string;
  outing_id: string;
  name: string;
  lat: number;
  lng: number;
  body: string;
  created_at: string;
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
  /** Sito ufficiale o prenotazioni (opzionale). */
  website_url: string | null;
  /** Contatto telefonico (opzionale). */
  phone: string | null;
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
