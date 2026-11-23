"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import V2PlanMap from "@/components/v2/V2PlanMap";
import Icon from "@/components/v2/ui/Icon";
import { fetchJson } from "@/lib/fetch-json";
import { formatDistance, formatDuration, segmentsToGeoJson } from "@/lib/segments/geo";
import type { SegmentDto } from "@/lib/segments/serialize";
import { activityLabel, isUserRouteActivity } from "@/lib/sports";
import { buildRouteMarkersGeoJson } from "@/lib/ski-overlays";

type Person = { username: string; display_name: string; avatar_url: string | null };
type BoardRow = { owner: string; elapsed_s: number; start_time: number; rank: number; person: Person; me: boolean };
type LegendRow = { owner: string; efforts: number; rank: number; person: Person; me: boolean };
type MyEffort = { id: string; activity_name: string; provider: string; start_time: number; elapsed_s: number | null; distance_m: number };

type Detail = {
  segment: SegmentDto;
  owner: Person;
  counts: { efforts: number; athletes: number };
  leaderboard: BoardRow[];
  legends: LegendRow[];
  my_efforts: MyEffort[];
  my_pr_s: number | null;
  my_rank: number | null;
  my_strava_missing_times: number;
  can_delete: boolean;
  my_gender?: "" | "f" | "m" | "x";
};

type Tab = "board" | "legend" | "mine";
type Period = "all" | "year" | "month";

const PERIOD_LABEL: Record<Period, string> = { all: "Sempre", year: "12 mesi", month: "30 giorni" };

function dateIt(ms: number) {
  return new Date(ms).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
}

function speedKmh(m: number, s: number | null) {
  return s ? `${((m / s) * 3.6).toFixed(1)} km/h` : "";
}

function Avatar({ p }: { p: Person }) {
  return p.avatar_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={p.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
  ) : (
    <span className="grid h-7 w-7 place-items-center rounded-full bg-[color:var(--hmr-accent-dim)] text-[11px] font-semibold uppercase">
      {p.display_name.slice(0, 1)}
    </span>
  );
}

