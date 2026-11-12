"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import V2PlanMap from "@/components/v2/V2PlanMap";
import V2PhotoCapture from "@/components/v2/V2PhotoCapture";
import V2OutingReportForm from "@/components/v2/V2OutingReportForm";
import V2ConditionsPanel from "@/components/v2/V2ConditionsPanel";
import { OutingStatusBadge } from "@/components/v2/V2OutingList";
import Icon from "@/components/v2/ui/Icon";
import { fetchJson } from "@/lib/fetch-json";
import {
  CONDITION_FIELD_LABELS,
  formatOutingDate,
  OUTING_STOP_KIND_META,
  SNOW_QUALITY_LABELS,
  TRAIL_STATE_LABELS,
  WEATHER_SKY_LABELS,
  WIND_LABELS,
  type OutingConditions,
  type OutingDto,
} from "@/lib/outings-types";
import { outingStopsGeoJson } from "@/lib/use-outing-draft";
import { activityLabel, outingPlanHref, routeEditorHref, SPORTS, type UserRouteActivity } from "@/lib/sports";

type RouteInfo = {
  id: string;
  name: string;
  owner: string;
  activity: UserRouteActivity;
  length_km: number;
  elev_gain_m: number;
  elev_loss_m: number;
  geojson: unknown;
};

type Props = { outingId: string };

/** Tutte le linee del GeoJSON (Feature, FeatureCollection salita/discesa…) concatenate. */
function lineCoords(g: unknown): [number, number][] {
  const out: [number, number][] = [];
  const visit = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (o.type === "FeatureCollection" && Array.isArray(o.features)) o.features.forEach(visit);
    else if (o.type === "Feature") visit(o.geometry);
    else if (o.type === "LineString" && Array.isArray(o.coordinates))
      for (const c of o.coordinates as number[][]) out.push([c[0], c[1]]);
    else if (o.type === "MultiLineString" && Array.isArray(o.coordinates))
      for (const l of o.coordinates as number[][][]) for (const c of l) out.push([c[0], c[1]]);
  };
  visit(g);
  return out;
}

function bbox(coords: [number, number][]): [number, number, number, number] | null {
  if (!coords.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
  }
  return [w, s, e, n];
}

