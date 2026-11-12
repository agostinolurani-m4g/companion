import type { OutdoorGroup } from "./groups";
import type { OutdoorGeom } from "./kinds";
import { kindMeta } from "./kinds";

export type OsmElementType = "node" | "way" | "relation";

export type OutdoorClassification = {
  group: OutdoorGroup;
  kind: string;
  geom: OutdoorGeom;
};

function t(tags: Record<string, string>, key: string): string | undefined {
  const v = tags[key];
  return v?.trim() || undefined;
}

function highway(tags: Record<string, string>): string | undefined {
  return (
    t(tags, "highway") ||
    t(tags, "abandoned:highway") ||
    t(tags, "disused:highway") ||
    t(tags, "construction:highway")
  );
}

function isAbandoned(tags: Record<string, string>): boolean {
  return Boolean(t(tags, "abandoned:highway") || tags.abandoned === "yes");
}

function isDisused(tags: Record<string, string>): boolean {
  return Boolean(t(tags, "disused:highway") || tags.disused === "yes");
}

function classifyTrailLine(tags: Record<string, string>): OutdoorClassification | null {
  const hw = highway(tags);
  if (!hw) return null;

  if (isAbandoned(tags)) {
    return { group: "hazard", kind: "trail_abandoned", geom: "line" };
  }
  if (isDisused(tags)) {
    return { group: "hazard", kind: "trail_disused", geom: "line" };
  }
  if (tags.access === "no" && (hw === "path" || hw === "footway" || hw === "track")) {
    return { group: "hazard", kind: "access_no", geom: "line" };
  }
  if (tags.seasonal === "winter" || tags.winter_road === "yes") {
    return { group: "hazard", kind: "winter_road", geom: "line" };
  }
  if (tags.seasonal === "no" || tags.access === "no" && tags.seasonal) {
    return { group: "hazard", kind: "seasonal_closed", geom: "line" };
  }
  if (t(tags, "construction:highway") || tags.highway === "construction") {
    return { group: "hazard", kind: "construction", geom: "line" };
  }

  const piste = t(tags, "piste:type");
  if (piste) {
    if (piste === "downhill" || piste === "sled" || piste === "skitour") {
      const kind = piste === "skitour" ? "piste_skitour" : "piste_downhill";
      return { group: "trail", kind, geom: "line" };
    }
    if (piste === "nordic") return { group: "trail", kind: "piste_nordic", geom: "line" };
    if (piste === "hike" || piste === "snowshoe") {
      return { group: "trail", kind: "piste_hike", geom: "line" };
    }
  }

  if (hw === "via_ferrata") return { group: "climb", kind: "via_ferrata", geom: "line" };
  if (hw === "steps") return { group: "trail", kind: "steps", geom: "line" };
  if (hw === "cycleway" || tags.bicycle === "designated") {
    return { group: "trail", kind: "cycleway", geom: "line" };
  }
  if (hw === "bridleway") return { group: "trail", kind: "bridleway", geom: "line" };
  if (hw === "track") return { group: "trail", kind: "track", geom: "line" };
  if (hw === "footway" || hw === "pedestrian") return { group: "trail", kind: "footway", geom: "line" };

  if (hw === "path") {
    const mtb = t(tags, "mtb:scale") || t(tags, "mtb");
    if (mtb && mtb !== "no") return { group: "trail", kind: "path_mtb", geom: "line" };
    return { group: "trail", kind: "path_hiking", geom: "line" };
  }

  return null;
}

