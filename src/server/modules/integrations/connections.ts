import "server-only";
import { isIntegrationEnabled } from "@/server/core/platform-controls";
import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import { decryptSecret, encryptSecret } from "@/server/core/crypto";
import { logger } from "@/server/core/logger";
import { providerInfo } from "./catalog";
import { ProviderError, refreshAccessToken, type ConnectionCredentials } from "./providers";

/**
 * Cross-module contract for reading provider connections (docs/module-development.md "External providers").
 * Other modules call `getConnection` to obtain a fresh access token; they never see refresh tokens.
 */

export type ConnectionStatus = "CONNECTED" | "ERROR" | "DISCONNECTED";

export interface Connection {
  id: string;
  provider: string;
  /** OAuth access token, or the API key / token of api_key providers (Stripe secret key, WhatsApp token, custom API key). */
  accessToken: string | null;
  /** Non-secret settings: phoneNumberId (whatsapp), baseUrl/headerName/headerPrefix (custom_api), instanceUrl (salesforce), realmId (quickbooks), tenantId (xero), teamName (slack)... */
  config: Record<string, unknown>;
  status: ConnectionStatus;
  /** Tenant of the connection (set by getConnection; used for the request log). */
  organizationId?: string;
  companyId?: string;
}

const REFRESH_WINDOW_MS = 2 * 60_000;
const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

/** Ciphertexts are bound to the company and provider, so a stolen column value cannot be replayed on another row. */
const purposeOf = (companyId: string, provider: string) => `integrations.credentials:${companyId}:${provider}`;

export function encryptCredentials(companyId: string, provider: string, creds: ConnectionCredentials): string {
  return encryptSecret(JSON.stringify(creds), purposeOf(companyId, provider));
}

export function decryptCredentials(companyId: string, provider: string, payload: string | null): ConnectionCredentials {
  if (!payload) return {};
  try {
    return JSON.parse(decryptSecret(payload, purposeOf(companyId, provider))) as ConnectionCredentials;
  } catch {
    logger.error({ companyId, provider }, "integration credentials could not be decrypted");
    return {};
  }
}

export const asConfig = (v: Prisma.JsonValue): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * The company's connection to `providerKey` with a fresh access token, or null when not connected.
 * OAuth tokens expiring within 2 minutes are refreshed (and the new token persisted) under a row lock, so concurrent
 * callers never race a rotating refresh token. A failed refresh marks the connection ERROR and returns it with a null token.
 */
