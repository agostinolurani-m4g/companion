"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import V2PlanMap from "@/components/v2/V2PlanMap";
import Icon from "@/components/v2/ui/Icon";
import { fetchJson } from "@/lib/fetch-json";
import type { ViewBbox } from "@/lib/overpass";
import { formatDistance, segmentsToGeoJson } from "@/lib/segments/geo";
import type { SegmentDto } from "@/lib/segments/serialize";
import { activityLabel, isUserRouteActivity } from "@/lib/sports";

type Item = { id: string; name: string; sport: string; when: number; km: number };

function sportLabel(s: string) {
  return isUserRouteActivity(s) ? activityLabel(s) : s;
}

/** Segmenti: i miei, quelli nell'area della mappa, e da dove crearne di nuovi. */
export default function V2Segments() {
  const router = useRouter();
  const [mine, setMine] = useState<SegmentDto[]>([]);
  const [area, setArea] = useState<SegmentDto[]>([]);
  const [acts, setActs] = useState<Item[]>([]);
  const [routes, setRoutes] = useState<Item[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [bbox, setBbox] = useState<ViewBbox | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [sportFilter, setSportFilter] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<"" | "climb" | "descent" | "flat">("");

  useEffect(() => {
    void (async () => {
      const [s, a, r] = await Promise.all([
        fetchJson<{ segments: SegmentDto[] }>("/api/v2/segments").catch(() => ({ segments: [] })),
        fetchJson<{ activities: { id: string; name: string; sport: string; start_time: number; distance_m: number }[] }>(
          "/api/v2/activities?limit=15",
        ).catch(() => ({ activities: [] })),
        fetchJson<{ routes: { id: string; name: string; activity: string; updated_at?: number; length_km: number }[] }>(
          "/api/v2/routes",
        ).catch(() => ({ routes: [] })),
      ]);
      setMine(s.segments);
      if (s.segments.length) setFitKey(1);
      setActs(a.activities.map((x) => ({ id: x.id, name: x.name, sport: x.sport, when: x.start_time, km: x.distance_m / 1000 })));
      setRoutes(r.routes.slice(0, 15).map((x) => ({ id: x.id, name: x.name, sport: x.activity, when: x.updated_at ?? 0, km: x.length_km })));
    })();
  }, []);

  useEffect(() => {
    if (!bbox) return;
    const t = setTimeout(() => {
      const q = new URLSearchParams({ bbox: `${bbox.south},${bbox.west},${bbox.north},${bbox.east}` });
      if (sportFilter) q.set("sport", sportFilter);
      if (kindFilter) q.set("kind", kindFilter);
      fetchJson<{ segments: SegmentDto[] }>(`/api/v2/segments?${q}`)
        .then((d) => setArea(d.segments))
        .catch(() => undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [bbox, sportFilter, kindFilter]);

  const passes = useCallback(
    (s: SegmentDto) => (!sportFilter || s.sport === sportFilter) && (!kindFilter || s.kind === kindFilter),
    [sportFilter, kindFilter],
  );
  const mineShown = useMemo(() => mine.filter(passes), [mine, passes]);
  const sportsAvailable = useMemo(() => [...new Set([...mine, ...area].map((s) => s.sport))].sort(), [mine, area]);
  const all = useMemo(() => {
    const m = new Map<string, SegmentDto>();
    for (const s of [...mineShown, ...area]) m.set(s.id, s);
    return [...m.values()];
  }, [mineShown, area]);
  const geo = useMemo(() => segmentsToGeoJson(all, hover), [all, hover]);
  const fit = useMemo(() => {
    if (!fitKey || !mine.length) return null;
    const b = mine.reduce(
      (acc, s) => [Math.min(acc[0], s.bbox[0]), Math.min(acc[1], s.bbox[1]), Math.max(acc[2], s.bbox[2]), Math.max(acc[3], s.bbox[3])],
      [Infinity, Infinity, -Infinity, -Infinity],
    ) as [number, number, number, number];
    return { bbox: b, key: fitKey, padding: 50 };
  }, [fitKey, mine]);
  const areaOnly = area.filter((s) => !mine.some((m) => m.id === s.id));
  const KIND_LABEL = { climb: "Salita", descent: "Discesa", flat: "Pianura" } as const;

  const row = (s: SegmentDto) => (
    <li key={s.id}>
      <Link
        href={`/v2/segmenti/${s.id}`}
        onMouseEnter={() => setHover(s.id)}
        onMouseLeave={() => setHover(null)}
        className="flex items-center gap-2 rounded-lg px-2 py-2 text-[13px] hover:bg-[color:var(--hmr-accent-dim)]"
      >
        <span className={`h-6 w-1.5 rounded-full ${s.kind === "descent" ? "bg-sky-500" : "bg-orange-500"}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{s.name}</span>
          <span className="text-[11px] text-[color:var(--hmr-muted)]">
            {KIND_LABEL[s.kind] ?? ""} · {sportLabel(s.sport)} · {formatDistance(s.length_m)} ·{" "}
            {s.kind === "descent" ? `−${Math.round(s.elev_loss_m)} m` : `+${Math.round(s.elev_gain_m)} m`} · {s.avg_grade_pct}%
          </span>
        </span>
      </Link>
    </li>
  );

  const sourceList = (items: Item[], kind: "activity" | "route") =>
    items.length ? (
      <ul className="space-y-0.5">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-2 px-2 py-1.5 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate">
              {it.name || "Senza nome"}
              <span className="text-[11px] text-[color:var(--hmr-muted)]">
                {" "}
                · {sportLabel(it.sport)} · {it.km.toFixed(1)} km
              </span>
            </span>
            <Link href={`/v2/segmenti/nuovo?${kind}=${encodeURIComponent(it.id)}`} className="ui-btn ui-btn-sm">
              Crea
            </Link>
          </li>
        ))}
      </ul>
    ) : (
      <p className="px-2 text-[12px] text-[color:var(--hmr-muted)]">
        {kind === "activity" ? "Nessuna attività: collega Strava o carica GPX/FIT dal profilo." : "Nessun percorso salvato."}
      </p>
    );

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="order-2 min-h-0 flex-1 space-y-5 overflow-y-auto p-4 lg:order-1 lg:w-[400px] lg:flex-none">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Icon name="trophy" size={20} /> Segmenti
          </h1>
          <p className="mt-1 text-[12.5px] text-[color:var(--hmr-muted)]">
            Tratti con classifica: i tuoi passaggi vengono trovati da soli in ogni attività importata. Vince il più
            veloce, ma anche chi ci passa più spesso (Local Legend).
          </p>
        </div>

        <section className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["", "Tutti"],
                ["climb", "Salite"],
                ["descent", "Discese"],
                ["flat", "Pianura"],
              ] as const
            ).map(([k, label]) => (
              <button key={k || "all"} type="button" className="ui-chip" aria-pressed={kindFilter === k} onClick={() => setKindFilter(k)}>
                {label}
              </button>
            ))}
          </div>
          {sportsAvailable.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="ui-chip" aria-pressed={!sportFilter} onClick={() => setSportFilter("")}>
                Ogni sport
              </button>
              {sportsAvailable.map((sp) => (
                <button key={sp} type="button" className="ui-chip" aria-pressed={sportFilter === sp} onClick={() => setSportFilter(sp)}>
                  {sportLabel(sp)}
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section>
          <h2 className="ui-eyebrow mb-1">I miei segmenti</h2>
          {mineShown.length ? (
            <ul>{mineShown.map(row)}</ul>
          ) : (
            <p className="px-2 text-[12px] text-[color:var(--hmr-muted)]">{mine.length ? "Nessuno con questi filtri." : "Ancora nessuno."}</p>
          )}
        </section>

        {areaOnly.length ? (
          <section>
            <h2 className="ui-eyebrow mb-1">In quest&apos;area</h2>
            <ul>{areaOnly.map(row)}</ul>
          </section>
        ) : null}

        <section>
          <h2 className="ui-eyebrow mb-1">Crea da un&apos;attività</h2>
          {sourceList(acts, "activity")}
        </section>
        <section>
          <h2 className="ui-eyebrow mb-1">Crea da un percorso</h2>
          {sourceList(routes, "route")}
        </section>
      </aside>

      <div className="relative order-1 h-[40vh] shrink-0 lg:order-2 lg:h-auto lg:flex-1">
        <V2PlanMap
          waypoints={[]}
          routeCoords={null}
          pois={[]}
          onMapInteraction={() => {}}
          showWaypoints={false}
          fitTo={fit}
          onViewportChange={(b) => setBbox(b)}
          segmentsGeoJson={geo}
          onSegmentSelect={(id) => router.push(`/v2/segmenti/${id}`)}
        />
      </div>
    </div>
  );
}
