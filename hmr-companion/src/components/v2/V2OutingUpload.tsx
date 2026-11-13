"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import V2PlanMap from "@/components/v2/V2PlanMap";
import V2SportChips from "@/components/v2/V2SportChips";
import ElevationChart from "@/components/ElevationChart";
import { emptyOutingExtractMeta, type OutingExtractMeta } from "@/lib/outing-extract";
import { parseGpxFile } from "@/lib/gpx-parse";
import { sampleElevationsForLine } from "@/lib/elevation";
import type { StoredCoord } from "@/lib/track-coords";
import { elevationGainLossSmoothed, smoothElevationProfile } from "@/lib/track-geometry";
import {
  buildSkiGeoJson,
  buildRouteMarkersGeoJsonFromTracks,
  SKI_SLOPE_DEFAULT_OPACITY,
  SLOPE_TILES_URL,
} from "@/lib/ski-overlays";
import V2SkiRouteBanner from "@/components/v2/V2SkiRouteBanner";
import type { RouteColoredSegment } from "@/lib/ors-route-tech";
import {
  isUserRouteActivity,
  isWinterSport,
  SPORTS,
  USER_ROUTE_ACTIVITIES,
  type UserRouteActivity,
} from "@/lib/sports";

type Props = { isAdmin?: boolean; username?: string };

type Step = "describe" | "track" | "review";

const STEP_LABELS: Record<Step, string> = { describe: "Racconta", track: "Traccia", review: "Verifica" };

function bboxOf(coords: [number, number][]): [number, number, number, number] | null {
  if (!coords.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
  }
  return [w, s, e, n];
}

/**
 * Aggiungi gita: una gita già fatta, per qualsiasi sport. Racconto (voce o testo) →
 * traccia GPX → verifica. Salva la traccia come percorso riusabile e la gita come uscita fatta.
 */
