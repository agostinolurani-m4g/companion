"use client";

import type { UserRouteActivity } from "@/lib/db";
import { exploreActivityOptions, SPORTS } from "@/lib/sports";
import { formatDuration } from "@/lib/route-time";
import Icon from "@/components/v2/ui/Icon";
import type { ExploreScope } from "@/lib/explore";
import type { useV2ExploreState } from "@/lib/use-v2-explore-state";
import V2OutingList from "@/components/v2/V2OutingList";
import { outingPlanHref } from "@/lib/sports";

type ExploreState = ReturnType<typeof useV2ExploreState>;

type Props = {
  explore: ExploreState;
};

const ACTIVITIES = exploreActivityOptions();

export default function V2ExploreAside({ explore }: Props) {
  const {
    scope,
    setScope,
    activity,
    setActivity,
    groups,
    routes,
    busy,
    err,
    scopeLabel,
    selectedRouteId,
    setSelectedRouteId,
    selectedRoute,
    reportMode,
    setReportMode,
    setShowPhotoCapture,
    reportsVisible,
    setReportsVisible,
    photosVisible,
    setPhotosVisible,
    slopeVisible,
    setSlopeVisible,
    avalancheVisible,
    setAvalancheVisible,
  } = explore;

  return (
    <>

      <section>
        <p className="ui-eyebrow">Sport</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ACTIVITIES.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => setActivity(a.value)}
              aria-pressed={activity === a.value}
              className="ui-chip"
            >
              {a.value !== "all" ? <span className="h-2 w-2 rounded-full" style={{ background: SPORTS[a.value].color }} aria-hidden /> : null}
              {a.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <p className="ui-eyebrow">Ambito</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(["public", "mine"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              aria-pressed={scope === s}
              className="ui-chip"
            >
              {s === "public" ? "Pubblici" : "Mie gite"}
            </button>
          ))}
          {groups.map((g) => {
            const gScope = `group:${g.id}` as ExploreScope;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setScope(gScope)}
                aria-pressed={scope === gScope}
                className="ui-chip"
              >
                <Icon name="users" size={13} />
                {g.name}
              </button>
            );
          })}
        </div>
        {scope.startsWith("group:") ? (
          <p className="mt-1 text-[10px] text-[color:var(--hmr-muted)]">
            Tracce = percorsi con almeno una gita registrata nel gruppo.
          </p>
        ) : null}
      </section>

      <section>
        <p className="ui-eyebrow">Sulla mappa</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setReportMode((v) => !v)}
            className={`ui-btn ui-btn-sm ${reportMode ? "!border-[color:var(--hmr-warn)]/40 !bg-[color:var(--hmr-warn)]/10 !text-[color:var(--hmr-warn)]" : ""}`}
          >
            <Icon name="alert" size={15} />
            {reportMode ? "Tocca la mappa…" : "Segnala pericolo"}
          </button>
          <button type="button" onClick={() => setShowPhotoCapture(true)} className="ui-btn ui-btn-sm">
            <Icon name="camera" size={15} />
            Aggiungi foto
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className="ui-chip" aria-pressed={reportsVisible} onClick={() => setReportsVisible(!reportsVisible)}>
            Segnalazioni
          </button>
          <button type="button" className="ui-chip" aria-pressed={photosVisible} onClick={() => setPhotosVisible(!photosVisible)}>
            Foto
          </button>
          {activity === "ski" ? (
            <>
              <button type="button" className="ui-chip" aria-pressed={slopeVisible} onClick={() => setSlopeVisible(!slopeVisible)}>
                Pendenza
              </button>
              <button type="button" className="ui-chip" aria-pressed={avalancheVisible} onClick={() => setAvalancheVisible(!avalancheVisible)}>
                Valanghe
              </button>
            </>
          ) : null}
        </div>
      </section>

      <section>
        <p className="ui-eyebrow">
          Percorsi nell&apos;area {busy ? "…" : `· ${explore.totalInArea > routes.length ? `${routes.length} di ${explore.totalInArea}` : routes.length}`}
        </p>
        {!busy && explore.totalInArea > routes.length ? (
          <p className="mt-1 text-[12px] text-[color:var(--hmr-muted)]">Avvicina la mappa per vederli tutti.</p>
        ) : null}
        {!busy && routes.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-[color:var(--hmr-border)] px-3 py-3 text-[12.5px] text-[color:var(--hmr-muted)]">
            Nessun percorso in quest&apos;area. Sposta la mappa o cambia filtri.
          </p>
        ) : null}
        <ul className="-mx-1 mt-1.5 space-y-0.5">
          {routes.slice(0, 120).map((r) => {
            const on = selectedRouteId === r.id;
            const sp = SPORTS[r.activity as keyof typeof SPORTS];
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelectedRouteId(r.id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors ${
                    on ? "bg-[color:var(--hmr-accent-dim)]" : "hover:bg-[color:var(--hmr-elev)]"
                  }`}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: sp?.color ?? "#94938f" }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] font-semibold ${on ? "text-[color:var(--hmr-accent)]" : ""}`}>{r.name}</span>
                    <span className="block truncate text-[11.5px] text-[color:var(--hmr-faint)]">
                      {sp?.shortLabel ?? r.activity} · {r.length_km.toFixed(1)} km
                      {r.elev_gain_m > 0 ? ` · +${Math.round(r.elev_gain_m)} m` : ""}
                      {r.difficulty_label ? ` · ${r.difficulty_label}` : ""}
                      {r.duration_min ? ` · ≈ ${formatDuration(r.duration_min)}` : ""}
                      {r.outing_count ? ` · ${r.outing_count} gite` : ""}
                      {r.source === "osm" ? " · OSM" : r.source === "camptocamp" ? " · camptocamp" : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {selectedRoute ? (
        <V2OutingList
          key={selectedRoute.id}
          routeId={selectedRoute.id}
          planHref={outingPlanHref(selectedRoute.activity, selectedRoute.id)}
        />
      ) : null}

      {err ? <p className="text-[12.5px] text-[color:var(--hmr-danger)]">{err}</p> : null}
    </>
  );
}
