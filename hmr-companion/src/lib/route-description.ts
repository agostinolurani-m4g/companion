/**
 * Descrizione di ripiego generata dai fatti del percorso, quando la fonte non fornisce un testo.
 * È sempre marcata come generata automaticamente.
 */
import type { Grade } from "@/lib/content/difficulty-scales";
import { ROUTE_SHAPE_LABEL, type RouteShape } from "@/lib/route-shape";

export type GeneratedDescription = { text: string; lang: "it"; generated: true };

export type FallbackInput = {
  lengthKm: number;
  gainM: number;
  routeType: RouteShape | null;
  elevationMax: number | null;
  difficulty: Grade[];
  durationLabel: string | null;
  waymark: { ref: string | null; operator: string | null } | null;
  from: string | null;
  to: string | null;
  orientations: string[];
  surface?: string | null;
  equippedM?: number | null;
};

const SURFACE_IT: Record<string, string> = {
  asphalt: "asfalto",
  paved: "asfalto",
  concrete: "cemento",
  gravel: "sterrato",
  fine_gravel: "sterrato fine",
  compacted: "sterrato compatto",
  unpaved: "sterrato",
  dirt: "terra",
  ground: "terra",
  grass: "erba",
  rock: "roccia",
  pebblestone: "ciottoli",
  paving_stones: "lastricato",
  sett: "porfido/pavé",
};

const nf0 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** null se i fatti non bastano per una frase utile (solo la lunghezza non basta). */
export function buildFallbackDescription(f: FallbackInput): GeneratedDescription | null {
  if (!(f.lengthKm > 0)) return null;
  const parts: string[] = [];
  const kind = f.routeType ? ROUTE_SHAPE_LABEL[f.routeType] : "Percorso";
  let first = `${kind} di ${nf1.format(f.lengthKm)} km`;
  if (f.gainM > 0) first += ` con ${nf0.format(Math.round(f.gainM))} m di dislivello positivo`;
  if (f.elevationMax != null && f.elevationMax > 0) first += `, quota massima ${nf0.format(Math.round(f.elevationMax))} m`;
  parts.push(`${first}.`);
  let extra = 0;
  const d = f.difficulty[0];
  if (d) {
    parts.push(`Difficoltà ${d.value}: ${d.explanation.charAt(0).toLowerCase()}${d.explanation.slice(1)}`);
    extra++;
  }
  if (f.waymark?.ref || f.from || f.to) {
    let s = f.waymark?.ref ? `Segnavia ${f.waymark.ref}` : "Itinerario";
    if (f.waymark?.operator) s += ` (${f.waymark.operator})`;
    if (f.from && f.to) s += `, da ${f.from} a ${f.to}`;
    else if (f.from) s += `, da ${f.from}`;
    else if (f.to) s += `, verso ${f.to}`;
    parts.push(`${s}.`);
    extra++;
  }
  if (f.surface && SURFACE_IT[f.surface]) {
    parts.push(`Fondo prevalente: ${SURFACE_IT[f.surface]}.`);
    extra++;
  }
  if (f.equippedM && f.equippedM > 50) {
    parts.push(`Comprende tratti attrezzati (circa ${nf0.format(Math.round(f.equippedM / 10) * 10)} m).`);
    extra++;
  }
  if (f.orientations.length) {
    parts.push(`Esposizione: ${f.orientations.join(", ")}.`);
    extra++;
  }
  if (f.durationLabel) {
    parts.push(`Tempo stimato in movimento ≈ ${f.durationLabel}.`);
  }
  if (extra === 0 && !(f.gainM > 0) && f.elevationMax == null && !f.routeType) return null;
  return { text: parts.join(" "), lang: "it", generated: true };
}