export default function V2OutingUpload({}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activityParam = searchParams.get("activity");
  const groupParam = searchParams.get("group");

  const [activity, setActivity] = useState<UserRouteActivity>(
    activityParam && isUserRouteActivity(activityParam) ? activityParam : "hike",
  );
  const sport = SPORTS[activity];
  const isSki = sport.skiTourMode;
  const snowy = isWinterSport(activity) || activity === "alpinism";

  const [step, setStep] = useState<Step>("describe");
  const [transcript, setTranscript] = useState("");
  const [recording, setRecording] = useState(false);
  const [extractBusy, setExtractBusy] = useState(false);
  const [meta, setMeta] = useState<OutingExtractMeta | null>(null);
  const [gpxCoords, setGpxCoords] = useState<[number, number][] | null>(null);
  const [profileCoords, setProfileCoords] = useState<StoredCoord[]>([]);
  const [lengthKm, setLengthKm] = useState(0);
  const [elevGainM, setElevGainM] = useState(0);
  const [elevLossM, setElevLossM] = useState(0);
  const [saveBusy, setSaveBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sourceNote, setSourceNote] = useState("");
  const [outingDate, setOutingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [conditionNotes, setConditionNotes] = useState("");
  const [participantsText, setParticipantsText] = useState("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(groupParam ? [groupParam] : []);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [routePublic, setRoutePublic] = useState(true);
  const [fitTo, setFitTo] = useState<{ bbox: [number, number, number, number]; key: number } | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v2/groups");
        const data = (await res.json()) as { groups?: { id: string; name: string }[] };
        if (data.groups) setGroups(data.groups.map((g) => ({ id: g.id, name: g.name })));
      } catch {
        /* opzionale */
      }
    })();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "it-IT";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let text = "";
      for (let i = 0; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript;
      }
      setTranscript(text.trim());
    };
    recognitionRef.current = rec;
  }, []);

  const toggleRecording = () => {
    const rec = recognitionRef.current;
    if (!rec) {
      setErr("Riconoscimento vocale non supportato: scrivi o incolla il testo.");
      return;
    }
    if (recording) {
      rec.stop();
      setRecording(false);
    } else {
      setErr(null);
      rec.start();
      setRecording(true);
    }
  };

  const runExtract = async () => {
    setExtractBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/v2/outings/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, activity }),
      });
      const data = (await res.json()) as { error?: string; meta?: OutingExtractMeta };
      if (!res.ok || !data.meta) throw new Error(data.error ?? "Estrazione fallita");
      setMeta(data.meta);
      setStep("track");
    } catch (e) {
      setErr(`${e instanceof Error ? e.message : String(e)}. Puoi continuare senza: compilerai i dati a mano.`);
    } finally {
      setExtractBusy(false);
    }
  };

  /** Senza AI: si passa alla traccia e i dati si compilano nella verifica. */
  const skipExtract = () => {
    setErr(null);
    setMeta(emptyOutingExtractMeta());
    setStep("track");
  };

  const onGpxFile = async (file: File) => {
    setErr(null);
    try {
      const parsed = await parseGpxFile(file);
      if (parsed.coordinates.length < 2) throw new Error("GPX senza traccia valida");
      setGpxCoords(parsed.coordinates);
      setLengthKm(parsed.length_km);
      const bb = bboxOf(parsed.coordinates);
      if (bb) setFitTo({ bbox: bb, key: Date.now() });
      if (parsed.date) setOutingDate(parsed.date);
      if (parsed.name) setMeta((m) => (m && !m.name ? { ...m, name: parsed.name as string } : m));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    if (!gpxCoords || gpxCoords.length < 2) {
      setProfileCoords([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const positions = gpxCoords.map((c) => [c[0], c[1]] as [number, number]);
      const { distanceKm, elevationM, sampled, available } = await sampleElevationsForLine(positions);
      if (cancelled || !available) return;
      const { gain, loss } = elevationGainLossSmoothed(elevationM);
      setElevGainM(gain);
      setElevLossM(loss);
      const displayWindow = Math.max(3, Math.min(7, Math.round(elevationM.length / 20)));
      const smoothed = smoothElevationProfile(elevationM, displayWindow);
      setProfileCoords(
        sampled.map((p, i) => [p[0], p[1], smoothed[i] ?? null, distanceKm[i] ?? 0] as StoredCoord),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [gpxCoords]);

  const routeColoredSegments = useMemo((): RouteColoredSegment[] | null => {
    if (!gpxCoords || gpxCoords.length < 2) return null;
    return [{ coordinates: gpxCoords, color: sport.color, surface: "unknown" }];
  }, [gpxCoords, sport.color]);

  const routeMarkersGeoJson = useMemo(() => buildRouteMarkersGeoJsonFromTracks(gpxCoords, null), [gpxCoords]);

  const fallbackName = `Gita ${sport.label.toLowerCase()}`;

  const save = async () => {
    if (!gpxCoords?.length || !meta) return;
    setSaveBusy(true);
    setErr(null);
    try {
      const geojson = isSki
        ? buildSkiGeoJson(gpxCoords, null)
        : { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: gpxCoords } };
      const res = await fetch("/api/v2/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: meta.name || `Traccia ${sport.label.toLowerCase()}`,
          activity,
          visibility: routePublic ? "public" : "private",
          length_km: lengthKm,
          elev_gain_m: meta.elev_gain_m ?? elevGainM,
          elev_loss_m: meta.elev_loss_m ?? elevLossM,
          waypoints: isSki ? { ascent: [], descent: [] } : [],
          geojson,
          source: sourceNote.toLowerCase().includes("gulliver") ? "gulliver" : "user",
          source_url: sourceNote.startsWith("http") ? sourceNote : null,
          license: null,
          meta_json: {
            zone: meta.zone,
            difficulty: meta.difficulty,
            exposition: meta.exposition,
            elevation_max_m: meta.elevation_max_m,
            notes: meta.notes,
            transcript,
          },
        }),
      });
      const data = (await res.json()) as { error?: string; id?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Salvataggio traccia fallito");

      // Gita fatta: il racconto è la descrizione (voce/testo); le note sulle condizioni vanno nel resoconto.
      const participants = participantsText
        .split(/[,;\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const note = (conditionNotes || meta.notes || "").trim();
      const outingRes = await fetch("/api/v2/outings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route_id: data.id,
          title: meta.name || fallbackName,
          outing_date: outingDate || null,
          status: "done",
          story: transcript.trim(),
          conditions: note ? (snowy ? { snow: { note } } : { trail: { note } }) : undefined,
          participants,
          group_ids: selectedGroupIds,
        }),
      });
      const outingData = (await outingRes.json()) as { error?: string; id?: string };
      if (!outingRes.ok || !outingData.id) throw new Error(outingData.error ?? "Registrazione gita fallita");

      // Nel dettaglio si completano condizioni e foto.
      router.push(`/v2/gite/${encodeURIComponent(outingData.id)}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const inputCls = "mt-0.5 w-full rounded border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] px-2 py-1";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="hmr-panel z-10 flex max-h-[55vh] shrink-0 flex-col gap-3 overflow-y-auto border-b border-[color:var(--hmr-border)]/60 p-3 lg:max-h-none lg:w-96 lg:border-b-0 lg:border-r">
          <div>
            <Link href={sport.plannerPath} className="text-xs text-[color:var(--hmr-muted)] hover:underline">
              ← Pianifica
            </Link>
            <h1 className="mt-1 text-base font-semibold">Aggiungi gita</h1>
            <p className="text-xs text-[color:var(--hmr-muted)]">
              Una gita già fatta: raccontala (voce o testo), carica il GPX, verifica e salva. Per una gita futura usa
              Pianifica → scheda Gita.
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-[color:var(--hmr-faint)]">Sport</p>
            <V2SportChips value={activity} onChange={setActivity} options={USER_ROUTE_ACTIVITIES} skiAsOption />
          </div>

          <div className="flex gap-1 text-[10px] uppercase tracking-wide">
            {(["describe", "track", "review"] as Step[]).map((s, i) => (
              <span
                key={s}
                className={
                  step === s
                    ? "rounded bg-[color:var(--hmr-accent)] px-2 py-0.5 text-[color:var(--hmr-bg)]"
                    : "rounded border border-[color:var(--hmr-border)] px-2 py-0.5 text-[color:var(--hmr-muted)]"
                }
              >
                {i + 1}. {STEP_LABELS[s]}
              </span>
            ))}
          </div>

          {step === "describe" ? (
            <>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={6}
                placeholder={
                  isSki
                    ? "Es: Gita al Pizzo Coppetto da Madesimo, PD+, 900 m D+, esposizione nord, neve polverosa…"
                    : "Es: Anello del Monte Legnone da Roccoli Lorla, 1300 m D+, sentiero buono, acqua al rifugio…"
                }
                className="w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] p-2 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={toggleRecording}
                  className={`rounded-lg px-3 py-1.5 text-xs ${recording ? "bg-red-500/90 text-white" : "border border-[color:var(--hmr-border)]"}`}
                >
                  {recording ? "Stop registrazione" : "Registra voce"}
                </button>
                <button
                  type="button"
                  disabled={extractBusy || transcript.length < 10}
                  onClick={() => void runExtract()}
                  className="rounded-lg bg-[color:var(--hmr-accent)] px-3 py-1.5 text-xs font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
                >
                  {extractBusy ? "Analizzo…" : "Estrai info con AI"}
                </button>
                <button
                  type="button"
                  onClick={skipExtract}
                  className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs text-[color:var(--hmr-muted)]"
                >
                  Continua senza AI
                </button>
              </div>
            </>
          ) : null}

          {step === "track" && meta ? (
            <>
              <p className="text-xs text-[color:var(--hmr-muted)]">
                Carica il file GPX della gita (orologio, telefono, Gulliver, OsmAnd…).
              </p>
              <input
                type="file"
                accept=".gpx,application/gpx+xml"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onGpxFile(f);
                }}
                className="text-xs"
              />
              <input
                type="text"
                value={sourceNote}
                onChange={(e) => setSourceNote(e.target.value)}
                placeholder="Fonte opzionale (URL…)"
                className="w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] px-2 py-1.5 text-xs"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep("describe")}
                  className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs"
                >
                  ← Racconto
                </button>
                {gpxCoords ? (
                  <button
                    type="button"
                    onClick={() => setStep("review")}
                    className="rounded-lg bg-[color:var(--hmr-accent)] px-3 py-1.5 text-xs font-medium text-[color:var(--hmr-bg)]"
                  >
                    Avanti → verifica
                  </button>
                ) : null}
              </div>
            </>
          ) : null}

          {step === "review" && meta ? (
            <div className="space-y-2 text-sm">
              <label className="block text-xs">
                Nome
                <input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder={fallbackName} className={inputCls} />
              </label>
              <label className="block text-xs">
                Zona
                <input value={meta.zone} onChange={(e) => setMeta({ ...meta, zone: e.target.value })} className={inputCls} />
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label>
                  D+ (m)
                  <input
                    type="number"
                    value={meta.elev_gain_m ?? Math.round(elevGainM)}
                    onChange={(e) => setMeta({ ...meta, elev_gain_m: Number(e.target.value) || null })}
                    className={inputCls}
                  />
                </label>
                <label>
                  Difficoltà{sport.difficultyScale !== "—" ? ` (${sport.difficultyScale})` : ""}
                  <input
                    value={meta.difficulty ?? ""}
                    onChange={(e) => setMeta({ ...meta, difficulty: e.target.value || null })}
                    className={inputCls}
                  />
                </label>
                {snowy ? (
                  <label>
                    Esposizione
                    <input
                      value={meta.exposition ?? ""}
                      onChange={(e) => setMeta({ ...meta, exposition: e.target.value || null })}
                      className={inputCls}
                    />
                  </label>
                ) : null}
                <label>
                  Quota max
                  <input
                    type="number"
                    value={meta.elevation_max_m ?? ""}
                    onChange={(e) => setMeta({ ...meta, elevation_max_m: Number(e.target.value) || null })}
                    className={inputCls}
                  />
                </label>
              </div>
              <label className="block text-xs">
                Note sulla traccia
                <textarea
                  value={meta.notes ?? ""}
                  onChange={(e) => setMeta({ ...meta, notes: e.target.value || null })}
                  rows={3}
                  className={inputCls}
                />
              </label>
              <p className="text-[10px] text-[color:var(--hmr-muted)]">
                {lengthKm.toFixed(1)} km di traccia · D+ dal profilo {Math.round(elevGainM)} m
              </p>
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input type="checkbox" checked={routePublic} onChange={(e) => setRoutePublic(e.target.checked)} />
                Traccia pubblica: gli altri possono riusarla per le loro gite
              </label>

              <p className="pt-1 text-[10px] font-medium uppercase tracking-wide text-[color:var(--hmr-faint)]">La tua gita</p>
              <p className="text-[10px] text-[color:var(--hmr-muted)]">
                La traccia diventa un percorso riusabile; la gita (data, compagni, racconto) resta visibile a te, ai compagni
                e ai gruppi scelti. Dopo il salvataggio puoi aggiungere condizioni e foto.
              </p>
              <div className="space-y-2 rounded-lg border border-[color:var(--hmr-border)]/70 bg-[color:var(--hmr-elev)] p-2">
                <input
                  type="date"
                  value={outingDate}
                  onChange={(e) => setOutingDate(e.target.value)}
                  aria-label="Data della gita"
                  className="w-full rounded border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] px-2 py-1 text-xs"
                />
                <textarea
                  value={conditionNotes}
                  onChange={(e) => setConditionNotes(e.target.value)}
                  rows={2}
                  placeholder={snowy ? "Condizioni neve…" : "Condizioni del sentiero / fondo…"}
                  className="w-full rounded border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] px-2 py-1 text-xs"
                />
                <input
                  type="text"
                  value={participantsText}
                  onChange={(e) => setParticipantsText(e.target.value)}
                  placeholder="Compagni (username, virgola)"
                  className="w-full rounded border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] px-2 py-1 text-xs"
                />
                {groups.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {groups.map((g) => {
                      const on = selectedGroupIds.includes(g.id);
                      return (
                        <button
                          key={g.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setSelectedGroupIds((ids) => (on ? ids.filter((id) => id !== g.id) : [...ids, g.id]))}
                          className={
                            on
                              ? "rounded bg-[color:var(--hmr-accent)] px-2 py-0.5 text-[10px] text-[color:var(--hmr-bg)]"
                              : "rounded border border-[color:var(--hmr-border)] px-2 py-0.5 text-[10px]"
                          }
                        >
                          {g.name}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep("track")}
                  className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-2 text-xs"
                >
                  ← Traccia
                </button>
                <button
                  type="button"
                  disabled={saveBusy || !gpxCoords}
                  onClick={() => void save()}
                  className="flex-1 rounded-lg bg-[color:var(--hmr-accent)] py-2 text-sm font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
                >
                  {saveBusy ? "Salvo…" : "Salva traccia e gita"}
                </button>
              </div>
            </div>
          ) : null}

          {err ? <p className="text-xs text-[color:var(--hmr-danger)]">{err}</p> : null}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-[40vh] flex-1">
            <V2PlanMap
              waypoints={[]}
              routeCoords={null}
              routeColoredSegments={routeColoredSegments}
              routeMarkersGeoJson={routeMarkersGeoJson}
              pois={[]}
              onMapInteraction={() => {}}
              showWaypoints={false}
              fitTo={fitTo}
              mapSport={activity}
              slopeVisible={isSki && Boolean(SLOPE_TILES_URL)}
              slopeOpacity={SKI_SLOPE_DEFAULT_OPACITY}
              terrain3d={isSki}
            />
            {step === "review" && meta && gpxCoords ? (
              <V2SkiRouteBanner
                name={meta.name || fallbackName}
                lengthKm={lengthKm}
                elevGainM={meta.elev_gain_m ?? elevGainM}
                elevLossM={meta.elev_loss_m ?? elevLossM}
              />
            ) : null}
          </div>
          {profileCoords.length >= 2 ? (
            <div className="shrink-0 border-t border-[color:var(--hmr-border)]/60 p-2">
              <ElevationChart coords={profileCoords} sections={[]} checkpoints={[]} atKm={null} hoverKm={null} onHoverKm={() => {}} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Web Speech API types (browser)
interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
}
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  length: number;
  [i: number]: { [j: number]: { transcript: string } };
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}
