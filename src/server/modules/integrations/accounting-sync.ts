import "server-only";
import { db, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { env } from "@/server/core/env";
import { isAppError } from "@/server/core/errors";
import { createAccount } from "@/server/modules/crm/accounts";
import { createContact } from "@/server/modules/crm/contacts";
import { createInvoice } from "@/server/modules/finance/billing";
import { syncCompanyCalendar } from "@/server/modules/comms/calendar-sync";
import { activeConnection } from "@/server/modules/comms/connections-bridge";
import type { Connection } from "./connections";
import { providerJson } from "./client";
import { ProviderError } from "./providers";

/**
 * Accounting imports (QuickBooks Online, Xero) and calendar syncs (Google Calendar, Outlook).
 * Customers become CRM accounts (+ a primary contact) and invoices become finance invoice drafts — always through the
 * CRM and Finance services, so their validation, numbering, audit and events apply. Each imported record is mapped in
 * IntegrationExternalRef, so a record is imported once; later edits at the provider are not re-applied.
 */

export interface SyncCounts {
  read: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { message: string; ref?: string }[];
}

export interface SyncConn {
  id: string;
  organizationId: string;
  companyId: string;
  provider: string;
  syncCursor: Prisma.JsonValue;
}

type Syncer = (ctx: RequestContext, conn: SyncConn, api: Connection, counts: SyncCounts) => Promise<Record<string, unknown>>;

const MAX_ITEMS = 500;
const cursorOf = (v: Prisma.JsonValue): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const errText = (err: unknown) => (err instanceof Error ? err.message.slice(0, 200) : "import failed");

async function findRef(conn: SyncConn, kind: string, externalId: string) {
  const r = await db().integrationExternalRef.findUnique({ where: { connectionId_kind_externalId: { connectionId: conn.id, kind, externalId } }, select: { internalId: true } });
  return r?.internalId ?? null;
}

async function saveRef(conn: SyncConn, kind: string, externalId: string, internalType: string, internalId: string) {
  await db().integrationExternalRef.upsert({
    where: { connectionId_kind_externalId: { connectionId: conn.id, kind, externalId } },
    create: { organizationId: conn.organizationId, companyId: conn.companyId, connectionId: conn.id, kind, externalId, internalType, internalId },
    update: { internalType, internalId },
  });
}

interface ExternalCustomer {
  externalId: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  firstName: string | null;
  lastName: string | null;
}

/** The CRM account of an external customer: mapped, an existing duplicate (by name/domain), or newly created. */
async function ensureAccount(ctx: RequestContext, conn: SyncConn, c: ExternalCustomer, counts: SyncCounts): Promise<string> {
  const mapped = await findRef(conn, "customer", c.externalId);
  if (mapped) {
    counts.skipped++;
    return mapped;
  }
  const email = c.email && EMAIL.test(c.email) ? c.email.toLowerCase() : undefined;
  let accountId: string;
  try {
    const a = await createAccount(ctx, conn.organizationId, conn.companyId, {
      name: c.name.slice(0, 200),
      type: "CUSTOMER",
      email,
      phone: c.phone?.slice(0, 40) ?? undefined,
      website: c.website?.slice(0, 300) ?? undefined,
      source: conn.provider,
      tags: [conn.provider],
    });
    accountId = a.id;
    counts.created++;
  } catch (err) {
    const ids = isAppError(err) && err.code === "conflict" && Array.isArray(err.details?.ids) ? (err.details.ids as string[]) : null;
    if (!ids?.[0]) throw err;
    // Same customer already in the CRM: link it instead of duplicating.
    accountId = ids[0];
    counts.updated++;
  }
  await saveRef(conn, "customer", c.externalId, "account", accountId);
  if (email && (c.firstName || c.lastName)) {
    await createContact(ctx, conn.organizationId, conn.companyId, { firstName: (c.firstName ?? c.lastName ?? c.name).slice(0, 100), lastName: c.firstName ? (c.lastName ?? undefined) : undefined, email, accountId, tags: [conn.provider] }).catch((err) => {
      if (!(isAppError(err) && err.code === "conflict")) throw err;
    });
  }
  return accountId;
}

interface ExternalLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

const qty = (n: number) => String(Math.round(n * 1000) / 1000);
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

async function companyCurrency(conn: SyncConn) {
  const c = await db().company.findFirstOrThrow({ where: { id: conn.companyId }, select: { baseCurrency: true } });
  return c.baseCurrency;
}

/** Create a finance invoice draft for an external invoice (once). */
async function importInvoice(
  ctx: RequestContext,
  conn: SyncConn,
  inv: { externalId: string; number: string | null; issueDate: string | null; dueDate: string | null; currency: string | null; customer: ExternalCustomer; lines: ExternalLine[]; tax: number },
  baseCurrency: string,
  label: string,
  counts: SyncCounts,
) {
  if (await findRef(conn, "invoice", inv.externalId)) {
    counts.skipped++;
    return;
  }
  if (inv.currency && inv.currency.toUpperCase() !== baseCurrency) {
    counts.skipped++;
    counts.errors.push({ message: `Invoice ${inv.number ?? inv.externalId} is in ${inv.currency}; only ${baseCurrency} invoices are imported`, ref: `${conn.provider}:invoice:${inv.externalId}` });
    return;
  }
  const issueDate = inv.issueDate && /^\d{4}-\d{2}-\d{2}$/.test(inv.issueDate) ? inv.issueDate : new Date().toISOString().slice(0, 10);
  const dueDate = inv.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(inv.dueDate) && inv.dueDate >= issueDate ? inv.dueDate : undefined;
  const lines = inv.lines.filter((l) => l.unitPrice > 0 && l.quantity > 0).map((l) => ({ description: l.description.slice(0, 500) || "Item", quantity: qty(l.quantity), unitPrice: money(l.unitPrice) }));
  if (inv.tax > 0) lines.push({ description: "Tax", quantity: "1", unitPrice: money(inv.tax) });
  if (!lines.length) {
    counts.skipped++;
    return;
  }
  const accountId = await ensureAccount(ctx, conn, inv.customer, { ...counts, errors: counts.errors });
  const created = await createInvoice(ctx, conn.organizationId, conn.companyId, {
    accountId,
    issueDate,
    dueDate,
    notes: `Imported from ${label} invoice ${inv.number ?? inv.externalId}.`,
    lines,
  });
  await saveRef(conn, "invoice", inv.externalId, "invoice", created.id);
  counts.created++;
}

// ───────────────────────────── QuickBooks Online ─────────────────────────────

const qbHost = () => (env().QUICKBOOKS_ENVIRONMENT === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com");
const QB_TIME = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/;

async function qbQuery<T>(api: Connection, entity: "Customer" | "Invoice", since: string): Promise<T[]> {
  const realm = str(api.config.realmId);
  if (!realm) throw new ProviderError("QuickBooks company (realm) id missing; reconnect the integration");
  if (!QB_TIME.test(since)) throw new ProviderError("invalid sync cursor");
  const q = `SELECT * FROM ${entity} WHERE MetaData.LastUpdatedTime > '${since}' ORDERBY MetaData.LastUpdatedTime STARTPOSITION 1 MAXRESULTS ${MAX_ITEMS}`;
  const res = await providerJson<{ QueryResponse?: Record<string, T[] | number> }>(api, `${qbHost()}/v3/company/${encodeURIComponent(realm)}/query?query=${encodeURIComponent(q)}&minorversion=70`);
  const rows = res.QueryResponse?.[entity];
  return Array.isArray(rows) ? rows : [];
}

interface QbCustomer {
  Id: string;
  DisplayName?: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  WebAddr?: { URI?: string };
  Active?: boolean;
  MetaData?: { LastUpdatedTime?: string };
}

const qbCustomer = (c: QbCustomer): ExternalCustomer => ({
  externalId: c.Id,
  name: str(c.CompanyName) ?? str(c.DisplayName) ?? ([c.GivenName, c.FamilyName].filter(Boolean).join(" ") || `QuickBooks customer ${c.Id}`),
  email: str(c.PrimaryEmailAddr?.Address),
  phone: str(c.PrimaryPhone?.FreeFormNumber),
  website: str(c.WebAddr?.URI),
  firstName: str(c.GivenName),
  lastName: str(c.FamilyName),
});

const qbCustomers: Syncer = async (ctx, conn, api, counts) => {
  const cursor = cursorOf(conn.syncCursor);
  let since = str(cursor.customersSince) ?? "1970-01-01T00:00:00Z";
  for (const c of await qbQuery<QbCustomer>(api, "Customer", since)) {
    counts.read++;
    const t = c.MetaData?.LastUpdatedTime;
    if (t && QB_TIME.test(t) && t > since) since = t;
    if (c.Active === false) {
      counts.skipped++;
      continue;
    }
    try {
      await ensureAccount(ctx, conn, qbCustomer(c), counts);
    } catch (err) {
      counts.errors.push({ message: errText(err), ref: `quickbooks:customer:${c.Id}` });
    }
  }
  return { ...cursor, customersSince: since };
};

interface QbInvoice {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  CurrencyRef?: { value?: string };
  CustomerRef?: { value?: string; name?: string };
  Line?: { Amount?: number; Description?: string; DetailType?: string; SalesItemLineDetail?: { Qty?: number; UnitPrice?: number; ItemRef?: { name?: string } } }[];
  TxnTaxDetail?: { TotalTax?: number };
  GlobalTaxCalculation?: string;
  MetaData?: { LastUpdatedTime?: string };
}

const qbInvoices: Syncer = async (ctx, conn, api, counts) => {
  const cursor = cursorOf(conn.syncCursor);
  let since = str(cursor.invoicesSince) ?? new Date(Date.now() - 90 * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
  const base = await companyCurrency(conn);
  const customerCache = new Map<string, QbCustomer>();
  for (const inv of await qbQuery<QbInvoice>(api, "Invoice", since)) {
    counts.read++;
    const t = inv.MetaData?.LastUpdatedTime;
    if (t && QB_TIME.test(t) && t > since) since = t;
    try {
      const custId = inv.CustomerRef?.value ?? "";
      let customer: ExternalCustomer = { externalId: custId || `invoice-${inv.Id}`, name: str(inv.CustomerRef?.name) ?? `QuickBooks customer ${custId}`, email: null, phone: null, website: null, firstName: null, lastName: null };
      if (custId && !(await findRef(conn, "customer", custId))) {
        const realm = str(api.config.realmId)!;
        const full = customerCache.get(custId) ?? (await providerJson<{ Customer?: QbCustomer }>(api, `${qbHost()}/v3/company/${encodeURIComponent(realm)}/customer/${encodeURIComponent(custId)}?minorversion=70`)).Customer;
        if (full) {
          customerCache.set(custId, full);
          customer = qbCustomer(full);
        }
      }
      const lines = (inv.Line ?? [])
        .filter((l) => l.DetailType === "SalesItemLineDetail")
        .map((l) => {
          const q = l.SalesItemLineDetail?.Qty ?? 1;
          return { description: str(l.Description) ?? str(l.SalesItemLineDetail?.ItemRef?.name) ?? "Item", quantity: q, unitPrice: l.SalesItemLineDetail?.UnitPrice ?? (q ? (l.Amount ?? 0) / q : 0) };
        });
      const tax = inv.GlobalTaxCalculation === "TaxInclusive" ? 0 : (inv.TxnTaxDetail?.TotalTax ?? 0);
      await importInvoice(ctx, conn, { externalId: inv.Id, number: str(inv.DocNumber), issueDate: str(inv.TxnDate), dueDate: str(inv.DueDate), currency: str(inv.CurrencyRef?.value), customer, lines, tax }, base, "QuickBooks", counts);
    } catch (err) {
      counts.errors.push({ message: errText(err), ref: `quickbooks:invoice:${inv.Id}` });
    }
  }
  return { ...cursor, invoicesSince: since };
};

// ───────────────────────────── Xero ─────────────────────────────

const XERO = "https://api.xero.com/api.xro/2.0";

function xeroHeaders(api: Connection, since: string | null): Record<string, string> {
  const tenant = str(api.config.tenantId);
  if (!tenant) throw new ProviderError("Xero organisation (tenant) id missing; test or reconnect the integration");
  return { "xero-tenant-id": tenant, ...(since ? { "if-modified-since": since } : {}) };
}

interface XeroContact {
  ContactID: string;
  Name?: string;
  FirstName?: string;
  LastName?: string;
  EmailAddress?: string;
  Website?: string;
  ContactStatus?: string;
  Phones?: { PhoneType?: string; PhoneNumber?: string; PhoneAreaCode?: string; PhoneCountryCode?: string }[];
  UpdatedDateUTC?: string;
}

const xeroCustomer = (c: XeroContact): ExternalCustomer => {
  const phone = c.Phones?.find((p) => p.PhoneNumber);
  return {
    externalId: c.ContactID,
    name: str(c.Name) ?? ([c.FirstName, c.LastName].filter(Boolean).join(" ") || `Xero contact ${c.ContactID}`),
    email: str(c.EmailAddress),
    phone: phone ? [phone.PhoneCountryCode && `+${phone.PhoneCountryCode}`, phone.PhoneAreaCode, phone.PhoneNumber].filter(Boolean).join(" ") : null,
    website: str(c.Website),
    firstName: str(c.FirstName),
    lastName: str(c.LastName),
  };
};

const xeroContacts: Syncer = async (ctx, conn, api, counts) => {
  const cursor = cursorOf(conn.syncCursor);
  const since = str(cursor.contactsSince);
  const startedAt = new Date().toISOString().replace(/\.\d+Z$/, "");
  for (let page = 1; page <= MAX_ITEMS / 100; page++) {
    const res = await providerJson<{ Contacts?: XeroContact[] }>(api, `${XERO}/Contacts?page=${page}&where=${encodeURIComponent("IsCustomer==true")}`, { headers: xeroHeaders(api, since) });
    const rows = res.Contacts ?? [];
    for (const c of rows) {
      counts.read++;
      if (c.ContactStatus === "ARCHIVED") {
        counts.skipped++;
        continue;
      }
      try {
        await ensureAccount(ctx, conn, xeroCustomer(c), counts);
      } catch (err) {
        counts.errors.push({ message: errText(err), ref: `xero:contact:${c.ContactID}` });
      }
    }
    if (rows.length < 100) break;
  }
  return { ...cursor, contactsSince: startedAt };
};

interface XeroInvoice {
  InvoiceID: string;
  InvoiceNumber?: string;
  Type?: string;
  Status?: string;
  DateString?: string;
  DueDateString?: string;
  CurrencyCode?: string;
  LineAmountTypes?: string;
  TotalTax?: number;
  Contact?: XeroContact;
  LineItems?: { Description?: string; Quantity?: number; UnitAmount?: number; LineAmount?: number }[];
  UpdatedDateUTC?: string;
}

const xeroInvoices: Syncer = async (ctx, conn, api, counts) => {
  const cursor = cursorOf(conn.syncCursor);
  const since = str(cursor.invoicesSince) ?? new Date(Date.now() - 90 * 86_400_000).toISOString().replace(/\.\d+Z$/, "");
  const startedAt = new Date().toISOString().replace(/\.\d+Z$/, "");
  const base = await companyCurrency(conn);
  for (let page = 1; page <= MAX_ITEMS / 100; page++) {
    const qs = `page=${page}&where=${encodeURIComponent('Type=="ACCREC"')}&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID`;
    const res = await providerJson<{ Invoices?: XeroInvoice[] }>(api, `${XERO}/Invoices?${qs}`, { headers: xeroHeaders(api, since) });
    const rows = res.Invoices ?? [];
    for (const inv of rows) {
      counts.read++;
      try {
        const contact = inv.Contact ?? { ContactID: `invoice-${inv.InvoiceID}` };
        const lines = (inv.LineItems ?? []).map((l) => {
          const q = l.Quantity ?? 1;
          return { description: str(l.Description) ?? "Item", quantity: q, unitPrice: l.UnitAmount ?? (q ? (l.LineAmount ?? 0) / q : 0) };
        });
        const tax = inv.LineAmountTypes === "Inclusive" ? 0 : (inv.TotalTax ?? 0);
        await importInvoice(
          ctx,
          conn,
          { externalId: inv.InvoiceID, number: str(inv.InvoiceNumber), issueDate: str(inv.DateString)?.slice(0, 10) ?? null, dueDate: str(inv.DueDateString)?.slice(0, 10) ?? null, currency: str(inv.CurrencyCode), customer: xeroCustomer(contact), lines, tax },
          base,
          "Xero",
          counts,
        );
      } catch (err) {
        counts.errors.push({ message: errText(err), ref: `xero:invoice:${inv.InvoiceID}` });
      }
    }
    if (rows.length < 100) break;
  }
  return { ...cursor, invoicesSince: startedAt };
};

// ───────────────────────────── Calendars ─────────────────────────────

/** Two-way meeting sync through the Communication module, recorded as a sync run of this connection. */
function calendarSyncer(provider: "google_calendar" | "outlook_calendar"): Syncer {
  return async (_ctx, conn, _api, counts) => {
    // Communication syncs with the first connected calendar (Google before Microsoft).
    if (provider === "outlook_calendar" && (await activeConnection(conn.organizationId, conn.companyId, "google_calendar"))) {
      throw new ProviderError("Meetings sync with Google Calendar, which takes precedence while both are connected");
    }
    const changed = await syncCompanyCalendar(conn.organizationId, conn.companyId);
    counts.read += changed;
    counts.updated += changed;
    return cursorOf(conn.syncCursor);
  };
}

export const ACCOUNTING_SYNCERS: Record<string, Syncer> = {
  "quickbooks.customers": qbCustomers,
  "quickbooks.invoices": qbInvoices,
  "xero.contacts": xeroContacts,
  "xero.invoices": xeroInvoices,
  "google.calendar": calendarSyncer("google_calendar"),
  "microsoft.calendar": calendarSyncer("outlook_calendar"),
};
