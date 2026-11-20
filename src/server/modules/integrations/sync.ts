import "server-only";
import { db, transaction, type Prisma, type Tx } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { providerInfo } from "./catalog";
import { getConnection, markConnectionError, recordSync, type Connection } from "./connections";
import { providerJson } from "./client";
import { ProviderError } from "./providers";
import { authorizeIntegrations } from "./service";
import { ACCOUNTING_SYNCERS } from "./accounting-sync";

/**
 * Sync engine: pulls data from connected providers into Realy. Each run records an IntegrationSyncRun with counts and
 * errors. Stripe payments → `payment.received` events; HubSpot / Salesforce contacts → shared Contact and Account rows
 * (deduplicated by email and by domain). Imports run as SYSTEM, attributed to the user who connected the provider.
 */

interface SyncCounts {
  read: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { message: string; ref?: string }[];
}

type ConnRow = { id: string; organizationId: string; companyId: string; provider: string; connectedById: string; connectedAt: Date; syncCursor: Prisma.JsonValue; syncIntervalMinutes: number };

const MAX_ITEMS = 500;
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.de", "gmx.net", "web.de", "qq.com", "163.com", "yandex.ru", "mail.ru"]);

const cursorOf = (v: Prisma.JsonValue): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function domainOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const fromEmail = v.includes("@") ? v.split("@")[1] : null;
  let host = fromEmail;
  if (!host) {
    try {
      host = new URL(v.startsWith("http") ? v : `https://${v}`).hostname;
    } catch {
      return null;
    }
  }
  host = host?.replace(/^www\./, "") ?? null;
  return host && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}

async function findOrCreateAccount(tx: Tx, conn: ConnRow, a: { name: string | null; domain: string | null; website?: string | null }, counts: SyncCounts): Promise<string | null> {
  if (!a.domain && !a.name) return null;
  const existing = await tx.account.findFirst({
    where: {
      organizationId: conn.organizationId,
      companyId: conn.companyId,
      archivedAt: null,
      OR: [...(a.domain ? [{ domain: { equals: a.domain, mode: "insensitive" as const } }] : []), ...(a.name ? [{ name: { equals: a.name, mode: "insensitive" as const } }] : [])],
    },
    select: { id: true },
  });
  if (existing) return existing.id;
  const account = await tx.account.create({
    data: {
      organizationId: conn.organizationId,
      companyId: conn.companyId,
      name: a.name ?? a.domain!,
      domain: a.domain,
      website: a.website ?? (a.domain ? `https://${a.domain}` : null),
      source: conn.provider,
      createdById: conn.connectedById,
    },
    select: { id: true },
  });
  counts.created++;
  return account.id;
}

interface ImportedContact {
  ref: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  accountName: string | null;
  accountWebsite: string | null;
}

