import "server-only";
import { z } from "zod";
import { db, transaction, type Prisma, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, forbidden, invalid, notFound } from "@/server/core/errors";
import { getControls, isIntegrationEnabled } from "@/server/core/platform-controls";
import { logger } from "@/server/core/logger";
import { pageInput, prismaPage, toPage, type PageInput } from "@/server/core/pagination";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { isConnectable, isPlatformManaged, PROVIDERS, providerInfo, type ProviderInfo } from "./catalog";
import { afterConnect, beforeDisconnect } from "./lifecycle";
import { assertNotPlatformManaged, platformAvailability, platformAvailabilityMap, type PlatformAvailability } from "./platform-managed";
import { providerWebhookUrl } from "./provider-webhooks";
import { asConfig, assertConnectionEntitled, decryptCredentials, encryptCredentials, getConnection, type Connection } from "./connections";
import { logProviderCall, providerFetch } from "./client";
import { buildAuthorizeUrl, type IntegrationOAuthState } from "./oauth";
import { validateTargetUrl } from "./webhooks";
import { exchangeCode, integrationRedirectUri, missingEnvVars, oauthClient, postConnectDetails, ProviderError, revokeToken, testConnection } from "./providers";

type Perm = "integrations.read" | "integrations.manage";

/**
 * Customer-side changes to a provider connection. Platform-managed providers (AI, research, creative, voice, video,
 * telephony) are configured only in Admin → Platform keys, so every customer write is refused (403); connecting a
 * provider the platform admin switched off (Platform Controls → disabled integrations) is refused too.
 */
async function assertCustomerProvider(provider: string, connecting: boolean) {
  assertNotPlatformManaged(provider);
  if (connecting && !(await isIntegrationEnabled(provider))) throw forbidden("This integration is not available on the platform right now", { reason: "integrations_disabled", provider });
}

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
  lastSuccessAt: true,
  lastFailureAt: true,
  errorStreak: true,
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
  const [access, platform, disabled] = await Promise.all([planAccessByCategory(organizationId), platformAvailabilityMap(), disabledProviders()]);
  return PROVIDERS.map((info) => {
    const managed = platform[info.key] ?? null;
    // Platform-managed providers never expose the company's own (legacy) connection row: it is kept but unused.
    const connection = managed ? null : (byProvider.get(info.key) ?? null);
    const status = managed ? null : info.key === "webhook" ? (hookCount > 0 ? "CONNECTED" : null) : connection && connection.status !== "DISCONNECTED" ? connection.status : null;
    return {
      info,
      connection,
      status,
      /** Platform-managed provider: availability on the platform's account (null = the company connects it itself). */
      platform: managed as PlatformAvailability | null,
      /** Switched off platform-wide by the admin (customer-connected providers). */
      disabled: !managed && disabled.has(info.key),
      configured: info.authType !== "oauth2" || oauthClient(info.key) !== null,
      oauthAvailable: (info.authType === "oauth2" || !!info.oauthAlternative) && oauthClient(info.key) !== null,
      /** Plan restriction of the provider's category (docs/entitlements.md): the cheapest plan and whether this org has it. */
      plan: access.get(info.category) ?? { minPlan: "starter", locked: false },
    };
  });
}

export async function getIntegration(ctx: RequestContext, organizationId: string, companyId: string, provider: string) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.read");
  const info = requireInfo(provider);
  const connection = await db().integrationConnection.findFirst({ where: { organizationId, companyId, provider }, select: safeSelect });
  const syncs = connection
    ? await db().integrationSyncRun.findMany({ where: { organizationId, companyId, connectionId: connection.id }, orderBy: { startedAt: "desc" }, take: 20 })
    : [];
  const managed = isPlatformManaged(provider) ? await platformAvailability(provider) : null;
  if (managed) {
    // Read-only status: the platform's account powers it; nothing about the company's legacy row is shown.
    return {
      info,
      connection: null,
      previous: null,
      syncs: [],
      missingEnv: [],
      redirectUri: null,
      oauthAvailable: false,
      webhookUrl: null,
      plan: (await planAccessByCategory(organizationId)).get(info.category) ?? { minPlan: "starter", locked: false },
      platform: managed,
      disabled: false,
    };
  }
  const disabled = !(await isIntegrationEnabled(provider));
  return {
    platform: null as PlatformAvailability | null,
    disabled,
    info,
    connection: connection && connection.status !== "DISCONNECTED" ? connection : null,
    previous: connection?.status === "DISCONNECTED" ? connection : null,
    syncs,
    missingEnv: info.authType === "oauth2" || info.oauthAlternative ? missingEnvVars(info) : [],
    redirectUri: info.authType === "oauth2" || info.oauthAlternative ? integrationRedirectUri(provider) : null,
    oauthAvailable: (info.authType === "oauth2" || !!info.oauthAlternative) && oauthClient(provider) !== null,
    /** The connection's provider-webhook URL (providers that call Realy back), to paste at the provider when it is not registered automatically. */
    webhookUrl: info.inboundWebhooks && connection && connection.status !== "DISCONNECTED" ? providerWebhookUrl(provider, connection.id) : null,
    plan: (await planAccessByCategory(organizationId)).get(info.category) ?? { minPlan: "starter", locked: false },
  };
}

