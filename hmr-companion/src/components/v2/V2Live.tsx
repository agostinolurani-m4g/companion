"use client";

import maplibregl, { type Map as MaplibreMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/v2/ui/Icon";
import {
  aroundMe,
  buildCourse,
  CHAT_RADIUS_M,
  createSim,
  initials,
  matchesFilter,
  ME_ID,
  NEARBY_RADIUS_M,
  positionAt,
  sendMyMessage,
  step,
  visibleChat,
  type CircleFilter,
  type Course,
  type CoursePoint,
  type RelativeRider,
  type SimState,
} from "@/lib/live/sim";
import { applyRelief, OPEN_FREE_MAP_STYLE } from "@/lib/map/topo-style";

type Props = { me: string; friends: string[]; trackId: string; startKm: number };
type GroupDto = { name: string; members: { username: string }[] };

const TICK_MS = 250;
const SPRINT_W = 160;
const SPRINT_S = 15;

function fmtGap(r: RelativeRider): string {
  const m = Math.abs(r.gapM);
  const dist = m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
  const s = Math.abs(r.gapS);
  const time = s < 60 ? `${Math.round(s)}″` : `${Math.floor(s / 60)}′${String(Math.round(s % 60)).padStart(2, "0")}″`;
  return `${dist} · ${time}`;
}

function avatarEl(name: string, color: string, isMe: boolean): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = initials(name);
  el.title = name;
  el.style.cssText = [
    `width:${isMe ? 30 : 24}px`,
    `height:${isMe ? 30 : 24}px`,
    "border-radius:999px",
    `background:${color}`,
    "color:#fff",
    `font:700 ${isMe ? 11 : 10}px/1 system-ui,sans-serif`,
    "display:flex",
    "align-items:center",
    "justify-content:center",
    `border:2px solid ${isMe ? "#facc15" : "#fff"}`,
    "box-shadow:0 1px 4px rgba(0,0,0,.35)",
    "transition:opacity .3s",
  ].join(";");
  return el;
}

