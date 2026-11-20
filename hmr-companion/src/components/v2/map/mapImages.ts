import type { Map as MaplibreMap } from "maplibre-gl";
import { PATTERN_IDS } from "@/lib/map/swiss-style";

/** Icone cartografiche disegnate su canvas (stile carta svizzera): vetta ▲ e rifugio ■. */
function draw(size: number, paint: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paint(ctx, size);
  const data = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: new Uint8Array(data.data.buffer) };
}

function peak(fill: string, halo: string) {
  return () =>
    draw(24, (ctx, s) => {
      ctx.beginPath();
      ctx.moveTo(s / 2, 3);
      ctx.lineTo(s - 3, s - 5);
      ctx.lineTo(3, s - 5);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.strokeStyle = halo;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fill();
    });
}

/* ───────────── Trame "disegnate" (carta svizzera) per fill-pattern ───────────── */

/** PRNG deterministico: la trama è identica a ogni avvio (niente "sfarfallio" tra sessioni). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Disegna `mark` anche sui bordi opposti, così la trama si ripete senza cuciture. */
function tiled(ctx: CanvasRenderingContext2D, s: number, x: number, y: number, mark: (x: number, y: number) => void) {
  for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) mark(x + dx, y + dy);
}

/** Roccia: trattini obliqui irregolari a gruppi, come il tratteggio delle rupi. */
function rockHatch(ink: string) {
  return () =>
    draw(64, (ctx, s) => {
      const r = rng(7);
      ctx.strokeStyle = ink;
      ctx.lineCap = "round";
      for (let g = 0; g < 9; g++) {
        const gx = r() * s;
        const gy = r() * s;
        const ang = (-55 + r() * 25) * (Math.PI / 180);
        const n = 2 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          const len = 5 + r() * 6;
          const ox = gx + k * 2.6 * Math.cos(ang + Math.PI / 2);
          const oy = gy + k * 2.6 * Math.sin(ang + Math.PI / 2);
          ctx.lineWidth = 0.9 + r() * 0.5;
          tiled(ctx, s, ox, oy, (x, y) => {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + len * Math.cos(ang), y + len * Math.sin(ang));
            ctx.stroke();
          });
        }
      }
    });
}

/** Detriti/ghiaioni: puntinato di grana variabile. */
function screeStipple(ink: string) {
  return () =>
    draw(64, (ctx, s) => {
      const r = rng(11);
      ctx.fillStyle = ink;
      for (let i = 0; i < 70; i++) {
        const x = r() * s;
        const y = r() * s;
        const rad = 0.5 + r() * r() * 1.3;
        tiled(ctx, s, x, y, (px, py) => {
          ctx.beginPath();
          ctx.arc(px, py, rad, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    });
}

/** Bosco: piccoli segni d'albero radi (chioma tonda), non una griglia regolare. */
function forestTrees(ink: string) {
  return () =>
    // Coordinate in pixel canvas (pixelRatio 2): una chioma di raggio 5 ≈ 2.5 px a schermo.
    draw(112, (ctx, s) => {
      const r = rng(23);
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      // Griglia sfalsata con jitter: distribuzione uniforme ma non meccanica.
      const step = s / 4;
      for (let gy = 0; gy < 4; gy++) {
        for (let gx = 0; gx < 4; gx++) {
          if (r() < 0.2) continue;
          const x = (gx + 0.5 + (gy % 2) * 0.5) * step + (r() - 0.5) * step * 0.5;
          const y = (gy + 0.5) * step + (r() - 0.5) * step * 0.5;
          const rad = 4.2 + r() * 1.8;
          tiled(ctx, s, x, y, (px, py) => {
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(px, py, rad, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(px, py + rad);
            ctx.lineTo(px, py + rad + 3);
            ctx.stroke();
          });
        }
      }
    });
}

/** Grana della carta: puntini minimi su fondo trasparente (effetto stampa), sopra P.paper. */
function paperGrain(speck: string) {
  return () =>
    draw(128, (ctx, s) => {
      const r = rng(5);
      ctx.fillStyle = speck;
      for (let i = 0; i < 700; i++) {
        const x = Math.floor(r() * s);
        const y = Math.floor(r() * s);
        ctx.globalAlpha = 0.3 + r() * 0.7;
        ctx.fillRect(x, y, r() < 0.3 ? 2 : 1, 1 + Math.floor(r() * 2));
      }
      ctx.globalAlpha = 1;
    });
}

const PATTERNS: Record<string, () => ReturnType<typeof draw>> = {
  [PATTERN_IDS.light.rock]: rockHatch("rgba(96,84,72,0.42)"),
  [PATTERN_IDS.dark.rock]: rockHatch("rgba(205,212,218,0.20)"),
  [PATTERN_IDS.light.scree]: screeStipple("rgba(110,98,84,0.40)"),
  [PATTERN_IDS.dark.scree]: screeStipple("rgba(200,206,212,0.20)"),
  [PATTERN_IDS.light.forest]: forestTrees("rgba(92,132,78,0.42)"),
  [PATTERN_IDS.dark.forest]: forestTrees("rgba(140,180,150,0.20)"),
  [PATTERN_IDS.light.paper]: paperGrain("rgba(140,122,95,0.13)"),
  [PATTERN_IDS.dark.paper]: paperGrain("rgba(255,255,255,0.045)"),
};

const ICONS: Record<string, () => ReturnType<typeof draw>> = {
  ...PATTERNS,
  "v2-peak-light": peak("#c3c9cc", "rgba(20,23,26,0.9)"),
  "v2-peak": peak("#57504a", "rgba(244,243,239,0.95)"),
  "v2-hut": () =>
    draw(24, (ctx, s) => {
      ctx.fillStyle = "rgba(244,243,239,0.95)";
      ctx.fillRect(3, 3, s - 6, s - 6);
      ctx.fillStyle = "#5f9e97";
      ctx.fillRect(6, 6, s - 12, s - 12);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(s / 2, 8.5);
      ctx.lineTo(s - 8.5, s / 2);
      ctx.lineTo(8.5, s / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(9.5, s / 2, s - 19, 5);
    }),
};

/** Registra il gestore: lo stile chiede un'icona o una trama mancante → la generiamo. */
export function attachMapImages(map: MaplibreMap): void {
  map.on("styleimagemissing", (e: { id: string }) => {
    const make = ICONS[e.id];
    if (!make || map.hasImage(e.id)) return;
    const img = make();
    if (img) map.addImage(e.id, img, { pixelRatio: 2 });
  });
}
