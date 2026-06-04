import { runPoiSnapshotForTrack } from "@/lib/snapshot-pois-run";
import { runSurfaceSnapshotForTrack } from "@/lib/snapshot-surface-run";

export type RunSnapshotOptions = {
  /** Griglia più piccola per upload web (più veloce). */
  webFast?: boolean;
};

/**
 * Snapshot POI Overpass + superficie OSM in-process (nessun npx/tsx esterno).
 */
export async function runFullTrackSnapshot(
  trackId: string,
  opts?: RunSnapshotOptions
): Promise<{ poiCount: number }> {
  const fast = opts?.webFast !== false;
  const poiCount = await runPoiSnapshotForTrack(trackId, fast
    ? {
        gridCols: 3,
        gridRows: 4,
        concurrency: 2,
        pauseMs: 500,
      }
    : undefined);
  await runSurfaceSnapshotForTrack(trackId, fast
    ? {
        gridCols: 2,
        gridRows: 3,
        pauseMs: 700,
      }
    : undefined);
  return { poiCount };
}
