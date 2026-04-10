import fs from "fs";
import path from "path";

const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_FETCH_BYTES = 5 * 1024 * 1024;

function sanitizeSessionId(sessionId: string): string {
  const s = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!s || s.length > 80) throw new Error("sessionId non valido");
  return s;
}

function safeJoin(root: string, rel: string): string {
  const normalized = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = path.join(root, normalized);
  const rootResolved = path.resolve(root) + path.sep;
  if (!path.resolve(full).startsWith(rootResolved)) {
    throw new Error("percorso non consentito");
  }
  return full;
}

export function getStudioRoot(cwd: string, sessionId: string): string {
  const id = sanitizeSessionId(sessionId);
  return path.join(cwd, "output", id);
}

export function ensureStudioRoot(cwd: string, sessionId: string): string {
  const root = getStudioRoot(cwd, sessionId);
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  return root;
}

export function studioWriteFile(
  cwd: string,
  sessionId: string,
  relativePath: string,
  content: string
): { path: string } {
  const root = ensureStudioRoot(cwd, sessionId);
  const target = safeJoin(root, relativePath);
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    throw new Error("file troppo grande");
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return { path: path.relative(root, target) };
}

export function studioListFiles(
  cwd: string,
  sessionId: string,
  relativeDir = ""
): { files: string[] } {
  const root = getStudioRoot(cwd, sessionId);
  if (!fs.existsSync(root)) return { files: [] };
  const dir = relativeDir ? safeJoin(root, relativeDir) : root;
  if (!fs.statSync(dir).isDirectory()) return { files: [] };
  const out: string[] = [];
  function walk(d: string, prefix: string) {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(p).isDirectory()) walk(p, rel);
      else out.push(rel.replace(/\\/g, "/"));
    }
  }
  walk(dir, "");
  return { files: out.sort() };
}

export async function studioFetchUrl(
  cwd: string,
  sessionId: string,
  urlStr: string,
  suggestedName?: string
): Promise<{ savedPath: string; contentType: string | null; bytes: number }> {
  const root = ensureStudioRoot(cwd, sessionId);
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error("URL non valido");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("solo http/https");
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 25000);
  const res = await fetch(u.toString(), {
    redirect: "follow",
    signal: controller.signal,
    headers: { "User-Agent": "StudioBuilder/1.0" },
  });
  clearTimeout(t);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = res.headers.get("content-length");
  if (len && parseInt(len, 10) > MAX_FETCH_BYTES) {
    throw new Error("contenuto troppo grande");
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FETCH_BYTES) throw new Error("contenuto troppo grande");
  const ct = res.headers.get("content-type");
  let ext = ".bin";
  if (ct?.includes("image/png")) ext = ".png";
  else if (ct?.includes("image/jpeg") || ct?.includes("image/jpg")) ext = ".jpg";
  else if (ct?.includes("image/webp")) ext = ".webp";
  else if (ct?.includes("image/gif")) ext = ".gif";
  else if (ct?.includes("text/html")) ext = ".html";
  const base =
    suggestedName?.replace(/[^a-zA-Z0-9._-]/g, "_") || `asset_${Date.now()}${ext}`;
  const name = base.includes(".") ? base : `${base}${ext}`;
  const target = safeJoin(path.join(root, "assets"), name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);
  return {
    savedPath: `assets/${path.basename(target)}`,
    contentType: ct,
    bytes: buf.length,
  };
}
