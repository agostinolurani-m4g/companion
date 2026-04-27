import { NextResponse } from "next/server";
import { getItinerary, listStops } from "@/lib/db";
import { computeLegDayStats } from "@/lib/leg-day-stats";
import type { Feature, LineString } from "geojson";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const it = getItinerary(id);
  if (!it) {
    return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  }
  const stops = listStops(id);
  let coords: [number, number][] | null = null;
  if (it.line_geojson) {
    try {
      const f = JSON.parse(it.line_geojson) as Feature<LineString> | LineString;
      const geom = "geometry" in f && f.geometry ? f.geometry : (f as LineString);
      if (geom?.type === "LineString" && Array.isArray(geom.coordinates)) {
        coords = geom.coordinates as [number, number][];
      }
    } catch {
      /* ignore */
    }
  }
  const legs = computeLegDayStats(stops, coords);

  const rows = stops
    .sort((a, b) => a.order_index - b.order_index)
    .map(
      (s) =>
        `<tr><td>${esc(s.name)}</td><td>${s.leg_index + 1}</td><td>${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</td><td>${esc((s.notes ?? "").slice(0, 200))}</td></tr>`
    )
    .join("");

  const legRows = legs
    .map(
      (l) =>
        `<tr><td>Giorno ${l.legIndex + 1}</td><td>${l.stopCount}</td><td>${l.distanceKm != null ? `${l.distanceKm.toFixed(1)} km (lungo traccia)` : "—"}</td></tr>`
    )
    .join("");

  const notes = it.planner_notes?.trim()
    ? `<section class="box"><h2>Note piano</h2><p>${esc(it.planner_notes.trim()).replace(/\n/g, "<br/>")}</p></section>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(it.name)} — Riepilogo</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 1.5rem auto; padding: 0 12px; color: #111; }
    h1 { font-size: 1.35rem; }
    h2 { font-size: 1rem; margin-top: 1.25rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
    th { background: #f4f4f5; }
    .meta { color: #555; font-size: 0.9rem; margin-bottom: 1rem; }
    .box { margin: 1rem 0; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>${esc(it.name)}</h1>
  <p class="meta">Attività: ${esc(String(it.activity))}
    ${it.start_date && it.end_date ? ` · Date: ${esc(it.start_date)} → ${esc(it.end_date)}` : ""}
  </p>
  ${notes}
  <section class="box">
    <h2>Giornate (stima su traccia)</h2>
    <table><thead><tr><th>Giornata</th><th>Tappe</th><th>Distanza</th></tr></thead><tbody>${legRows || "<tr><td colspan=\"3\">Nessuna tappa</td></tr>"}</tbody></table>
  </section>
  <section class="box">
    <h2>Elenco tappe</h2>
    <table><thead><tr><th>Nome</th><th>Giorno</th><th>Coord.</th><th>Note</th></tr></thead><tbody>${rows || "<tr><td colspan=\"4\">Nessuna tappa</td></tr>"}</tbody></table>
  </section>
  <p class="meta" style="margin-top:2rem;">Sentiero — riepilogo locale. Stampa da browser (⌘P) per PDF.</p>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