/** Create or enrich a Contact, deduplicated by normalized email within the company. */
async function upsertContact(ctx: RequestContext, conn: ConnRow, c: ImportedContact, counts: SyncCounts) {
  const email = c.email?.toLowerCase() ?? null;
  if (!email && !c.firstName && !c.lastName) {
    counts.skipped++;
    return;
  }
  await transaction(async (tx) => {
    const existing = email
      ? await tx.contact.findFirst({ where: { organizationId: conn.organizationId, companyId: conn.companyId, emailNormalized: email, archivedAt: null }, select: { id: true, phone: true, title: true, lastName: true, accountId: true } })
      : null;
    const emailDomain = domainOf(email);
    const accountDomain = domainOf(c.accountWebsite) ?? (emailDomain && !FREE_MAIL.has(emailDomain) ? emailDomain : null);
    const accountId = await findOrCreateAccount(tx, conn, { name: c.accountName, domain: accountDomain, website: c.accountWebsite }, counts);
    if (existing) {
      const patch: Prisma.ContactUncheckedUpdateInput = {};
      if (!existing.phone && c.phone) patch.phone = c.phone;
      if (!existing.title && c.title) patch.title = c.title;
      if (!existing.lastName && c.lastName) patch.lastName = c.lastName;
      if (!existing.accountId && accountId) patch.accountId = accountId;
      if (Object.keys(patch).length) {
        await tx.contact.update({ where: { id: existing.id }, data: patch });
        counts.updated++;
      } else counts.skipped++;
      return;
    }
    const contact = await tx.contact.create({
      data: {
        organizationId: conn.organizationId,
        companyId: conn.companyId,
        accountId,
        firstName: c.firstName ?? c.lastName ?? email!.split("@")[0]!,
        lastName: c.firstName ? c.lastName : null,
        email,
        emailNormalized: email,
        phone: c.phone,
        title: c.title,
        tags: [conn.provider],
        customFields: { importedFrom: conn.provider, externalId: c.ref },
        createdById: conn.connectedById,
      },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    counts.created++;
    await emitDomainEvent(tx, ctx, "contact.created", {
      organizationId: conn.organizationId,
      companyId: conn.companyId,
      entityType: "contact",
      entityId: contact.id,
      data: { firstName: contact.firstName, lastName: contact.lastName, email: contact.email, accountId, source: conn.provider },
    });
  });
}

async function syncStripePayments(ctx: RequestContext, conn: ConnRow, api: Connection, counts: SyncCounts) {
  const cursor = cursorOf(conn.syncCursor);
  // Only payments after the connection was made (no historical backfill that would fire workflows for old payments).
  const since = typeof cursor.created === "number" ? cursor.created : Math.floor(conn.connectedAt.getTime() / 1000);
  const seen = new Set(Array.isArray(cursor.seen) ? (cursor.seen as string[]) : []);
  let maxCreated = since;
  let startingAfter: string | null = null;
  const charges: Record<string, unknown>[] = [];
  while (charges.length < MAX_ITEMS) {
    const qs = new URLSearchParams({ limit: "100", "created[gte]": String(since) });
    if (startingAfter) qs.set("starting_after", startingAfter);
    const page = await providerJson<{ data: Record<string, unknown>[]; has_more: boolean }>(api, `https://api.stripe.com/v1/charges?${qs}`);
    charges.push(...page.data);
    if (!page.has_more || !page.data.length) break;
    startingAfter = String(page.data[page.data.length - 1]!.id);
  }
  const atMax = new Set<string>();
  for (const ch of charges.sort((a, b) => Number(a.created) - Number(b.created))) {
    counts.read++;
    const id = String(ch.id);
    const created = Number(ch.created);
    if (created > maxCreated) {
      maxCreated = created;
      atMax.clear();
    }
    if (created === maxCreated) atMax.add(id);
    if (seen.has(id) || ch.status !== "succeeded" || ch.paid !== true) {
      counts.skipped++;
      continue;
    }
    const billing = ch.billing_details as { email?: string; name?: string } | undefined;
    await transaction(async (tx) => {
      await emitDomainEvent(tx, ctx, "payment.received", {
        organizationId: conn.organizationId,
        companyId: conn.companyId,
        entityType: "stripe_charge",
        entityId: id,
        data: {
          provider: "stripe",
          chargeId: id,
          amountMinor: String(ch.amount ?? 0),
          currency: String(ch.currency ?? "").toUpperCase(),
          customerEmail: str(billing?.email) ?? str(ch.receipt_email),
          customerName: str(billing?.name),
          description: str(ch.description),
          paidAt: new Date(created * 1000).toISOString(),
        },
      });
    });
    counts.created++;
  }
  const nextSeen = maxCreated === since ? [...new Set([...seen, ...atMax])] : [...atMax];
  return { created: maxCreated, seen: nextSeen.slice(-200) };
}

async function syncHubspotContacts(ctx: RequestContext, conn: ConnRow, api: Connection, counts: SyncCounts) {
  const cursor = cursorOf(conn.syncCursor);
  let after = str(cursor.after);
  let pages = 0;
  while (pages < MAX_ITEMS / 100) {
    const qs = new URLSearchParams({ limit: "100", properties: "email,firstname,lastname,phone,jobtitle,company,website" });
    if (after) qs.set("after", after);
    const page = await providerJson<{ results: { id: string; properties: Record<string, string | null> }[]; paging?: { next?: { after?: string } } }>(api, `https://api.hubapi.com/crm/v3/objects/contacts?${qs}`);
    pages++;
    for (const r of page.results) {
      counts.read++;
      const p = r.properties;
      try {
        await upsertContact(ctx, conn, { ref: r.id, firstName: str(p.firstname), lastName: str(p.lastname), email: str(p.email), phone: str(p.phone), title: str(p.jobtitle), accountName: str(p.company), accountWebsite: str(p.website) }, counts);
      } catch (err) {
        counts.errors.push({ message: err instanceof Error ? err.message.slice(0, 200) : "import failed", ref: `hubspot:${r.id}` });
      }
    }
    after = page.paging?.next?.after ?? null;
    if (!after) break;
  }
  // When the listing is exhausted the next run starts over (dedupe makes re-reads harmless and picks up edits).
  return { after };
}

async function syncSalesforceContacts(ctx: RequestContext, conn: ConnRow, api: Connection, counts: SyncCounts) {
  const instance = str(api.config.instanceUrl);
  if (!instance) throw new ProviderError("Salesforce instance URL missing; reconnect the integration");
  const cursor = cursorOf(conn.syncCursor);
  const since = str(cursor.since) ?? "1970-01-01T00:00:00Z";
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(since)) throw new ProviderError("invalid sync cursor");
  const soql = `SELECT Id, FirstName, LastName, Email, Phone, Title, Account.Name, Account.Website, LastModifiedDate FROM Contact WHERE LastModifiedDate > ${since} ORDER BY LastModifiedDate ASC LIMIT ${MAX_ITEMS}`;
  const res = await providerJson<{ records: Record<string, unknown>[] }>(api, `${instance}/services/data/v61.0/query?q=${encodeURIComponent(soql)}`);
  let last = since;
  for (const r of res.records) {
    counts.read++;
    const account = r.Account as { Name?: string; Website?: string } | null;
    try {
      await upsertContact(ctx, conn, { ref: String(r.Id), firstName: str(r.FirstName), lastName: str(r.LastName), email: str(r.Email), phone: str(r.Phone), title: str(r.Title), accountName: str(account?.Name), accountWebsite: str(account?.Website) }, counts);
    } catch (err) {
      counts.errors.push({ message: err instanceof Error ? err.message.slice(0, 200) : "import failed", ref: `salesforce:${String(r.Id)}` });
    }
    if (typeof r.LastModifiedDate === "string") last = r.LastModifiedDate.replace(/\+0000$/, "Z");
  }
  return { since: last };
}

const SYNCERS: Record<string, (ctx: RequestContext, conn: ConnRow, api: Connection, counts: SyncCounts) => Promise<Record<string, unknown>>> = {
  "stripe.payments": syncStripePayments,
  "hubspot.contacts": syncHubspotContacts,
  "salesforce.contacts": syncSalesforceContacts,
  ...ACCOUNTING_SYNCERS,
};

/** Run every sync kind of one connection; records one IntegrationSyncRun per kind and emits integration.synced. */
export async function runConnectionSync(connectionId: string, trigger: "manual" | "scheduled") {
  const conn = await db().integrationConnection.findUnique({ where: { id: connectionId } });
  if (!conn || conn.status === "DISCONNECTED") return [];
  const info = providerInfo(conn.provider);
  const kinds = info?.syncKinds ?? [];
  const ctx = systemContext();
  const results: { kind: string; runId: string; status: string; counts: Omit<SyncCounts, "errors"> & { errors: number } }[] = [];
  // Schedule the next run first so a crash never makes the job hammer the provider.
  await db().integrationConnection.update({ where: { id: conn.id }, data: { nextSyncAt: new Date(Date.now() + conn.syncIntervalMinutes * 60_000) } });
  for (const kind of kinds) {
    const counts: SyncCounts = { read: 0, created: 0, updated: 0, skipped: 0, errors: [] };
    const startedAt = new Date();
    let status: "SUCCEEDED" | "PARTIAL" | "FAILED" = "SUCCEEDED";
    try {
      const api = await getConnection(conn.organizationId, conn.companyId, conn.provider);
      if (!api?.accessToken) throw new ProviderError("connection has no usable credentials; reconnect or test it");
      const syncer = SYNCERS[kind];
      if (!syncer) throw new ProviderError(`unknown sync kind ${kind}`);
      const nextCursor = await syncer(ctx, conn, api, counts);
      await db().integrationConnection.update({ where: { id: conn.id }, data: { syncCursor: nextCursor as Prisma.InputJsonValue } });
      // Later kinds of this run build on the cursor just saved.
      conn.syncCursor = nextCursor as Prisma.JsonValue;
      if (counts.errors.length) status = "PARTIAL";
    } catch (err) {
      status = "FAILED";
      counts.errors.push({ message: err instanceof Error ? err.message.slice(0, 300) : "sync failed" });
      logger.warn({ provider: conn.provider, kind, err: err instanceof Error ? err.message : "sync failed" }, "integration sync failed");
    }
    const runId = await recordSync({
      organizationId: conn.organizationId,
      companyId: conn.companyId,
      connectionId: conn.id,
      provider: conn.provider,
      kind,
      trigger,
      status,
      startedAt,
      itemsRead: counts.read,
      itemsCreated: counts.created,
      itemsUpdated: counts.updated,
      itemsSkipped: counts.skipped,
      errors: counts.errors,
    });
    await transaction(async (tx) => {
      await emitDomainEvent(tx, ctx, "integration.synced", {
        organizationId: conn.organizationId,
        companyId: conn.companyId,
        entityType: "integration_sync_run",
        entityId: runId,
        data: { provider: conn.provider, kind, status, itemsRead: counts.read, itemsCreated: counts.created, itemsUpdated: counts.updated, errorCount: counts.errors.length },
      });
    });
    results.push({ kind, runId, status, counts: { read: counts.read, created: counts.created, updated: counts.updated, skipped: counts.skipped, errors: counts.errors.length } });
  }
  return results;
}

/** "Sync now" from the integration page. */
export async function syncNow(ctx: RequestContext, organizationId: string, companyId: string, provider: string) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage");
  const conn = await db().integrationConnection.findFirst({ where: { organizationId, companyId, provider, status: { not: "DISCONNECTED" } }, select: { id: true } });
  if (!conn) throw notFound("Connection");
  if (!providerInfo(provider)?.syncKinds?.length) throw invalid("This integration has nothing to sync");
  await transaction((tx) => writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.sync_requested", resourceType: "integration_connection", resourceId: conn.id, newValue: { provider } }));
  return runConnectionSync(conn.id, "manual");
}

/** Periodic job: run syncs whose time has come (a few per tick). */
export async function runDueSyncs(limit = 5): Promise<number> {
  const due = await db().integrationConnection.findMany({
    where: { syncEnabled: true, status: { in: ["CONNECTED", "ERROR"] }, nextSyncAt: { lte: new Date() } },
    orderBy: { nextSyncAt: "asc" },
    take: limit,
    select: { id: true, nextSyncAt: true },
  });
  let n = 0;
  for (const c of due) {
    // Claim: only one worker moves nextSyncAt forward.
    const { count } = await db().integrationConnection.updateMany({ where: { id: c.id, nextSyncAt: c.nextSyncAt }, data: { nextSyncAt: new Date(Date.now() + 10 * 60_000) } });
    if (!count) continue;
    try {
      await runConnectionSync(c.id, "scheduled");
      n++;
    } catch (err) {
      await markConnectionError(c.id, err instanceof Error ? err.message.slice(0, 300) : "sync failed");
    }
  }
  return n;
}
