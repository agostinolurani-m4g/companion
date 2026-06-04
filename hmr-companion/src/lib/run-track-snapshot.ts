import { spawn } from "node:child_process";
import path from "node:path";

export type RunSnapshotOptions = {
  /** Griglia più piccola per upload web (più veloce, meno POI ai bordi). */
  webFast?: boolean;
};

function runTsxScript(
  scriptRel: string,
  trackId: string,
  extraEnv: Record<string, string>
): Promise<string> {
  const cwd = process.cwd();
  const scriptPath = path.join(cwd, scriptRel);
  const env = { ...process.env, TRACK_ID: trackId, ...extraEnv };

  return new Promise((resolve, reject) => {
    const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
    const child = spawn(cmd, ["tsx", scriptPath], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || out.trim() || `${scriptRel} exit ${code}`));
    });
  });
}

/**
 * Esegue snapshot POI Overpass + superficie OSM per la traccia (come `npm run snapshot` + `snapshot:surface`).
 */
export async function runFullTrackSnapshot(
  trackId: string,
  opts?: RunSnapshotOptions
): Promise<void> {
  const fast = opts?.webFast !== false;
  const snapshotEnv: Record<string, string> = fast
    ? {
        HMR_SNAPSHOT_GRID_COLS: "3",
        HMR_SNAPSHOT_GRID_ROWS: "4",
        HMR_SNAPSHOT_CONCURRENCY: "2",
        HMR_SNAPSHOT_PAUSE_MS: "500",
      }
    : {};
  const surfaceEnv: Record<string, string> = fast
    ? {
        HMR_SURFACE_GRID_COLS: "2",
        HMR_SURFACE_GRID_ROWS: "3",
        HMR_SURFACE_PAUSE_MS: "700",
      }
    : {};

  await runTsxScript("scripts/snapshot-pois.ts", trackId, snapshotEnv);
  await runTsxScript("scripts/snapshot-surface.ts", trackId, surfaceEnv);
}
