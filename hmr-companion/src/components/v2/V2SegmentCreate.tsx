"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Position } from "geojson";
import V2PlanMap, { type V2MapClickTarget } from "@/components/v2/V2PlanMap";
import { fetchJson } from "@/lib/fetch-json";
import { sampleElevationsForLine } from "@/lib/elevation";
import { detectClimbs, detectDescents, segmentStats } from "@/lib/segments/match";
import { formatDistance, segmentsToGeoJson } from "@/lib/segments/geo";
import { activityLabel, isUserRouteActivity, USER_ROUTE_ACTIVITIES, type UserRouteActivity } from "@/lib/sports";
import { haversineKm } from "@/lib/track-geometry";

type Source = { kind: "activity" | "route"; id: string };

type Loaded = { name: string; sport: UserRouteActivity; coords: Position[] };

/** Tutte le LineString di un GeoJSON di percorso, in ordine (salita + discesa per lo scialpinismo). */
function linesOf(g: GeoJSON.GeoJSON): Position[] {
  if (g.type === "LineString") return g.coordinates;
  if (g.type === "MultiLineString") return g.coordinates.flat();
  if (g.type === "Feature") return g.geometry ? linesOf(g.geometry) : [];
  if (g.type === "FeatureCollection") return g.features.flatMap((f) => linesOf(f));
  return [];
}

async function loadSource(src: Source): Promise<Loaded> {
  if (src.kind === "activity") {
    const d = await fetchJson<{ activity: { name: string; sport: string; geojson: GeoJSON.LineString } }>(
      `/api/v2/activities/${encodeURIComponent(src.id)}`,
    );
    return {
      name: d.activity.name,
      sport: isUserRouteActivity(d.activity.sport) ? d.activity.sport : "road",
      coords: d.activity.geojson.coordinates,
    };
  }
  const d = await fetchJson<{ route: { name: string; activity: UserRouteActivity; geojson: GeoJSON.GeoJSON } }>(
    `/api/v2/routes/${encodeURIComponent(src.id)}`,
  );
  return { name: d.route.name, sport: d.route.activity, coords: linesOf(d.route.geojson) };
}