/** Providers switched off platform-wide (Admin → Platform Controls). */
async function disabledProviders(): Promise<Set<string>> {
  return new Set((await getControls()).disabledIntegrations.map((p) => p.toLowerCase()));
}

/** Plan access per provider category: the cheapest plan that unlocks it and whether the organization's plan does. */
export async function planAccessByCategory(organizationId: string): Promise<Map<string, { minPlan: string; locked: boolean }>> {
  const { integrationCategoryAccess } = await import("@/server/modules/entitlements/catalog");
  const { hasFeature } = await import("@/server/modules/entitlements/service");
  const out = new Map<string, { minPlan: string; locked: boolean }>();
  for (const category of new Set(PROVIDERS.map((p) => p.category))) {
    const a = integrationCategoryAccess(category);
    out.set(category, { minPlan: a.minPlan, locked: a.feature ? !(await hasFeature(organizationId, a.feature).catch(() => false)) : false });
  }
  return out;
}

/** Number of connected (or erroring) integrations at the company. */
export async function connectedCount(organizationId: string, companyId: string) {
  return db().integrationConnection.count({ where: { organizationId, companyId, status: { in: ["CONNECTED", "ERROR"] } } });
}

const MAX_FIELD = 4000;

/** Validate API-key form values against the provider's fields; returns secret and non-secret parts. */
function parseFields(info: ProviderInfo, raw: Record<string, unknown>, fieldList = info.fields ?? [], requireKey = true) {
  const fields = fieldList;
  const config: Record<string, string> = {};
  const secrets: Record<string, string> = {};
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
    else if (f.secret) secrets[f.key] = v;
    else config[f.key] = v;
  }
  if (issues.length) throw new AppError("validation_error", "Invalid credentials", { issues });
  if (requireKey && !apiKey) throw invalid("API key required");
  return { apiKey: apiKey ?? "", config, secrets };
}

/** Keep the user's active sub-account when a test/reconnect refreshes the list; default to the first one. */
function mergeAccounts(previous: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(extra.accounts)) return extra;
  const accounts = extra.accounts as { id: string }[];
  const prev = typeof previous.activeAccountId === "string" ? previous.activeAccountId : null;
  return { ...extra, activeAccountId: accounts.some((a) => a.id === prev) ? prev : (accounts[0]?.id ?? null) };
}

/** Provider-specific URL fields must be public HTTPS targets (SSRF protection). */
function validateUrlFields(provider: string, config: Record<string, string>) {
  if (provider === "custom_api") validateTargetUrl(config.baseUrl ?? "");
  if (provider === "wordpress") config.siteUrl = validateTargetUrl(config.siteUrl ?? "").toString().replace(/\/+$/, "");
  if (provider === "s3" && config.endpoint) config.endpoint = validateTargetUrl(config.endpoint).origin;
  if (provider === "openai_compatible") config.baseUrl = validateTargetUrl(config.baseUrl ?? "").toString().replace(/\/+$/, "");
}

export const apiKeyInput = z.record(z.string().max(64), z.string().max(MAX_FIELD));

