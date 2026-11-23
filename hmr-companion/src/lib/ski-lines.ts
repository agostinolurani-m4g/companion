/**
 * Linee di sci (stile FATMAP): le discese degli itinerari pubblici di
 * scialpinismo, colorate per difficoltà di sci (Toponeige, da camptocamp).
 */

export type SkiLineSource = { id: string; name: string; geojson: string; meta_json: string | null };

/** Classi Toponeige (1 facile → 5 estremo). */
export const SKI_LINE_CLASSES = [
  { cls: 1, label: "1 · facile", color: "#16a34a" },
  { cls: 2, label: "2 · medio", color: "#2563eb" },
  { cls: 3, label: "3 · impegnativo", color: "#dc2626" },
  { cls: 4, label: "4 · difficile", color: "#111827" },
  { cls: 5, label: "5 · estremo", color: "#7e22ce" },
] as const;
export const SKI_LINE_UNRATED = "#64748b";

/** "3.2" → 3; "4.1" → 4; altro → null. */
export function toponeigeClass(raw: unknown): number | null {
  const m = String(raw ?? "").match(/^\s*([1-5])(?:\.\d)?\s*$/);
  return m ? Number(m[1]) : null;
}

export function skiLineColor(cls: number | null): string {
  return SKI_LINE_CLASSES.find((c) => c.cls === cls)?.color ?? SKI_LINE_UNRATED;
}

function lines(geo: GeoJSON.GeoJSON): { coords: GeoJSON.Position[]; mode: string | null }[] {
  const out: { coords: GeoJSON.Position[]; mode: string | null }[] = [];
  const visit = (g: GeoJSON.Geometry | null, mode: string | null) => {
    if (!g) return;
    if (g.type === "LineString") out.push({ coords: g.coordinates, mode });
    else if (g.type === "MultiLineString") for (const c of g.coordinates) out.push({ coords: c, mode });
    else if (g.type === "GeometryCollection") for (const x of g.geometries) visit(x, mode);
  };
  if (geo.type === "FeatureCollection") {
    for (const f of geo.features) visit(f.geometry, (f.properties as { mode?: string } | null)?.mode ?? null);
  } else if (geo.type === "Feature") visit(geo.geometry, (geo.properties as { mode?: string } | null)?.mode ?? null);
  else visit(geo as GeoJSON.Geometry, null);
  return out.filter((l) => l.coords.length >= 2);
}

/** Discese di un itinerario: i tratti "descent"; se mancano, l'intera traccia (le gite c2c sono spesso salita = discesa). */
export function skiLineFeatures(r: SkiLineSource): GeoJSON.Feature<GeoJSON.LineString>[] {
  let geo: GeoJSON.GeoJSON;
  try {
    geo = JSON.parse(r.geojson) as GeoJSON.GeoJSON;
  } catch {
    return [];
  }
  let meta: { ski_rating?: unknown; ski_exposition?: unknown } = {};
  try {
    meta = r.meta_json ? (JSON.parse(r.meta_json) as typeof meta) : {};
  } catch {
    /* meta facoltativo */
  }
  const all = lines(geo);
  const descents = all.filter((l) => l.mode === "descent");
  const picked = descents.length ? descents : all.filter((l) => l.mode !== "ascent").length ? all.filter((l) => l.mode !== "ascent") : all;
  const cls = toponeigeClass(meta.ski_rating);
  return picked.map((l) => ({
    type: "Feature",
    properties: {
      routeId: r.id,
      name: r.name,
      rating: meta.ski_rating != null ? String(meta.ski_rating) : null,
      cls,
      color: skiLineColor(cls),
    },
    geometry: { type: "LineString", coordinates: l.coords.map((c) => [c[0], c[1]]) },
  }));
}
