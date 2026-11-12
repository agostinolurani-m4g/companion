let cachedPath: { path: string; at: number } | null = null;

/** Tile path RainViewer (radar) per overlay raster. */
export async function rainViewerTilePath(): Promise<string | null> {
  const now = Date.now();
  if (cachedPath && now - cachedPath.at < 5 * 60_000) return cachedPath.path;
  try {
    const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { radar?: { past?: Array<{ path: string }> } };
    const path = data.radar?.past?.at(-1)?.path;
    if (!path) return null;
    cachedPath = { path, at: now };
    return path;
  } catch {
    return null;
  }
}

export function rainViewerTilesUrl(path: string): string {
  return `https://tilecache.rainviewer.com${path}/256/{z}/{x}/{y}/2/1_1.png`;
}