/** Connect an API-key provider. The credentials are verified with a live test call before anything is stored. */
export async function saveApiKeyConnection(ctx: RequestContext, organizationId: string, companyId: string, provider: string, raw: z.input<typeof apiKeyInput>) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage");
  await assertCustomerProvider(provider, true);
  const info = requireInfo(provider);
  if (info.authType !== "api_key") throw invalid("This integration does not use an API key");
  if (!isConnectable(info)) throw invalid("This integration is not available yet", { reason: "integrations_awaiting_docs" });
  await assertConnectionEntitled(ctx, organizationId, companyId, provider);
  const { apiKey, config, secrets } = parseFields(info, apiKeyInput.parse(raw));
  validateUrlFields(provider, config);
  // Automation catch-hook URLs are the credential: n8n is self-hosted, so it must be a public HTTPS target (SSRF).
  if (provider === "n8n") validateTargetUrl(apiKey);
  if (provider === "mailchimp") (config as Record<string, string>).authMode = "key";
  const existing = await db().integrationConnection.findFirst({ where: { organizationId, companyId, provider }, select: { config: true, credentialsEnc: true, status: true } });
  // Replacing Plaid keys of the same Plaid client keeps the linked banks (their tokens belong to that client).
  if (provider === "plaid" && existing && existing.status !== "DISCONNECTED" && asConfig(existing.config).clientId === config.clientId) {
    const prev = decryptCredentials(companyId, provider, existing.credentialsEnc).secrets ?? {};
    for (const [k, v] of Object.entries(prev)) if (k.startsWith("plaidItem:")) secrets[k] = v;
    const items = asConfig(existing.config).plaidItems;
    if (Array.isArray(items)) (config as Record<string, unknown>).plaidItems = items;
  }
  let account: string | null = null;
  let extra: Record<string, unknown> = {};
  try {
    const r = await testConnection({ provider, token: apiKey, config: { ...config, ...secrets } });
    account = r.account;
    extra = mergeAccounts(existing ? asConfig(existing.config) : {}, r.extra ?? {});
  } catch (err) {
    throw invalid("The provider rejected these credentials", { reason: "integrations_test_failed", status: err instanceof ProviderError ? err.status : null, detail: err instanceof ProviderError ? err.message.slice(0, 200) : null });
  }
  return transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    const data = {
      status: "CONNECTED" as const,
      credentialsEnc: encryptCredentials(companyId, provider, { apiKey, ...(Object.keys(secrets).length ? { secrets } : {}) }),
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
  }).then(async (row) => {
    // Provider-side setup that needs the stored connection (e.g. registering Calendly's webhook subscription).
    await afterConnect(row.id).catch((err) => logger.warn({ provider, err: err instanceof Error ? err.message : "after-connect failed" }, "integration after-connect step failed"));
    return row;
  });
}

/** Start the OAuth flow (returns the provider URL and the signed state cookie). */
export async function startOAuthConnection(ctx: RequestContext, organizationId: string, companyId: string, provider: string, locale: string) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage");
  await assertCustomerProvider(provider, true);
  const info = requireInfo(provider);
  if (info.authType !== "oauth2" && !info.oauthAlternative) throw invalid("This integration does not use OAuth");
  await assertConnectionEntitled(ctx, organizationId, companyId, provider);
  if (!oauthClient(provider)) throw new AppError("not_configured", "OAuth app not configured", { reason: "integrations_not_configured", envVars: info.envVars });
  return buildAuthorizeUrl(provider, { organizationId, companyId, userId: ctx.actor.id!, locale });
}