export default function V2SegmentDetail({ segmentId }: { segmentId: string }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("board");
  const [period, setPeriod] = useState<Period>("all");
  const [gender, setGender] = useState<"" | "f" | "m" | "x">("");
  const [hydrating, setHydrating] = useState(false);

  const load = useCallback(
    async (opts: { hydrate?: boolean } = {}) => {
      try {
        const q = new URLSearchParams({ period });
        if (gender) q.set("gender", gender);
        if (opts.hydrate) q.set("hydrate", "1");
        setD(await fetchJson<Detail>(`/api/v2/segments/${encodeURIComponent(segmentId)}?${q}`));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Errore");
      }
    },
    [segmentId, period, gender],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const coords = useMemo(() => (d?.segment.geojson?.coordinates ?? []) as [number, number][], [d]);
  const fit = useMemo(() => (d ? { bbox: d.segment.bbox, key: 1, padding: 60 } : null), [d]);
  const segGeo = useMemo(() => (d ? segmentsToGeoJson([d.segment], d.segment.id) : null), [d]);

  if (err) return <p className="p-6 text-sm text-[color:var(--hmr-danger)]">{err}</p>;
  if (!d) return <p className="p-6 text-sm text-[color:var(--hmr-muted)]">Caricamento…</p>;
  const s = d.segment;
  const crown = d.leaderboard[0];
  const legend = d.legends[0];

  const hydrate = async () => {
    setHydrating(true);
    await load({ hydrate: true });
    setHydrating(false);
  };

  const remove = async () => {
    if (!confirm("Eliminare il segmento e la sua classifica?")) return;
    const res = await fetch(`/api/v2/segments/${encodeURIComponent(s.id)}`, { method: "DELETE" });
    if (res.ok) router.push("/v2/segmenti");
  };

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="order-2 min-h-0 flex-1 space-y-4 overflow-y-auto p-4 lg:order-1 lg:w-[400px] lg:flex-none">
        <div>
          <Link href="/v2/segmenti" className="text-[12px] text-[color:var(--hmr-muted)]">
            ← Segmenti
          </Link>
          <h1 className="mt-1 text-xl font-semibold leading-tight">{s.name}</h1>
          <p className="text-[12px] text-[color:var(--hmr-muted)]">
            {isUserRouteActivity(s.sport) ? activityLabel(s.sport) : s.sport} · creato da {d.owner.display_name}
            {s.visibility === "private" ? " · privato" : ""}
          </p>
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            [formatDistance(s.length_m), "lunghezza"],
            [`${Math.round(s.elev_gain_m)} m`, "D+"],
            [`${s.avg_grade_pct}%`, "pend. media"],
            [`${s.max_grade_pct}%`, "pend. max"],
          ].map(([v, l]) => (
            <div key={l} className="ui-card px-1 py-2">
              <div className="text-[15px] font-semibold">{v}</div>
              <div className="text-[10.5px] text-[color:var(--hmr-muted)]">{l}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="ui-card p-3">
            <div className="ui-eyebrow flex items-center gap-1">
              <Icon name="trophy" size={13} /> Più veloce
            </div>
            {crown ? (
              <p className="mt-1 text-[13px]">
                <b>{crown.person.display_name}</b> · {formatDuration(crown.elapsed_s)}
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-[color:var(--hmr-muted)]">Nessun tempo ancora</p>
            )}
          </div>
          <div className="ui-card p-3">
            <div className="ui-eyebrow">Local Legend</div>
            {legend ? (
              <p className="mt-1 text-[13px]">
                <b>{legend.person.display_name}</b> · {legend.efforts} passaggi
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-[color:var(--hmr-muted)]">Nessuno negli ultimi 90 gg</p>
            )}
          </div>
        </div>

        <div className="ui-card flex items-center justify-between p-3 text-[13px]">
          <div>
            <div className="ui-eyebrow">Il mio record</div>
            <div className="mt-0.5 text-[17px] font-semibold">{formatDuration(d.my_pr_s)}</div>
          </div>
          <div className="text-right text-[12px] text-[color:var(--hmr-muted)]">
            {d.my_rank ? <div>{d.my_rank}° in classifica</div> : null}
            <div>{d.my_efforts.length} passaggi miei</div>
            <div>
              {d.counts.athletes} persone · {d.counts.efforts} passaggi
            </div>
          </div>
        </div>

        {d.my_strava_missing_times > 0 || d.my_efforts.length === 0 ? (
          <button type="button" className="ui-btn ui-btn-sm w-full" onClick={hydrate} disabled={hydrating}>
            {hydrating ? "Recupero i tempi da Strava…" : "Cerca i miei passaggi nelle attività Strava"}
          </button>
        ) : null}

        <div className="ui-seg" role="tablist">
          {(
            [
              ["board", "Classifica"],
              ["legend", "Local Legend"],
              ["mine", "I miei"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === "board" ? (
          <section>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
                <button key={p} type="button" className="ui-chip" aria-pressed={period === p} onClick={() => setPeriod(p)}>
                  {PERIOD_LABEL[p]}
                </button>
              ))}
              <span className="mx-1 w-px self-stretch bg-[color:var(--hmr-border)]" aria-hidden />
              {(
                [
                  ["", "Tutti"],
                  ["f", "Donne"],
                  ["m", "Uomini"],
                ] as const
              ).map(([g, label]) => (
                <button key={g || "all"} type="button" className="ui-chip" aria-pressed={gender === g} onClick={() => setGender(g)}>
                  {label}
                </button>
              ))}
            </div>
            {gender && !d.my_gender ? (
              <p className="mb-2 text-[11px] text-[color:var(--hmr-muted)]">
                Le classifiche per genere usano solo chi l&apos;ha indicato nel profilo (facoltativo).
              </p>
            ) : null}
            {d.leaderboard.length ? (
              <ol className="space-y-1">
                {d.leaderboard.map((r) => (
                  <li
                    key={r.owner}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] ${r.me ? "bg-[color:var(--hmr-accent-dim)]" : ""}`}
                  >
                    <span className="w-6 text-right font-semibold tabular-nums">{r.rank}</span>
                    <Avatar p={r.person} />
                    <Link href={`/v2/u/${encodeURIComponent(r.owner)}`} className="min-w-0 flex-1 truncate">
                      {r.person.display_name}
                    </Link>
                    <span className="text-[11px] text-[color:var(--hmr-muted)]">{dateIt(r.start_time)}</span>
                    <span className="w-16 text-right font-semibold tabular-nums">{formatDuration(r.elapsed_s)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[12.5px] text-[color:var(--hmr-muted)]">
                Nessun tempo in questo periodo. Carica un GPX/FIT o collega Strava: i passaggi vengono trovati da soli.
              </p>
            )}
            <p className="mt-3 text-[11px] text-[color:var(--hmr-faint)]">
              In classifica pubblica entrano le attività caricate da file con consenso community. Le attività
              Strava le vedi solo tu (regole API Strava).
            </p>
          </section>
        ) : null}

        {tab === "legend" ? (
          <section>
            <p className="mb-2 text-[12px] text-[color:var(--hmr-muted)]">
              Chi ci è passato più volte negli ultimi 90 giorni: conta la costanza, non la velocità.
            </p>
            {d.legends.length ? (
              <ol className="space-y-1">
                {d.legends.map((r) => (
                  <li
                    key={r.owner}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] ${r.me ? "bg-[color:var(--hmr-accent-dim)]" : ""}`}
                  >
                    <span className="w-6 text-right font-semibold tabular-nums">{r.rank}</span>
                    <Avatar p={r.person} />
                    <span className="min-w-0 flex-1 truncate">{r.person.display_name}</span>
                    <span className="font-semibold tabular-nums">{r.efforts}×</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[12.5px] text-[color:var(--hmr-muted)]">Nessun passaggio negli ultimi 90 giorni.</p>
            )}
          </section>
        ) : null}

        {tab === "mine" ? (
          <section>
            {d.my_efforts.length ? (
              <ul className="space-y-1">
                {d.my_efforts.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{e.activity_name || "Attività"}</span>
                      <span className="text-[11px] text-[color:var(--hmr-muted)]">
                        {dateIt(e.start_time)} · {e.provider === "strava" ? "Strava" : "file"} {speedKmh(s.length_m, e.elapsed_s)}
                      </span>
                    </span>
                    <span
                      className={`font-semibold tabular-nums ${e.elapsed_s != null && e.elapsed_s === d.my_pr_s ? "text-[color:var(--hmr-accent)]" : ""}`}
                    >
                      {e.elapsed_s != null && e.elapsed_s === d.my_pr_s ? "PR " : ""}
                      {formatDuration(e.elapsed_s)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-[color:var(--hmr-muted)]">Non sei ancora passato di qui.</p>
            )}
          </section>
        ) : null}

        {d.can_delete ? (
          <button type="button" className="ui-btn ui-btn-sm ui-btn-danger" onClick={remove}>
            <Icon name="trash" size={14} /> Elimina segmento
          </button>
        ) : null}
      </aside>

      <div className="relative order-1 h-[38vh] shrink-0 lg:order-2 lg:h-auto lg:flex-1">
        <V2PlanMap
          waypoints={[]}
          routeCoords={null}
          pois={[]}
          onMapInteraction={() => {}}
          showWaypoints={false}
          fitTo={fit}
          segmentsGeoJson={segGeo}
          routeMarkersGeoJson={
            coords.length >= 2 ? buildRouteMarkersGeoJson({ start: coords[0], end: coords[coords.length - 1] }) : null
          }
          mapSport={isUserRouteActivity(s.sport) ? s.sport : undefined}
        />
      </div>
    </div>
  );
}
