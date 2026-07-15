"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import V2Nav from "@/components/v2/V2Nav";
import V2PlanMap from "@/components/v2/V2PlanMap";
import ElevationChart from "@/components/ElevationChart";
import type { SkiExtractMeta } from "@/app/api/v2/ski/extract/route";
import { parseGpxFile } from "@/lib/gpx-parse";
import { sampleElevationsForLine } from "@/lib/elevation";
import type { StoredCoord } from "@/lib/track-coords";
import { elevationGainLossSmoothed, smoothElevationProfile } from "@/lib/track-geometry";
import {
  buildSkiGeoJson,
  buildRouteMarkersGeoJsonFromTracks,
  SKI_SLOPE_DEFAULT_OPACITY,
  SKI_TRACK_COLORS,
  SLOPE_TILES_URL,
} from "@/lib/ski-overlays";
import V2SkiRouteBanner from "@/components/v2/V2SkiRouteBanner";
import type { RouteColoredSegment } from "@/lib/ors-route-tech";

type Props = { isAdmin?: boolean; username?: string };

type Step = "describe" | "track" | "review";

export default function V2SkiUpload({ isAdmin = false, username }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("describe");
  const [transcript, setTranscript] = useState("");
  const [recording, setRecording] = useState(false);
  const [extractBusy, setExtractBusy] = useState(false);
  const [meta, setMeta] = useState<SkiExtractMeta | null>(null);
  const [gpxCoords, setGpxCoords] = useState<[number, number][] | null>(null);
  const [profileCoords, setProfileCoords] = useState<StoredCoord[]>([]);
  const [lengthKm, setLengthKm] = useState(0);
  const [elevGainM, setElevGainM] = useState(0);
  const [elevLossM, setElevLossM] = useState(0);
  const [saveBusy, setSaveBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sourceNote, setSourceNote] = useState("");
  const [registerOuting, setRegisterOuting] = useState(true);
  const [outingDate, setOutingDate] = useState("");
  const [snowNotes, setSnowNotes] = useState("");
  const [participantsText, setParticipantsText] = useState("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);

  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v2/groups");
        const data = (await res.json()) as { groups?: { id: string; name: string }[] };
        if (data.groups) setGroups(data.groups.map((g) => ({ id: g.id, name: g.name })));
      } catch {
        /* optional */
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
      setErr("Riconoscimento vocale non supportato — scrivi o incolla il testo.");
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
      const res = await fetch("/api/v2/ski/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const data = (await res.json()) as { error?: string; meta?: SkiExtractMeta };
      if (!res.ok || !data.meta) throw new Error(data.error ?? "Estrazione fallita");
      setMeta(data.meta);
      setStep("track");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExtractBusy(false);
    }
  };

  const onGpxFile = async (file: File) => {
    setErr(null);
    try {
      const parsed = await parseGpxFile(file);
      if (parsed.coordinates.length < 2) throw new Error("GPX senza traccia valida");
      setGpxCoords(parsed.coordinates);
      setLengthKm(parsed.length_km);
      if (parsed.name && meta && !meta.name) {
        setMeta({ ...meta, name: parsed.name });
      }
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
      const { distanceKm, elevationM, sampled } = await sampleElevationsForLine(positions);
      if (cancelled) return;
      const { gain, loss } = elevationGainLossSmoothed(elevationM);
      setElevGainM(gain);
      setElevLossM(loss);
      const displayWindow = Math.max(3, Math.min(7, Math.round(elevationM.length / 20)));
      const smoothed = smoothElevationProfile(elevationM, displayWindow);
      setProfileCoords(
        sampled.map(
          (p, i) => [p[0], p[1], smoothed[i] ?? null, distanceKm[i] ?? 0] as StoredCoord,
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [gpxCoords]);

  const routeColoredSegments = useMemo((): RouteColoredSegment[] | null => {
    if (!gpxCoords || gpxCoords.length < 2) return null;
    return [{ coordinates: gpxCoords, color: SKI_TRACK_COLORS.ascent, surface: "unknown" }];
  }, [gpxCoords]);

  const routeMarkersGeoJson = useMemo(() => {
    return buildRouteMarkersGeoJsonFromTracks(gpxCoords, null);
  }, [gpxCoords]);

  const saveRoute = async () => {
    if (!gpxCoords?.length || !meta) return;
    setSaveBusy(true);
    setErr(null);
    try {
      const geojson = buildSkiGeoJson(gpxCoords, null);
      const res = await fetch("/api/v2/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: meta.name || "Percorso scialpinismo",
          activity: "ski",
          visibility: "public",
          length_km: lengthKm,
          elev_gain_m: meta.elev_gain_m ?? elevGainM,
          elev_loss_m: meta.elev_loss_m ?? elevLossM,
          waypoints: { ascent: [], descent: [] },
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
      if (!res.ok || !data.id) throw new Error(data.error ?? "Salvataggio fallito");

      if (registerOuting) {
        const participants = participantsText
          .split(/[,;\s]+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        const outingRes = await fetch("/api/v2/ski/outings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            route_id: data.id,
            title: meta.name || "Gita scialpinismo",
            outing_date: outingDate || null,
            snow_notes: snowNotes || meta.notes || "",
            participants,
            group_ids: selectedGroupIds,
            make_route_public: true,
          }),
        });
        const outingData = (await outingRes.json()) as { error?: string };
        if (!outingRes.ok) throw new Error(outingData.error ?? "Registrazione gita fallita");
      }

      router.push("/v2/scialpinismo/esplora");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <V2Nav isAdmin={isAdmin} username={username} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="hmr-panel z-10 flex max-h-[50vh] shrink-0 flex-col gap-3 overflow-y-auto border-b border-[color:var(--hmr-border)]/60 p-3 lg:max-h-none lg:w-96 lg:border-b-0 lg:border-r">
          <div>
            <Link href="/v2/scialpinismo" className="text-xs text-[color:var(--hmr-muted)] hover:underline">
              ← Scialpinismo
            </Link>
            <h1 className="mt-1 text-base font-semibold">Carica gita</h1>
            <p className="text-xs text-[color:var(--hmr-muted)]">
              Descrivi la gita (voce o testo) → carica GPX → verifica → salva.
            </p>
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
                {i + 1}. {s === "describe" ? "Descrivi" : s === "track" ? "Traccia" : "Verifica"}
              </span>
            ))}
          </div>

          {step === "describe" ? (
            <>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={6}
                placeholder="Es: Gita al Pizzo Coppetto da Madesimo, PD+, 900m D+, esposizione nord, neve polverosa..."
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
              </div>
            </>
          ) : null}

          {step === "track" && meta ? (
            <>
              <p className="text-xs text-[color:var(--hmr-muted)]">
                Carica il file GPX (da Gulliver, OsmAnd, telefono…).
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
                placeholder="Fonte opzionale (URL Gulliver…)"
                className="w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] px-2 py-1.5 text-xs"
              />
              {gpxCoords ? (
                <button
                  type="button"
                  onClick={() => setStep("review")}
                  className="rounded-lg bg-[color:var(--hmr-accent)] px-3 py-1.5 text-xs font-medium text-[color:var(--hmr-bg)]"
                >
                  Avanti → verifica
                </button>
              ) : null}
            </>
          ) : null}

          {step === "review" && meta ? (
            <div className="space-y-2 text-sm">
              <label className="block text-xs">
                Nome
                <input
                  value={meta.name}
                  onChange={(e) => setMeta({ ...meta, name: e.target.value })}
                  className="mt-0.5 w-full rounded border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] px-2 py-1"
                />
              </label>
              <label className="block text-xs">
                Zona
                <input
                  value={meta.zone}
                  onChange={(e) => setMeta({ ...meta, zone: e.target.value })}
                  className="mt-0.5 w-full rounded border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] px-2 py-1"
                />
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label>
                  D+ (m)
                  <input
                    type="number"
                    value={meta.elev_gain_m ?? elevGainM}
                    onChange={(e) =>
                      setMeta({ ...meta, elev_gain_m: Number(e.target.value) || null })
                    }
                    className="mt-0.5 w-full rounded border px-2 py-1"
                  />
                </label>
                <label>
                  Difficoltà
                  <input
                    value={meta.difficulty ?? ""}
                    onChange={(e) => setMeta({ ...meta, difficulty: e.target.value || null })}
                    className="mt-0.5 w-full rounded border px-2 py-1"
                  />
                </label>
                <label>
                  Esposizione
                  <input
                    value={meta.exposition ?? ""}
                    onChange={(e) => setMeta({ ...meta, exposition: e.target.value || null })}
                    className="mt-0.5 w-full rounded border px-2 py-1"
                  />
                </label>
                <label>
                  Quota max
                  <input
                    type="number"
                    value={meta.elevation_max_m ?? ""}
                    onChange={(e) =>
                      setMeta({ ...meta, elevation_max_m: Number(e.target.value) || null })
                    }
                    className="mt-0.5 w-full rounded border px-2 py-1"
                  />
                </label>
              </div>
              <label className="block text-xs">
                Note
                <textarea
                  value={meta.notes ?? ""}
                  onChange={(e) => setMeta({ ...meta, notes: e.target.value || null })}
                  rows={3}
                  className="mt-0.5 w-full rounded border px-2 py-1"
                />
              </label>
              <p className="text-[10px] text-[color:var(--hmr-muted)]">
                {lengthKm.toFixed(1)} km traccia · D+ profilo {Math.round(elevGainM)} m
              </p>

              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={registerOuting}
                  onChange={(e) => setRegisterOuting(e.target.checked)}
                />
                Registra gita (percorso sempre pubblico)
              </label>
              {registerOuting ? (
                <div className="space-y-2 rounded-lg border border-[color:var(--hmr-border)]/70 bg-[color:var(--hmr-elev)] p-2">
                  <input
                    type="date"
                    value={outingDate}
                    onChange={(e) => setOutingDate(e.target.value)}
                    className="w-full rounded border px-2 py-1 text-xs"
                  />
                  <textarea
                    value={snowNotes}
                    onChange={(e) => setSnowNotes(e.target.value)}
                    rows={2}
                    placeholder="Condizioni neve…"
                    className="w-full rounded border px-2 py-1 text-xs"
                  />
                  <input
                    type="text"
                    value={participantsText}
                    onChange={(e) => setParticipantsText(e.target.value)}
                    placeholder="Compagni (username, virgola)"
                    className="w-full rounded border px-2 py-1 text-xs"
                  />
                  {groups.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {groups.map((g) => {
                        const on = selectedGroupIds.includes(g.id);
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() =>
                              setSelectedGroupIds((ids) =>
                                on ? ids.filter((id) => id !== g.id) : [...ids, g.id],
                              )
                            }
                            className={
                              on
                                ? "rounded bg-[color:var(--hmr-accent)] px-2 py-0.5 text-[10px] text-[color:var(--hmr-bg)]"
                                : "rounded border px-2 py-0.5 text-[10px]"
                            }
                          >
                            {g.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <button
                type="button"
                disabled={saveBusy || !gpxCoords}
                onClick={() => void saveRoute()}
                className="w-full rounded-lg bg-[color:var(--hmr-accent)] py-2 text-sm font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
              >
                {saveBusy ? "Salvo…" : "Salva gita"}
              </button>
            </div>
          ) : null}

          {err ? <p className="text-xs text-red-400">{err}</p> : null}
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
              slopeVisible={Boolean(SLOPE_TILES_URL)}
              slopeOpacity={SKI_SLOPE_DEFAULT_OPACITY}
            />
            {step === "review" && meta && gpxCoords ? (
              <V2SkiRouteBanner
                name={meta.name}
                lengthKm={lengthKm}
                elevGainM={meta.elev_gain_m ?? elevGainM}
                elevLossM={meta.elev_loss_m ?? elevLossM}
              />
            ) : null}
          </div>
          {profileCoords.length >= 2 ? (
            <div className="shrink-0 border-t p-2">
              <ElevationChart
                coords={profileCoords}
                sections={[]}
                checkpoints={[]}
                atKm={null}
                hoverKm={null}
                onHoverKm={() => {}}
              />
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