/** Finish the OAuth flow: exchange the code, verify the token with a test call and store it encrypted. */
export async function completeOAuthConnection(ctx: RequestContext, state: IntegrationOAuthState, code: string, extras: { realmId?: string | null }) {
  const { organizationId, companyId, provider } = state;
  if (ctx.actor.id !== state.userId) throw new AppError("forbidden", "Signed-in user changed during the OAuth flow");
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage");
  await assertCustomerProvider(provider, true);
  const info = requireInfo(provider);
  const tokens = await exchangeCode(provider, code, state.verifier);
  const existing = await db().integrationConnection.findFirst({ where: { organizationId, companyId, provider }, select: { config: true, credentialsEnc: true } });
  const previousConfig = existing ? asConfig(existing.config) : {};
  const previousSecrets = existing ? (decryptCredentials(companyId, provider, existing.credentialsEnc).secrets ?? {}) : {};
  // Settings the user entered (configFields) survive a reconnect.
  const kept = Object.fromEntries((info.configFields ?? []).filter((f) => !f.secret && previousConfig[f.key] !== undefined).map((f) => [f.key, previousConfig[f.key]]));
  const config: Record<string, unknown> = { ...kept, ...tokens.extra };
  if (provider === "quickbooks" && extras.realmId && /^\d{1,30}$/.test(extras.realmId)) config.realmId = extras.realmId;
  Object.assign(config, await postConnectDetails(provider, tokens.accessToken).catch(() => ({})));
  let account: string | null = null;
  let lastError: string | null = null;
  try {
    const r = await testConnection({ provider, token: tokens.accessToken, config: { ...config, ...previousSecrets } });
    account = r.account;
    Object.assign(config, mergeAccounts(previousConfig, r.extra ?? {}));
  } catch (err) {
    lastError = `Connected, but the test call failed: ${err instanceof Error ? err.message : "error"}`;
  }
  return transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    const data = {
      status: lastError ? ("ERROR" as const) : ("CONNECTED" as const),
      credentialsEnc: encryptCredentials(companyId, provider, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, ...(Object.keys(previousSecrets).length ? { secrets: previousSecrets } : {}) }),
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
  await assertCustomerProvider(provider, false);
  requireInfo(provider);
  const row = await loadRow(organizationId, companyId, provider);
  // getConnection refreshes an expiring token first.
  const conn = await getConnection(organizationId, companyId, provider);
  if (!conn?.accessToken) {
    const fresh = await db().integrationConnection.findUnique({ where: { id: row.id }, select: { lastError: true } });
    return { ok: false as const, error: fresh?.lastError ?? "No usable credentials" };
  }
  const started = Date.now();
  const logTest = (status: number | null, responseSummary: string | null, error: string | null) =>
    logProviderCall(conn, { method: "TEST", url: `${provider} · connection test`, status, durationMs: Date.now() - started, attempts: 1, requestSummary: "authenticated identity call", responseSummary, error });
  try {
    const r = await testConnection({ provider, token: conn.accessToken, config: conn.config });
    await logTest(200, r.account ? "account verified" : "ok", null);
    await db().integrationConnection.update({
      where: { id: row.id },
      data: {
        status: "CONNECTED",
        lastError: null,
        lastErrorAt: null,
        lastTestedAt: new Date(),
        lastSuccessAt: new Date(),
        errorStreak: 0,
        externalAccount: r.account ?? row.externalAccount,
        // The stored (non-secret) config, never conn.config, which carries decrypted secret settings.
        ...(r.extra ? { config: { ...asConfig(row.config), ...mergeAccounts(asConfig(row.config), r.extra) } as Prisma.InputJsonValue } : {}),
      },
    });
    const calendar = provider === "google" || provider === "microsoft" ? await testCalendar(conn) : undefined;
    return { ok: true as const, account: r.account, calendar };
  } catch (err) {
    const error = err instanceof ProviderError ? err.message : "Connection test failed";
    await logTest(err instanceof ProviderError ? err.status : null, null, error);
    await db().integrationConnection.update({ where: { id: row.id }, data: { status: "ERROR", lastError: error.slice(0, 500), lastErrorAt: new Date(), lastTestedAt: new Date(), lastFailureAt: new Date() } });
    return { ok: false as const, error };
  }
}

/** Calendar access check for Google / Microsoft 365: lists the calendars the token can read (Google Calendar / Outlook). */
export async function testCalendar(conn: Connection): Promise<{ ok: boolean; calendars?: number; primary?: string | null; error?: string }> {
  const url = conn.provider === "google" ? "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50" : "https://graph.microsoft.com/v1.0/me/calendars?$top=50&$select=id,name,isDefaultCalendar";
  try {
    const res = await providerFetch<{ items?: { summary?: string; primary?: boolean }[]; value?: { name?: string; isDefaultCalendar?: boolean }[] }>(conn, url, { retries: 1 });
    if (!res.ok) return { ok: false, error: res.status === 403 || res.status === 401 ? "The connection lacks calendar permission; reconnect and grant calendar access" : `Calendar API responded ${res.status}` };
    if (conn.provider === "google") {
      const items = res.data?.items ?? [];
      return { ok: true, calendars: items.length, primary: items.find((c) => c.primary)?.summary ?? null };
    }
    const items = res.data?.value ?? [];
    return { ok: true, calendars: items.length, primary: items.find((c) => c.isDefaultCalendar)?.name ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Calendar check failed" };
  }
}

/** Disconnect: revoke the token at the provider where supported, then wipe every stored secret. */
export async function disconnectIntegration(ctx: RequestContext, organizationId: string, companyId: string, provider: string) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage");
  await assertCustomerProvider(provider, false);
  const info = requireInfo(provider);
  const row = await loadRow(organizationId, companyId, provider);
  let revoked = false;
  // Provider-side cleanup with the credentials still in place (Calendly webhook subscription, Plaid linked banks).
  revoked = await beforeDisconnect(row.id).catch((err) => {
    logger.warn({ provider, err: err instanceof Error ? err.message : "cleanup failed" }, "integration disconnect cleanup failed");
    return false;
  });
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
  await assertCustomerProvider(provider, false);
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

// ───────────────────────────── Request logs ─────────────────────────────

export const LOG_OUTCOMES = ["ok", "error"] as const;

/** A connection's provider calls, newest first (summaries only: no headers, tokens or bodies are ever stored). */
export async function listRequestLogs(ctx: RequestContext, organizationId: string, companyId: string, provider: string, filters: { outcome?: string; cursor?: string } = {}) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.read");
  requireInfo(provider);
  const conn = await db().integrationConnection.findFirst({ where: { organizationId, companyId, provider }, select: { id: true } });
  if (!conn) return { data: [] as Prisma.IntegrationRequestLogGetPayload<object>[], nextCursor: null };
  const page = pageInput.parse({ limit: 50, cursor: filters.cursor && z.string().uuid().safeParse(filters.cursor).success ? filters.cursor : undefined });
  const outcome =
    filters.outcome === "error" ? { OR: [{ status: null }, { status: { gte: 400 } }] } : filters.outcome === "ok" ? { status: { gte: 200, lt: 400 } } : {};
  const rows = await db().integrationRequestLog.findMany({ where: { connectionId: conn.id, companyId, ...outcome }, orderBy: { id: "desc" }, ...prismaPage(page) });
  return toPage(rows, page);
}

