"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import Icon, { type IconName } from "@/components/v2/ui/Icon";
import { activeNavId, V2_NAV_LINKS } from "@/lib/v2-nav";
import { useV2Theme, V2ThemeProvider } from "@/components/v2/ui/theme";

function ThemeToggle() {
  const { theme, toggle } = useV2Theme();
  return (
    <button
      type="button"
      onClick={toggle}
      className="ui-icon-btn mb-1 text-[color:var(--hmr-faint)] hover:text-[color:var(--hmr-text)]"
      title={theme === "dark" ? "Tema chiaro" : "Tema scuro"}
      aria-label={theme === "dark" ? "Passa al tema chiaro" : "Passa al tema scuro"}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={19} />
    </button>
  );
}

function ThemedRoot({ children }: { children: React.ReactNode }) {
  const { theme } = useV2Theme();
  return <div className={`v2-theme ${theme === "light" ? "v2-light" : ""} flex h-[100dvh] min-h-0`}>{children}</div>;
}

type Props = {
  children: React.ReactNode;
  username?: string;
  isAdmin?: boolean;
};

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <span
      className="grid place-items-center rounded-[6px] bg-[color:var(--hmr-accent)] text-[color:var(--hmr-accent-ink)]"
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M2 20 9.2 7.6a1 1 0 0 1 1.7 0l3 5.1 1.6-2.6a1 1 0 0 1 1.7 0L22 20H2Z" />
      </svg>
    </span>
  );
}

function RailLink({ href, label, icon, active }: { href: string; label: string; icon: IconName; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex w-full flex-col items-center gap-1 py-2.5 text-[10.5px] font-medium transition-colors ${
        active ? "text-[color:var(--hmr-text)]" : "text-[color:var(--hmr-faint)] hover:text-[color:var(--hmr-text)]"
      }`}
    >
      {active ? <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-[color:var(--hmr-accent)]" aria-hidden /> : null}
      <Icon name={icon} size={20} strokeWidth={active ? 2 : 1.7} />
      {label}
    </Link>
  );
}

function ShellNav({ username, isAdmin }: { username?: string; isAdmin: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = activeNavId(pathname, searchParams.get("mode"));
  const profileHref = username ? `/v2/u/${encodeURIComponent(username)}` : "/v2/me";
  const initial = (username ?? "?").slice(0, 1).toUpperCase();

  return (
    <>
      <aside className="z-30 hidden w-[76px] shrink-0 flex-col items-center border-r border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)] py-3 lg:flex">
        <Link href="/v2/plan" className="mb-4" aria-label="HMR · home">
          <BrandMark />
        </Link>
        {V2_NAV_LINKS.map((l) => (
          <RailLink key={l.id} href={l.href} label={l.label} icon={l.icon} active={active === l.id} />
        ))}
        <div className="flex-1" />
        <ThemeToggle />
        {isAdmin ? <RailLink href="/v2/admin" label="Admin" icon="settings" active={active === "admin"} /> : null}
        <Link
          href={profileHref}
          aria-current={active === "profile" ? "page" : undefined}
          title="Profilo"
          className={`mt-2 grid h-9 w-9 place-items-center rounded-full border text-[13px] font-semibold ${
            active === "profile"
              ? "border-[color:var(--hmr-accent)] bg-[color:var(--hmr-accent-dim)] text-[color:var(--hmr-accent)]"
              : "border-[color:var(--hmr-border)] text-[color:var(--hmr-text)] hover:border-[color:var(--hmr-faint)]"
          }`}
        >
          {initial}
        </Link>
      </aside>

      <nav
        className="fixed inset-x-0 bottom-0 z-50 flex border-t border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)] lg:hidden"
        style={{ paddingBottom: "var(--safe-bottom)", height: "calc(var(--v2-tabbar) + var(--safe-bottom))" }}
        aria-label="Navigazione principale"
      >
        {[...V2_NAV_LINKS.filter((l) => l.mobile), { id: "profile", href: profileHref, label: "Profilo", icon: "user" as IconName }].map((l) => {
          const on = active === l.id;
          return (
            <Link
              key={l.id}
              href={l.href}
              aria-current={on ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-medium ${
                on ? "text-[color:var(--hmr-text)]" : "text-[color:var(--hmr-faint)]"
              }`}
            >
              {on ? <span className="absolute inset-x-5 top-0 h-[2px] bg-[color:var(--hmr-accent)]" aria-hidden /> : null}
              <Icon name={l.icon} size={20} strokeWidth={on ? 2 : 1.7} />
              {l.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export default function V2Shell({ children, username, isAdmin = false }: Props) {
  return (
    <V2ThemeProvider>
      <ThemedRoot>
        <Suspense fallback={<aside className="hidden w-[76px] shrink-0 lg:block" />}>
          <ShellNav username={username} isAdmin={isAdmin} />
        </Suspense>
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col pb-[calc(var(--v2-tabbar)+var(--safe-bottom))] lg:pb-0">
          {children}
        </main>
      </ThemedRoot>
    </V2ThemeProvider>
  );
}
