/** Corpo comune delle richieste "lungo il percorso": coordinate valide e distanza massima. */
export function parseAlongBody(
  raw: unknown,
  defaults: { maxDistM: number; maxCap: number },
): { route: [number, number][]; maxDistM: number } | null {
  const b = (raw ?? {}) as { coordinates?: unknown; maxDistM?: unknown };
  if (!Array.isArray(b.coordinates) || b.coordinates.length < 2) return null;
  const coords = b.coordinates as unknown[];
  // Percorsi lunghi: un punto ogni N basta (la distanza resta precisa sui segmenti).
  const step = Math.max(1, Math.ceil(coords.length / 4000));
  const route: [number, number][] = [];
  const push = (c: unknown): boolean => {
    if (!Array.isArray(c) || !Number.isFinite(Number(c[0])) || !Number.isFinite(Number(c[1]))) return false;
    route.push([Number(c[0]), Number(c[1])]);
    return true;
  };
  for (let i = 0; i < coords.length; i += step) if (!push(coords[i])) return null;
  if ((coords.length - 1) % step !== 0 && !push(coords[coords.length - 1])) return null;
  const d = Number(b.maxDistM);
  return { route, maxDistM: Number.isFinite(d) && d > 0 ? Math.min(d, defaults.maxCap) : defaults.maxDistM };
}
