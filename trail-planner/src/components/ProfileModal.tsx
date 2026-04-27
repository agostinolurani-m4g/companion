"use client";

import { useEffect, useState } from "react";
import type { ProfileRow, UserRow } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function ProfileModal({ open, onClose, onSaved }: Props) {
  const [p, setP] = useState<ProfileRow | null>(null);
  const [socialUsers, setSocialUsers] = useState<UserRow[]>([]);
  const [friends, setFriends] = useState<UserRow[]>([]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const res = await fetch("/api/profile");
      const j = (await res.json()) as { profile: ProfileRow };
      setP(j.profile);
      const ur = await fetch("/api/social/users");
      if (ur.ok) {
        const uj = (await ur.json()) as { users: UserRow[] };
        setSocialUsers(uj.users ?? []);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open || !p?.active_user_id) {
      setFriends([]);
      return;
    }
    void (async () => {
      const r = await fetch("/api/social/friends");
      if (!r.ok) return;
      const j = (await r.json()) as { friends: UserRow[] };
      setFriends(j.friends ?? []);
    })();
  }, [open, p?.active_user_id]);

  if (!open || !p) return null;

  const save = async () => {
    await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: p.display_name,
        units: p.units,
        sports_json: p.sports_json,
        rain_mm_h: p.rain_mm_h,
        wind_ms: p.wind_ms,
        frost_temp_c: p.frost_temp_c,
        timezone: p.timezone,
        active_user_id: p.active_user_id ?? null,
      }),
    });
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-zinc-600 bg-zinc-900 p-4 shadow-xl">
        <h2 className="text-lg font-semibold text-zinc-100">Profilo locale</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Dati solo su questo computer. Soglie usate per le allerte meteo lungo l’itinerario.
        </p>
        {socialUsers.length > 0 ? (
          <label className="mt-4 block">
            <span className="text-zinc-400">Utente attivo (POC social)</span>
            <select
              className="mt-1 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
              value={p.active_user_id ?? ""}
              onChange={(e) =>
                setP({ ...p, active_user_id: e.target.value || null })
              }
            >
              <option value="">—</option>
              {socialUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name} ({u.role})
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[10px] text-zinc-600">
              Per feed mappa: scegli chi sei in questo dispositivo (dati demo locali).
            </span>
          </label>
        ) : null}
        {p.active_user_id && friends.length > 0 ? (
          <div className="mt-3 rounded border border-zinc-800/80 bg-zinc-950/50 p-2">
            <p className="text-[11px] font-medium text-zinc-400">Rete demo</p>
            <ul className="mt-1 space-y-0.5 text-xs text-zinc-300">
              {friends.map((f) => (
                <li key={f.id}>
                  {f.display_name}{" "}
                  <span className="text-zinc-600">
                    ({f.role}
                    {f.handle ? ` · @${f.handle}` : ""})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-4 space-y-3 text-sm">
          <label className="block">
            <span className="text-zinc-400">Nome</span>
            <input
              className="mt-1 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-zinc-100"
              value={p.display_name}
              onChange={(e) => setP({ ...p, display_name: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-zinc-400">Unità distanza</span>
            <select
              className="mt-1 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-zinc-100"
              value={p.units}
              onChange={(e) => setP({ ...p, units: e.target.value as "km" | "mi" })}
            >
              <option value="km">km</option>
              <option value="mi">mi</option>
            </select>
          </label>
          <label className="block">
            <span className="text-zinc-400">Soglia pioggia (mm/giorno indicativi)</span>
            <input
              type="number"
              step={0.1}
              className="mt-1 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-zinc-100"
              value={p.rain_mm_h}
              onChange={(e) => setP({ ...p, rain_mm_h: parseFloat(e.target.value) || 0 })}
            />
          </label>
          <label className="block">
            <span className="text-zinc-400">Soglia vento (m/s)</span>
            <input
              type="number"
              step={0.5}
              className="mt-1 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-zinc-100"
              value={p.wind_ms}
              onChange={(e) => setP({ ...p, wind_ms: parseFloat(e.target.value) || 0 })}
            />
          </label>
          <label className="block">
            <span className="text-zinc-400">Allerta gelo sotto (°C)</span>
            <input
              type="number"
              step={0.5}
              className="mt-1 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-zinc-100"
              value={p.frost_temp_c}
              onChange={(e) => setP({ ...p, frost_temp_c: parseFloat(e.target.value) || 0 })}
            />
          </label>
          <label className="block">
            <span className="text-zinc-400">Timezone</span>
            <input
              className="mt-1 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-zinc-100"
              value={p.timezone}
              onChange={(e) => setP({ ...p, timezone: e.target.value })}
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200"
            onClick={onClose}
          >
            Chiudi
          </button>
          <button
            type="button"
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white"
            onClick={() => void save()}
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}
