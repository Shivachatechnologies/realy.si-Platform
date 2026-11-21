import "server-only";
import { db, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { providerFetch, providerJson } from "./client";
import type { Connection } from "./connections";
import { plaidHost, ProviderError, wiseHost } from "./providers";
import { upsertCalendlyInvitee } from "./provider-webhooks";
import { plaidItemsOf, toMinor } from "./services/banking";
import { recordUsage } from "./usage";

/**
 * Sync kinds of the bank-feed and scheduling providers (registered in ./sync.ts SYNCERS):
 *   plaid.transactions   /transactions/sync per linked bank → IntegrationBankAccount + IntegrationBankTransaction (staged)
 *   wise.balances        balances of each Wise profile → IntegrationBankAccount
 *   calendly.events      upcoming scheduled events + invitees → CRM meetings (backfill / missed webhooks)
 */

interface Counts {
  read: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { message: string; ref?: string }[];
}
type ConnLike = { id: string; organizationId: string; companyId: string; provider: string; connectedById: string; syncCursor: Prisma.JsonValue; config?: Prisma.JsonValue };

const cursorOf = (v: Prisma.JsonValue): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const errMsg = (err: unknown) => (err instanceof Error ? err.message.slice(0, 200) : "failed");

interface PlaidAccount {
  account_id: string;
  name?: string;
  official_name?: string | null;
  mask?: string | null;
  type?: string;
  subtype?: string | null;
  balances?: { current?: number | null; available?: number | null; iso_currency_code?: string | null; unofficial_currency_code?: string | null };
}
interface PlaidTxn {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
  date: string;
  name?: string;
  merchant_name?: string | null;
  pending?: boolean;
  personal_finance_category?: { primary?: string } | null;
}

async function syncPlaidTransactions(_ctx: RequestContext, conn: ConnLike, api: Connection, counts: Counts) {
  const cursor = cursorOf(conn.syncCursor);
  const itemCursors = cursorOf((cursor.items ?? {}) as Prisma.JsonValue) as Record<string, string>;
  const items = plaidItemsOf(api.config);
  if (!items.length) return { ...cursor, items: itemCursors };
  for (const item of items) {
    const token = api.config[`plaidItem:${item.itemId}`];
    if (typeof token !== "string") {
      counts.errors.push({ message: "linked bank has no stored token; relink it", ref: `plaid:${item.itemId}` });
      continue;
    }
    let next = itemCursors[item.itemId] ?? "";
    try {
      for (let page = 0; page < 10; page++) {
        const r = await providerJson<{ added: PlaidTxn[]; modified: PlaidTxn[]; removed: { transaction_id: string }[]; accounts?: PlaidAccount[]; next_cursor: string; has_more: boolean }>(api, `${plaidHost(api.config)}/transactions/sync`, {
          json: { access_token: token, count: 500, ...(next ? { cursor: next } : {}) },
          retries: 2,
          timeoutMs: 30_000,
        });
        for (const a of r.accounts ?? []) {
          const currency = a.balances?.iso_currency_code ?? a.balances?.unofficial_currency_code ?? "USD";
          const data = {
            name: (a.official_name ?? a.name ?? "Account").slice(0, 200),
            institution: item.institution,
            mask: a.mask ?? null,
            type: [a.type, a.subtype].filter(Boolean).join(" · ") || null,
            currency,
            currentMinor: typeof a.balances?.current === "number" ? toMinor(a.balances.current, currency) : null,
            availableMinor: typeof a.balances?.available === "number" ? toMinor(a.balances.available, currency) : null,
            balanceAt: new Date(),
          };
          await db().integrationBankAccount.upsert({
            where: { connectionId_externalAccountId: { connectionId: conn.id, externalAccountId: a.account_id } },
            create: { organizationId: conn.organizationId, companyId: conn.companyId, connectionId: conn.id, provider: "plaid", itemId: item.itemId, externalAccountId: a.account_id, ...data },
            update: data,
          });
        }
        for (const t of [...r.added, ...r.modified]) {
          counts.read++;
          try {
            const currency = t.iso_currency_code ?? t.unofficial_currency_code ?? "USD";
            // Plaid: positive amount = money leaving the account. Stored from the company's view (money in > 0).
            const data = {
              externalAccountId: t.account_id,
              bookedOn: new Date(`${t.date}T00:00:00Z`),
              amountMinor: -toMinor(t.amount, currency),
              currency,
              description: (t.name ?? t.merchant_name ?? "Transaction").slice(0, 300),
              merchantName: t.merchant_name?.slice(0, 200) ?? null,
              category: t.personal_finance_category?.primary?.slice(0, 80) ?? null,
              pending: !!t.pending,
              removedAt: null,
            };
            const existing = await db().integrationBankTransaction.findUnique({ where: { connectionId_externalId: { connectionId: conn.id, externalId: t.transaction_id } }, select: { id: true } });
            if (existing) {
              await db().integrationBankTransaction.update({ where: { id: existing.id }, data });
              counts.updated++;
            } else {
              await db().integrationBankTransaction.create({ data: { organizationId: conn.organizationId, companyId: conn.companyId, connectionId: conn.id, provider: "plaid", externalId: t.transaction_id, ...data } });
              counts.created++;
            }
          } catch (err) {
            counts.errors.push({ message: errMsg(err), ref: `plaid:${t.transaction_id}` });
          }
        }
        if (r.removed.length) {
          const { count } = await db().integrationBankTransaction.updateMany({ where: { connectionId: conn.id, companyId: conn.companyId, externalId: { in: r.removed.map((x) => x.transaction_id) } }, data: { removedAt: new Date() } });
          counts.updated += count;
        }
        next = r.next_cursor;
        if (!r.has_more) break;
      }
      itemCursors[item.itemId] = next;
    } catch (err) {
      counts.errors.push({ message: errMsg(err), ref: `plaid:${item.itemId}` });
      // ITEM_LOGIN_REQUIRED etc.: the bank needs relinking; other banks keep syncing.
      if (err instanceof ProviderError && (err.status === 401 || err.status === 403)) throw err;
    }
  }
  await recordUsage({ organizationId: conn.organizationId, companyId: conn.companyId, connectionId: conn.id, provider: "plaid", operation: "bank.sync", units: counts.read, unit: "request", estimatedCostMicros: 0, status: counts.errors.length ? "FAILED" : "SUCCEEDED", meta: { items: items.length } });
  return { ...cursor, items: itemCursors };
}

async function syncWiseBalances(_ctx: RequestContext, conn: ConnLike, api: Connection, counts: Counts) {
  const profiles = Array.isArray(api.config.accounts) ? (api.config.accounts as { id: string; name: string; type: string }[]) : [];
  for (const p of profiles.slice(0, 10)) {
    if (!/^\d{1,20}$/.test(p.id)) continue;
    try {
      const res = await providerFetch<{ id: number; currency: string; name?: string | null; amount?: { value?: number; currency?: string } }[]>(api, `${wiseHost(api.config)}/v4/profiles/${p.id}/balances?types=STANDARD`, { retries: 2 });
      if (!res.ok) throw new ProviderError(`Wise balances responded ${res.status}`, res.status);
      for (const b of Array.isArray(res.data) ? res.data : []) {
        counts.read++;
        const currency = b.amount?.currency ?? b.currency;
        const data = { name: b.name ?? `${currency} balance`, institution: `Wise · ${p.name}`.slice(0, 200), mask: null, type: "balance", currency, currentMinor: typeof b.amount?.value === "number" ? toMinor(b.amount.value, currency) : null, availableMinor: null, balanceAt: new Date() };
        const existing = await db().integrationBankAccount.findUnique({ where: { connectionId_externalAccountId: { connectionId: conn.id, externalAccountId: String(b.id) } }, select: { id: true } });
        if (existing) {
          await db().integrationBankAccount.update({ where: { id: existing.id }, data });
          counts.updated++;
        } else {
          await db().integrationBankAccount.create({ data: { organizationId: conn.organizationId, companyId: conn.companyId, connectionId: conn.id, provider: "wise", itemId: p.id, externalAccountId: String(b.id), ...data } });
          counts.created++;
        }
      }
    } catch (err) {
      counts.errors.push({ message: errMsg(err), ref: `wise:${p.id}` });
      if (err instanceof ProviderError && (err.status === 401 || err.status === 403)) throw err;
    }
  }
  return cursorOf(conn.syncCursor);
}

async function syncCalendlyEvents(_ctx: RequestContext, conn: ConnLike, api: Connection, counts: Counts) {
  const user = typeof api.config.userUri === "string" ? api.config.userUri : null;
  if (!user) throw new ProviderError("Calendly user unknown; run a connection test");
  const qs = new URLSearchParams({ user, count: "50", status: "active", sort: "start_time:asc", min_start_time: new Date(Date.now() - 86_400_000).toISOString() });
  const events = await providerJson<{ collection?: Record<string, unknown>[] }>(api, `https://api.calendly.com/scheduled_events?${qs}`);
  const row = { id: conn.id, organizationId: conn.organizationId, companyId: conn.companyId, provider: conn.provider, connectedById: conn.connectedById, credentialsEnc: null, config: {} };
  for (const ev of events.collection ?? []) {
    const uri = typeof ev.uri === "string" ? ev.uri : null;
    const uuid = uri?.split("/").pop();
    if (!uuid || !/^[A-Za-z0-9-]{8,64}$/.test(uuid)) continue;
    try {
      const inv = await providerJson<{ collection?: Record<string, unknown>[] }>(api, `https://api.calendly.com/scheduled_events/${uuid}/invitees?count=20`);
      for (const i of inv.collection ?? []) {
        counts.read++;
        const r = await upsertCalendlyInvitee(row, i.status === "canceled" ? "invitee.canceled" : "invitee.created", { ...i, scheduled_event: ev });
        if (r.status === "processed") counts.updated++;
        else counts.skipped++;
      }
    } catch (err) {
      counts.errors.push({ message: errMsg(err), ref: `calendly:${uuid}` });
    }
  }
  return cursorOf(conn.syncCursor);
}

export const PROVIDER_SYNCERS: Record<string, (ctx: RequestContext, conn: ConnLike, api: Connection, counts: Counts) => Promise<Record<string, unknown>>> = {
  "plaid.transactions": syncPlaidTransactions,
  "wise.balances": syncWiseBalances,
  "calendly.events": syncCalendlyEvents,
};
