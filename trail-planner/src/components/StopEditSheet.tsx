"use client";

import { useEffect, useState } from "react";
import { isPassThroughPoint } from "@/lib/stop-segment";
import { WAYPOINT_ROLE_LABELS, waypointRoleOptionsForStop } from "@/lib/waypoint-role";
import { googleMapsSearchUrl } from "@/lib/maps-links";
import type { StopRow, WaypointRole } from "@/lib/types";

type Props = {
  stop: StopRow;
  /** Indice ordinato (0..n-1) per opzioni ruolo. */
  stopIndex: number;
  stopsTotal: number;
  onClose: () => void;
  onRemove: () => void;
  onStartRelocate: () => void;
  onSave: (patch: {
    name: string;
    image_url: string | null;
    website_url?: string | null;
    phone?: string | null;
    segment_type?: string;
    waypoint_role?: WaypointRole;
  }) => void | Promise<void>;
};

export function StopEditSheet({
  stop,
  stopIndex,
  stopsTotal,
  onClose,
  onRemove,
  onStartRelocate,
  onSave,
}: Props) {
  const isLodging = stop.segment_type === "lodging";
  const showContactFields = isLodging || stop.segment_type === "poi";
  const [name, setName] = useState(stop.name);
  const [imageUrl, setImageUrl] = useState(stop.image_url ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(stop.website_url ?? "");
  const [phone, setPhone] = useState(stop.phone ?? "");
  const [role, setRole] = useState<WaypointRole>(stop.waypoint_role);
  const [saving, setSaving] = useState(false);

  const roleOptions = waypointRoleOptionsForStop(stopIndex, stopsTotal);

  useEffect(() => {
    setName(stop.name);
    setImageUrl(stop.image_url ?? "");
    setWebsiteUrl(stop.website_url ?? "");
    setPhone(stop.phone ?? "");
    setRole(stop.waypoint_role);
  }, [stop.id, stop.name, stop.image_url, stop.website_url, stop.phone, stop.waypoint_role]);

  const submit = async () => {
    setSaving(true);
    try {
      let segment_type: string | undefined;
      if (role !== stop.waypoint_role) {
        if (role === "poi") segment_type = "poi";
        else if (stop.segment_type === "poi" || stop.segment_type === "stop") segment_type = "stop";
      }
      await onSave({
        name: name.trim() || stop.name,
        image_url: imageUrl.trim() ? imageUrl.trim() : null,
        ...(showContactFields
          ? {
              website_url: websiteUrl.trim() ? websiteUrl.trim() : null,
              phone: phone.trim() ? phone.trim() : null,
            }
          : {}),
        ...(role !== stop.waypoint_role
          ? { waypoint_role: role, ...(segment_type ? { segment_type } : {}) }
          : {}),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pointer-events-auto absolute bottom-2 left-1/2 z-[50] w-[min(100%-0.75rem,22rem)] -translate-x-1/2 rounded-lg border border-amber-600/50 bg-zinc-900/97 p-2.5 shadow-xl backdrop-blur-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium text-amber-100/95">
          {isLodging
            ? "Rifugio / tappa"
            : isPassThroughPoint(stop)
              ? "Punto di passaggio"
              : "Tappa"}
        </p>
        <button
          type="button"
          className="rounded bg-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-600"
          onClick={onClose}
        >
          Chiudi
        </button>
      </div>
      {stop.image_url ? (
        <div className="mb-2 overflow-hidden rounded-md border border-zinc-700/80">
          <img
            src={stop.image_url}
            alt=""
            className="max-h-36 w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : null}

      <label className="mb-1 block text-[10px] text-zinc-500">Ruolo lungo il percorso</label>
      <select
        className="mb-2 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
        value={role}
        onChange={(e) => setRole(e.target.value as WaypointRole)}
      >
        {roleOptions.map((r) => (
          <option key={r} value={r}>
            {WAYPOINT_ROLE_LABELS[r]}
          </option>
        ))}
      </select>

      {!isLodging && (stop.segment_type === "meal" || stop.segment_type === "transport") ? (
        <p className="mb-2 text-[10px] text-zinc-500">
          {stop.segment_type === "meal" ? "Pasto — categoria" : "Trasporto — categoria"}
        </p>
      ) : null}

      <label className="mb-1 block text-[10px] text-zinc-500">Nome</label>
      <input
        className="mb-2 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
          if (e.key === "Escape") onClose();
        }}
      />
      {showContactFields ? (
        <>
          <label className="mb-1 block text-[10px] text-zinc-500">Sito web (prenotazioni / info)</label>
          <input
            className="mb-2 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://…"
          />
          {(() => {
            const u = websiteUrl.trim() || stop.website_url?.trim() || "";
            if (!u || !/^https?:\/\//i.test(u)) return null;
            return (
              <p className="mb-2 text-[11px]">
                <a
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-400 underline hover:text-sky-300"
                >
                  Apri sito →
                </a>
              </p>
            );
          })()}
          <label className="mb-1 block text-[10px] text-zinc-500">Telefono</label>
          <input
            className="mb-2 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+39 …"
            inputMode="tel"
          />
          {(phone.trim() || stop.phone?.trim()) ? (
            <p className="mb-2 text-[11px]">
              <a
                href={`tel:${(phone.trim() || stop.phone || "").replace(/\s/g, "")}`}
                className="text-emerald-400 underline hover:text-emerald-300"
              >
                Chiama
              </a>
            </p>
          ) : null}
        </>
      ) : null}
      <p className="mb-2 text-[11px]">
        <a
          href={googleMapsSearchUrl(stop.lat, stop.lng, stop.name)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 underline hover:text-sky-300"
        >
          Apri in Google Maps
        </a>
      </p>
      <label className="mb-1 block text-[10px] text-zinc-500">
        URL foto {showContactFields ? "(anteprima)" : "(opzionale)"}
      </label>
      <input
        className="mb-2 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
        placeholder="https://…"
      />
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          disabled={saving}
          onClick={() => void submit()}
        >
          Salva
        </button>
        <button
          type="button"
          className="rounded bg-sky-800/90 px-2 py-1 text-[11px] text-white hover:bg-sky-700"
          onClick={onStartRelocate}
        >
          Sposta sulla mappa
        </button>
        <button
          type="button"
          className="rounded bg-red-950/80 px-2 py-1 text-[11px] text-red-200 hover:bg-red-900/80"
          onClick={onRemove}
        >
          Rimuovi
        </button>
      </div>
    </div>
  );
}
