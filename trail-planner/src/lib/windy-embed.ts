/** Windy embed: layer «Rain, thunder» = pioggia/neve + densità fulmini (modello, non radar live). */

const EMBED_BASE = "https://embed.windy.com/embed2.html";

export function buildWindyEmbed2Url(opts: {
  lat: number;
  lng: number;
  zoom: number;
  /** Istante timeline previsione (ms Unix). ECMWF, non radar. */
  forecastTimeMs: number;
}): string {
  const q = new URLSearchParams();
  q.set("lat", String(opts.lat));
  q.set("lon", String(opts.lng));
  q.set("zoom", String(opts.zoom));
  q.set("overlay", "rain");
  q.set("product", "ecmwf");
  q.set("level", "surface");
  q.set("timestamp", String(Math.round(opts.forecastTimeMs)));
  q.set("menu", "");
  return `${EMBED_BASE}?${q.toString()}`;
}

/** Link al sito Windy: ECMWF + layer pioggia/tuoni. */
export function buildWindyMainSiteUrl(lat: number, lng: number, zoom: number): string {
  return `https://www.windy.com/?ecmwf,rain,${lat},${lng},${zoom}`;
}
