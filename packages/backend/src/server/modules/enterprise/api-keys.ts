import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import { newRequestId, type RequestContext } from "@/server/core/context";
import { AppError, forbidden, invalid, notFound } from "@/server/core/errors";
import { randomToken, safeEqual, sha256 } from "@/server/core/crypto";
import { writeAudit } from "@/server/modules/audit/service";
import { PERMISSION_KEYS, PLATFORM_ONLY } from "@/server/modules/rbac/catalog";
import { can } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { API_KEY_ROLE_PREFIX } from "./roles";
import { assertWithinLimit, authorizeOrg, ipAllowed, getOrgSettings } from "./policy";

/**
 * API keys for /api/v1. Each key is backed by a core service account holding one managed role (key "api-key-<prefix>")
 * that carries exactly the key's scopes, so ordinary RBAC applies to API requests. The secret is shown once; only its
 * SHA-256 is stored. Format: `rly_<prefix>_<secret>`.
 */

export const KEY_PATTERN = /^rly_([A-Za-z0-9]{10})_([A-Za-z0-9_-]{30,80})$/;
const alnum = (n: number) =>
  randomToken(n * 2)
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, n);

export const createApiKeyInput = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.string()).min(1).max(200),
  /** Days until expiry; null = never. */
  expiresInDays: z.number().int().min(1).max(730).nullable(),
});

export async function listApiKeys(ctx: RequestContext, organizationId: string) {
  await authorizeOrg(ctx, organizationId, "developer.read");
  const [keys, meta] = await Promise.all([
    db().apiKey.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    }),
    db().enterpriseApiKeyMeta.findMany({ where: { organizationId } }),
  ]);
  const creators = await db().user.findMany({
    where: { id: { in: meta.map((m) => m.createdById) } },
    select: { id: true, name: true },
  });
  const by = new Map(meta.map((m) => [m.apiKeyId, m]));
  const names = new Map(creators.map((u) => [u.id, u.name]));
  const now = Date.now();
  return keys.map((k) => {
    const m = by.get(k.id);
    const status = k.revokedAt ? "revoked" : k.expiresAt && k.expiresAt.getTime() <= now ? "expired" : "active";
    return {
      ...k,
      scopes: m?.scopes ?? [],
      createdBy: m ? (names.get(m.createdById) ?? null) : null,
      status: status as "active" | "revoked" | "expired",
    };
  });
}

/** Create a key; returns the secret once. Scopes must be tenant permissions the creator holds at the organization. */
export async function createApiKey(ctx: RequestContext, organizationId: string, raw: z.input<typeof createApiKeyInput>) {
  const input = createApiKeyInput.parse(raw);
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw forbidden("Only people can create API keys");
  const scopes = [...new Set(input.scopes)];
  const bad = scopes.filter((s) => !PERMISSION_KEYS.has(s) || PLATFORM_ONLY.has(s));
  if (bad.length) throw invalid(`Invalid scopes: ${bad.join(", ")}`);
  return transaction(async (tx) => {
    await authorizeOrg(ctx, organizationId, "developer.manage", tx);
    for (const s of scopes)
      if (!(await can(ctx, s, orgChain(organizationId), tx)))
        throw forbidden(`You do not hold ${s}`, {
          permission: s,
          reason: "enterprise_permission_not_held",
        });
    await assertWithinLimit(organizationId, "apiKeys", { client: tx });
    const prefix = alnum(10);
    const secret = `rly_${prefix}_${randomToken(32)}`;
    const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
    const sa = await tx.serviceAccount.create({
      data: {
        organizationId,
        name: `API key: ${input.name}`,
        createdById: ctx.actor.id!,
      },
    });
    const perms = await tx.permission.findMany({
      where: { key: { in: scopes } },
      select: { id: true },
    });
    const role = await tx.role.create({
      data: {
        organizationId,
        key: `${API_KEY_ROLE_PREFIX}${prefix.toLowerCase()}`,
        name: `API key: ${input.name}`,
        description: "Managed by an API key; edit the key instead.",
        assignableAt: ["ORGANIZATION"],
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
    });
    await tx.roleAssignment.create({
      data: {
        principalType: "SERVICE_ACCOUNT",
        principalId: sa.id,
        roleId: role.id,
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        organizationId,
        grantedById: ctx.actor.id,
        expiresAt,
      },
    });
    const key = await tx.apiKey.create({
      data: {
        organizationId,
        serviceAccountId: sa.id,
        name: input.name,
        prefix,
        keyHash: sha256(secret),
        expiresAt,
      },
    });
    await tx.enterpriseApiKeyMeta.create({
      data: {
        organizationId,
        apiKeyId: key.id,
        roleId: role.id,
        scopes,
        createdById: ctx.actor.id!,
      },
    });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "api_key.created",
      resourceType: "api_key",
      resourceId: key.id,
      newValue: { name: input.name, prefix, scopes, expiresAt },
    });
    return { id: key.id, name: key.name, prefix, secret, expiresAt, scopes };
  });
}

