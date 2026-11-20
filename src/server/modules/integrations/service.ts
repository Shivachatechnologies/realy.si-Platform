import "server-only";
import { z } from "zod";
import { db, transaction, type Prisma, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { pageInput, prismaPage, toPage, type PageInput } from "@/server/core/pagination";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { PROVIDERS, providerInfo, type ProviderInfo } from "./catalog";
import { decryptCredentials, encryptCredentials, getConnection } from "./connections";
import { buildAuthorizeUrl, type IntegrationOAuthState } from "./oauth";
import { validateTargetUrl } from "./webhooks";
import { exchangeCode, integrationRedirectUri, missingEnvVars, oauthClient, postConnectDetails, ProviderError, revokeToken, testConnection } from "./providers";

type Perm = "integrations.read" | "integrations.manage";

export async function authorizeIntegrations(ctx: RequestContext, organizationId: string, companyId: string, permission: Perm, tx?: Tx) {
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain, tx);
  return chain;
}

function requireInfo(provider: string): ProviderInfo {
  const info = providerInfo(provider);
  if (!info) throw notFound("Integration");
  return info;
}

/** Connection columns safe to show (never credentials or sync cursors). */
const safeSelect = {
  id: true,
  provider: true,
  status: true,
  tokenExpiresAt: true,
  scopes: true,
  config: true,
  externalAccount: true,
  syncEnabled: true,
  syncIntervalMinutes: true,
  nextSyncAt: true,
  lastSyncAt: true,
  lastError: true,
  lastErrorAt: true,
  lastTestedAt: true,
  connectedById: true,
  connectedAt: true,
  updatedAt: true,
} satisfies Prisma.IntegrationConnectionSelect;

export type SafeConnection = Prisma.IntegrationConnectionGetPayload<{ select: typeof safeSelect }>;

/** Marketplace view: every catalog provider with its connection status at the company. */
export async function listIntegrations(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.read");
  const [rows, hookCount] = await Promise.all([
    db().integrationConnection.findMany({ where: { organizationId, companyId }, select: safeSelect }),
    db().integrationHook.count({ where: { organizationId, companyId, active: true } }),
  ]);
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return PROVIDERS.map((info) => {
    const connection = byProvider.get(info.key) ?? null;
    const status = info.key === "webhook" ? (hookCount > 0 ? "CONNECTED" : null) : connection && connection.status !== "DISCONNECTED" ? connection.status : null;
    return { info, connection, status, configured: info.authType !== "oauth2" || oauthClient(info.key) !== null };
  });
}

export async function getIntegration(ctx: RequestContext, organizationId: string, companyId: string, provider: string) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.read");
  const info = requireInfo(provider);
  const connection = await db().integrationConnection.findFirst({ where: { organizationId, companyId, provider }, select: safeSelect });
  const syncs = connection
    ? await db().integrationSyncRun.findMany({ where: { organizationId, companyId, connectionId: connection.id }, orderBy: { startedAt: "desc" }, take: 20 })
    : [];
  return {
    info,
    connection: connection && connection.status !== "DISCONNECTED" ? connection : null,
    previous: connection?.status === "DISCONNECTED" ? connection : null,
    syncs,
    missingEnv: info.authType === "oauth2" ? missingEnvVars(info) : [],
    redirectUri: info.authType === "oauth2" ? integrationRedirectUri(provider) : null,
  };
}

/** Number of connected (or erroring) integrations at the company. */
export async function connectedCount(organizationId: string, companyId: string) {
  return db().integrationConnection.count({ where: { organizationId, companyId, status: { in: ["CONNECTED", "ERROR"] } } });
}

const MAX_FIELD = 4000;

/** Validate API-key form values against the provider's fields; returns secret and non-secret parts. */
function parseFields(info: ProviderInfo, raw: Record<string, unknown>) {
  const fields = info.fields ?? [];
  const config: Record<string, string> = {};
  let apiKey: string | null = null;
  const issues: { path: string; message: string }[] = [];
  for (const f of fields) {
    const v = typeof raw[f.key] === "string" ? (raw[f.key] as string).trim() : "";
    if (!v) {
      if (f.required) issues.push({ path: f.key, message: "Required" });
      continue;
    }
    if (v.length > MAX_FIELD || (f.pattern && !new RegExp(f.pattern).test(v))) {
      issues.push({ path: f.key, message: "Invalid value" });
      continue;
    }
    if (f.key === "apiKey") apiKey = v;
    else config[f.key] = v;
  }
  if (issues.length) throw new AppError("validation_error", "Invalid credentials", { issues });
  if (!apiKey) throw invalid("API key required");
  return { apiKey, config };
}

export const apiKeyInput = z.record(z.string().max(64), z.string().max(MAX_FIELD));