/** "Zwift su strada", simulato: rider virtuali sulla traccia vera, chat solo tra vicini. */
export default function V2Live({ me, friends, trackId, startKm }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markersRef = useRef(new Map<string, Marker>());
  const simRef = useRef<SimState | null>(null);
  const courseRef = useRef<Course | null>(null);
  const sprintUntil = useRef(0);

  const [error, setError] = useState<string | null>(null);
  const [trackName, setTrackName] = useState("");
  const [groups, setGroups] = useState<GroupDto[] | null>(null);
  /** Fotografia immutabile della simulazione per il render (la sim vera vive nel ref e muta a ogni tick). */
  const [view, setView] = useState<{ sim: SimState; course: Course; sprinting: boolean } | null>(null);
  const [watts, setWatts] = useState(190);
  const [speedup, setSpeedup] = useState(1);
  const [running, setRunning] = useState(true);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState<CircleFilter>("all");
  const [group, setGroup] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [coords, setCoords] = useState<CoursePoint[] | null>(null);

  const publish = useCallback(() => {
    const s = simRef.current;
    const c = courseRef.current;
    if (!s || !c) return;
    setView({
      sim: { ...s, riders: s.riders.map((r) => ({ ...r })), chat: [...s.chat] },
      course: c,
      sprinting: s.t < sprintUntil.current,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [t, g] = await Promise.all([
          fetch(`/api/track/${encodeURIComponent(trackId)}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error("Traccia non trovata")))),
          fetch("/api/v2/groups").then((r) => (r.ok ? r.json() : { groups: [] })).catch(() => ({ groups: [] })),
        ]);
        if (cancelled) return;
        setTrackName(t.name);
        setGroups(g.groups ?? []);
        setCoords(t.coords);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Errore nel caricamento");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  // Simulazione: parte quando ci sono traccia e gruppi.
  useEffect(() => {
    if (!coords || !groups) return;
    const course = buildCourse(coords);
    courseRef.current = course;
    const groupMap = Object.fromEntries(groups.map((g) => [g.name, g.members.map((m) => m.username)]));
    simRef.current = createSim(course, { me, friends, groups: groupMap, others: 16, startM: startKm * 1000, seed: Date.now() % 1e6 });
    setGroup(groups[0]?.name ?? null);
    publish();
  }, [coords, groups, me, friends, startKm, publish]);

  // Mappa.
  useEffect(() => {
    if (!coords || !containerRef.current || mapRef.current) return;
    const start = positionAt(buildCourse(coords), startKm * 1000);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OPEN_FREE_MAP_STYLE,
      center: [start.lng, start.lat],
      zoom: 15,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.on("dragstart", () => setFollow(false));
    map.on("load", () => {
      applyRelief(map, { hillshade: true, tint: false, dark: false, winter: false });
      map.addSource("live-course", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords.map((c) => [c[0], c[1]]) } },
      });
      map.addLayer({
        id: "live-course",
        type: "line",
        source: "live-course",
        paint: { "line-color": "#f97316", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 15, 6], "line-opacity": 0.85 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
    });
    const markers = markersRef.current;
    return () => {
      for (const m of markers.values()) m.remove();
      markers.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [coords, startKm]);

  // Loop di simulazione.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const s = simRef.current;
      const c = courseRef.current;
      if (!s || !c) return;
      const dt = (TICK_MS / 1000) * speedup;
      const boost = s.t < sprintUntil.current ? SPRINT_W : 0;
      step(s, c, { myWatts: watts + boost, dt });
      publish();
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running, speedup, watts, publish]);

  const sim = view?.sim ?? null;
  const course = view?.course ?? null;
  const meRider = sim?.riders.find((r) => r.id === ME_ID) ?? null;

  // Avatar sulla mappa (aggiornati a ogni tick).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !sim || !course || !meRider) return;
    for (const r of sim.riders) {
      const p = positionAt(course, r.distM);
      let mk = markersRef.current.get(r.id);
      if (!mk) {
        mk = new maplibregl.Marker({ element: avatarEl(r.name, r.color, r.id === ME_ID) }).setLngLat([p.lng, p.lat]).addTo(map);
        markersRef.current.set(r.id, mk);
      } else {
        mk.setLngLat([p.lng, p.lat]);
      }
      const el = mk.getElement();
      el.style.opacity = matchesFilter(r, filter, group) ? "1" : "0.18";
      el.style.zIndex = r.id === ME_ID ? "10" : "1";
    }
    if (follow) {
      const p = positionAt(course, meRider.distM);
      map.easeTo({ center: [p.lng, p.lat], duration: TICK_MS, easing: (x) => x });
    }
  }, [sim, course, meRider, filter, group, follow]);

  const around = useMemo(() => (sim ? aroundMe(sim, filter, group, 4) : null), [sim, filter, group]);
  const chat = sim ? visibleChat(sim).slice(-30) : [];
  const listeners = sim && meRider ? sim.riders.filter((r) => r.id !== ME_ID && Math.abs(r.distM - meRider.distM) <= CHAT_RADIUS_M) : [];
  const nearbyCount = sim && meRider ? sim.riders.filter((r) => r.id !== ME_ID && Math.abs(r.distM - meRider.distM) <= NEARBY_RADIUS_M).length : 0;
  const here = course && meRider ? positionAt(course, meRider.distM) : null;
  const sprinting = view?.sprinting ?? false;

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const lastChatId = chat.at(-1)?.id;
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [lastChatId]);

  const send = useCallback(() => {
    if (!simRef.current || !draft.trim()) return;
    sendMyMessage(simRef.current, draft);
    setDraft("");
    publish();
  }, [draft, publish]);

  if (error) {
    return <p className="p-6 text-sm text-[color:var(--hmr-muted)]">{error}</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="relative h-[45vh] shrink-0 lg:h-auto lg:flex-1">
        {/* maplibre forza position:relative sul container: il posizionamento va su un wrapper. */}
        <div className="absolute inset-0">
          <div ref={containerRef} className="h-full w-full" />
        </div>
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/70 px-3 py-2 text-white shadow">
          <div className="text-[11px] uppercase tracking-wide opacity-70">Simulazione · {trackName || "…"}</div>
          {meRider && here ? (
            <div className="mt-0.5 flex gap-4 text-sm font-semibold tabular-nums">
              <span>{(meRider.speedMs * 3.6).toFixed(1)} km/h</span>
              <span>{Math.round(meRider.watts)} W</span>
              <span>{(here.grade * 100).toFixed(1)}%</span>
              <span>km {(meRider.distM / 1000).toFixed(2)}</span>
            </div>
          ) : null}
        </div>
        {!follow ? (
          <button type="button" className="ui-btn ui-btn-sm absolute bottom-3 right-3 shadow" onClick={() => setFollow(true)}>
            <Icon name="locateFixed" size={16} /> Seguimi
          </button>
        ) : null}
      </div>

      <aside className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 lg:w-[400px] lg:flex-none">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Icon name="sparkles" size={20} /> Live
          </h1>
          <p className="mt-1 text-[12.5px] text-[color:var(--hmr-muted)]">
            Pedali sulla traccia vera insieme ad amici, gruppi e chiunque sia in giro. Vedi chi hai davanti, prendi la
            scia, e se sei a meno di {CHAT_RADIUS_M} m vi scrivete. Per ora i rider sono simulati.
          </p>
        </div>

        <section className="space-y-2">
          <div className="flex items-center justify-between text-[13px]">
            <span>
              Potenza <b className="tabular-nums">{watts} W</b>
              {sprinting ? <span className="ml-1 font-semibold text-orange-500">+{SPRINT_W} scatto!</span> : null}
            </span>
            <span className="text-[color:var(--hmr-muted)]">{nearbyCount} nel gruppetto</span>
          </div>
          <input
            type="range"
            min={60}
            max={400}
            step={5}
            value={watts}
            onChange={(e) => setWatts(Number(e.target.value))}
            className="w-full"
            aria-label="Potenza in watt"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="ui-btn ui-btn-sm"
              disabled={!sim || sprinting}
              onClick={() => {
                if (simRef.current) sprintUntil.current = simRef.current.t + SPRINT_S;
              }}>
              ⚡ Scatto {SPRINT_S}″
            </button>
            <button type="button" className="ui-btn ui-btn-sm" onClick={() => setRunning((r) => !r)}>
              {running ? "Pausa" : "Riprendi"}
            </button>
            {[1, 5, 20].map((x) => (
              <button
                key={x}
                type="button"
                className={`ui-btn ui-btn-sm ${speedup === x ? "ring-2 ring-orange-400" : ""}`}
                onClick={() => setSpeedup(x)}>
                {x}×
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {(
              [
                ["all", "Tutti"],
                ["friends", "Amici"],
                ["group", "Gruppo"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`ui-btn ui-btn-sm ${filter === id ? "ring-2 ring-orange-400" : ""}`}
                onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
            {filter === "group" && groups?.length ? (
              <select className="ui-input text-[12px]" value={group ?? ""} onChange={(e) => setGroup(e.target.value || null)}>
                {groups.map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.name}
                  </option>
                ))}
              </select>
            ) : null}
            {around ? (
              <span className="ml-auto text-[13px] font-semibold tabular-nums">
                {around.position}° / {around.total}
              </span>
            ) : null}
          </div>

          <h2 className="ui-eyebrow mb-1">Davanti a te</h2>
          {around?.ahead.length ? (
            <ul className="space-y-1">
              {[...around.ahead].reverse().map((a) => (
                <RiderRow key={a.rider.id} r={a} />
              ))}
            </ul>
          ) : (
            <p className="px-2 text-[12px] text-[color:var(--hmr-muted)]">Nessuno: sei in testa 🏆</p>
          )}
          <div className="my-1 rounded-md bg-yellow-400/20 px-2 py-1 text-[12.5px] font-semibold">Tu · {me}</div>
          <h2 className="ui-eyebrow mb-1 mt-2">Dietro</h2>
          {around?.behind.length ? (
            <ul className="space-y-1">
              {around.behind.map((a) => (
                <RiderRow key={a.rider.id} r={a} />
              ))}
            </ul>
          ) : (
            <p className="px-2 text-[12px] text-[color:var(--hmr-muted)]">Nessuno dietro.</p>
          )}
        </section>

        <section>
          <h2 className="ui-eyebrow mb-1">Chat di prossimità ({CHAT_RADIUS_M} m)</h2>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-[color:var(--hmr-border,#e5e7eb)] p-2 text-[12.5px]">
            {chat.length ? (
              chat.map((m) =>
                m.system ? (
                  <div key={m.id} className="text-center text-[11px] text-[color:var(--hmr-muted)]">
                    {m.text}
                  </div>
                ) : (
                  <div key={m.id} className={m.fromId === ME_ID ? "text-right" : ""}>
                    <b>{m.fromId === ME_ID ? "Tu" : m.fromName}</b>: {m.text}
                  </div>
                ),
              )
            ) : (
              <div className="text-[color:var(--hmr-muted)]">Ancora silenzio. Avvicinati a qualcuno e saluta!</div>
            )}
            <div ref={chatEndRef} />
          </div>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}>
            <input
              className="ui-input min-w-0 flex-1 text-[13px]"
              placeholder={listeners.length ? `Scrivi a ${listeners.length} vicino/i…` : "Nessuno a portata: avvicinati!"}
              value={draft}
              maxLength={280}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!listeners.length}
            />
            <button type="submit" className="ui-btn ui-btn-sm" disabled={!listeners.length || !draft.trim()}>
              Invia
            </button>
          </form>
        </section>
      </aside>
    </div>
  );
}

function RiderRow({ r }: { r: RelativeRider }) {
  const tag = r.rider.circle === "friend" ? "amico" : r.rider.circle === "group" ? "gruppo" : null;
  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px]">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ background: r.rider.color }}>
        {initials(r.rider.name)}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {r.rider.name}
        {tag ? <span className="ml-1 text-[11px] text-[color:var(--hmr-muted)]">· {tag}</span> : null}
      </span>
      <span className="tabular-nums text-[12px] text-[color:var(--hmr-muted)]">
        {(r.rider.speedMs * 3.6).toFixed(0)} km/h · {fmtGap(r)}
      </span>
    </li>
  );
}
