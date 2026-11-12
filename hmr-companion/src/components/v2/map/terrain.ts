import type { Map as MaplibreMap } from "maplibre-gl";
import { OPEN_DEM_SOURCE_ID, TERRAIN_3D_PITCH, TERRAIN_EXAGGERATION } from "./constants";
import { applySky, ensureDemSource } from "@/lib/map/topo-style";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim() || undefined;
const MAPTILER_TERRAIN = "maptiler-terrain-rgb";

export function applyTerrain3d(map: MaplibreMap, enabled: boolean, animate: boolean, dark = false) {
  if (enabled) {
    if (MAPTILER_KEY && !map.getSource(MAPTILER_TERRAIN)) {
      map.addSource(MAPTILER_TERRAIN, {
        type: "raster-dem",
        url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`,
        tileSize: 256,
      });
    }
    ensureDemSource(map);
    const source = MAPTILER_KEY && map.getSource(MAPTILER_TERRAIN) ? MAPTILER_TERRAIN : OPEN_DEM_SOURCE_ID;
    if (map.getSource(source)) {
      map.setTerrain({ source, exaggeration: TERRAIN_EXAGGERATION });
      applySky(map, dark);
      if (map.getPitch() < 20) {
        map.easeTo({ pitch: TERRAIN_3D_PITCH, duration: animate ? 800 : 0 });
      }
    }
  } else {
    map.setTerrain(null);
    if (map.getPitch() > 0) map.easeTo({ pitch: 0, duration: animate ? 500 : 0 });
  }
}