function classifyNode(tags: Record<string, string>): OutdoorClassification | null {
  if (tags.tourism === "alpine_hut") return { group: "shelter", kind: "alpine_hut", geom: "point" };
  if (tags.tourism === "wilderness_hut") return { group: "shelter", kind: "wilderness_hut", geom: "point" };
  if (tags.amenity === "shelter") {
    const st = t(tags, "shelter_type");
    if (st === "lean_to") return { group: "shelter", kind: "lean_to", geom: "point" };
    if (st === "basic_hut") return { group: "shelter", kind: "shelter_basic", geom: "point" };
    return { group: "shelter", kind: "shelter", geom: "point" };
  }
  if (tags.tourism === "chalet") return { group: "shelter", kind: "chalet", geom: "point" };
  if (tags.landuse === "farmyard" || tags.building === "farm") {
    if (tags.ele || tags.name) return { group: "shelter", kind: "alpine_farm", geom: "point" };
  }

  if (tags.information === "guidepost") return { group: "signage", kind: "guidepost", geom: "point" };
  if (tags.information === "board") return { group: "signage", kind: "information_board", geom: "point" };
  if (tags.information === "map") return { group: "signage", kind: "map_board", geom: "point" };
  if (tags.information === "route_marker" || tags.hiking === "yes") {
    return { group: "signage", kind: "trail_marker", geom: "point" };
  }
  if (tags.tourism === "information" && tags.information !== "office") {
    return { group: "signage", kind: "information_board", geom: "point" };
  }
  if (tags.tourism === "information" && tags.information === "office") {
    return { group: "signage", kind: "tourism_office", geom: "point" };
  }

  if (tags.amenity === "drinking_water") return { group: "water", kind: "drinking_water", geom: "point" };
  if (tags.natural === "spring") return { group: "water", kind: "spring", geom: "point" };
  if (tags.amenity === "fountain") return { group: "water", kind: "fountain", geom: "point" };
  if (tags.amenity === "water_point") return { group: "water", kind: "water_point", geom: "point" };
  if (tags.man_made === "water_tap") return { group: "water", kind: "water_tap", geom: "point" };
  if (tags.natural === "waterfall") return { group: "water", kind: "waterfall", geom: "point" };
  if (tags.man_made === "watering_place") return { group: "water", kind: "water_trough", geom: "point" };

  if (tags.natural === "peak" || tags["natural:peak"]) {
    return { group: "terrain", kind: "peak", geom: "point" };
  }
  if (tags.natural === "saddle") return { group: "terrain", kind: "saddle", geom: "point" };
  if (tags.mountain_pass === "yes") return { group: "terrain", kind: "mountain_pass", geom: "point" };
  if (tags.tourism === "viewpoint") return { group: "terrain", kind: "viewpoint", geom: "point" };
  if (tags.natural === "cave_entrance") return { group: "terrain", kind: "cave_entrance", geom: "point" };
  if (tags.natural === "rock") return { group: "terrain", kind: "rock", geom: "point" };
  if (tags.natural === "stone") return { group: "terrain", kind: "stone", geom: "point" };
  if (tags.natural === "volcano") return { group: "terrain", kind: "volcano", geom: "point" };

  if (tags.emergency === "defibrillator" || tags.amenity === "defibrillator") {
    return { group: "safety", kind: "defibrillator", geom: "point" };
  }
  if (tags.emergency === "phone") return { group: "safety", kind: "emergency_phone", geom: "point" };
  if (tags.emergency === "mountain_rescue") return { group: "safety", kind: "mountain_rescue", geom: "point" };
  if (tags.emergency === "access_point") return { group: "safety", kind: "mountain_rescue", geom: "point" };
  if (tags.amenity === "hospital") return { group: "safety", kind: "hospital", geom: "point" };
  if (tags.emergency === "yes" && tags.amenity === "first_aid") {
    return { group: "safety", kind: "first_aid", geom: "point" };
  }
  if (tags.aeroway === "helipad" || tags.emergency === "helipad") {
    return { group: "safety", kind: "helicopter_pad", geom: "point" };
  }

  if (tags.aerialway === "station" || tags.public_transport === "station" && tags.aerialway) {
    return { group: "transport", kind: "aerialway_station", geom: "point" };
  }
  if (tags.highway === "trailhead") return { group: "transport", kind: "trailhead", geom: "point" };
  if (tags.amenity === "parking" || tags.parking) return { group: "transport", kind: "parking", geom: "point" };
  if (tags.highway === "bus_stop") return { group: "transport", kind: "bus_stop", geom: "point" };
  if (tags.railway === "station" || tags.train === "yes") {
    return { group: "transport", kind: "train_station", geom: "point" };
  }

  if (tags.climbing === "crag") return { group: "climb", kind: "climbing_crag", geom: "point" };
  if (tags.sport === "climbing" && tags.climbing) {
    return { group: "climb", kind: "climbing_route", geom: "point" };
  }

  if (tags.barrier === "gate") return { group: "obstacle", kind: "gate", geom: "point" };
  if (tags.barrier === "stile") return { group: "obstacle", kind: "stile", geom: "point" };
  if (tags.barrier === "cattle_grid") return { group: "obstacle", kind: "cattle_grid", geom: "point" };
  if (tags.ford === "yes" || tags.highway === "ford") return { group: "obstacle", kind: "ford", geom: "point" };

  if (tags.tourism === "camp_site") return { group: "service", kind: "camp_site", geom: "point" };
  if (tags.tourism === "picnic_site") return { group: "service", kind: "picnic_site", geom: "point" };
  if (tags.leisure === "firepit" || tags.fireplace === "yes") {
    return { group: "service", kind: "fireplace", geom: "point" };
  }
  if (tags.amenity === "toilets") return { group: "service", kind: "toilets", geom: "point" };
  if (tags.amenity === "bench") return { group: "service", kind: "bench", geom: "point" };
  if (tags.amenity === "restaurant") return { group: "service", kind: "restaurant", geom: "point" };
  if (tags.amenity === "cafe" || tags.amenity === "fast_food" || tags.amenity === "bar") {
    return { group: "service", kind: "cafe", geom: "point" };
  }
  if (tags.shop === "supermarket") return { group: "service", kind: "shop_supermarket", geom: "point" };
  if (tags.shop === "outdoor" || tags.shop === "sports") {
    return { group: "service", kind: "shop_outdoor", geom: "point" };
  }
  if (tags.amenity === "bicycle_repair_station") {
    return { group: "service", kind: "bicycle_repair", geom: "point" };
  }
  if (tags.amenity === "charging_station") return { group: "service", kind: "charging_station", geom: "point" };
  if (tags.tourism === "hotel" || tags.tourism === "guest_house" || tags.tourism === "hostel") {
    return { group: "service", kind: "hotel", geom: "point" };
  }
  if (tags.amenity === "pharmacy") return { group: "service", kind: "pharmacy", geom: "point" };
  if (tags.amenity === "fuel") return { group: "service", kind: "fuel", geom: "point" };
  if (tags.amenity === "atm") return { group: "service", kind: "atm", geom: "point" };

  if (tags.amenity === "place_of_worship" || tags.building === "chapel") {
    return { group: "culture", kind: "chapel", geom: "point" };
  }
  if (tags.historic === "wayside_shrine") return { group: "culture", kind: "wayside_shrine", geom: "point" };
  if (tags.historic === "memorial" || tags.memorial) {
    return { group: "culture", kind: "memorial", geom: "point" };
  }
  if (tags.man_made === "cross" || tags.summit === "cross" || tags["summit:cross"] === "yes") {
    return { group: "culture", kind: "cross", geom: "point" };
  }
  if (tags.historic === "ruins") return { group: "culture", kind: "ruins", geom: "point" };
  if (tags.historic === "fort" || tags.historic === "castle") {
    return { group: "culture", kind: "fort", geom: "point" };
  }
  if (tags.military === "bunker") return { group: "culture", kind: "bunker", geom: "point" };

  if (tags.natural === "tree" && (tags.monument === "yes" || tags.notable === "yes")) {
    return { group: "nature", kind: "tree_monument", geom: "point" };
  }
  if (tags.man_made === "tower" && tags.tower === "watchtower") {
    return { group: "nature", kind: "hunting_stand", geom: "point" };
  }

  const trail = classifyTrailLine(tags);
  if (trail) return trail;

  return null;
}