export async function getConnection(organizationId: string, companyId: string, providerKey: string): Promise<Connection | null> {
  if (!isUuid(organizationId) || !isUuid(companyId)) return null;
  // A provider switched off platform-wide (Admin → Platform Controls) behaves as not connected.
  if (!(await isIntegrationEnabled(providerKey))) return null;
  const row = await db().integrationConnection.findFirst({ where: { organizationId, companyId, provider: providerKey } });
  if (!row || row.status === "DISCONNECTED" || !row.credentialsEnc) return null;
  const info = providerInfo(providerKey);
  const creds = decryptCredentials(companyId, providerKey, row.credentialsEnc);
  // Secret settings (e.g. a Google Ads developer token) are stored encrypted and only merged in here, server side.
  const withSecrets = (c: Prisma.JsonValue) => ({ ...asConfig(c), ...(creds.secrets ?? {}) });
  const base = { id: row.id, provider: row.provider, config: withSecrets(row.config), status: row.status as ConnectionStatus, organizationId: row.organizationId, companyId: row.companyId };
  if (info?.authType !== "oauth2" && !(info?.oauthAlternative && !creds.apiKey && creds.refreshToken)) return { ...base, accessToken: creds.apiKey ?? creds.accessToken ?? null };

  const expiring = row.tokenExpiresAt && row.tokenExpiresAt.getTime() - Date.now() < REFRESH_WINDOW_MS;
  if (!expiring) return { ...base, accessToken: creds.accessToken ?? null };
  if (!creds.refreshToken) {
    await markConnectionError(row.id, "Access token expired and the provider issued no refresh token; reconnect the integration");
    return { ...base, status: "ERROR", accessToken: null };
  }
  try {
    return await transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM integration_connections WHERE id = ${row.id}::uuid FOR UPDATE`;
        const fresh = await tx.integrationConnection.findUniqueOrThrow({ where: { id: row.id } });
        const current = decryptCredentials(companyId, providerKey, fresh.credentialsEnc);
        // Another caller refreshed while we waited for the lock.
        if (fresh.tokenExpiresAt && fresh.tokenExpiresAt.getTime() - Date.now() >= REFRESH_WINDOW_MS) {
          return { ...base, config: withSecrets(fresh.config), status: fresh.status as ConnectionStatus, accessToken: current.accessToken ?? null };
        }
        const tokens = await refreshAccessToken(providerKey, current.refreshToken ?? creds.refreshToken!);
        await tx.integrationConnection.update({
          where: { id: row.id },
          data: {
            credentialsEnc: encryptCredentials(companyId, providerKey, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, ...(current.secrets ? { secrets: current.secrets } : {}) }),
            tokenExpiresAt: tokens.expiresAt,
            status: "CONNECTED",
            lastError: null,
            lastErrorAt: null,
          },
        });
        return { ...base, config: withSecrets(fresh.config), status: "CONNECTED" as const, accessToken: tokens.accessToken };
      },
      { timeout: 25_000 },
    );
  } catch (err) {
    const message = err instanceof ProviderError ? `Token refresh failed: ${err.message}` : "Token refresh failed";
    await markConnectionError(row.id, message);
    return { ...base, status: "ERROR", accessToken: null };
  }
}

/** Mark a connection as failing (shown on the integration page; cleared by a successful test, sync or refresh). Never pass secrets in `message`. */
export async function markConnectionError(connectionId: string, message: string): Promise<void> {
  await db().integrationConnection.updateMany({
    where: { id: connectionId, status: { not: "DISCONNECTED" } },
    data: { status: "ERROR", lastError: message.slice(0, 500), lastErrorAt: new Date() },
  });
}

/** Clear an error after a successful call. */
export async function markConnectionHealthy(connectionId: string): Promise<void> {
  await db().integrationConnection.updateMany({ where: { id: connectionId, status: "ERROR" }, data: { status: "CONNECTED", lastError: null, lastErrorAt: null } });
}

export interface SyncRecord {
  organizationId: string;
  companyId: string;
  connectionId: string;
  provider: string;
  /** e.g. "stripe.payments", "marketing.posts". */
  kind: string;
  trigger: "manual" | "scheduled" | "external";
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  startedAt?: Date;
  itemsRead?: number;
  itemsCreated?: number;
  itemsUpdated?: number;
  itemsSkipped?: number;
  errors?: { message: string; ref?: string }[];
}

/** Record one sync (any module may record its provider syncs here); updates the connection's last sync and health. */
export async function recordSync(r: SyncRecord): Promise<string> {
  const errors = (r.errors ?? []).slice(0, 50).map((e) => ({ message: e.message.slice(0, 300), ...(e.ref ? { ref: e.ref.slice(0, 200) } : {}) }));
  const run = await db().integrationSyncRun.create({
    data: {
      organizationId: r.organizationId,
      companyId: r.companyId,
      connectionId: r.connectionId,
      provider: r.provider,
      kind: r.kind,
      trigger: r.trigger,
      status: r.status,
      itemsRead: r.itemsRead ?? 0,
      itemsCreated: r.itemsCreated ?? 0,
      itemsUpdated: r.itemsUpdated ?? 0,
      itemsSkipped: r.itemsSkipped ?? 0,
      errorCount: r.errors?.length ?? 0,
      errors,
      startedAt: r.startedAt ?? new Date(),
      finishedAt: new Date(),
    },
    select: { id: true },
  });
  await db().integrationConnection.updateMany({ where: { id: r.connectionId, companyId: r.companyId }, data: { lastSyncAt: new Date() } });
  if (r.status === "FAILED") await markConnectionError(r.connectionId, errors[0]?.message ?? "Sync failed");
  else await markConnectionHealthy(r.connectionId);
  return run.id;
}

/** The selected sub-account (page, channel, ad account, site...) of a multi-account connection, or the first one. */
export function activeAccount(conn: Pick<Connection, "config">): { id: string; name: string; type: string } | null {
  const accounts = Array.isArray(conn.config.accounts) ? (conn.config.accounts as { id: string; name: string; type: string }[]) : [];
  const active = typeof conn.config.activeAccountId === "string" ? conn.config.activeAccountId : null;
  return accounts.find((a) => a.id === active) ?? accounts[0] ?? null;
}
