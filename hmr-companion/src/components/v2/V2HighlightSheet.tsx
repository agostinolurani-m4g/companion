"use client";

import { useEffect, useState } from "react";
import V2PhotoLightbox from "@/components/v2/V2PhotoLightbox";
import Icon from "@/components/v2/ui/Icon";
import { fetchJson } from "@/lib/fetch-json";
import type { HighlightDto, HighlightPhotoDto } from "@/lib/highlights/serialize";
import { activityLabel, isUserRouteActivity, USER_ROUTE_ACTIVITIES } from "@/lib/sports";

function sportName(s: string) {
  return s && isUserRouteActivity(s) ? activityLabel(s) : "Tutti gli sport";
}

/** Scheda di un highlight: foto, consiglio, "consigliato da", azioni. */
export function V2HighlightSheet({
  highlightId,
  onClose,
  onChanged,
  onAddToRoute,
}: {
  highlightId: string;
  onClose: () => void;
  onChanged?: () => void;
  /** In pianificazione: aggiunge l'highlight come tappa del percorso. */
  onAddToRoute?: (h: HighlightDto) => void;
}) {
  const [h, setH] = useState<HighlightDto | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setH(null);
    fetchJson<{ highlight: HighlightDto }>(`/api/v2/highlights/${encodeURIComponent(highlightId)}`)
      .then((d) => alive && setH(d.highlight))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "Errore"));
    return () => {
      alive = false;
    };
  }, [highlightId]);

  const vote = async () => {
    if (!h) return;
    setBusy(true);
    try {
      const d = await fetchJson<{ highlight: HighlightDto }>(`/api/v2/highlights/${encodeURIComponent(h.id)}`, { method: "POST" });
      setH(d.highlight);
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!h) return;
    setBusy(true);
    try {
      await fetchJson(`/api/v2/highlights/${encodeURIComponent(h.id)}`, { method: "DELETE" });
      onChanged?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Errore");
      setBusy(false);
    }
  };

  const photos: HighlightPhotoDto[] = h?.photos ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[color:var(--hmr-border)] bg-[color:var(--hmr-panel)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={h?.name ?? "Highlight"}
      >
        {h?.cover_url ? (
          <button type="button" className="block w-full" onClick={() => setLightbox(0)} aria-label="Apri le foto">
            {/* eslint-disable-next-line @next/next/no-img-element -- foto utente servite dall'API */}
            <img src={h.cover_url} alt="" className="h-44 w-full object-cover" />
          </button>
        ) : null}
        <div className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-amber-600">
                <Icon name="star" size={13} /> Highlight · {h ? sportName(h.sport) : "…"}
              </p>
              <h2 className="mt-0.5 text-base font-semibold">{h?.name ?? "Carico…"}</h2>
            </div>
            <button type="button" onClick={onClose} className="ui-icon-btn" aria-label="Chiudi">
              <Icon name="x" size={18} />
            </button>
          </div>
          {h?.tip ? <p className="whitespace-pre-line text-[13px] leading-relaxed">{h.tip}</p> : null}
          {h ? (
            <p className="text-[11.5px] text-[color:var(--hmr-muted)]">
              Proposto da {h.owner.display_name} · consigliato da {h.votes} {h.votes === 1 ? "persona" : "persone"}
            </p>
          ) : null}
          {photos.length > 1 ? (
            <div className="ui-no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
              {photos.map((p, i) =>
                p.url ? (
                  <button key={p.id} type="button" onClick={() => setLightbox(i)} className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element -- miniature */}
                    <img src={p.url} alt={p.caption || "Foto"} className="h-16 w-16 rounded-lg object-cover" />
                  </button>
                ) : null,
              )}
            </div>
          ) : null}
          {h ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`ui-btn ui-btn-sm ${h.voted ? "!border-amber-500 !bg-amber-500/10 !text-amber-700" : ""}`}
                onClick={vote}
                disabled={busy}
                aria-pressed={h.voted}
              >
                <Icon name="star" size={14} /> {h.voted ? "Consigliato" : "Consiglia"} · {h.votes}
              </button>
              {onAddToRoute ? (
                <button type="button" className="ui-btn ui-btn-sm" onClick={() => onAddToRoute(h)}>
                  <Icon name="plus" size={14} /> Aggiungi al percorso
                </button>
              ) : null}
              <a className="ui-btn ui-btn-sm" href={`/v2/panorama?lat=${h.lat.toFixed(5)}&lng=${h.lng.toFixed(5)}`}>
                <Icon name="panorama" size={14} /> Panorama
              </a>
              {h.mine ? (
                <button type="button" className="ui-btn ui-btn-sm text-[color:var(--hmr-danger)]" onClick={remove} disabled={busy}>
                  <Icon name="trash" size={14} /> Elimina
                </button>
              ) : null}
            </div>
          ) : null}
          {err ? <p className="text-xs text-[color:var(--hmr-danger)]">{err}</p> : null}
        </div>
      </div>
      {lightbox != null && photos.length ? (
        <V2PhotoLightbox
          photos={photos.map((p) => ({ id: p.id, url: p.url, caption: p.caption, owner: p.owner, lng: p.lng, lat: p.lat }))}
          startIndex={lightbox}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}

/** Nuovo highlight nel punto toccato: nome, consiglio, sport, foto vicina come copertina. */
export function V2HighlightCreateSheet({
  lng,
  lat,
  defaultSport,
  onClose,
  onCreated,
}: {
  lng: number;
  lat: number;
  defaultSport?: string;
  onClose: () => void;
  onCreated: (h: HighlightDto) => void;
}) {
  const [name, setName] = useState("");
  const [tip, setTip] = useState("");
  const [sport, setSport] = useState(defaultSport && isUserRouteActivity(defaultSport) ? defaultSport : "");
  const [photos, setPhotos] = useState<HighlightPhotoDto[]>([]);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const d = 150 / 111_320;
    const dl = d / Math.cos((lat * Math.PI) / 180);
    fetchJson<{ photos: HighlightPhotoDto[] }>(`/api/v2/photos?bbox=${lat - d},${lng - dl},${lat + d},${lng + dl}`)
      .then((r) => setPhotos(r.photos.filter((p) => p.url)))
      .catch(() => undefined);
  }, [lat, lng]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const d = await fetchJson<{ highlight: HighlightDto }>("/api/v2/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, tip, sport, lat, lng, photo_id: photoId }),
      });
      onCreated(d.highlight);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Errore");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-t-2xl border border-[color:var(--hmr-border)] bg-[color:var(--hmr-panel)] p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Nuovo highlight"
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Icon name="star" size={15} /> Nuovo highlight
          </h2>
          <button type="button" onClick={onClose} className="ui-icon-btn" aria-label="Chiudi">
            <Icon name="x" size={18} />
          </button>
        </div>
        <p className="text-[11.5px] text-[color:var(--hmr-muted)]">
          Un posto che vale la deviazione: un belvedere, una fontana, un tratto di sentiero bellissimo, un rifugio dove si mangia bene.
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome (es. Belvedere sul lago)"
          maxLength={100}
          className="w-full rounded-lg border border-[color:var(--hmr-border)] bg-transparent px-3 py-2 text-sm"
        />
        <textarea
          value={tip}
          onChange={(e) => setTip(e.target.value)}
          placeholder="Il tuo consiglio (quando andarci, cosa vedere, a cosa fare attenzione)"
          rows={3}
          maxLength={600}
          className="w-full rounded-lg border border-[color:var(--hmr-border)] bg-transparent px-3 py-2 text-sm"
        />
        <label className="grid gap-1 text-xs">
          Per quale sport
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            className="rounded-lg border border-[color:var(--hmr-border)] bg-transparent px-3 py-2 text-sm"
          >
            <option value="">Tutti gli sport</option>
            {USER_ROUTE_ACTIVITIES.map((a) => (
              <option key={a} value={a}>
                {activityLabel(a)}
              </option>
            ))}
          </select>
        </label>
        {photos.length ? (
          <div>
            <p className="mb-1 text-xs">Foto di copertina (dalle foto vicine)</p>
            <div className="ui-no-scrollbar flex gap-1.5 overflow-x-auto">
              {photos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPhotoId(photoId === p.id ? null : p.id)}
                  className={`shrink-0 rounded-lg ring-offset-1 ${photoId === p.id ? "ring-2 ring-amber-500" : ""}`}
                  aria-pressed={photoId === p.id}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- miniature */}
                  <img src={p.url ?? ""} alt={p.caption || "Foto"} className="h-16 w-16 rounded-lg object-cover" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-[color:var(--hmr-faint)]">
            Nessuna foto qui vicino: aggiungine una con &quot;Aggiungi foto&quot; e diventerà la copertina.
          </p>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={busy || name.trim().length < 3}
          className="w-full rounded-lg bg-[color:var(--hmr-accent)] py-2.5 text-xs font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
        >
          {busy ? "Salvo…" : "Pubblica highlight"}
        </button>
        {err ? <p className="text-xs text-[color:var(--hmr-danger)]">{err}</p> : null}
      </div>
    </div>
  );
}
