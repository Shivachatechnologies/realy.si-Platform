import "server-only";
import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 (header signing and presigned URLs) for S3-compatible storage — AWS S3, Cloudflare R2,
 * Backblaze B2, MinIO, Wasabi... Implemented with node:crypto only.
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-authenticating-requests.html
 */

export interface S3Target {
  /** Custom endpoint (path-style) such as https://<account>.r2.cloudflarestorage.com; empty = AWS virtual-hosted style. */
  endpoint?: string | null;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as S3 expects it (slashes kept in object keys). */
export function encodeKey(key: string): string {
  return key
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

const encodeQ = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Request URL of an object (or of the bucket when key is empty). */
export function objectUrl(t: S3Target, key = ""): URL {
  const path = key ? `/${encodeKey(key)}` : "/";
  if (t.endpoint) {
    const base = t.endpoint.replace(/\/+$/, "");
    return new URL(`${base}/${encodeURIComponent(t.bucket)}${key ? path : ""}`);
  }
  const region = t.region === "us-east-1" ? "s3" : `s3.${t.region}`;
  return new URL(`https://${t.bucket}.${region}.amazonaws.com${path}`);
}

function amzDates(now: Date) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function signingKey(secret: string, dateStamp: string, region: string, service: string) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), service), "aws4_request");
}

function canonicalQuery(url: URL): string {
  return [...url.searchParams.entries()]
    .map(([k, v]) => [encodeQ(k), encodeQ(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/**
 * Signed headers for a request. `body` is hashed into x-amz-content-sha256 (an empty body for GET/HEAD).
 * Returns every header to send (host is set by fetch from the URL and must match).
 */
export function signS3Request(
  t: S3Target,
  req: { method: string; url: URL; headers?: Record<string, string>; body?: Uint8Array | string | null },
  now = new Date(),
): Record<string, string> {
  const { amzDate, dateStamp } = amzDates(now);
  const payloadHash = sha256Hex(req.body ?? "");
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = v.trim();
  headers.host = req.url.host;
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = payloadHash;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]!.replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonical = [req.method.toUpperCase(), req.url.pathname || "/", canonicalQuery(req.url), canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${t.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(t.secretAccessKey, dateStamp, t.region, "s3")).update(toSign).digest("hex");
  const rest = { ...headers };
  delete rest.host;
  return { ...rest, authorization: `AWS4-HMAC-SHA256 Credential=${t.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

/** Presigned GET URL valid for `expiresSeconds` (max 7 days). */
export function presignS3Get(t: S3Target, key: string, expiresSeconds = 3600, now = new Date()): string {
  const { amzDate, dateStamp } = amzDates(now);
  const url = objectUrl(t, key);
  const scope = `${dateStamp}/${t.region}/s3/aws4_request`;
  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set("X-Amz-Credential", `${t.accessKeyId}/${scope}`);
  url.searchParams.set("X-Amz-Date", amzDate);
  url.searchParams.set("X-Amz-Expires", String(Math.min(Math.max(1, Math.floor(expiresSeconds)), 604_800)));
  url.searchParams.set("X-Amz-SignedHeaders", "host");
  const canonical = ["GET", url.pathname, canonicalQuery(url), `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(t.secretAccessKey, dateStamp, t.region, "s3")).update(toSign).digest("hex");
  url.searchParams.set("X-Amz-Signature", signature);
  return url.toString();
}

/** S3 target from a connection's config + secret (null when incomplete). */
export function s3TargetOf(config: Record<string, unknown>, secret: string | null): S3Target | null {
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  const region = s(config.region);
  const bucket = s(config.bucket);
  const accessKeyId = s(config.accessKeyId);
  if (!region || !bucket || !accessKeyId || !secret) return null;
  return { endpoint: s(config.endpoint), region, bucket, accessKeyId, secretAccessKey: secret };
}