export async function revokeApiKey(ctx: RequestContext, organizationId: string, keyId: string) {
  if (!z.string().uuid().safeParse(keyId).success) throw notFound("API key");
  await transaction(async (tx) => {
    await authorizeOrg(ctx, organizationId, "developer.manage", tx);
    const key = await tx.apiKey.findFirst({
      where: { id: keyId, organizationId },
    });
    if (!key) throw notFound("API key");
    if (key.revokedAt) return;
    await tx.apiKey.update({
      where: { id: key.id },
      data: { revokedAt: new Date() },
    });
    await tx.serviceAccount.update({
      where: { id: key.serviceAccountId },
      data: { disabledAt: new Date() },
    });
    await tx.roleAssignment.deleteMany({
      where: {
        principalType: "SERVICE_ACCOUNT",
        principalId: key.serviceAccountId,
      },
    });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "api_key.revoked",
      resourceType: "api_key",
      resourceId: key.id,
      oldValue: { name: key.name, prefix: key.prefix },
    });
  });
}

// ───────────── Authentication for /api/v1 ─────────────

const TOUCH_MS = 60_000;

export interface ApiKeyPrincipal {
  ctx: RequestContext;
  organizationId: string;
  apiKeyId: string;
  scopes: string[];
}

/** True when the request carries an API key (Authorization: Bearer rly_…). */
export const hasApiKey = (headers: Headers) => /^Bearer rly_/i.test(headers.get("authorization") ?? "");

/**
 * Resolve `Authorization: Bearer rly_…` to a SERVICE_ACCOUNT request context, or throw `unauthenticated`. Enforces
 * revocation, expiry, a disabled service account and the organization's IP allowlist; records one `api.request` usage
 * row per request (idempotent on the request id) for usage analytics.
 */
export async function authenticateApiKey(headers: Headers, meta: { requestId: string; ip: string | null; userAgent: string | null }): Promise<ApiKeyPrincipal> {
  const raw = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const m = KEY_PATTERN.exec(raw);
  if (!m) throw new AppError("unauthenticated", "Invalid API key");
  const key = await db().apiKey.findUnique({
    where: { prefix: m[1]! },
    include: { serviceAccount: { select: { disabledAt: true } } },
  });
  const now = new Date();
  if (!key || !safeEqual(key.keyHash, sha256(raw)) || key.revokedAt || key.serviceAccount.disabledAt || (key.expiresAt && key.expiresAt <= now)) {
    throw new AppError("unauthenticated", "Invalid API key");
  }
  const settings = await getOrgSettings(key.organizationId);
  if (!ipAllowed(meta.ip, settings.ipAllowlist) && settings.ipAllowlist.length) throw forbidden("Address not allowed", { reason: "enterprise_ip_blocked" });
  if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > TOUCH_MS)
    await db().apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: now },
    });
  await db()
    .usageRecord.create({
      data: {
        organizationId: key.organizationId,
        meter: "api.request",
        quantity: 1n,
        occurredAt: now,
        idempotencyKey: `api:${meta.requestId}`,
      },
    })
    .catch(() => undefined);
  const metaRow = await db().enterpriseApiKeyMeta.findUnique({
    where: { apiKeyId: key.id },
    select: { scopes: true },
  });
  return {
    organizationId: key.organizationId,
    apiKeyId: key.id,
    scopes: metaRow?.scopes ?? [],
    ctx: {
      requestId: newRequestId(meta.requestId),
      actor: { type: "SERVICE_ACCOUNT", id: key.serviceAccountId },
      mfaVerifiedAt: null,
      sessionId: null,
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  };
}
