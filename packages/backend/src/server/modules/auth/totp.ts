import { createHmac, randomBytes } from "node:crypto";
import { hmacSha256 } from "@/server/core/crypto";

/** RFC 6238 TOTP: HMAC-SHA1, 6 digits, 30 s step (the parameters authenticator apps support universally). */
export const TOTP_STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secretBase32: string, counter: bigint): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", base32Decode(secretBase32)).update(msg).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

export const currentStep = (nowMs = Date.now()) => BigInt(Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS));

/**
 * Verify a code within ±1 step. Returns the matched step so callers can reject replays
 * (a step ≤ the last used step is refused).
 */
export function verifyTotp(secretBase32: string, code: string, nowMs = Date.now()): bigint | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = currentStep(nowMs);
  for (const delta of [0n, -1n, 1n]) {
    const candidate = step + delta;
    const expected = hotp(secretBase32, candidate);
    // constant-time compare of equal-length digit strings
    if (hmacSha256("cmp", expected).equals(hmacSha256("cmp", code))) return candidate;
  }
  return null;
}

export function otpauthUrl(secretBase32: string, accountName: string, issuer = "Realy"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
