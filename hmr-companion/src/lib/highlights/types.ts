/** Tipi e funzioni degli highlights usabili anche nel browser (nessun import server). */

export type HighlightPhotoDto = { id: string; url: string | null; caption: string; owner: string; lng: number; lat: number };

export type HighlightDto = {
  id: string;
  name: string;
  tip: string;
  sport: string;
  lat: number;
  lng: number;
  votes: number;
  voted: boolean;
  mine: boolean;
  owner: { username: string; display_name: string; avatar_url: string | null };
  cover_url: string | null;
  created_at: number;
  photos?: HighlightPhotoDto[];
};

export function highlightsToGeoJson(items: Pick<HighlightDto, "id" | "name" | "votes" | "lat" | "lng">[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: items.map((h) => ({
      type: "Feature",
      properties: { highlightId: h.id, name: h.name, votes: h.votes },
      geometry: { type: "Point", coordinates: [h.lng, h.lat] },
    })),
  };
}
