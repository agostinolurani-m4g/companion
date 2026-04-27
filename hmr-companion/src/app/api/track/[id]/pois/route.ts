import { NextResponse } from "next/server";
import { listPois, type PoiCategory } from "@/lib/db";

export const runtime = "nodejs";

const ALL_CATEGORIES: PoiCategory[] = [
  "water",
  "hut",
  "lodging",
  "shop",
  "restaurant",
  "pharmacy",
  "atm",
  "bus",
];

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const raw = url.searchParams.get("categories");
  const categories: PoiCategory[] | undefined = raw
    ? (raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is PoiCategory => (ALL_CATEGORIES as string[]).includes(s)))
    : undefined;

  const fromKm = parseNumber(url.searchParams.get("fromKm"));
  const toKm = parseNumber(url.searchParams.get("toKm"));
  const maxDetourM = parseNumber(url.searchParams.get("maxDetourM"));

  const pois = listPois(id, { categories, fromKm, toKm, maxDetourM });
  return NextResponse.json({ pois });
}

function parseNumber(v: string | null): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
