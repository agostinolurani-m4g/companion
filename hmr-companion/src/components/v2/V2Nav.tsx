"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = {
  isAdmin?: boolean;
};

const LINKS = [
  { href: "/v2/plan", label: "Pianifica" },
  { href: "/v2/me", label: "Area personale" },
] as const;

export default function V2Nav({ isAdmin = false }: Props) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-2 border-b border-[color:var(--hmr-border)]/60 px-4 py-2 text-xs">
      <Link href="/" className="text-[color:var(--hmr-muted)] hover:text-[color:var(--hmr-text)]">
        ← HMR v1
      </Link>
      <span className="rounded-full bg-[color:var(--hmr-accent)]/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[color:var(--hmr-accent)]">
        Beta v2
      </span>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={
            pathname === l.href
              ? "rounded-lg bg-[color:var(--hmr-accent)] px-2.5 py-1 font-medium text-[color:var(--hmr-bg)]"
              : "rounded-lg px-2.5 py-1 text-[color:var(--hmr-muted)] hover:bg-[color:var(--hmr-elev)] hover:text-[color:var(--hmr-text)]"
          }
        >
          {l.label}
        </Link>
      ))}
      {isAdmin ? (
        <Link
          href="/v2/admin"
          className={
            pathname === "/v2/admin"
              ? "rounded-lg bg-amber-500/90 px-2.5 py-1 font-medium text-[color:var(--hmr-bg)]"
              : "rounded-lg px-2.5 py-1 text-amber-400/90 hover:bg-amber-500/10"
          }
        >
          Admin
        </Link>
      ) : null}
    </nav>
  );
}
