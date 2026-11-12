import type { Map as MaplibreMap } from "maplibre-gl";

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

const ICONS: Record<string, () => ReturnType<typeof draw>> = {
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

/** Registra il gestore: lo stile chiede un'icona mancante → la generiamo. */
export function attachMapImages(map: MaplibreMap): void {
  map.on("styleimagemissing", (e: { id: string }) => {
    const make = ICONS[e.id];
    if (!make || map.hasImage(e.id)) return;
    const img = make();
    if (img) map.addImage(e.id, img, { pixelRatio: 2 });
  });
}
