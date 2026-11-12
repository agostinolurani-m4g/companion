import type { IconName } from "@/components/v2/ui/Icon";

export type V2NavLink = {
  id: string;
  href: string;
  label: string;
  icon: IconName;
  /** Visibile nella tab bar mobile (max 5 voci). */
  mobile: boolean;
};

/** Navigazione v2 unificata (rail desktop + tab bar mobile). */
export const V2_NAV_LINKS: readonly V2NavLink[] = [
  { id: "plan", href: "/v2/plan", label: "Pianifica", icon: "route", mobile: true },
  { id: "explore", href: "/v2/plan?mode=explore", label: "Esplora", icon: "compass", mobile: true },
  { id: "safety", href: "/v2/sicurezza", label: "Sicurezza", icon: "shield", mobile: true },
  { id: "groups", href: "/v2/groups", label: "Gruppi", icon: "users", mobile: true },
  { id: "photos", href: "/v2/foto", label: "Foto", icon: "camera", mobile: false },
] as const;

/** Determina la voce attiva da pathname + query (Esplora vive in /v2/plan?mode=explore). */
export function activeNavId(pathname: string, mode: string | null): string | null {
  if (pathname === "/v2/plan" || pathname.startsWith("/v2/plan/")) {
    return mode === "explore" ? "explore" : "plan";
  }
  if (pathname.startsWith("/v2/esplora") || pathname.startsWith("/v2/scialpinismo/esplora")) return "explore";
  if (pathname.startsWith("/v2/scialpinismo")) return "plan";
  if (pathname.startsWith("/v2/sicurezza")) return "safety";
  if (pathname.startsWith("/v2/groups")) return "groups";
  if (pathname.startsWith("/v2/foto")) return "photos";
  if (pathname.startsWith("/v2/u/") || pathname === "/v2/me") return "profile";
  if (pathname.startsWith("/v2/admin")) return "admin";
  return null;
}
