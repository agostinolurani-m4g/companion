/** Tipi condivisi client/server (nessun import da `db`). */

export type StreetViewAlongItem = {
  pano_id: string;
  lat: number;
  lng: number;
  along_km: number;
  detour_m: number;
  copyright: string | null;
  sample_lat: number;
  sample_lng: number;
  /** Link per aprire Street View in Google Maps (salvato/restituito dall’API). */
  maps_url?: string;
};

export type MapillaryAlongItem = {
  id: string;
  lat: number;
  lng: number;
  along_km: number;
  detour_m: number;
  thumb_url: string | null;
};
