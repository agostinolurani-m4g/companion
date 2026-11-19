/** Foto geolocalizzata come la restituisce /api/v2/photos. */
export type MapPhoto = {
  id: string;
  url: string | null;
  caption?: string;
  owner?: string;
  lng: number;
  lat: number;
  created_at?: number;
};

/** FeatureCollection per le miniature sulla mappa (MapCore → usePhotoMarkers). */
export function photosToGeoJson(photos: MapPhoto[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: photos.map((p) => ({
      type: "Feature",
      properties: { photoId: p.id, owner: p.owner ?? "", caption: p.caption ?? "", ...(p.url ? { url: p.url } : {}) },
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    })),
  };
}
