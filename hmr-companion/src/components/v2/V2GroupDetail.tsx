"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import V2Nav from "@/components/v2/V2Nav";
import type { GroupMemberRole, GroupType } from "@/lib/db";

type Props = {
  groupId: string;
  username: string;
  isAdmin?: boolean;
};

type GroupDetail = {
  id: string;
  name: string;
  type: GroupType;
  type_label: string;
  description: string;
  member_count: number;
  members: Array<{ username: string; role: GroupMemberRole }>;
  route_id: string | null;
  created_by: string;
};

type Message = {
  id: string;
  from_user: string;
  body: string;
  created_at: number;
};

const POLL_MS = 5000;

function formatMsgTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

export default function V2GroupDetail({ groupId, username, isAdmin = false }: Props) {
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [myRole, setMyRole] = useState<GroupMemberRole | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tab, setTab] = useState<"chat" | "members">("chat");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [memberInput, setMemberInput] = useState("");
  const lastTsRef = useRef(0);

  const loadGroup = useCallback(async () => {
    const res = await fetch(`/api/v2/groups/${encodeURIComponent(groupId)}`);
    const data = (await res.json()) as {
      error?: string;
      group?: GroupDetail;
      my_role?: GroupMemberRole;
    };
    if (!res.ok) throw new Error(data.error ?? "Gruppo non trovato");
    setGroup(data.group ?? null);
    setMyRole(data.my_role ?? null);
  }, [groupId]);

  const loadMessages = useCallback(
    async (initial = false) => {
      const since = initial ? 0 : lastTsRef.current;
      const url =
        since > 0
          ? `/api/v2/groups/${encodeURIComponent(groupId)}/messages?since=${since}`
          : `/api/v2/groups/${encodeURIComponent(groupId)}/messages`;
      const res = await fetch(url);
      const data = (await res.json()) as { error?: string; messages?: Message[] };
      if (!res.ok) throw new Error(data.error ?? "Messaggi non caricati");
      const incoming = data.messages ?? [];
      if (initial) {
        setMessages(incoming);
      } else if (incoming.length > 0) {
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          const merged = [...prev];
          for (const m of incoming) {
            if (!ids.has(m.id)) merged.push(m);
          }
          return merged;
        });
      }
      if (incoming.length > 0) {
        lastTsRef.current = Math.max(lastTsRef.current, ...incoming.map((m) => m.created_at));
      }
    },
    [groupId]
  );

  const loadAll = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      await loadGroup();
      lastTsRef.current = 0;
      await loadMessages(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [loadGroup, loadMessages]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void loadMessages(false).catch(() => {});
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setErr(null);
    try {
      const res = await fetch(`/api/v2/groups/${encodeURIComponent(groupId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = (await res.json()) as { error?: string; message?: Message };
      if (!res.ok) throw new Error(data.error ?? "Invio fallito");
      if (data.message) {
        setMessages((prev) => [...prev, data.message!]);
        lastTsRef.current = Math.max(lastTsRef.current, data.message.created_at);
      }
      setText("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const addMember = async () => {
    const u = memberInput.trim().toLowerCase();
    if (!u) return;
    try {
      const res = await fetch(`/api/v2/groups/${encodeURIComponent(groupId)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u }),
      });
      const data = (await res.json()) as { error?: string; group?: GroupDetail };
      if (!res.ok) throw new Error(data.error ?? "Invito fallito");
      setGroup(data.group ?? null);
      setMemberInput("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const removeMember = async (target: string) => {
    if (!window.confirm(`Rimuovere @${target} dal gruppo?`)) return;
    try {
      const res = await fetch(
        `/api/v2/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(target)}`,
        { method: "DELETE" }
      );
      const data = (await res.json()) as { error?: string; group?: GroupDetail };
      if (!res.ok) throw new Error(data.error ?? "Rimozione fallita");
      setGroup(data.group ?? null);
      if (target === username) router.push("/v2/groups");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteGroup = async () => {
    if (!window.confirm("Eliminare definitivamente questo gruppo?")) return;
    try {
      const res = await fetch(`/api/v2/groups/${encodeURIComponent(groupId)}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Eliminazione fallita");
      router.push("/v2/groups");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const canManageMembers = myRole === "owner" || myRole === "admin";

  if (busy) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <V2Nav isAdmin={isAdmin} username={username} />
        <p className="p-4 text-sm text-[color:var(--hmr-muted)]">Caricamento…</p>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <V2Nav isAdmin={isAdmin} username={username} />
        <p className="p-4 text-sm text-red-400">{err ?? "Gruppo non trovato"}</p>
        <Link href="/v2/groups" className="px-4 text-xs text-[color:var(--hmr-accent)]">
          ← Torna ai gruppi
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <V2Nav isAdmin={isAdmin} username={username} />
      <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col p-4">
        <div className="shrink-0">
          <Link href="/v2/groups" className="text-xs text-[color:var(--hmr-muted)] hover:text-[color:var(--hmr-text)]">
            ← Gruppi
          </Link>
          <div className="mt-2 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">{group.name}</h1>
              <p className="text-xs text-[color:var(--hmr-muted)]">
                {group.type_label} · {group.member_count} membri
              </p>
              {group.description ? (
                <p className="mt-1 text-sm text-[color:var(--hmr-muted)]">{group.description}</p>
              ) : null}
              {group.route_id ? (
                <Link
                  href={`/v2/plan?route=${encodeURIComponent(group.route_id)}`}
                  className="mt-2 inline-block text-xs text-[color:var(--hmr-accent)]"
                >
                  Apri percorso collegato →
                </Link>
              ) : null}
            </div>
            {myRole === "owner" ? (
              <button
                type="button"
                onClick={() => void deleteGroup()}
                className="shrink-0 text-xs text-red-400"
              >
                Elimina
              </button>
            ) : null}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setTab("chat")}
              className={
                tab === "chat"
                  ? "rounded-lg bg-[color:var(--hmr-accent)] px-3 py-1.5 text-xs font-medium text-[color:var(--hmr-bg)]"
                  : "rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs"
              }
            >
              Messaggi
            </button>
            <button
              type="button"
              onClick={() => setTab("members")}
              className={
                tab === "members"
                  ? "rounded-lg bg-[color:var(--hmr-accent)] px-3 py-1.5 text-xs font-medium text-[color:var(--hmr-bg)]"
                  : "rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs"
              }
            >
              Membri
            </button>
          </div>
        </div>

        {tab === "chat" ? (
          <>
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-[color:var(--hmr-border)]/60 bg-[color:var(--hmr-elev)]/30 p-3">
              {messages.length === 0 ? (
                <p className="text-center text-sm text-[color:var(--hmr-muted)]">
                  Nessun messaggio. Scrivi il primo!
                </p>
              ) : (
                <ul className="grid gap-2">
                  {messages.map((m) => {
                    const mine = m.from_user === username;
                    return (
                      <li
                        key={m.id}
                        className={`flex ${mine ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={
                            mine
                              ? "max-w-[85%] rounded-2xl rounded-br-md bg-[color:var(--hmr-accent)] px-3 py-2 text-sm text-[color:var(--hmr-bg)]"
                              : "max-w-[85%] rounded-2xl rounded-bl-md border border-[color:var(--hmr-border)]/60 bg-[color:var(--hmr-panel)] px-3 py-2 text-sm"
                          }
                        >
                          {!mine ? (
                            <Link
                              href={`/v2/u/${encodeURIComponent(m.from_user)}`}
                              className="text-[10px] font-medium text-[color:var(--hmr-accent)]"
                            >
                              @{m.from_user}
                            </Link>
                          ) : null}
                          <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          <p
                            className={`mt-0.5 text-[10px] ${mine ? "text-[color:var(--hmr-bg)]/70" : "text-[color:var(--hmr-muted)]"}`}
                          >
                            {formatMsgTime(m.created_at)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="mt-3 flex shrink-0 gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Scrivi un messaggio…"
                className="min-w-0 flex-1 rounded-xl border border-[color:var(--hmr-border)] bg-transparent px-3 py-2.5 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <button
                type="button"
                disabled={sending || !text.trim()}
                onClick={() => void sendMessage()}
                className="rounded-xl bg-[color:var(--hmr-accent)] px-4 py-2.5 text-xs font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
              >
                Invia
              </button>
            </div>
          </>
        ) : (
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {canManageMembers ? (
              <div className="mb-4 flex gap-2">
                <input
                  value={memberInput}
                  onChange={(e) => setMemberInput(e.target.value)}
                  placeholder="username da invitare"
                  className="min-w-0 flex-1 rounded-lg border border-[color:var(--hmr-border)] bg-transparent px-3 py-2 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addMember();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => void addMember()}
                  className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-2 text-xs"
                >
                  Invita
                </button>
              </div>
            ) : null}

            <ul className="grid gap-2">
              {group.members.map((m) => (
                <li
                  key={m.username}
                  className="hmr-panel flex items-center justify-between rounded-xl border border-[color:var(--hmr-border)]/60 px-3 py-2"
                >
                  <div>
                    <Link
                      href={`/v2/u/${encodeURIComponent(m.username)}`}
                      className="text-sm font-medium hover:text-[color:var(--hmr-accent)]"
                    >
                      @{m.username}
                    </Link>
                    <span className="ml-2 text-[10px] text-[color:var(--hmr-muted)]">{m.role}</span>
                  </div>
                  {(canManageMembers && m.role !== "owner") || m.username === username ? (
                    m.role !== "owner" ? (
                      <button
                        type="button"
                        onClick={() => void removeMember(m.username)}
                        className="text-xs text-red-400"
                      >
                        {m.username === username ? "Esci" : "Rimuovi"}
                      </button>
                    ) : null
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        {err ? <p className="mt-2 shrink-0 text-xs text-red-400">{err}</p> : null}
      </div>
    </div>
  );
}