/**
 * Tipi "puntuali" spesso mappati come edificio/area (es. ~80% dei rifugi italiani in OSM è una way):
 * vengono importati come punto al centroide.
 */
const WAY_AS_POINT_KINDS = new Set([
  "alpine_hut",
  "wilderness_hut",
  "shelter",
  "shelter_basic",
  "lean_to",
  "drinking_water",
  "spring",
  "water_point",
  "camp_site",
  "mountain_rescue",
]);

function classifyWay(tags: Record<string, string>): OutdoorClassification | null {
  if (!highway(tags)) {
    const asPoint = classifyNode(tags);
    if (asPoint && WAY_AS_POINT_KINDS.has(asPoint.kind)) return asPoint;
  }
  if (tags.natural === "glacier") return { group: "terrain", kind: "glacier", geom: "area" };
  if (tags.boundary === "protected_area" || tags.leisure === "nature_reserve") {
    const kind = tags.protection_title?.includes("National") ? "national_park" : "protected_area";
    return { group: "nature", kind, geom: "area" };
  }

  const aerial = t(tags, "aerialway");
  if (aerial) {
    if (aerial === "cable_car" || aerial === "gondola" || aerial === "chair_lift") {
      return { group: "transport", kind: "cable_car", geom: "line" };
    }
    return { group: "transport", kind: "aerialway_line", geom: "line" };
  }

  const trail = classifyTrailLine(tags);
  if (trail) return trail;

  if (tags.area === "yes" && tags.highway === "pedestrian") {
    return { group: "trail", kind: "footway", geom: "line" };
  }

  return null;
}

