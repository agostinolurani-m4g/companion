"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@/components/v2/ui/Icon";

export type NotificationDto = {
  id: string;
  kind: "segment_pr" | "segment_crown" | "segment_crown_lost";
  title: string;
  body: string;
  href: string | null;
  created_at: number;
  read_at: number | null;
};

const POLL_MS = 120_000;
const EVENT = "hmr:notifications";

async function fetchNotifications(): Promise<{ notifications: NotificationDto[]; unread: number } | null> {
  try {
    const r = await fetch("/api/v2/notifications", { cache: "no-store" });
    return r.ok ? ((await r.json()) as { notifications: NotificationDto[]; unread: number }) : null;
  } catch {
    return null;
  }
}

/** Conteggio non lette (badge), aggiornato ogni 2 minuti e quando la campanella le segna lette. */
export function useUnreadNotifications(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void fetchNotifications().then((d) => {
        if (alive && d) setN(d.unread);
      });
    load();
    const id = window.setInterval(load, POLL_MS);
    const onEvt = (e: Event) => setN((e as CustomEvent<number>).detail);
    window.addEventListener(EVENT, onEvt);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener(EVENT, onEvt);
    };
  }, []);
  return n;
}

const KIND_ICON: Record<NotificationDto["kind"], string> = {
  segment_pr: "⏱",
  segment_crown: "👑",
  segment_crown_lost: "⚔",
};

function timeAgo(t: number): string {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min fa`;
  if (s < 86400) return `${Math.round(s / 3600)} h fa`;
  return new Date(t).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

/** Elenco notifiche (usato nella campanella e nella pagina profilo). */
export function V2NotificationsList({ onNavigate }: { onNavigate?: () => void }) {
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const load = useCallback(async () => {
    const d = await fetchNotifications();
    setItems(d?.notifications ?? []);
    if (d && d.unread > 0) {
      const r = await fetch("/api/v2/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(
        () => null,
      );
      if (r?.ok) window.dispatchEvent(new CustomEvent(EVENT, { detail: 0 }));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (items == null) return <p className="p-3 text-xs text-[color:var(--hmr-muted)]">Carico…</p>;
  if (!items.length) {
    return (
      <p className="p-3 text-xs text-[color:var(--hmr-muted)]">
        Nessuna notifica. Qui trovi i nuovi record e le corone sui segmenti.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-[color:var(--hmr-border)]">
      {items.map((n) => {
        const inner = (
          <div className={`flex gap-2.5 px-3 py-2.5 ${n.read_at ? "" : "bg-[color:var(--hmr-accent-dim)]"}`}>
            <span className="text-base leading-5" aria-hidden>
              {KIND_ICON[n.kind] ?? "•"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium leading-snug">{n.title}</span>
              {n.body ? <span className="block text-[11.5px] text-[color:var(--hmr-muted)]">{n.body}</span> : null}
              <span className="block text-[10.5px] text-[color:var(--hmr-faint)]">{timeAgo(n.created_at)}</span>
            </span>
          </div>
        );
        return (
          <li key={n.id}>
            {n.href ? (
              <Link href={n.href} onClick={onNavigate} className="block hover:bg-[color:var(--hmr-elev)]">
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Campanella nella barra laterale (desktop): badge + pannello. */
export default function V2NotificationBell() {
  const unread = useUnreadNotifications();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ui-icon-btn relative text-[color:var(--hmr-faint)] hover:text-[color:var(--hmr-text)]"
        aria-label={unread ? `Notifiche, ${unread} non lette` : "Notifiche"}
        aria-expanded={open}
        title="Notifiche"
      >
        <Icon name="bell" size={19} />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[color:var(--hmr-danger)] px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute bottom-0 left-full z-50 ml-2 max-h-[70vh] w-80 overflow-y-auto rounded-xl border border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)] shadow-xl">
          <p className="border-b border-[color:var(--hmr-border)] px-3 py-2 text-[12.5px] font-semibold">Notifiche</p>
          <V2NotificationsList onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
