import { listTracks } from "../src/lib/db";
import { loadTrackPayload } from "../src/lib/load-track-payload";

const owner = "ago";
const tracks = listTracks(owner);
console.log("tracks:", tracks.length, tracks.map((t) => t.id));

if (tracks.length === 0) {
  console.error("FAIL: nessuna traccia per", owner);
  process.exit(1);
}

const payload = loadTrackPayload(tracks[0].id, owner);
if (!payload) {
  console.error("FAIL: loadTrackPayload null");
  process.exit(1);
}

console.log("payload:", {
  id: payload.id,
  name: payload.name,
  length_km: payload.length_km,
  coords: payload.coords.length,
  pois: payload.pois.length,
});

console.log("OK: dogfood DB verification passed");
