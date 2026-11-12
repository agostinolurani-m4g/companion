/** Query Overpass per riempimento tile outdoor (stessa tassonomia dell'import PBF). */

export function outdoorOverpassQuery(south: number, west: number, north: number, east: number): string {
  const b = `${south},${west},${north},${east}`;
  return `
[out:json][timeout:120];
(
  node["tourism"~"^(alpine_hut|wilderness_hut|camp_site|viewpoint|information)$"](${b});
  node["amenity"~"^(shelter|drinking_water|fountain|water_point|bench|toilets|restaurant|cafe|pharmacy|parking|bicycle_repair_station|charging_station|defibrillator)$"](${b});
  node["information"="guidepost"](${b});
  node["natural"~"^(peak|spring|saddle|cave_entrance|waterfall|rock)$"](${b});
  node["mountain_pass"="yes"](${b});
  node["highway"="trailhead"](${b});
  node["emergency"~"^(phone|mountain_rescue|defibrillator)$"](${b});
  node["climbing"="crag"](${b});
  node["barrier"~"^(gate|stile|cattle_grid)$"](${b});
  way["tourism"~"^(alpine_hut|wilderness_hut|camp_site)$"](${b});
  way["amenity"~"^(shelter|drinking_water|water_point)$"](${b});
  way["natural"="spring"](${b});
  way["highway"~"^(path|footway|track|steps|via_ferrata|cycleway|bridleway)$"](${b});
  way["abandoned:highway"](${b});
  way["disused:highway"](${b});
  way["piste:type"](${b});
  way["aerialway"](${b});
  relation["type"="destination_sign"](${b});
  relation["route"~"^(hiking|mtb|ski|bicycle)$"](${b});
);
out body geom;
`.trim();
}