/** Connect an API-key provider. The credentials are verified with a live test call before anything is stored. */
export async function saveApiKeyConnection(ctx: RequestContext, organizationId: string, companyId: string, provider: string, raw: z.input<typeof apiKeyInput>) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage");
  const info = requireInfo(provider);
  if (info.authType !== "api_key") throw invalid("This integration does not use an API key");
  const { apiKey, config } = parseFields(info, apiKeyInput.parse(raw));
  if (provider === "custom_api") validateTargetUrl(config.baseUrl ?? "");
  let account: string | null = null;
  let extra: Record<string, unknown> = {};
  try {
    const r = await testConnection({ provider, token: apiKey, config });
    account = r.account;
    extra = r.extra ?? {};
  } catch (err) {
    throw invalid("The provider rejected these credentials", { reason: "integrations_test_failed", status: err instanceof ProviderError ? err.status : null });
  }
  return transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    const data = {
      status: "CONNECTED" as const,
      credentialsEnc: encryptCredentials(companyId, provider, { apiKey }),
      tokenExpiresAt: null,
      scopes: [],
      config: { ...config, ...extra } as Prisma.InputJsonValue,
      externalAccount: account,
      lastError: null,
      lastErrorAt: null,
      lastTestedAt: new Date(),
      connectedById: ctx.actor.id ?? organizationId,
      connectedAt: new Date(),
      syncEnabled: !!info.syncKinds?.length,
      nextSyncAt: info.syncKinds?.length ? new Date() : null,
    };
    const row = await tx.integrationConnection.upsert({
      where: { companyId_provider: { companyId, provider } },
      create: { organizationId, companyId, provider, ...data },
      update: data,
      select: safeSelect,
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.connected", resourceType: "integration_connection", resourceId: row.id, newValue: { provider, account } });
    return row;
  });
}

/** Start the OAuth flow (returns the provider URL and the signed state cookie). */
export async function startOAuthConnection(ctx: RequestContext, organizationId: string, companyId: string, provider: string, locale: string) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage");
  const info = requireInfo(provider);
  if (info.authType !== "oauth2") throw invalid("This integration does not use OAuth");
  if (!oauthClient(provider)) throw new AppError("not_configured", "OAuth app not configured", { reason: "integrations_not_configured", envVars: info.envVars });
  return buildAuthorizeUrl(provider, { organizationId, companyId, userId: ctx.actor.id!, locale });
}

/** Finish the OAuth flow: exchange the code, verify the token with a test call and store it encrypted. */
export async function completeOAuthConnection(ctx: RequestContext, state: IntegrationOAuthState, code: string, extras: { realmId?: string | null }) {
  const { organizationId, companyId, provider } = state;
  if (ctx.actor.id !== state.userId) throw new AppError("forbidden", "Signed-in user changed during the OAuth flow");
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage");
  const info = requireInfo(provider);
  const tokens = await exchangeCode(provider, code, state.verifier);
  const config: Record<string, unknown> = { ...tokens.extra };
  if (provider === "quickbooks" && extras.realmId && /^\d{1,30}$/.test(extras.realmId)) config.realmId = extras.realmId;
  Object.assign(config, await postConnectDetails(provider, tokens.accessToken).catch(() => ({})));
  let account: string | null = null;
  let lastError: string | null = null;
  try {
    const r = await testConnection({ provider, token: tokens.accessToken, config });
    account = r.account;
    Object.assign(config, r.extra ?? {});
  } catch (err) {
    lastError = `Connected, but the test call failed: ${err instanceof Error ? err.message : "error"}`;
  }
  return transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    const data = {
      status: lastError ? ("ERROR" as const) : ("CONNECTED" as const),
      credentialsEnc: encryptCredentials(companyId, provider, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
      tokenExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes ?? info.scopes,
      config: config as Prisma.InputJsonValue,
      externalAccount: account,
      lastError,
      lastErrorAt: lastError ? new Date() : null,
      lastTestedAt: new Date(),
      connectedById: ctx.actor.id!,
      connectedAt: new Date(),
      syncEnabled: !!info.syncKinds?.length,
      nextSyncAt: info.syncKinds?.length ? new Date() : null,
      syncCursor: {},
    };
    const row = await tx.integrationConnection.upsert({
      where: { companyId_provider: { companyId, provider } },
      create: { organizationId, companyId, provider, ...data },
      update: data,
      select: { id: true },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.connected", resourceType: "integration_connection", resourceId: row.id, newValue: { provider, account, scopes: data.scopes } });
    return row;
  });
}

async function loadRow(organizationId: string, companyId: string, provider: string) {
  const row = await db().integrationConnection.findFirst({ where: { organizationId, companyId, provider } });
  if (!row || row.status === "DISCONNECTED") throw notFound("Connection");
  return row;
}

/** Run the provider's lightweight test call with the stored (refreshed) credentials. */
export async function testIntegration(ctx: RequestContext, organizationId: string, companyId: string, provider: string) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage");
  requireInfo(provider);
  const row = await loadRow(organizationId, companyId, provider);
  // getConnection refreshes an expiring token first.
  const conn = await getConnection(organizationId, companyId, provider);
  if (!conn?.accessToken) {
    const fresh = await db().integrationConnection.findUnique({ where: { id: row.id }, select: { lastError: true } });
    return { ok: false as const, error: fresh?.lastError ?? "No usable credentials" };
  }
  try {
    const r = await testConnection({ provider, token: conn.accessToken, config: conn.config });
    await db().integrationConnection.update({
      where: { id: row.id },
      data: { status: "CONNECTED", lastError: null, lastErrorAt: null, lastTestedAt: new Date(), externalAccount: r.account ?? row.externalAccount, ...(r.extra ? { config: { ...conn.config, ...r.extra } as Prisma.InputJsonValue } : {}) },
    });
    return { ok: true as const, account: r.account };
  } catch (err) {
    const error = err instanceof ProviderError ? err.message : "Connection test failed";
    await db().integrationConnection.update({ where: { id: row.id }, data: { status: "ERROR", lastError: error.slice(0, 500), lastErrorAt: new Date(), lastTestedAt: new Date() } });
    return { ok: false as const, error };
  }
}

