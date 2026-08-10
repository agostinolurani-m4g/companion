import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import {
  countUserPhotos,
  insertUserPhoto,
  listUserPhotos,
  listUserPhotosInBbox,
} from "@/lib/db";
import { avatarUrl } from "@/lib/social-labels";

export const runtime = "nodejs";

const MAX_PHOTOS = 50;
const MAX_BYTES = 5 * 1024 * 1024;

export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const url = new URL(req.url);
  const owner = (url.searchParams.get("owner") ?? "").trim().toLowerCase();
  const bbox = url.searchParams.get("bbox");

  if (bbox) {
    const parts = bbox.split(",").map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
      return NextResponse.json({ error: "bbox non valido (south,west,north,east)" }, { status: 400 });
    }
    const [south, west, north, east] = parts;
    const rows = listUserPhotosInBbox(south, west, north, east);
    return NextResponse.json({
      photos: rows.map((p) => ({
        id: p.id,
        owner: p.owner,
        lng: p.lng,
        lat: p.lat,
        caption: p.caption,
        url: avatarUrl(p.photo_path),
        route_id: p.route_id,
        created_at: p.created_at,
      })),
    });
  }

  const target = owner || auth.email;
  const rows = listUserPhotos(target, 50);
  return NextResponse.json({
    photos: rows.map((p) => ({
      id: p.id,
      owner: p.owner,
      lng: p.lng,
      lat: p.lat,
      caption: p.caption,
      url: avatarUrl(p.photo_path),
      route_id: p.route_id,
      created_at: p.created_at,
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  if (countUserPhotos(auth.email) >= MAX_PHOTOS) {
    return NextResponse.json({ error: `Limite di ${MAX_PHOTOS} foto raggiunto` }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const lng = Number(form.get("lng"));
  const lat = Number(form.get("lat"));
  const caption = String(form.get("caption") ?? "").trim();
  const routeId = String(form.get("route_id") ?? "").trim() || null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file richiesto" }, { status: 400 });
  }
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return NextResponse.json({ error: "lng e lat richiesti" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File troppo grande (max 5 MB)" }, { status: 400 });
  }

  const relDir = path.join("data", "uploads", "v2", "photos", auth.email);
  const absDir = path.join(process.cwd(), relDir);
  fs.mkdirSync(absDir, { recursive: true });

  const photoId = crypto.randomUUID();
  const ext = path.extname(file.name) || ".jpg";
  const filename = `${photoId}${ext}`;
  const relPath = path.join(relDir, filename).replace(/\\/g, "/");
  const absPath = path.join(process.cwd(), relPath);
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(absPath, buf);

  const photo = insertUserPhoto({
    id: photoId,
    owner: auth.email,
    lng,
    lat,
    caption,
    photo_path: relPath,
    route_id: routeId,
    created_at: Date.now(),
  });

  return NextResponse.json(
    {
      photo: {
        id: photo.id,
        lng: photo.lng,
        lat: photo.lat,
        caption: photo.caption,
        url: avatarUrl(photo.photo_path),
      },
    },
    { status: 201 },
  );
}
