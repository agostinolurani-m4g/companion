"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import V2Nav from "@/components/v2/V2Nav";
import type { ProfileLevel } from "@/lib/db";
import { avatarUrl } from "@/lib/social-labels";

type Props = {
  username: string;
  isAdmin?: boolean;
};

type Profile = {
  username: string;
  display_name: string;
  bio: string;
  avatar_path: string | null;
  home_area: string;
  level: ProfileLevel;
  level_label: string;
  trust_score: number;
  trust_tier: string;
  trust_tier_label: string;
  followers: number;
  following: number;
  public_routes: number;
  stats?: {
    total_km: number;
    total_elev_gain_m: number;
    outings_count: number;
    photos_count: number;
    reports_verified: number;
    confirmations_received: number;
  };
};

type RouteItem = {
  id: string;
  name: string;
  activity: string;
  length_km: number;
  elev_gain_m: number;
};

type PhotoItem = {
  id: string;
  caption: string;
  url?: string;
  photo_path: string;
};

type FollowUser = { username: string; display_name: string };

const LEVELS: { value: ProfileLevel; label: string }[] = [
  { value: "beginner", label: "Principiante" },
  { value: "intermediate", label: "Intermedio" },
  { value: "advanced", label: "Avanzato" },
  { value: "expert", label: "Esperto" },
];

function Avatar({ profile }: { profile: Profile }) {
  const src = avatarUrl(profile.avatar_path);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="h-20 w-20 shrink-0 rounded-full border-2 border-[color:var(--hmr-border)] object-cover"
      />
    );
  }
  const initial = (profile.display_name || profile.username).charAt(0).toUpperCase();
  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] text-2xl font-semibold text-[color:var(--hmr-accent)]">
      {initial}
    </div>
  );
}

