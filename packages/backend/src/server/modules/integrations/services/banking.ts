import "server-only";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { env } from "@/server/core/env";
import { AppError, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { providerFetch } from "../client";
import { asConfig, decryptCredentials, encryptCredentials, getConnection, type Connection } from "../connections";
import { plaidCountries, plaidHost, ProviderError } from "../providers";
import { providerWebhookUrl } from "../provider-webhooks";

/**
 * Read-only bank feeds. Plaid: the company's own Plaid keys (sandbox or production); banks are linked through Plaid
 * Hosted Link (no third-party script on Realy's pages), each linked bank ("item") is stored encrypted with the
 * connection, and /transactions/sync stages transactions in IntegrationBankTransaction for reconciliation in Finance.
 * Wise: balances of the business profile (statements need Wise's SCA signing and are not pulled).
 * Nothing here moves money.
 */

export interface PlaidItem {
  itemId: string;
  institution: string | null;
  linkedAt: string;
}

const itemSecret = (itemId: string) => `plaidItem:${itemId}`;
export const plaidItemsOf = (config: Record<string, unknown>): PlaidItem[] => (Array.isArray(config.plaidItems) ? (config.plaidItems as PlaidItem[]) : []);

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, perm: "integrations.read" | "integrations.manage") {
  const { authorizeIntegrations } = await import("../service");
  await authorizeIntegrations(ctx, organizationId, companyId, perm);
}

async function plaidConn(organizationId: string, companyId: string): Promise<Connection & { accessToken: string }> {
  const c = await getConnection(organizationId, companyId, "plaid");
  if (!c?.accessToken) throw new AppError("not_configured", "Connect Plaid with your client id and secret first", { reason: "integrations_credentials_required" });
  return c as Connection & { accessToken: string };
}

