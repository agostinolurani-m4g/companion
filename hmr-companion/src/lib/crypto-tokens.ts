import crypto from "node:crypto";

/**
 * Cifratura simmetrica (AES-256-GCM) per i token OAuth dei provider esterni
 * salvati in SQLite. Chiave da `HMR_TOKEN_KEY` (qualsiasi stringa: viene
 * derivata con SHA-256); in mancanza si deriva da `STRAVA_CLIENT_SECRET`.
 */
function resolveKey(explicit?: string): Buffer {
  const raw = explicit ?? process.env.HMR_TOKEN_KEY?.trim() ?? process.env.STRAVA_CLIENT_SECRET?.trim();
  if (!raw) {
    throw new Error("HMR_TOKEN_KEY non configurata: impossibile cifrare i token dei provider esterni.");
  }
  return crypto.createHash("sha256").update(`hmr-token-key:${raw}`).digest();
}

const VERSION = "v1";

export function encryptToken(plain: string, key?: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", resolveKey(key), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptToken(payload: string, key?: string): string {
  const [ver, ivB64, tagB64, encB64] = payload.split(".");
  if (ver !== VERSION || !ivB64 || !tagB64 || encB64 == null) {
    throw new Error("Token cifrato in formato non valido");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", resolveKey(key), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encB64, "base64url")), decipher.final()]).toString("utf8");
}