export default function V2Profile({ username, isAdmin = false }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [stats, setStats] = useState<Profile["stats"] | null>(null);
  const [followList, setFollowList] = useState<FollowUser[] | null>(null);
  const [followListKind, setFollowListKind] = useState<"followers" | "following" | null>(null);
  const [isSelf, setIsSelf] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [busy, setBusy] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    display_name: "",
    bio: "",
    home_area: "",
    level: "intermediate" as ProfileLevel,
  });

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/v2/profile/${encodeURIComponent(username)}`);
      const data = (await res.json()) as {
        error?: string;
        profile?: Profile;
        routes?: RouteItem[];
        photos?: PhotoItem[];
        stats?: Profile["stats"];
        is_self?: boolean;
        is_following?: boolean;
      };
      if (!res.ok) throw new Error(data.error ?? "Caricamento fallito");
      setProfile(data.profile ?? null);
      setRoutes(data.routes ?? []);
      setPhotos(
        (data.photos ?? []).map((p) => ({
          ...p,
          url: p.url ?? `/api/field-photo?path=${encodeURIComponent(p.photo_path)}`,
        })),
      );
      setStats(data.stats ?? data.profile?.stats ?? null);
      setIsSelf(!!data.is_self);
      setIsFollowing(!!data.is_following);
      if (data.profile) {
        setForm({
          display_name: data.profile.display_name,
          bio: data.profile.bio,
          home_area: data.profile.home_area,
          level: data.profile.level,
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [username]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFollow = async () => {
    if (!profile) return;
    try {
      const method = isFollowing ? "DELETE" : "POST";
      const res = await fetch(`/api/v2/follow/${encodeURIComponent(profile.username)}`, { method });
      const data = (await res.json()) as { error?: string; followers?: number };
      if (!res.ok) throw new Error(data.error ?? "Operazione fallita");
      setIsFollowing(!isFollowing);
      setProfile((p) => (p ? { ...p, followers: data.followers ?? p.followers } : p));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/v2/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as { error?: string; profile?: Profile };
      if (!res.ok) throw new Error(data.error ?? "Salvataggio fallito");
      setProfile(data.profile ?? null);
      setEditing(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const loadFollowList = async (kind: "followers" | "following") => {
    try {
      const res = await fetch(`/api/v2/follow/${encodeURIComponent(username)}?list=${kind}`);
      const data = (await res.json()) as { users?: FollowUser[] };
      setFollowList(data.users ?? []);
      setFollowListKind(kind);
    } catch {
      setFollowList([]);
      setFollowListKind(kind);
    }
  };

  const routeHref = (activity: string, id: string) =>
    activity === "ski"
      ? `/v2/scialpinismo?route=${encodeURIComponent(id)}`
      : `/v2/plan?route=${encodeURIComponent(id)}`;

  const uploadAvatar = async (file: File) => {
    setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/v2/profile/avatar", { method: "POST", body: fd });
      const data = (await res.json()) as { error?: string; profile?: Profile };
      if (!res.ok) throw new Error(data.error ?? "Upload fallito");
      setProfile(data.profile ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  if (busy) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <V2Nav isAdmin={isAdmin} username={username} />
        <p className="p-4 text-sm text-[color:var(--hmr-muted)]">Caricamento profilo…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <V2Nav isAdmin={isAdmin} username={username} />
        <p className="p-4 text-sm text-red-400">{err ?? "Profilo non trovato"}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <V2Nav isAdmin={isAdmin} username={username} />
      <div className="mx-auto w-full max-w-3xl flex-1 p-4">
        <div className="hmr-panel flex flex-col gap-4 rounded-2xl border border-[color:var(--hmr-border)]/80 p-5 sm:flex-row sm:items-start">
          <div className="flex flex-col items-center gap-2">
            <Avatar profile={profile} />
            {isSelf ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadAvatar(f);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="text-xs text-[color:var(--hmr-accent)]"
                >
                  Cambia foto
                </button>
              </>
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">{profile.display_name}</h1>
            <p className="text-sm text-[color:var(--hmr-muted)]">@{profile.username}</p>
            {profile.home_area ? (
              <p className="mt-1 text-sm text-[color:var(--hmr-muted)]">📍 {profile.home_area}</p>
            ) : null}
            <span className="mt-2 inline-block rounded-full bg-[color:var(--hmr-accent)]/15 px-2.5 py-0.5 text-xs text-[color:var(--hmr-accent)]">
              {profile.level_label}
            </span>
            <span className="ml-2 mt-2 inline-block rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-400">
              {profile.trust_tier_label}
            </span>
            {profile.bio ? (
              <p className="mt-3 text-sm leading-relaxed text-[color:var(--hmr-text)]">{profile.bio}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <button type="button" onClick={() => void loadFollowList("followers")} className="hover:text-[color:var(--hmr-accent)]">
                <strong>{profile.followers}</strong>{" "}
                <span className="text-[color:var(--hmr-muted)]">follower</span>
              </button>
              <button type="button" onClick={() => void loadFollowList("following")} className="hover:text-[color:var(--hmr-accent)]">
                <strong>{profile.following}</strong>{" "}
                <span className="text-[color:var(--hmr-muted)]">seguiti</span>
              </button>
              <span>
                <strong>{profile.public_routes}</strong>{" "}
                <span className="text-[color:var(--hmr-muted)]">percorsi pubblici</span>
              </span>
            </div>

            {stats ? (
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded-lg bg-[color:var(--hmr-elev)]/50 px-2 py-1.5">
                  <strong>{stats.total_km.toFixed(0)}</strong> km
                </div>
                <div className="rounded-lg bg-[color:var(--hmr-elev)]/50 px-2 py-1.5">
                  <strong>{stats.outings_count}</strong> gite
                </div>
                <div className="rounded-lg bg-[color:var(--hmr-elev)]/50 px-2 py-1.5">
                  <strong>{stats.photos_count}</strong> foto
                </div>
                <div className="rounded-lg bg-[color:var(--hmr-elev)]/50 px-2 py-1.5">
                  <strong>{stats.reports_verified}</strong> segnal. verif.
                </div>
              </div>
            ) : null}

            {followList && followListKind ? (
              <div className="mt-3 rounded-lg border border-[color:var(--hmr-border)]/60 p-2">
                <p className="text-[10px] font-medium uppercase text-[color:var(--hmr-muted)]">
                  {followListKind === "followers" ? "Follower" : "Seguiti"}
                </p>
                <ul className="mt-1 space-y-1">
                  {followList.map((u) => (
                    <li key={u.username}>
                      <Link href={`/v2/u/${encodeURIComponent(u.username)}`} className="text-xs hover:text-[color:var(--hmr-accent)]">
                        {u.display_name || u.username}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {isSelf ? (
                <button
                  type="button"
                  onClick={() => setEditing((v) => !v)}
                  className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-2 text-xs"
                >
                  {editing ? "Annulla" : "Modifica profilo"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void toggleFollow()}
                    className={
                      isFollowing
                        ? "rounded-lg border border-[color:var(--hmr-border)] px-3 py-2 text-xs"
                        : "rounded-lg bg-[color:var(--hmr-accent)] px-3 py-2 text-xs font-medium text-[color:var(--hmr-bg)]"
                    }
                  >
                    {isFollowing ? "Non seguire più" : "Segui"}
                  </button>
                  <Link
                    href={`/v2/groups?invite=${encodeURIComponent(profile.username)}`}
                    className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-2 text-xs text-[color:var(--hmr-accent)]"
                  >
                    Invita in un gruppo
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>

        {editing && isSelf ? (
          <div className="mt-4 hmr-panel rounded-2xl border border-[color:var(--hmr-border)]/80 p-4">
            <h2 className="text-sm font-medium">Modifica profilo</h2>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-1 text-xs">
                Nome visualizzato
                <input
                  value={form.display_name}
                  onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                  className="rounded-lg border border-[color:var(--hmr-border)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-xs">
                Bio
                <textarea
                  value={form.bio}
                  onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                  rows={3}
                  className="rounded-lg border border-[color:var(--hmr-border)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-xs">
                Zona / area
                <input
                  value={form.home_area}
                  onChange={(e) => setForm((f) => ({ ...f, home_area: e.target.value }))}
                  placeholder="es. Valchiavenna"
                  className="rounded-lg border border-[color:var(--hmr-border)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-xs">
                Livello
                <select
                  value={form.level}
                  onChange={(e) => setForm((f) => ({ ...f, level: e.target.value as ProfileLevel }))}
                  className="rounded-lg border border-[color:var(--hmr-border)] bg-transparent px-3 py-2 text-sm"
                >
                  {LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveProfile()}
                className="rounded-lg bg-[color:var(--hmr-accent)] px-4 py-2 text-xs font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
              >
                {saving ? "Salvo…" : "Salva"}
              </button>
            </div>
          </div>
        ) : null}

        {routes.length > 0 ? (
          <div className="mt-6">
            <h2 className="text-sm font-medium">Percorsi pubblici</h2>
            <ul className="mt-3 grid gap-2">
              {routes.map((r) => (
                <li key={r.id}>
                  <Link
                    href={routeHref(r.activity, r.id)}
                    className="hmr-panel block rounded-xl border border-[color:var(--hmr-border)]/60 p-3 text-sm hover:border-[color:var(--hmr-accent)]/40"
                  >
                    <span className="font-medium">{r.name}</span>
                    <span className="ml-2 text-xs text-[color:var(--hmr-muted)]">
                      {r.length_km.toFixed(1)} km · +{Math.round(r.elev_gain_m)} m
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {photos.length > 0 ? (
          <div className="mt-6">
            <h2 className="text-sm font-medium">Foto</h2>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {photos.map((p) => (
                <div key={p.id} className="overflow-hidden rounded-lg border border-[color:var(--hmr-border)]/60">
                  {p.url ? <img src={p.url} alt="" className="aspect-square w-full object-cover" /> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {err ? <p className="mt-4 text-xs text-red-400">{err}</p> : null}
      </div>
    </div>
  );
}