function classifyRelation(tags: Record<string, string>): OutdoorClassification | null {
  if (tags.type === "destination_sign") {
    return { group: "signage", kind: "destination_sign", geom: "point" };
  }
  const route = t(tags, "route");
  if (route === "hiking" || tags.hiking === "yes") {
    return { group: "trail", kind: "route_hiking", geom: "line" };
  }
  if (route === "mtb" || route === "bicycle") {
    return { group: "trail", kind: "route_mtb", geom: "line" };
  }
  if (route === "ski" || route === "piste") {
    return { group: "trail", kind: "piste_downhill", geom: "line" };
  }
  if (tags.boundary === "protected_area" || tags.protection_title) {
    return { group: "nature", kind: "protected_area", geom: "area" };
  }
  return null;
}

/** Classifica un elemento OSM; null se fuori tassonomia outdoor. */
export function classifyOutdoor(
  osmType: OsmElementType,
  tags: Record<string, string>,
): OutdoorClassification | null {
  if (tags.area === "yes" && osmType === "way" && !tags.highway && !tags.natural) {
    // aree generiche non outdoor
  }
  let c: OutdoorClassification | null = null;
  if (osmType === "node") c = classifyNode(tags);
  else if (osmType === "way") c = classifyWay(tags);
  else c = classifyRelation(tags);

  if (!c) return null;
  const meta = kindMeta(c.kind);
  if (meta) {
    return { group: meta.group, kind: meta.kind, geom: meta.geom };
  }
  return c;
}

export function outdoorFeatureId(osmType: OsmElementType, osmId: number | string): string {
  const prefix = osmType === "node" ? "n" : osmType === "way" ? "w" : "r";
  return `${prefix}${osmId}`;
}

export function parseOutdoorFeatureId(id: string): { osmType: OsmElementType; osmId: number } | null {
  const m = /^([nwr])(\d+)$/.exec(id);
  if (!m) return null;
  const osmType = m[1] === "n" ? "node" : m[1] === "w" ? "way" : "relation";
  return { osmType, osmId: Number(m[2]) };
}

export function featureDisplayName(tags: Record<string, string>, kind: string): string {
  const name =
    tags.name?.trim() ||
    tags["name:it"]?.trim() ||
    tags.ref?.trim() ||
    tags["ref:CAI"]?.trim() ||
    tags["ref:REI"]?.trim();
  if (name) return name;
  const meta = kindMeta(kind);
  return meta?.label ?? kind;
}

export function parseEle(tags: Record<string, string>): number | null {
  const raw = tags.ele?.trim();
  if (!raw) return null;
  const n = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
