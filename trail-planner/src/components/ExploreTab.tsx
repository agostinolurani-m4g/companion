"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import type { ExplorePlaceRow } from "@/lib/types";

type Props = {
  places: ExplorePlaceRow[];
  onRefresh: () => void | Promise<void>;
  onOpenChat?: () => void;
  onStartNewItinerary?: () => void | Promise<void>;
  /** Volo mappa verso un luogo del catalogo. */
  onFlyToPlace?: (lat: number, lng: number) => void;
};

export function ExploreTab({
  places,
  onRefresh,
  onOpenChat,
  onStartNewItinerary,
  onFlyToPlace,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    lat: "",
    lng: "",
    description: "",
    image_url: "",
    rating: "4.5",
    review_count: "0",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sorted = useMemo(() => [...places].sort((a, b) => a.name.localeCompare(b.name)), [places]);

  const resetForm = () => {
    setForm({
      name: "",
      lat: "",
      lng: "",
      description: "",
      image_url: "",
      rating: "4.5",
      review_count: "0",
    });
    setEditingId(null);
    setErr(null);
  };

  const startEdit = (p: ExplorePlaceRow) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      lat: String(p.lat),
      lng: String(p.lng),
      description: p.description,
      image_url: p.image_url,
      rating: String(p.rating),
      review_count: String(p.review_count),
    });
  };

  const submit = async () => {
    setErr(null);
    const name = form.name.trim();
    const lat = Number(form.lat);
    const lng = Number(form.lng);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      setErr("Nome, lat e lng sono obbligatori (numeri validi).");
      return;
    }
    const rating = Number(form.rating);
    const review_count = Number(form.review_count);
    setBusy(true);
    try {
      if (editingId) {
        const res = await fetch(`/api/explore/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            lat,
            lng,
            description: form.description,
            image_url: form.image_url,
            rating: Number.isFinite(rating) ? rating : 4.5,
            review_count: Number.isFinite(review_count) ? Math.floor(review_count) : 0,
          }),
        });
        const j = (await res.json()) as { error?: string };
        if (!res.ok) {
          setErr(j.error ?? "Errore aggiornamento");
          return;
        }
      } else {
        const res = await fetch("/api/explore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            lat,
            lng,
            description: form.description,
            image_url: form.image_url || undefined,
            rating: Number.isFinite(rating) ? rating : 4.5,
            review_count: Number.isFinite(review_count) ? Math.floor(review_count) : 0,
          }),
        });
        const j = (await res.json()) as { error?: string };
        if (!res.ok) {
          setErr(j.error ?? "Errore creazione");
          return;
        }
      }
      resetForm();
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Eliminare questo luogo dal catalogo?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/explore/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        setErr(j.error ?? "Errore");
        return;
      }
      if (editingId === id) resetForm();
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-brand-border/80 bg-brand-surface/60 p-3">
      <p className="text-xs text-brand-muted">
        Luoghi salvati qui: sulla mappa sono <span className="text-violet-300">punti viola</span>.
      </p>
        {err ? (
        <p className="rounded-lg border border-brand-warn/30 bg-brand-warn/10 px-2 py-1 text-[11px] text-brand-warn">{err}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg bg-brand-accent px-3 py-1.5 text-xs font-medium text-brand-bg hover:brightness-110"
          onClick={() => void onStartNewItinerary?.()}
        >
          Nuovo itinerario
        </button>
        <button
          type="button"
          className="rounded-lg border border-brand-border bg-brand-elevated px-3 py-1.5 text-xs text-brand-text hover:bg-brand-border/50"
          onClick={() => onOpenChat?.()}
        >
          Torna alla chat
        </button>
      </div>

      <div className="rounded-lg border border-brand-border/60 bg-brand-bg/40 p-2">
        <p className="mb-2 text-[11px] font-medium text-brand-muted">
          {editingId ? "Modifica luogo" : "Aggiungi luogo"}
        </p>
        <div className="grid grid-cols-1 gap-1.5 text-[11px] sm:grid-cols-2">
          <label className="text-zinc-500">
            Nome
            <input
              className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-200"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="text-zinc-500">
            Lat / Lng
            <div className="mt-0.5 flex gap-1">
              <input
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-200"
                placeholder="46.64"
                value={form.lat}
                onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
              />
              <input
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-200"
                placeholder="11.72"
                value={form.lng}
                onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
              />
            </div>
          </label>
          <label className="text-zinc-500 sm:col-span-2">
            Descrizione
            <textarea
              className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-200"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </label>
          <label className="text-zinc-500 sm:col-span-2">
            URL immagine (https)
            <input
              className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-200"
              value={form.image_url}
              onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
            />
          </label>
          <label className="text-zinc-500">
            Rating
            <input
              className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-200"
              value={form.rating}
              onChange={(e) => setForm((f) => ({ ...f, rating: e.target.value }))}
            />
          </label>
          <label className="text-zinc-500">
            N. recensioni
            <input
              className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-200"
              value={form.review_count}
              onChange={(e) => setForm((f) => ({ ...f, review_count: e.target.value }))}
            />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded-lg bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            onClick={() => void submit()}
          >
            {busy ? "Salvataggio…" : editingId ? "Salva modifiche" : "Aggiungi"}
          </button>
          {editingId ? (
            <button
              type="button"
              className="rounded border border-zinc-600 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
              onClick={resetForm}
            >
              Annulla
            </button>
          ) : null}
        </div>
      </div>

      <ul className="space-y-3">
        {sorted.map((pl) => (
          <li
            key={pl.id}
            className="flex gap-3 rounded-lg border border-zinc-700/40 bg-zinc-950/50 p-2"
          >
            <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded bg-zinc-800">
              {pl.image_url ? (
                <Image
                  src={pl.image_url}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="112px"
                  unoptimized
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-zinc-100">{pl.name}</div>
              <p className="text-xs text-zinc-400 line-clamp-2">{pl.description}</p>
              <p className="mt-1 text-[10px] text-zinc-500">
                ★ {pl.rating.toFixed(1)} · {pl.review_count} recensioni
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                <button
                  type="button"
                  className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-700"
                  onClick={() => onFlyToPlace?.(pl.lat, pl.lng)}
                >
                  Mostra su mappa
                </button>
                <button
                  type="button"
                  className="rounded border border-zinc-600 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800"
                  onClick={() => startEdit(pl)}
                >
                  Modifica
                </button>
                <button
                  type="button"
                  className="rounded border border-red-900/50 px-2 py-0.5 text-[10px] text-red-300/90 hover:bg-red-950/40"
                  onClick={() => void remove(pl.id)}
                >
                  Elimina
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
