"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { nearestPointOnPolyline } from "@/lib/track-geometry";
import type { OutingDto, OutingStopDto, OutingStopKind, OutingVisibility } from "@/lib/outings-types";

export type OutingDraft = {
  id: string | null;
  title: string;
  outing_date: string;
  start_time: string;
  notes: string;
  visibility: OutingVisibility;
  participants: string[];
  group_ids: string[];
  stops: OutingStopDto[];
};

export function emptyOutingDraft(): OutingDraft {
  return {
    id: null,
    title: "",
    outing_date: "",
    start_time: "",
    notes: "",
    visibility: "participants",
    participants: [],
    group_ids: [],
    stops: [],
  };
}

function draftFromDto(o: OutingDto): OutingDraft {
  return {
    id: o.id,
    title: o.title,
    outing_date: o.outing_date ?? "",
    start_time: o.start_time ?? "",
    notes: o.notes,
    visibility: o.visibility,
    participants: o.participants,
    group_ids: o.group_ids,
    stops: o.stops,
  };
}

/** Distanza oltre la quale un punto non è più "sul percorso" (km). */
const OFF_ROUTE_KM = 1.5;

/**
 * Stato della gita in pianificazione: partenza/arrivo seguono la traccia
 * finché l'utente non li rinomina o sposta; le soste sono ordinate per km.
 */