/** Update the connection's encrypted secrets and non-secret config atomically (row lock). */
async function patchConnection(connectionId: string, companyId: string, mutate: (secrets: Record<string, string>, config: Record<string, unknown>) => void) {
  await transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM integration_connections WHERE id = ${connectionId}::uuid FOR UPDATE`;
    const row = await tx.integrationConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const creds = decryptCredentials(companyId, row.provider, row.credentialsEnc);
    const secrets = { ...(creds.secrets ?? {}) };
    const config = asConfig(row.config);
    mutate(secrets, config);
    await tx.integrationConnection.update({ where: { id: connectionId }, data: { credentialsEnc: encryptCredentials(companyId, row.provider, { ...creds, secrets }), config: config as Prisma.InputJsonValue } });
  });
}

async function plaidPost<T>(conn: Connection & { accessToken: string }, path: string, json: Record<string, unknown>): Promise<T> {
  const res = await providerFetch<T>(conn, `${plaidHost(conn.config)}${path}`, { json, retries: 2, timeoutMs: 30_000 });
  if (!res.ok) {
    const d = (res.data ?? {}) as { error_code?: string; error_message?: string };
    throw new ProviderError(`Plaid ${path} failed (${res.status}${d.error_code ? `: ${d.error_code}` : ""})`, res.status);
  }
  return res.data;
}

/** Start linking a bank: a Plaid Hosted Link session; the founder is redirected there and back to the Plaid page. */
export async function startPlaidLink(ctx: RequestContext, organizationId: string, companyId: string, locale: string): Promise<{ url: string }> {
  await authorize(ctx, organizationId, companyId, "integrations.manage");
  const conn = await plaidConn(organizationId, companyId);
  const safeLocale = /^[a-z]{2}(-[A-Z]{2})?$/.test(locale) ? locale : "en-US";
  const r = await plaidPost<{ link_token?: string; hosted_link_url?: string }>(conn, "/link/token/create", {
    client_name: "Realy",
    language: safeLocale.slice(0, 2) === "de" ? "de" : "en",
    country_codes: plaidCountries(conn.config),
    user: { client_user_id: companyId },
    products: ["transactions"],
    transactions: { days_requested: 730 },
    webhook: providerWebhookUrl("plaid", conn.id),
    hosted_link: { completion_redirect_uri: `${env().APP_URL.replace(/\/+$/, "")}/${safeLocale}/integrations/plaid?plaid=return`, is_mobile_app: false },
  });
  if (!r.link_token || !r.hosted_link_url) throw new ProviderError("Plaid returned no Hosted Link URL (is Hosted Link enabled for your Plaid account?)");
  await patchConnection(conn.id, companyId, (secrets) => {
    secrets.plaidLinkToken = r.link_token!;
  });
  await transaction((tx) => writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.plaid_link_started", resourceType: "integration_connection", resourceId: conn.id }));
  return { url: r.hosted_link_url };
}

/** Finish linking: read the Hosted Link session results, exchange each public token and store the bank encrypted. */
export async function completePlaidLink(ctx: RequestContext, organizationId: string, companyId: string): Promise<{ linked: PlaidItem[] }> {
  await authorize(ctx, organizationId, companyId, "integrations.manage");
  const conn = await plaidConn(organizationId, companyId);
  const linkToken = typeof conn.config.plaidLinkToken === "string" ? conn.config.plaidLinkToken : null;
  if (!linkToken) throw invalid("No bank link is in progress; start linking again", { reason: "integrations_plaid_no_session" });
  const session = await plaidPost<{ link_sessions?: { results?: { item_add_results?: { public_token?: string; institution?: { name?: string } }[] } }[] }>(conn, "/link/token/get", { link_token: linkToken });
  const adds = (session.link_sessions ?? []).flatMap((s) => s.results?.item_add_results ?? []).filter((a) => a.public_token);
  if (!adds.length) return { linked: [] };
  const linked: { item: PlaidItem; accessToken: string }[] = [];
  for (const a of adds.slice(0, 10)) {
    const ex = await plaidPost<{ access_token?: string; item_id?: string }>(conn, "/item/public_token/exchange", { public_token: a.public_token });
    if (ex.access_token && ex.item_id) linked.push({ item: { itemId: ex.item_id, institution: a.institution?.name ?? null, linkedAt: new Date().toISOString() }, accessToken: ex.access_token });
  }
  await patchConnection(conn.id, companyId, (secrets, config) => {
    delete secrets.plaidLinkToken;
    const items = plaidItemsOf(config).filter((i) => !linked.some((l) => l.item.itemId === i.itemId));
    for (const l of linked) {
      secrets[itemSecret(l.item.itemId)] = l.accessToken;
      items.push(l.item);
    }
    config.plaidItems = items;
  });
  await db().integrationConnection.update({ where: { id: conn.id }, data: { syncEnabled: true, nextSyncAt: new Date() } });
  await transaction((tx) => writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.plaid_bank_linked", resourceType: "integration_connection", resourceId: conn.id, newValue: { institutions: linked.map((l) => l.item.institution) } }));
  return { linked: linked.map((l) => l.item) };
}

/** Unlink a bank: /item/remove at Plaid, then drop its token, accounts and staged transactions. */
export async function removePlaidItem(ctx: RequestContext, organizationId: string, companyId: string, itemId: string): Promise<{ ok: true }> {
  await authorize(ctx, organizationId, companyId, "integrations.manage");
  const conn = await plaidConn(organizationId, companyId);
  const token = conn.config[itemSecret(itemId)];
  if (typeof token !== "string" || !plaidItemsOf(conn.config).some((i) => i.itemId === itemId)) throw notFound("Bank");
  await plaidPost(conn, "/item/remove", { access_token: token }).catch((err) => {
    // An item Plaid no longer knows is already gone.
    if (!(err instanceof ProviderError && err.status === 400)) throw err;
  });
  await patchConnection(conn.id, companyId, (secrets, config) => {
    delete secrets[itemSecret(itemId)];
    config.plaidItems = plaidItemsOf(config).filter((i) => i.itemId !== itemId);
  });
  const accounts = await db().integrationBankAccount.findMany({ where: { connectionId: conn.id, companyId, itemId }, select: { externalAccountId: true } });
  await transaction(async (tx) => {
    await tx.integrationBankTransaction.deleteMany({ where: { connectionId: conn.id, companyId, externalAccountId: { in: accounts.map((a) => a.externalAccountId) } } });
    await tx.integrationBankAccount.deleteMany({ where: { connectionId: conn.id, companyId, itemId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.plaid_bank_removed", resourceType: "integration_connection", resourceId: conn.id, newValue: { itemId } });
  });
  return { ok: true };
}

/** Revoke every linked bank at Plaid (disconnect). Best effort; returns how many were removed. */
export async function revokeAllPlaidItems(conn: Connection & { accessToken: string }): Promise<number> {
  let n = 0;
  for (const item of plaidItemsOf(conn.config)) {
    const token = conn.config[itemSecret(item.itemId)];
    if (typeof token !== "string") continue;
    try {
      await plaidPost(conn, "/item/remove", { access_token: token });
      n++;
    } catch {
      // keep going: the credentials are wiped locally either way
    }
  }
  return n;
}

/** Linked accounts and the latest staged transactions of a bank-feed connection (Plaid or Wise). */
export async function bankFeed(ctx: RequestContext, organizationId: string, companyId: string, provider: "plaid" | "wise", take = 50) {
  await authorize(ctx, organizationId, companyId, "integrations.read");
  const conn = await db().integrationConnection.findFirst({ where: { organizationId, companyId, provider, status: { not: "DISCONNECTED" } }, select: { id: true, config: true } });
  if (!conn) return { items: [] as PlaidItem[], accounts: [], transactions: [], pendingLink: false };
  const [accounts, transactions] = await Promise.all([
    db().integrationBankAccount.findMany({ where: { connectionId: conn.id, companyId }, orderBy: [{ institution: "asc" }, { name: "asc" }] }),
    db().integrationBankTransaction.findMany({ where: { connectionId: conn.id, companyId, removedAt: null }, orderBy: [{ bookedOn: "desc" }, { id: "desc" }], take: Math.min(Math.max(1, take), 200) }),
  ]);
  const creds = provider === "plaid" ? await db().integrationConnection.findUnique({ where: { id: conn.id }, select: { credentialsEnc: true } }) : null;
  const pendingLink = !!creds && !!decryptCredentials(companyId, provider, creds.credentialsEnc).secrets?.plaidLinkToken;
  return { items: plaidItemsOf(asConfig(conn.config)), accounts, transactions, pendingLink };
}

/** Minor units of an amount in a currency (ISO 4217 digits via Intl; JPY 0, USD 2, KWD 3). */
export function toMinor(amount: number, currency: string): bigint {
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  return BigInt(Math.round(amount * 10 ** digits));
}
