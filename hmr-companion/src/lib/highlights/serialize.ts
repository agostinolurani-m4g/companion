import { getUserPhoto, listUserPhotosInBbox } from "@/lib/db";
import { personLabel } from "@/lib/segments/serialize";
import { avatarUrl } from "@/lib/social-labels";
import type { HighlightWithVotes } from "./store";
import type { HighlightDto, HighlightPhotoDto } from "./types";

export type { HighlightDto, HighlightPhotoDto } from "./types";

/** Foto della community entro ~120 m dall'highlight (galleria della scheda). */
export function photosNear(lat: number, lng: number, radiusM = 120, limit = 12): HighlightPhotoDto[] {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return listUserPhotosInBbox(lat - dLat, lng - dLng, lat + dLat, lng + dLng, limit).map((p) => ({
    id: p.id,
    url: avatarUrl(p.photo_path),
    caption: p.caption,
    owner: p.owner,
    lng: p.lng,
    lat: p.lat,
  }));
}

export function serializeHighlight(h: HighlightWithVotes, viewer: string, opts: { photos?: boolean } = {}): HighlightDto {
  const cover = h.photo_id ? getUserPhoto(h.photo_id) : undefined;
  const photos = opts.photos ? photosNear(h.lat, h.lng) : undefined;
  return {
    id: h.id,
    name: h.name,
    tip: h.tip,
    sport: h.sport,
    lat: h.lat,
    lng: h.lng,
    votes: h.votes,
    voted: !!h.voted,
    mine: h.owner === viewer,
    owner: personLabel(h.owner),
    cover_url: cover ? avatarUrl(cover.photo_path) : (photos?.[0]?.url ?? null),
    created_at: h.created_at,
    ...(photos ? { photos } : {}),
  };
}