export function useOutingDraft(
  routeCoords: [number, number][] | null,
  outingId: string | null,
  /** Gruppo preselezionato per una gita nuova (es. creata dalla pagina del gruppo). */
  initialGroupId: string | null = null,
) {
  const [draft, setDraft] = useState<OutingDraft>(() => ({
    ...emptyOutingDraft(),
    group_ids: initialGroupId ? [initialGroupId] : [],
  }));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Partenza/arrivo personalizzati dall'utente: non più agganciati agli estremi della traccia. */
  const pinnedRef = useRef<{ start: boolean; end: boolean }>({ start: false, end: false });

  useEffect(() => {
    if (!outingId) return;
    let cancelled = false;
    setLoading(true);
    fetchJson<{ outing: OutingDto }>(`/api/v2/outings/${encodeURIComponent(outingId)}`)
      .then((d) => {
        if (cancelled) return;
        const next = draftFromDto(d.outing);
        pinnedRef.current = {
          start: next.stops.some((s) => s.role === "start" && s.name),
          end: next.stops.some((s) => s.role === "end" && s.name),
        };
        setDraft(next);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [outingId]);

  const alongKm = useCallback(
    (lng: number, lat: number): { km: number | null; offRoute: boolean } => {
      if (!routeCoords || routeCoords.length < 2) return { km: null, offRoute: false };
      const hit = nearestPointOnPolyline(routeCoords, [lng, lat]);
      if (!hit) return { km: null, offRoute: false };
      return { km: Math.round(hit.alongKm * 100) / 100, offRoute: hit.distKm > OFF_ROUTE_KM };
    },
    [routeCoords],
  );

  // Partenza/arrivo agganciati agli estremi della traccia (se non personalizzati).
  useEffect(() => {
    if (!routeCoords || routeCoords.length < 2) return;
    const first = routeCoords[0];
    const last = routeCoords[routeCoords.length - 1];
    setDraft((d) => {
      let stops = d.stops;
      const upsert = (role: "start" | "end", c: [number, number]) => {
        if (pinnedRef.current[role]) return;
        const i = stops.findIndex((s) => s.role === role);
        const base: OutingStopDto =
          i >= 0
            ? stops[i]
            : { role, kind: "parking", name: "", lng: c[0], lat: c[1], along_km: null, ref: null, note: "" };
        if (i >= 0 && base.lng === c[0] && base.lat === c[1]) return;
        const next = { ...base, lng: c[0], lat: c[1], along_km: role === "start" ? 0 : null };
        stops = i >= 0 ? stops.map((s, j) => (j === i ? next : s)) : [...stops, next];
      };
      upsert("start", first);
      upsert("end", last);
      return stops === d.stops ? d : { ...d, stops: sortStops(stops) };
    });
  }, [routeCoords]);

  // Ricalcola i km delle soste quando cambia la traccia.
  useEffect(() => {
    setDraft((d) => {
      let changed = false;
      const stops = d.stops.map((s) => {
        if (s.role !== "stop") return s;
        const { km } = alongKm(s.lng, s.lat);
        if (km === s.along_km) return s;
        changed = true;
        return { ...s, along_km: km };
      });
      return changed ? { ...d, stops: sortStops(stops) } : d;
    });
  }, [alongKm]);

  const patch = useCallback((p: Partial<OutingDraft>) => setDraft((d) => ({ ...d, ...p })), []);

  const addStop = useCallback(
    (s: { kind: OutingStopKind; name: string; lng: number; lat: number; ref?: string | null; overnight?: boolean }) => {
      const { km, offRoute } = alongKm(s.lng, s.lat);
      setDraft((d) => {
        if (s.ref && d.stops.some((x) => x.ref === s.ref)) return d;
        const stop: OutingStopDto = {
          role: "stop",
          kind: s.kind,
          name: s.name,
          lng: s.lng,
          lat: s.lat,
          along_km: km,
          ref: s.ref ?? null,
          note: offRoute ? "Fuori traccia" : "",
          overnight: s.overnight === true,
        };
        return { ...d, stops: sortStops([...d.stops, stop]) };
      });
    },
    [alongKm],
  );

  const updateStop = useCallback((index: number, p: Partial<OutingStopDto>) => {
    setDraft((d) => {
      const s = d.stops[index];
      if (!s) return d;
      if (s.role !== "stop" && (p.name !== undefined || p.lng !== undefined)) pinnedRef.current[s.role] = true;
      return { ...d, stops: d.stops.map((x, i) => (i === index ? { ...x, ...p } : x)) };
    });
  }, []);

  const removeStop = useCallback((index: number) => {
    setDraft((d) => ({ ...d, stops: d.stops.filter((_, i) => i !== index) }));
  }, []);

  /** Salva (crea o aggiorna) la gita in programma sul percorso indicato. */
  const save = useCallback(
    async (routeId: string, fallbackTitle: string): Promise<string> => {
      setSaving(true);
      setError(null);
      try {
        const body = {
          title: draft.title.trim() || fallbackTitle,
          outing_date: draft.outing_date || null,
          start_time: draft.start_time || null,
          notes: draft.notes,
          visibility: draft.visibility,
          participants: draft.participants,
          group_ids: draft.group_ids,
          stops: draft.stops,
        };
        const data = draft.id
          ? await fetchJson<{ outing: OutingDto }>(`/api/v2/outings/${encodeURIComponent(draft.id)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })
          : await fetchJson<{ outing: OutingDto }>("/api/v2/outings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...body, route_id: routeId, status: "planned" }),
            });
        setDraft(draftFromDto(data.outing));
        return data.outing.id;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [draft],
  );

  const stopsGeoJson = useMemo(() => outingStopsGeoJson(draft.stops), [draft.stops]);

  return { draft, patch, addStop, updateStop, removeStop, save, loading, saving, error, stopsGeoJson };
}

export type OutingDraftApi = ReturnType<typeof useOutingDraft>;

function sortStops(stops: OutingStopDto[]): OutingStopDto[] {
  const start = stops.filter((s) => s.role === "start").slice(0, 1);
  const end = stops.filter((s) => s.role === "end").slice(0, 1);
  const mid = stops
    .filter((s) => s.role === "stop")
    .sort((a, b) => (a.along_km ?? Infinity) - (b.along_km ?? Infinity));
  return [...start, ...mid, ...end];
}

export function outingStopsGeoJson(stops: OutingStopDto[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: stops.map((s, i) => ({
      type: "Feature",
      properties: { index: i, role: s.role, kind: s.kind, name: s.name, overnight: s.overnight === true },
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    })),
  };
}