/** Profilo altimetrico SVG con la selezione evidenziata. */
function Profile({ km, ele, a, b }: { km: number[]; ele: number[]; a: number; b: number }) {
  if (km.length < 2) return null;
  const W = 340;
  const H = 90;
  const total = km[km.length - 1] || 1;
  const lo = Math.min(...ele);
  const hi = Math.max(...ele);
  const span = Math.max(20, hi - lo);
  const x = (k: number) => (k / total) * W;
  const y = (e: number) => H - 4 - ((e - lo) / span) * (H - 12);
  const path = (from: number, to: number) =>
    km
      .slice(from, to + 1)
      .map((k, i) => `${i ? "L" : "M"}${x(k).toFixed(1)},${y(ele[from + i]).toFixed(1)}`)
      .join(" ");
  const area = (from: number, to: number) => `${path(from, to)} L${x(km[to]).toFixed(1)},${H} L${x(km[from]).toFixed(1)},${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" preserveAspectRatio="none" aria-label="Profilo altimetrico">
      <path d={area(0, km.length - 1)} fill="var(--hmr-elev, #94a3b8)" opacity={0.25} />
      {b > a ? <path d={area(a, b)} fill="#f97316" opacity={0.55} /> : null}
      <path d={path(0, km.length - 1)} fill="none" stroke="currentColor" strokeWidth={1.2} opacity={0.6} />
    </svg>
  );
}

export default function V2SegmentCreate({ source }: { source: Source | null }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [samples, setSamples] = useState<{ pts: Position[]; km: number[] } | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [name, setName] = useState("");
  const [sport, setSport] = useState<UserRouteActivity>("road");
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fitKey] = useState(1);

  useEffect(() => {
    if (!source) return;
    let alive = true;
    (async () => {
      try {
        const l = await loadSource(source);
        if (!alive) return;
        setLoaded(l);
        setSport(l.sport);
        const el = await sampleElevationsForLine(l.coords);
        if (!alive) return;
        const pts = el.sampled.map((c, i) => (el.available ? [c[0], c[1], el.elevationM[i]] : [c[0], c[1]]));
        setSamples({ pts, km: el.distanceKm });
        // Selezione iniziale: la salita più dura, altrimenti il terzo centrale.
        // MTB e sci: proponi prima la discesa più lunga; per gli altri la salita più dura.
        const downhillFirst = ["mtb", "ski"].includes(l.sport);
        const climbs = detectClimbs(pts);
        const descents = detectDescents(pts);
        const bestUp = [...climbs].sort((x, y) => y.gain_m - x.gain_m)[0];
        const bestDown = [...descents].sort((x, y) => y.gain_m - x.gain_m)[0];
        const best = downhillFirst ? (bestDown ?? bestUp) : (bestUp ?? bestDown);
        if (best) {
          setRange([best.start, best.end]);
          setName(`${best === bestDown ? "Discesa" : "Salita"} da ${l.name}`.slice(0, 120));
        } else {
          const n = pts.length;
          setRange([Math.floor(n / 3), Math.floor((2 * n) / 3)]);
          setName(`Tratto di ${l.name}`.slice(0, 120));
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Errore di caricamento");
      }
    })();
    return () => {
      alive = false;
    };
  }, [source]);

  const climbs = useMemo(() => (samples ? detectClimbs(samples.pts) : []), [samples]);
  const descents = useMemo(() => (samples ? detectDescents(samples.pts) : []), [samples]);
  const slice = useMemo(() => (samples ? samples.pts.slice(range[0], range[1] + 1) : []), [samples, range]);
  const stats = useMemo(() => (slice.length >= 2 ? segmentStats(slice) : null), [slice]);
  const fit = useMemo(() => {
    if (!samples || samples.pts.length < 2) return null;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const p of samples.pts) {
      w = Math.min(w, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]);
    }
    return { bbox: [w, s, e, n] as [number, number, number, number], key: fitKey, padding: 50 };
  }, [samples, fitKey]);
  const segGeo = useMemo(
    () =>
      slice.length >= 2
        ? segmentsToGeoJson(
            [{ id: "draft", geojson: { type: "LineString", coordinates: slice } } as Parameters<typeof segmentsToGeoJson>[0][number]],
            "draft",
          )
        : null,
    [slice],
  );
  const ele = useMemo(() => (samples ? samples.pts.map((p) => (p.length > 2 ? (p[2] as number) : 0)) : []), [samples]);

  /** Click sulla mappa: sposta l'estremo della selezione più vicino al punto cliccato. */
  const onMap = (t: V2MapClickTarget) => {
    if (!samples || t.kind !== "map") return;
    let best = 0;
    let bestD = Infinity;
    samples.pts.forEach((p, i) => {
      const d = haversineKm(p, [t.lng, t.lat]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (bestD > 0.3) return;
    setRange(([a, b]) => (Math.abs(best - a) <= Math.abs(best - b) ? [Math.min(best, b - 1), b] : [a, Math.max(best, a + 1)]));
  };

  const save = async () => {
    if (!stats) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/v2/segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          sport,
          coords: slice,
          visibility: priv ? "private" : "public",
          source_kind: source?.kind ?? "draw",
          source_id: source?.id,
        }),
      });
      const data = (await res.json()) as { segment?: { id: string }; error?: string };
      if (!res.ok || !data.segment) throw new Error(data.error ?? "Errore");
      router.push(`/v2/segmenti/${data.segment.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Errore");
      setBusy(false);
    }
  };

  if (!source) {
    return (
      <div className="mx-auto max-w-lg p-6 text-sm">
        <h1 className="text-xl font-semibold">Nuovo segmento</h1>
        <p className="mt-2 text-[color:var(--hmr-muted)]">
          Apri un tuo percorso o un&apos;attività e scegli &quot;Crea segmento&quot;.
        </p>
        <Link href="/v2/segmenti" className="ui-btn ui-btn-sm mt-4 inline-flex">
          ← Segmenti
        </Link>
      </div>
    );
  }

  const n = samples?.pts.length ?? 0;
  const kmA = samples ? samples.km[range[0]] ?? 0 : 0;
  const kmB = samples ? samples.km[range[1]] ?? 0 : 0;

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="order-2 min-h-0 flex-1 space-y-4 overflow-y-auto p-4 lg:order-1 lg:w-[400px] lg:flex-none">
        <div>
          <Link href="/v2/segmenti" className="text-[12px] text-[color:var(--hmr-muted)]">
            ← Segmenti
          </Link>
          <h1 className="mt-1 text-xl font-semibold">Nuovo segmento</h1>
          <p className="text-[12px] text-[color:var(--hmr-muted)]">
            {loaded ? `Da: ${loaded.name}` : "Caricamento traccia…"} · tocca la mappa vicino alla traccia per spostare
            partenza o arrivo.
          </p>
        </div>

        {samples ? (
          <>
            <Profile km={samples.km} ele={ele} a={range[0]} b={range[1]} />
            <label className="block text-[12px]">
              Partenza · km {kmA.toFixed(2)}
              <input
                type="range"
                className="w-full"
                min={0}
                max={n - 2}
                value={range[0]}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setRange(([, b]) => [Math.min(v, b - 1), b]);
                }}
              />
            </label>
            <label className="block text-[12px]">
              Arrivo · km {kmB.toFixed(2)}
              <input
                type="range"
                className="w-full"
                min={1}
                max={n - 1}
                value={range[1]}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setRange(([a]) => [a, Math.max(v, a + 1)]);
                }}
              />
            </label>

            {climbs.length ? (
              <div>
                <div className="ui-eyebrow mb-1.5">Salite trovate</div>
                <div className="flex flex-wrap gap-1.5">
                  {climbs.map((c) => (
                    <button
                      key={`${c.start}-${c.end}`}
                      type="button"
                      className="ui-chip"
                      aria-pressed={range[0] === c.start && range[1] === c.end}
                      onClick={() => setRange([c.start, c.end])}
                    >
                      {formatDistance(c.length_m)} · +{c.gain_m} m · {c.avg_grade_pct}%
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {descents.length ? (
              <div>
                <div className="ui-eyebrow mb-1.5">Discese trovate (MTB, sci)</div>
                <div className="flex flex-wrap gap-1.5">
                  {descents.map((c) => (
                    <button
                      key={`d-${c.start}-${c.end}`}
                      type="button"
                      className="ui-chip"
                      aria-pressed={range[0] === c.start && range[1] === c.end}
                      onClick={() => setRange([c.start, c.end])}
                    >
                      {formatDistance(c.length_m)} · −{c.gain_m} m · −{c.avg_grade_pct}%
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {stats ? (
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  [formatDistance(stats.length_m), "lunghezza"],
                  stats.avg_grade_pct < -2 ? [`${stats.elev_loss_m} m`, "D−"] : [`${stats.elev_gain_m} m`, "D+"],
                  [`${stats.avg_grade_pct}%`, "media"],
                  [`${stats.max_grade_pct}%`, "max"],
                ].map(([v, l]) => (
                  <div key={l} className="ui-card px-1 py-2">
                    <div className="text-[14px] font-semibold">{v}</div>
                    <div className="text-[10.5px] text-[color:var(--hmr-muted)]">{l}</div>
                  </div>
                ))}
              </div>
            ) : null}

            <label className="block text-[12px]">
              Nome
              <input className="ui-input mt-1 w-full" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block text-[12px]">
              Sport
              <select
                className="ui-input mt-1 w-full"
                value={sport}
                onChange={(e) => setSport(e.target.value as UserRouteActivity)}
              >
                {USER_ROUTE_ACTIVITIES.map((a) => (
                  <option key={a} value={a}>
                    {activityLabel(a)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
              Privato (classifica visibile solo a me)
            </label>

            {err ? <p className="text-[12px] text-[color:var(--hmr-danger)]">{err}</p> : null}
            <button
              type="button"
              className="ui-btn ui-btn-primary w-full"
              disabled={busy || !stats || stats.length_m < 200 || !name.trim()}
              onClick={save}
            >
              {busy ? "Creo e cerco i passaggi…" : "Crea segmento"}
            </button>
            {stats && stats.length_m < 200 ? (
              <p className="text-[11.5px] text-[color:var(--hmr-muted)]">Serve almeno 200 m.</p>
            ) : null}
          </>
        ) : err ? (
          <p className="text-[12px] text-[color:var(--hmr-danger)]">{err}</p>
        ) : (
          <p className="text-[12.5px] text-[color:var(--hmr-muted)]">Calcolo il profilo…</p>
        )}
      </aside>

      <div className="relative order-1 h-[40vh] shrink-0 lg:order-2 lg:h-auto lg:flex-1">
        <V2PlanMap
          waypoints={[]}
          routeCoords={samples ? (samples.pts.map((p) => [p[0], p[1]]) as [number, number][]) : null}
          pois={[]}
          onMapInteraction={onMap}
          showWaypoints={false}
          fitTo={fit}
          segmentsGeoJson={segGeo}
          mapSport={sport}
        />
      </div>
    </div>
  );
}
