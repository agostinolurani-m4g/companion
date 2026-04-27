import { getMapPoi, getStop, updateMapPoi, updateStop } from "@/lib/db";
import { fetchNearestLodgingOsm } from "@/lib/overpass";
import type { MapPoiRow, StopRow } from "@/lib/types";
import { fetchWikipediaImageUrlForQuery } from "@/lib/refuge-wiki-image";

export type LodgingEnrichFields = {
  image_url: string | null;
  website_url: string | null;
  phone: string | null;
};

/**
 * Compila foto, sito e telefono da OSM (vicino al punto) e, se manca ancora l’immagine, da Wikipedia.
 * Non sovrascrive valori già presenti (persistenza «salva per sempre» una volta in DB).
 */
export async function enrichLodgingMetadata(input: {
  name: string;
  lat: number;
  lng: number;
  existing?: Partial<LodgingEnrichFields> | null;
}): Promise<LodgingEnrichFields> {
  const ex = input.existing ?? {};
  let image_url = ex.image_url?.trim() || null;
  let website_url = ex.website_url?.trim() || null;
  let phone = ex.phone?.trim() || null;

  const needOsm = !website_url || !phone || !image_url;
  if (needOsm) {
    try {
      const osm = await fetchNearestLodgingOsm(input.lat, input.lng, input.name, 2800);
      if (osm) {
        if (!phone && osm.phone) phone = osm.phone;
        if (!website_url && osm.website) website_url = osm.website;
        if (!image_url && osm.image_url) image_url = osm.image_url;
      }
    } catch {
      /* Overpass opzionale */
    }
  }

  if (!image_url) {
    try {
      const wiki = await fetchWikipediaImageUrlForQuery(input.name);
      if (wiki) image_url = wiki;
    } catch {
      /* Wikipedia opzionale */
    }
  }

  if (website_url && !/^https?:\/\//i.test(website_url)) {
    website_url = `https://${website_url.replace(/^\/\//, "")}`;
  }

  return { image_url, website_url, phone };
}

/** Dopo creazione/aggiornamento: riempie campi mancanti e salva in SQLite. */
export async function enrichAndPersistStopIfLodging(
  itineraryId: string,
  stopId: string
): Promise<StopRow | null> {
  const s = getStop(stopId, itineraryId);
  if (!s || s.segment_type !== "lodging") return s ?? null;
  if (s.image_url?.trim() && s.website_url?.trim() && s.phone?.trim()) return s;

  const enriched = await enrichLodgingMetadata({
    name: s.name,
    lat: s.lat,
    lng: s.lng,
    existing: { image_url: s.image_url, website_url: s.website_url, phone: s.phone },
  });

  const patch: {
    image_url?: string | null;
    website_url?: string | null;
    phone?: string | null;
  } = {};
  if (!s.image_url?.trim() && enriched.image_url) patch.image_url = enriched.image_url;
  if (!s.website_url?.trim() && enriched.website_url) patch.website_url = enriched.website_url;
  if (!s.phone?.trim() && enriched.phone) patch.phone = enriched.phone;
  if (Object.keys(patch).length === 0) return s;

  return updateStop(stopId, itineraryId, patch);
}

export async function enrichAndPersistMapPoiIfRefuge(
  itineraryId: string,
  poiId: string
): Promise<MapPoiRow | null> {
  const p = getMapPoi(poiId, itineraryId);
  if (!p || p.category !== "refuge") return p ?? null;
  if (p.image_url?.trim() && p.website_url?.trim() && p.phone?.trim()) return p;

  const enriched = await enrichLodgingMetadata({
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    existing: { image_url: p.image_url, website_url: p.website_url, phone: p.phone },
  });

  const patch: {
    image_url?: string | null;
    website_url?: string | null;
    phone?: string | null;
  } = {};
  if (!p.image_url?.trim() && enriched.image_url) patch.image_url = enriched.image_url;
  if (!p.website_url?.trim() && enriched.website_url) patch.website_url = enriched.website_url;
  if (!p.phone?.trim() && enriched.phone) patch.phone = enriched.phone;
  if (Object.keys(patch).length === 0) return p;

  return updateMapPoi(poiId, itineraryId, patch);
}