function ConditionsView({ c }: { c: OutingConditions }) {
  const rows: { label: string; value: string; note?: string }[] = [];
  if (c.snow)
    rows.push({
      label: CONDITION_FIELD_LABELS.snow,
      value: [c.snow.quality && SNOW_QUALITY_LABELS[c.snow.quality], c.snow.from_ele_m != null && `da ${c.snow.from_ele_m} m`]
        .filter(Boolean)
        .join(" · "),
      note: c.snow.note,
    });
  if (c.weather)
    rows.push({
      label: CONDITION_FIELD_LABELS.weather,
      value: [c.weather.sky && WEATHER_SKY_LABELS[c.weather.sky], c.weather.wind && `vento ${WIND_LABELS[c.weather.wind].toLowerCase()}`]
        .filter(Boolean)
        .join(" · "),
      note: c.weather.note,
    });
  if (c.access)
    rows.push({
      label: CONDITION_FIELD_LABELS.access,
      value: c.access.ok === true ? "OK" : c.access.ok === false ? "Problemi" : "",
      note: c.access.note,
    });
  if (c.trail)
    rows.push({
      label: CONDITION_FIELD_LABELS.trail,
      value: c.trail.state ? TRAIL_STATE_LABELS[c.trail.state] : "",
      note: c.trail.note,
    });
  return (
    <dl className="space-y-2">
      {c.rating ? (
        <div className="text-lg text-amber-400" aria-label={`${c.rating} su 5`}>
          {"★".repeat(c.rating)}
          <span className="text-[color:var(--hmr-faint)]">{"★".repeat(5 - c.rating)}</span>
        </div>
      ) : null}
      {rows.map((r) => (
        <div key={r.label}>
          <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--hmr-faint)]">{r.label}</dt>
          <dd className="text-[13px]">
            {r.value || "—"}
            {r.note ? <span className="block text-[12px] text-[color:var(--hmr-muted)]">{r.note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function V2OutingDetail({ outingId }: Props) {
  const router = useRouter();
  const [outing, setOuting] = useState<OutingDto | null>(null);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [canAddPhotos, setCanAddPhotos] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await fetchJson<{ outing: OutingDto; route: RouteInfo | null; can_edit: boolean; can_add_photos: boolean }>(
        `/api/v2/outings/${encodeURIComponent(outingId)}`,
      );
      setOuting(d.outing);
      setRoute(d.route);
      setCanEdit(d.can_edit);
      setCanAddPhotos(d.can_add_photos);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [outingId]);

  useEffect(() => {
    void load();
  }, [load]);

  const coords = useMemo(() => (route ? lineCoords(route.geojson) : []), [route]);
  const fit = useMemo(() => {
    const b = bbox([...coords, ...(outing?.stops.map((s) => [s.lng, s.lat] as [number, number]) ?? [])]);
    return b ? { bbox: b, key: 1 } : null;
  }, [coords, outing?.stops]);
  const stopsGeo = useMemo(() => outingStopsGeoJson(outing?.stops ?? []), [outing?.stops]);
  const photosGeo = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: (outing?.photos ?? []).map((p) => ({
        type: "Feature",
        properties: { id: p.id },
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      })),
    }),
    [outing?.photos],
  );

  const remove = async () => {
    setDeleting(true);
    try {
      await fetchJson(`/api/v2/outings/${encodeURIComponent(outingId)}`, { method: "DELETE" });
      router.push("/v2/me");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  };

  if (err && !outing) {
    return <p className="p-4 text-sm text-[color:var(--hmr-danger)]">{err}</p>;
  }
  if (!outing) {
    return <p className="p-4 text-sm text-[color:var(--hmr-muted)]">Carico la gita…</p>;
  }

  const activity = route?.activity ?? outing.activity;
  const sport = SPORTS[activity];
  const first = coords[0];

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="hmr-panel z-10 order-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:order-1 lg:w-[400px] lg:flex-none lg:border-r lg:border-[color:var(--hmr-border)]/60">
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="ui-eyebrow" style={{ color: sport.color }}>
              {activityLabel(activity)} · Gita
            </p>
            <OutingStatusBadge outing={outing} />
          </div>
          <h1 className="mt-1 text-[19px] font-bold tracking-tight">{outing.title}</h1>
          <p className="mt-0.5 text-[12.5px] text-[color:var(--hmr-muted)]">
            {formatOutingDate(outing.outing_date)}
            {outing.start_time ? ` · partenza ${outing.start_time}` : ""}
            {outing.visibility === "public" ? " · pubblica" : " · compagni e gruppi"}
          </p>
          {route ? (
            <p className="mt-1 text-[12.5px]">
              Traccia:{" "}
              <Link href={routeEditorHref(activity, route.id)} className="text-[color:var(--hmr-accent)] hover:underline">
                {route.name}
              </Link>{" "}
              <span className="text-[color:var(--hmr-muted)]">
                · {route.length_km.toFixed(1)} km · {Math.round(route.elev_gain_m)} m D+
              </span>
            </p>
          ) : null}
          {outing.participants.length ? (
            <p className="mt-1 text-[12px] text-[color:var(--hmr-muted)]">
              <Icon name="users" size={13} className="mr-1 inline" />
              {outing.participants.join(", ")}
            </p>
          ) : null}
        </div>

        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {route ? (
              <Link href={outingPlanHref(activity, route.id, outing.id)} className="ui-btn ui-btn-sm">
                <Icon name="route" size={15} />
                Modifica piano
              </Link>
            ) : null}
            {!reporting ? (
              <button type="button" className="ui-btn ui-btn-sm ui-btn-primary" onClick={() => setReporting(true)}>
                <Icon name="flag" size={15} />
                {outing.status === "done" ? "Modifica resoconto" : "Segna come fatta"}
              </button>
            ) : null}
            {confirmDelete ? (
              <>
                <button type="button" disabled={deleting} className="ui-btn ui-btn-sm ui-btn-danger" onClick={() => void remove()}>
                  {deleting ? "Elimino…" : "Conferma eliminazione"}
                </button>
                <button type="button" className="ui-btn ui-btn-sm ui-btn-ghost" onClick={() => setConfirmDelete(false)}>
                  Annulla
                </button>
              </>
            ) : (
              <button type="button" className="ui-btn ui-btn-sm ui-btn-ghost" onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" size={15} />
                Elimina
              </button>
            )}
          </div>
        ) : null}

        {reporting && canEdit ? (
          <section className="ui-card p-3">
            <h2 className="mb-3 text-[14px] font-bold">Resoconto</h2>
            <V2OutingReportForm
              outing={outing}
              activity={activity}
              onCancel={() => setReporting(false)}
              onSaved={(o) => {
                setOuting(o);
                setReporting(false);
              }}
            />
          </section>
        ) : null}

        {outing.status === "done" && !reporting ? (
          <section>
            <h2 className="ui-eyebrow mb-2">Resoconto</h2>
            {outing.conditions ? <ConditionsView c={outing.conditions} /> : null}
            {outing.story ? (
              <p className="mt-3 whitespace-pre-line text-[13.5px] leading-relaxed">{outing.story}</p>
            ) : !outing.conditions ? (
              <p className="text-[12.5px] text-[color:var(--hmr-muted)]">Nessun racconto.</p>
            ) : null}
          </section>
        ) : null}

        {outing.photos.length || canAddPhotos ? (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="ui-eyebrow">Foto</h2>
              {canAddPhotos ? (
                <button type="button" className="ui-btn ui-btn-sm ui-btn-ghost" onClick={() => setPhotoOpen(true)}>
                  <Icon name="camera" size={15} />
                  Aggiungi
                </button>
              ) : null}
            </div>
            {outing.photos.length ? (
              <div className="grid grid-cols-3 gap-1.5">
                {outing.photos.map((p) => (
                  <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.caption || "Foto gita"} className="h-full w-full object-cover" loading="lazy" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-[color:var(--hmr-muted)]">Nessuna foto.</p>
            )}
          </section>
        ) : null}

        <section>
          <h2 className="ui-eyebrow mb-2">Piano</h2>
          {outing.stops.length ? (
            <ol className="space-y-1">
              {outing.stops.map((s, i) => {
                const meta = OUTING_STOP_KIND_META[s.kind];
                const label = s.role === "start" ? "Partenza" : s.role === "end" ? "Arrivo" : meta.label;
                return (
                  <li key={i} className="flex gap-3 py-1">
                    <span className="w-11 shrink-0 text-right text-[12px] font-bold tabular-nums text-[color:var(--hmr-accent)]">
                      {s.role === "start" ? "0" : s.along_km != null ? s.along_km.toFixed(1) : "—"}
                      <span className="ml-0.5 text-[10px] text-[color:var(--hmr-faint)]">km</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold">
                        <span aria-hidden className="mr-1">{s.role === "start" ? "🟢" : s.role === "end" ? "🏁" : meta.icon}</span>
                        {s.name || label}
                      </span>
                      <span className="block text-[11.5px] text-[color:var(--hmr-faint)]">
                        {s.name ? label : ""}
                        {s.note ? `${s.name ? " · " : ""}${s.note}` : ""}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-[12.5px] text-[color:var(--hmr-muted)]">Nessuna sosta pianificata.</p>
          )}
          {outing.notes ? (
            <p className="mt-2 whitespace-pre-line rounded-lg bg-[color:var(--hmr-elev)] p-2.5 text-[12.5px]">{outing.notes}</p>
          ) : null}
        </section>

        {outing.status === "planned" && first ? (
          <section>
            <h2 className="ui-eyebrow mb-2">Condizioni previste</h2>
            <V2ConditionsPanel lat={first[1]} lng={first[0]} activity={activity} compact />
          </section>
        ) : null}

        {err ? <p className="text-[12px] text-[color:var(--hmr-danger)]">{err}</p> : null}
      </aside>

      <div className="relative order-1 h-[42vh] shrink-0 lg:order-2 lg:h-auto lg:flex-1">
        <V2PlanMap
          waypoints={[]}
          routeCoords={coords.length >= 2 ? coords : null}
          pois={[]}
          onMapInteraction={() => {}}
          showWaypoints={false}
          fitTo={fit}
          outingStopsGeoJson={stopsGeo}
          photosGeoJson={photosGeo}
          mapSport={activity}
        />
      </div>

      {photoOpen ? (
        <V2PhotoCapture
          outingId={outing.id}
          initialLng={first?.[0]}
          initialLat={first?.[1]}
          onClose={() => setPhotoOpen(false)}
          onUploaded={() => {
            setPhotoOpen(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
