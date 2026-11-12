"use client";

import { useEffect, useState } from "react";
import type { V2OutdoorFeaturePick } from "@/components/v2/map/types";
import { fetchJson } from "@/lib/fetch-json";

type Detail = {
  feature: {
    id: string;
    name: string;
    kindLabel: string;
    ele: number | null;
    eleSource: string | null;
    keyFacts: { key: string; label: string; value: string; href?: string }[];
    allTags: { label: string; value: string; key: string }[];
    destinationSigns: Array<{ destination: string; distance_m: number | null; duration_s: number | null }>;
    osmUrl: string | null;
  };
  refugesInfo: {
    url: string;
    type: string;
    state: string | null;
    facts: Array<{ label: string; value: string }>;
    access: string | null;
    remark: string | null;
    updatedAt: string | null;
    attribution: string;
  } | null;
  photos: string[];
  commons: Array<{ title: string; thumbUrl: string; pageUrl: string }>;
  wiki: { extract: string | null; wiki_url: string | null };
  camptocamp: unknown[];
  reports: unknown[];
  links: Array<{ source: string; url: string | null }>;
};

type Props = {
  pick: V2OutdoorFeaturePick;
  onClose: () => void;
  onFlyTo?: (lng: number, lat: number) => void;
};

export default function V2FeatureSheet({ pick, onClose, onFlyTo }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchJson<Detail>(`/api/v2/features/${encodeURIComponent(pick.id)}`);
        setDetail(data);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Errore caricamento");
      }
    })();
  }, [pick.id]);

  const f = detail?.feature;

  return (
    <div className="v2-sheet v2-feature-sheet">
      <div className="v2-sheet-header">
        <div>
          <h2 className="v2-sheet-title">{pick.name}</h2>
          <p className="v2-sheet-sub">{f?.kindLabel ?? pick.kind}</p>
          {f?.ele != null && (
            <p className="v2-sheet-sub">
              {f.eleSource === "dem" ? "≈ " : ""}
              {Math.round(f.ele)} m{f.eleSource === "dem" ? " (stima da modello del terreno)" : ""}
            </p>
          )}
        </div>
        <button type="button" className="v2-icon-btn" onClick={onClose} aria-label="Chiudi">
          ×
        </button>
      </div>

      {err && <p className="v2-error">{err}</p>}

      {f && (
        <>
          <div className="v2-chip-row">
            {f.keyFacts.map((c) => (
              <span key={c.key} className="v2-chip">
                {c.label}:{" "}
                {c.href ? (
                  <a
                    href={c.href}
                    className="v2-link"
                    {...(c.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                  >
                    {c.value}
                  </a>
                ) : (
                  c.value
                )}
              </span>
            ))}
          </div>

          {detail.refugesInfo && (
            <section className="v2-sheet-section">
              <h3>refuges.info</h3>
              <p className="v2-muted">
                {detail.refugesInfo.type}
                {detail.refugesInfo.state && ` · Stato: ${detail.refugesInfo.state}`}
              </p>
              {detail.refugesInfo.facts.length > 0 && (
                <dl className="v2-tag-dl">
                  {detail.refugesInfo.facts.map((r) => (
                    <div key={r.label}>
                      <dt>{r.label}</dt>
                      <dd>{r.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {detail.refugesInfo.access && (
                <p className="v2-muted">
                  <strong>Accesso</strong> (testo originale): {detail.refugesInfo.access}
                </p>
              )}
              {detail.refugesInfo.remark && (
                <p className="v2-muted">
                  <strong>Note</strong> (testo originale): {detail.refugesInfo.remark}
                </p>
              )}
              <p className="v2-muted">
                <a href={detail.refugesInfo.url} target="_blank" rel="noreferrer" className="v2-link">
                  Scheda su refuges.info
                </a>
                {" · "}
                {detail.refugesInfo.attribution}
                {detail.refugesInfo.updatedAt && ` · aggiornato ${detail.refugesInfo.updatedAt}`}
              </p>
            </section>
          )}

          {f.destinationSigns.length > 0 && (
            <section className="v2-sheet-section">
              <h3>Destinazioni</h3>
              <ul className="v2-list-compact">
                {f.destinationSigns.map((d) => (
                  <li key={d.destination}>
                    <strong>{d.destination}</strong>
                    {d.duration_s != null && ` · ${Math.round(d.duration_s / 60)} min`}
                    {d.distance_m != null && ` · ${(d.distance_m / 1000).toFixed(1)} km`}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(detail.photos.length > 0 || detail.commons.length > 0) && (
            <section className="v2-sheet-section">
              <h3>Foto</h3>
              <div className="v2-photo-row">
                {detail.photos.slice(0, 4).map((url) => (
                  <img key={url} src={url} alt="" className="v2-photo-thumb" />
                ))}
                {detail.commons.slice(0, 4).map((p) => (
                  <a key={p.pageUrl} href={p.pageUrl} target="_blank" rel="noreferrer">
                    <img src={p.thumbUrl} alt={p.title} className="v2-photo-thumb" />
                  </a>
                ))}
              </div>
            </section>
          )}

          {detail.wiki.extract && (
            <section className="v2-sheet-section">
              <h3>Descrizione</h3>
              <p className="v2-muted">{detail.wiki.extract}</p>
              {detail.wiki.wiki_url && (
                <a href={detail.wiki.wiki_url} target="_blank" rel="noreferrer" className="v2-link">
                  Wikipedia
                </a>
              )}
            </section>
          )}

          {detail.reports.length > 0 && (
            <section className="v2-sheet-section">
              <h3>Segnalazioni vicine</h3>
              <p className="v2-muted">{detail.reports.length} attive in zona</p>
            </section>
          )}

          <section className="v2-sheet-section">
            <button type="button" className="v2-btn-ghost" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Nascondi dati" : "Tutti i dati"}
            </button>
            {showAll && (
              <dl className="v2-tag-dl">
                {f.allTags.map((t) => (
                  <div key={t.key}>
                    <dt>{t.label}</dt>
                    <dd>{t.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <div className="v2-sheet-actions">
            {onFlyTo && (
              <button type="button" className="v2-btn" onClick={() => onFlyTo(pick.lng, pick.lat)}>
                Centra mappa
              </button>
            )}
            {f.osmUrl && (
              <a href={f.osmUrl} target="_blank" rel="noreferrer" className="v2-btn-ghost">
                OpenStreetMap
              </a>
            )}
            {detail.links
              .filter((l) => l.url && !(l.source === "refuges.info" && detail.refugesInfo))
              .map((l) => (
                <a key={`${l.source}-${l.url}`} href={l.url!} target="_blank" rel="noreferrer" className="v2-btn-ghost">
                  {l.source}
                </a>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
