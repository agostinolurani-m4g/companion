/**
 * Genera PNG per PWA da public/icon.svg (devDependency sharp).
 * Uso: npm run icons:pwa
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const svgPath = path.join(root, "public", "icon.svg");
const svg = fs.readFileSync(svgPath);

async function main() {
  await sharp(svg, { density: 400 })
    .resize(192, 192, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, "public", "icon-192.png"));
  console.log("wrote public/icon-192.png");

  await sharp(svg, { density: 400 })
    .resize(512, 512, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, "public", "icon-512.png"));
  console.log("wrote public/icon-512.png");

  await sharp(svg, { density: 400 })
    .resize(410, 410, { fit: "contain", background: { r: 11, g: 18, b: 33, alpha: 1 } })
    .extend({
      top: 51,
      bottom: 51,
      left: 51,
      right: 51,
      background: { r: 11, g: 18, b: 33, alpha: 1 },
    })
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, "public", "icon-maskable-512.png"));
  console.log("wrote public/icon-maskable-512.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
