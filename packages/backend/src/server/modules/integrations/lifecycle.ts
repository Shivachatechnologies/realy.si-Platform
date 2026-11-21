import "server-only";
import { randomToken } from "@/server/core/crypto";
import { db, transaction, type Prisma } from "@/server/core/db";
import { providerFetch } from "./client";
import { asConfig, decryptCredentials, encryptCredentials, getConnection, type Connection } from "./connections";
import { providerWebhookUrl } from "./provider-webhooks";
import { revokeAllPlaidItems } from "./services/banking";

/**
 * Provider-side setup after a connection is stored, and cleanup before it is wiped:
 *   calendly  registers (and on disconnect deletes) a webhook subscription for invitee.created / invitee.canceled with a
 *             signing key Realy generates (stored encrypted), so bookings become CRM meetings without manual setup.
 *             Calendly allows webhooks on paid plans only: a refusal is recorded on the connection (config.webhookError)
 *             and the scheduled calendly.events sync still backfills meetings.
 *   plaid     revokes every linked bank (/item/remove) on disconnect.
 */

type Conn = Connection & { accessToken: string };

async function connOf(connectionId: string): Promise<{ conn: Conn; row: { id: string; organizationId: string; companyId: string; provider: string } } | null> {
  const row = await db().integrationConnection.findUnique({ where: { id: connectionId }, select: { id: true, organizationId: true, companyId: true, provider: true, status: true } });
  if (!row || row.status === "DISCONNECTED") return null;
  const conn = await getConnection(row.organizationId, row.companyId, row.provider);
  return conn?.accessToken ? { conn: conn as Conn, row } : null;
}

async function patch(connectionId: string, companyId: string, provider: string, config: Record<string, unknown>, secrets: Record<string, string | null>) {
  await transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM integration_connections WHERE id = ${connectionId}::uuid FOR UPDATE`;
    const row = await tx.integrationConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const creds = decryptCredentials(companyId, provider, row.credentialsEnc);
    const nextSecrets = { ...(creds.secrets ?? {}) };
    for (const [k, v] of Object.entries(secrets)) {
      if (v === null) delete nextSecrets[k];
      else nextSecrets[k] = v;
    }
    const nextConfig = { ...asConfig(row.config), ...config };
    for (const [k, v] of Object.entries(config)) if (v === null) delete nextConfig[k];
    await tx.integrationConnection.update({ where: { id: connectionId }, data: { config: nextConfig as Prisma.InputJsonValue, credentialsEnc: encryptCredentials(companyId, provider, { ...creds, secrets: nextSecrets }) } });
  });
}

const CALENDLY = "https://api.calendly.com";

async function calendlyDeleteSubscription(conn: Conn): Promise<boolean> {
  const uri = typeof conn.config.calendlyWebhookUri === "string" ? conn.config.calendlyWebhookUri : null;
  const uuid = uri?.split("/").pop();
  if (!uuid || !/^[A-Za-z0-9-]{8,64}$/.test(uuid)) return false;
  const res = await providerFetch(conn, `${CALENDLY}/webhook_subscriptions/${uuid}`, { method: "DELETE", retries: 1, skipHealth: true });
  return res.ok || res.status === 404;
}

async function calendlySubscribe(conn: Conn, row: { id: string; companyId: string; provider: string }) {
  const user = typeof conn.config.userUri === "string" ? conn.config.userUri : null;
  const org = typeof conn.config.organizationUri === "string" ? conn.config.organizationUri : null;
  if (!user || !org) return;
  // A reconnect replaces the previous subscription (the URL token is per connection and stays the same).
  await calendlyDeleteSubscription(conn).catch(() => false);
  const signingKey = randomToken(32);
  const res = await providerFetch<{ resource?: { uri?: string }; message?: string; title?: string }>(conn, `${CALENDLY}/webhook_subscriptions`, {
    json: { url: providerWebhookUrl("calendly", row.id), events: ["invitee.created", "invitee.canceled"], organization: org, user, scope: "user", signing_key: signingKey },
    retries: 1,
    skipHealth: true,
  });
  if (res.ok && res.data?.resource?.uri) {
    await patch(row.id, row.companyId, row.provider, { calendlyWebhookUri: res.data.resource.uri, webhookError: null }, { calendlyWebhookKey: signingKey });
    return;
  }
  const reason = res.status === 403 ? "Calendly allows webhooks on paid plans only; meetings are imported by the scheduled sync instead" : `Calendly refused the webhook subscription (${res.status}${res.data?.message ? `: ${String(res.data.message).slice(0, 120)}` : ""})`;
  await patch(row.id, row.companyId, row.provider, { calendlyWebhookUri: null, webhookError: reason }, { calendlyWebhookKey: null });
}

/** Run provider-side setup for a freshly stored connection (best effort; failures are recorded on the connection). */
export async function afterConnect(connectionId: string): Promise<void> {
  const found = await connOf(connectionId);
  if (!found) return;
  if (found.row.provider === "calendly") await calendlySubscribe(found.conn, found.row);
}

/** Provider-side cleanup before the credentials are wiped; returns whether anything was revoked at the provider. */
export async function beforeDisconnect(connectionId: string): Promise<boolean> {
  const found = await connOf(connectionId);
  if (!found) return false;
  if (found.row.provider === "calendly") return calendlyDeleteSubscription(found.conn);
  if (found.row.provider === "plaid") return (await revokeAllPlaidItems(found.conn)) > 0;
  return false;
}
