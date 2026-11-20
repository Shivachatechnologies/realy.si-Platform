import "server-only";
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/server/core/db";
import { env } from "@/server/core/env";
import { providerFetch } from "../client";
import { objectUrl, presignS3Get, s3TargetOf, signS3Request } from "../sigv4";
import { recordUsage } from "../usage";
import { ensureOk, errorText, usableConnection, type ServiceResult } from "./common";

/**
 * Object storage: the company's S3-compatible bucket when connected (SigV4, no SDK), otherwise a bounded database
 * fallback (integration_stored_objects) served through short-lived HMAC-signed URLs.
 * Keys are namespaced per company: companies/<companyId>/<key>.
 */

export const DB_FALLBACK_MAX_BYTES = 10 * 1024 * 1024;
const MAX_BYTES = 200 * 1024 * 1024;

export interface StoredObject {
  /** "s3" or "db". */
  backend: "s3" | "db";
  key: string;
  size: number;
  contentType: string;
  /** Opaque reference for getSignedUrl: "s3:<key>" or "db:<objectId>". */
  ref: string;
  /** Signed URL valid for about an hour. */
  url: string;
}

const KEY_RE = /^[A-Za-z0-9!_.*'()/-]{1,700}$/;
const CT_RE = /^[a-z]+\/[a-z0-9.+-]{1,100}$/i;

function urlKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(env().REALY_ENCRYPTION_KEY, "base64"), Buffer.alloc(0), "realy:integrations.storage.url", 32));
}

const sign = (objectId: string, exp: number) => createHmac("sha256", urlKey()).update(`${objectId}.${exp}`).digest("base64url");

/** Signed URL of a database-stored object (served by /api/v1/integrations/storage/<id>). */
export function dbObjectUrl(objectId: string, expiresSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + Math.min(Math.max(60, expiresSeconds), 7 * 86_400);
  return `${env().APP_URL}/api/v1/integrations/storage/${objectId}?exp=${exp}&sig=${sign(objectId, exp)}`;
}

export function verifyDbObjectSignature(objectId: string, exp: string | null, sig: string | null): boolean {
  const e = Number(exp);
  if (!sig || !Number.isInteger(e) || e < Math.floor(Date.now() / 1000)) return false;
  const a = Buffer.from(sign(objectId, e));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Random object key under a prefix, e.g. newObjectKey("images", "png") → images/2026/11/<random>.png */
export function newObjectKey(prefix: string, ext: string): string {
  const d = new Date();
  return `${prefix.replace(/[^A-Za-z0-9_-]/g, "") || "files"}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${randomBytes(12).toString("hex")}.${ext.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin"}`;
}

export async function putObject(organizationId: string, companyId: string, input: { key: string; body: Uint8Array; contentType: string }): Promise<ServiceResult<StoredObject>> {
  if (!KEY_RE.test(input.key) || input.key.includes("..")) return { ok: false, code: "invalid_input", error: "Invalid object key", providerId: null, attempts: [] };
  if (!CT_RE.test(input.contentType)) return { ok: false, code: "invalid_input", error: "Invalid content type", providerId: null, attempts: [] };
  if (input.body.byteLength > MAX_BYTES) return { ok: false, code: "invalid_input", error: "Object too large", providerId: null, attempts: [] };
  const fullKey = `companies/${companyId}/${input.key}`;
  const conn = await usableConnection(organizationId, companyId, "s3");
  const target = conn ? s3TargetOf(conn.config, conn.accessToken) : null;
  if (conn && target) {
    try {
      const url = objectUrl(target, fullKey);
      const headers = signS3Request(target, { method: "PUT", url, headers: { "content-type": input.contentType }, body: input.body });
      const res = await providerFetch(conn, url.toString(), { method: "PUT", raw: input.body, headers, noAuth: true, timeoutMs: 120_000, retries: 2 });
      ensureOk(res, "S3 PutObject");
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "s3", operation: "storage.put", units: input.body.byteLength, unit: "byte", estimatedCostMicros: null, status: "SUCCEEDED" });
      return {
        ok: true,
        providerId: "s3",
        attempts: [{ providerId: "s3", outcome: "ok" }],
        data: { backend: "s3", key: input.key, size: input.body.byteLength, contentType: input.contentType, ref: `s3:${fullKey}`, url: presignS3Get(target, fullKey, 3600) },
      };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "s3", operation: "storage.put", units: 0, unit: "byte", status: "FAILED", error: errorText(err) });
      return { ok: false, code: "provider_error", error: errorText(err), providerId: "s3", attempts: [{ providerId: "s3", outcome: "error", error: errorText(err) }] };
    }
  }
  if (input.body.byteLength > DB_FALLBACK_MAX_BYTES) {
    return { ok: false, code: "not_connected", error: `Objects over ${DB_FALLBACK_MAX_BYTES / 1024 / 1024} MB need a connected S3-compatible bucket`, providerId: null, attempts: [{ providerId: "s3", outcome: "not_connected" }] };
  }
  const row = await db().integrationStoredObject.upsert({
    where: { companyId_key: { companyId, key: input.key } },
    create: { organizationId, companyId, key: input.key, contentType: input.contentType, size: input.body.byteLength, data: Buffer.from(input.body) },
    update: { contentType: input.contentType, size: input.body.byteLength, data: Buffer.from(input.body) },
    select: { id: true },
  });
  return {
    ok: true,
    providerId: "db",
    attempts: [{ providerId: "s3", outcome: "not_connected" }],
    data: { backend: "db", key: input.key, size: input.body.byteLength, contentType: input.contentType, ref: `db:${row.id}`, url: dbObjectUrl(row.id) },
  };
}

/** Fresh signed URL for a stored object reference (from StoredObject.ref). */
export async function getSignedUrl(organizationId: string, companyId: string, ref: string, expiresSeconds = 3600): Promise<ServiceResult<{ url: string }>> {
  if (ref.startsWith("db:")) {
    const id = ref.slice(3);
    const row = /^[0-9a-f-]{36}$/.test(id) ? await db().integrationStoredObject.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }) : null;
    if (!row) return { ok: false, code: "invalid_input", error: "Object not found", providerId: "db", attempts: [] };
    return { ok: true, providerId: "db", attempts: [], data: { url: dbObjectUrl(row.id, expiresSeconds) } };
  }
  if (ref.startsWith("s3:")) {
    const key = ref.slice(3);
    if (!key.startsWith(`companies/${companyId}/`)) return { ok: false, code: "invalid_input", error: "Object not found", providerId: "s3", attempts: [] };
    const conn = await usableConnection(organizationId, companyId, "s3");
    const target = conn ? s3TargetOf(conn.config, conn.accessToken) : null;
    if (!target) return { ok: false, code: "not_connected", error: "S3 storage is not connected", providerId: "s3", attempts: [{ providerId: "s3", outcome: "not_connected" }] };
    return { ok: true, providerId: "s3", attempts: [], data: { url: presignS3Get(target, key, expiresSeconds) } };
  }
  return { ok: false, code: "invalid_input", error: "Unknown object reference", providerId: null, attempts: [] };
}