/** Periodic job: keep 30 days of request logs. */
export async function pruneRequestLogs(): Promise<number> {
  const { count } = await db().integrationRequestLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } });
  return count;
}

// ───────────────────────────── Sub-accounts & settings ─────────────────────────────

export const activeAccountInput = z.object({ accountId: z.string().min(1).max(300) });

/** Choose the active sub-account (page, channel, ad account, site, audience...) of a multi-account connection. */
export async function setActiveAccount(ctx: RequestContext, organizationId: string, companyId: string, provider: string, raw: z.input<typeof activeAccountInput>) {
  const { accountId } = activeAccountInput.parse(raw);
  requireInfo(provider);
  await assertCustomerProvider(provider, false);
  return transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    const row = await tx.integrationConnection.findFirst({ where: { organizationId, companyId, provider, status: { not: "DISCONNECTED" } }, select: { id: true, config: true } });
    if (!row) throw notFound("Connection");
    const config = asConfig(row.config);
    const accounts = Array.isArray(config.accounts) ? (config.accounts as { id: string; name: string }[]) : [];
    const account = accounts.find((a) => a.id === accountId);
    if (!account) throw invalid("Unknown account; run a connection test to refresh the list");
    const updated = await tx.integrationConnection.update({ where: { id: row.id }, data: { config: { ...config, activeAccountId: accountId } as Prisma.InputJsonValue }, select: safeSelect });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.account_selected", resourceType: "integration_connection", resourceId: row.id, oldValue: { activeAccountId: config.activeAccountId ?? null }, newValue: { provider, activeAccountId: accountId, name: account.name } });
    return updated;
  });
}

/** Update a connection's settings (catalog `configFields`): non-secret ones in config, secret ones encrypted with the credentials. */
export async function updateConnectionConfig(ctx: RequestContext, organizationId: string, companyId: string, provider: string, raw: z.input<typeof apiKeyInput>) {
  const info = requireInfo(provider);
  await assertCustomerProvider(provider, false);
  if (!info.configFields?.length) throw invalid("This integration has no settings");
  const input = apiKeyInput.parse(raw);
  // Only fields that were sent are changed; an empty value clears a non-secret setting, secrets are kept unless replaced.
  const sent = info.configFields.filter((f) => input[f.key] !== undefined);
  const { config, secrets } = parseFields(info, input, sent.map((f) => ({ ...f, required: false })), false);
  return transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    const row = await tx.integrationConnection.findFirst({ where: { organizationId, companyId, provider, status: { not: "DISCONNECTED" } }, select: { id: true, config: true, credentialsEnc: true } });
    if (!row) throw notFound("Connection");
    const current = asConfig(row.config);
    for (const f of sent) if (!f.secret && !input[f.key]?.trim()) delete current[f.key];
    const creds = decryptCredentials(companyId, provider, row.credentialsEnc);
    const nextSecrets = { ...(creds.secrets ?? {}), ...secrets };
    const updated = await tx.integrationConnection.update({
      where: { id: row.id },
      data: {
        config: { ...current, ...config } as Prisma.InputJsonValue,
        ...(Object.keys(secrets).length ? { credentialsEnc: encryptCredentials(companyId, provider, { ...creds, secrets: nextSecrets }) } : {}),
      },
      select: safeSelect,
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.settings_updated", resourceType: "integration_connection", resourceId: row.id, newValue: { provider, fields: sent.map((f) => f.key) } });
    return updated;
  });
}

