import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb, listFieldReportsInBbox } from "@/lib/db";
import { serializeFieldReportForViewer } from "@/lib/field-reports-server";
import { allTagRows, keyFactsFromTags } from "@/lib/outdoor/tag-labels";
import { kindLabel } from "@/lib/outdoor/kinds";
import { enrichFeatureDetail } from "@/lib/outdoor/enrich";
import { getDestinationSigns, getOutdoorFeatureById } from "@/lib/outdoor/store";
import {
  refugesInfoExternalUrl,
  summarizeRefugesInfo,
  type RefugesInfoSummary,
} from "@/lib/outdoor/sources/refuges-info";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  const db = getDb();
  const row = getOutdoorFeatureById(db, id);
  if (!row) return NextResponse.json({ error: "Non trovato" }, { status: 404 });

  const tags = JSON.parse(row.tags_json) as Record<string, string>;
  const signs = getDestinationSigns(db, id);
  const enrich = await enrichFeatureDetail(db, row, tags);

  const pad = 0.01;
  const reportRows = listFieldReportsInBbox(
    row.lat - pad,
    row.lng - pad,
    row.lat + pad,
    row.lng + pad,
    true,
  );
  const reports = reportRows
    .map((r) => serializeFieldReportForViewer(r, auth.email))
    .slice(0, 8);

  // Punti creati da refuges.info (osm_id negativo) non hanno un oggetto OSM.
  const osmUrl =
    row.source === "refuges.info" || row.osm_id < 0
      ? null
      : row.osm_type === "node"
        ? `https://www.openstreetmap.org/node/${row.osm_id}`
        : row.osm_type === "way"
          ? `https://www.openstreetmap.org/way/${row.osm_id}`
          : `https://www.openstreetmap.org/relation/${row.osm_id}`;

  let refugesInfo: RefugesInfoSummary | null = null;
  const externalLinks = enrich.links.map((l) => {
    let url: string | null = null;
    if (l.source === "refuges.info") {
      let payload: unknown = null;
      try {
        payload = JSON.parse(l.payload_json);
      } catch {
        payload = null;
      }
      const summary = summarizeRefugesInfo(payload);
      if (summary && !refugesInfo) refugesInfo = summary;
      url = summary?.url ?? refugesInfoExternalUrl(Number(l.external_id));
    }
    if (l.source === "camptocamp") url = `https://www.camptocamp.org/routes/${l.external_id}`;
    return { source: l.source, external_id: l.external_id, fetched_at: l.fetched_at, url };
  });

  return NextResponse.json({
    feature: {
      id: row.id,
      kind: row.kind,
      kindLabel: kindLabel(row.kind),
      grp: row.grp,
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      ele: row.ele,
      eleSource: row.ele_source ?? null,
      geom: row.geom_json ? JSON.parse(row.geom_json) : null,
      tags,
      keyFacts: keyFactsFromTags(tags),
      allTags: allTagRows(tags),
      destinationSigns: signs,
      osmUrl,
    },
    photos: enrich.wiki.photos,
    commons: enrich.commons,
    wiki: { extract: enrich.wiki.extract, wiki_url: enrich.wiki.wiki_url },
    camptocamp: enrich.camptocamp,
    weather: enrich.weather,
    reports,
    links: externalLinks,
    refugesInfo,
  });
}