/** Disconnect: revoke the token at the provider where supported, then wipe every stored secret. */
export async function disconnectIntegration(ctx: RequestContext, organizationId: string, companyId: string, provider: string) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage");
  const info = requireInfo(provider);
  const row = await loadRow(organizationId, companyId, provider);
  let revoked = false;
  if (info.authType === "oauth2") {
    const creds = decryptCredentials(companyId, provider, row.credentialsEnc);
    const token = creds.refreshToken ?? creds.accessToken;
    if (token) {
      try {
        revoked = await revokeToken(provider, token);
      } catch (err) {
        logger.warn({ provider, err: err instanceof Error ? err.message : "revoke failed" }, "integration token revocation failed");
      }
    }
  }
  return transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    await tx.integrationConnection.update({
      where: { id: row.id },
      data: { status: "DISCONNECTED", credentialsEnc: null, tokenExpiresAt: null, syncEnabled: false, nextSyncAt: null, syncCursor: {}, lastError: null, lastErrorAt: null },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.disconnected", resourceType: "integration_connection", resourceId: row.id, newValue: { provider, revoked } });
    return { ok: true, revoked };
  });
}

export const settingsInput = z.object({
  syncEnabled: z.boolean().optional(),
  syncIntervalMinutes: z.number().int().min(15).max(24 * 60).optional(),
});

export async function updateIntegrationSettings(ctx: RequestContext, organizationId: string, companyId: string, provider: string, raw: z.input<typeof settingsInput>) {
  const input = settingsInput.parse(raw);
  const info = requireInfo(provider);
  return transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    const row = await tx.integrationConnection.findFirst({ where: { organizationId, companyId, provider, status: { not: "DISCONNECTED" } }, select: { id: true, syncEnabled: true, syncIntervalMinutes: true } });
    if (!row) throw notFound("Connection");
    if (input.syncEnabled && !info.syncKinds?.length) throw invalid("This integration has nothing to sync");
    const updated = await tx.integrationConnection.update({
      where: { id: row.id },
      data: { ...input, ...(input.syncEnabled ? { nextSyncAt: new Date() } : {}) },
      select: safeSelect,
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.settings_updated", resourceType: "integration_connection", resourceId: row.id, oldValue: row, newValue: input });
    return updated;
  });
}

/** Sync history (newest first), optionally for one provider. */
export async function listSyncRuns(ctx: RequestContext, organizationId: string, companyId: string, filters: { provider?: string; status?: string } & Partial<PageInput> = {}) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.read");
  const page = pageInput.parse({ limit: filters.limit ?? 50, cursor: filters.cursor });
  const status = ["RUNNING", "SUCCEEDED", "PARTIAL", "FAILED"].includes(filters.status ?? "") ? (filters.status as "FAILED") : undefined;
  const rows = await db().integrationSyncRun.findMany({
    where: { organizationId, companyId, ...(filters.provider && providerInfo(filters.provider) ? { provider: filters.provider } : {}), ...(status ? { status } : {}) },
    orderBy: { id: "desc" },
    ...prismaPage(page),
  });
  return toPage(rows, page);
}

/** Health counts for the Integrations overview (last 30 days). */
export async function integrationsHealth(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.read");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [syncErrors, failedDeliveries] = await Promise.all([
    db().integrationSyncRun.count({ where: { organizationId, companyId, status: { in: ["FAILED", "PARTIAL"] }, startedAt: { gte: since } } }),
    db().integrationWebhookDelivery.count({ where: { organizationId, companyId, status: "FAILED", updatedAt: { gte: since } } }),
  ]);
  return { syncErrors, failedDeliveries };
}
