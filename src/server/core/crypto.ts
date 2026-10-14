import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual, hkdfSync } from "node:crypto";
import { env } from "./env";

/** 256-bit URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256(key: Buffer | string, value: string | Buffer): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const KEY_VERSION = "v1";

/** Per-purpose data key derived from the master key, so one leaked ciphertext class does not expose others. */
function dataKey(purpose: string): Buffer {
  const master = Buffer.from(env().REALY_ENCRYPTION_KEY, "base64");
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `realy:${purpose}`, 32));
}

/**
 * AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url). `purpose` is bound as AAD,
 * so a ciphertext cannot be replayed under another purpose.
 */
export function encryptSecret(plaintext: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey(purpose), iv);
  cipher.setAAD(Buffer.from(purpose));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [KEY_VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, purpose: string): string {
  const [version, iv, tag, ct] = payload.split(".");
  if (version !== KEY_VERSION || !iv || !tag || !ct) throw new Error("Unsupported ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", dataKey(purpose), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