/** Which secret settings are stored (names only, never values) — for the settings form. */
export async function storedSecretNames(organizationId: string, companyId: string, provider: string): Promise<string[]> {
  const row = await db().integrationConnection.findFirst({ where: { organizationId, companyId, provider, status: { not: "DISCONNECTED" } }, select: { credentialsEnc: true } });
  return row ? Object.keys(decryptCredentials(companyId, provider, row.credentialsEnc).secrets ?? {}) : [];
}

// ───────────────────────────── Usage & cost ─────────────────────────────

export const USAGE_STATUSES = ["SUCCEEDED", "FAILED"] as const;

/** A provider's metered usage at the company (newest first), filterable by operation and status. */
export async function listUsage(ctx: RequestContext, organizationId: string, companyId: string, provider: string, filters: { operation?: string; status?: string; cursor?: string } = {}) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.read");
  requireInfo(provider);
  const page = pageInput.parse({ limit: 50, cursor: filters.cursor && z.string().uuid().safeParse(filters.cursor).success ? filters.cursor : undefined });
  const status = (USAGE_STATUSES as readonly string[]).includes(filters.status ?? "") ? (filters.status as "FAILED") : undefined;
  const operation = filters.operation && /^[a-z_.]{1,60}$/.test(filters.operation) ? filters.operation : undefined;
  const rows = await db().integrationUsage.findMany({
    where: { organizationId, companyId, provider, ...(status ? { status } : {}), ...(operation ? { operation } : {}) },
    orderBy: { id: "desc" },
    ...prismaPage(page),
  });
  return toPage(rows, page);
}

/** Usage aggregates per provider + operation over the last `days` days. */
export async function usageSummary(ctx: RequestContext, organizationId: string, companyId: string, opts: { days?: number; provider?: string } = {}) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.read");
  const since = new Date(Date.now() - (opts.days ?? 30) * 86_400_000);
  const groups = await db().integrationUsage.groupBy({
    by: ["provider", "operation", "status", "unit"],
    where: { organizationId, companyId, createdAt: { gte: since }, ...(opts.provider ? { provider: opts.provider } : {}) },
    _count: { _all: true },
    _sum: { units: true, estimatedCostMicros: true },
  });
  const byProvider = new Map<string, { provider: string; calls: number; failed: number; costMicros: number; operations: Map<string, { operation: string; unit: string; calls: number; failed: number; units: number; costMicros: number }> }>();
  for (const g of groups) {
    const p = byProvider.get(g.provider) ?? { provider: g.provider, calls: 0, failed: 0, costMicros: 0, operations: new Map() };
    const op = p.operations.get(g.operation) ?? { operation: g.operation, unit: g.unit, calls: 0, failed: 0, units: 0, costMicros: 0 };
    op.calls += g._count._all;
    op.units += g._sum.units ?? 0;
    op.costMicros += g._sum.estimatedCostMicros ?? 0;
    if (g.status === "FAILED") op.failed += g._count._all;
    p.operations.set(g.operation, op);
    p.calls += g._count._all;
    p.costMicros += g._sum.estimatedCostMicros ?? 0;
    if (g.status === "FAILED") p.failed += g._count._all;
    byProvider.set(g.provider, p);
  }
  const providers = [...byProvider.values()].map((p) => ({ ...p, operations: [...p.operations.values()].sort((a, b) => b.calls - a.calls) })).sort((a, b) => b.costMicros - a.costMicros || b.calls - a.calls);
  return {
    since,
    providers,
    totals: { calls: providers.reduce((n, p) => n + p.calls, 0), failed: providers.reduce((n, p) => n + p.failed, 0), costMicros: providers.reduce((n, p) => n + p.costMicros, 0) },
  };
}

/** Periodic job: keep 400 days of usage rows (enough for year-over-year cost views). */
export async function pruneUsage(): Promise<number> {
  const { count } = await db().integrationUsage.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 400 * 86_400_000) } } });
  return count;
}
