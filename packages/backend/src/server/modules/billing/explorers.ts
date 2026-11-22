/**
 * Control Center explorers over the Stripe mirror tables (invoices, payments, refunds, disputes): filters, keyset
 * pagination on (created_at, id) — Stripe's creation time, not the sync time — CSV export and detail views.
 * Read-only; amounts stay in minor units per currency (never converted).
 */
import { z } from "zod";
import { db, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { requireAnyPlatform } from "@/server/modules/admin/access";

export const BILLING_READ = ["platform.subscriptions.read", "pricing.read"];

export const INVOICE_STATUSES = ["draft", "open", "paid", "uncollectible", "void"] as const;
export const PAYMENT_STATUSES = ["succeeded", "pending", "failed", "refunded", "partially_refunded", "disputed"] as const;
export const REFUND_STATUSES = ["pending", "requires_action", "succeeded", "failed", "canceled"] as const;
export const DISPUTE_STATUSES = ["warning_needs_response", "warning_under_review", "warning_closed", "needs_response", "under_review", "won", "lost", "prevented"] as const;
export const OPEN_DISPUTE_STATUSES = ["warning_needs_response", "warning_under_review", "needs_response", "under_review"];

// ───────────── Keyset cursor ─────────────

const encodeCursor = (r: { createdAt: Date; id: string }) => Buffer.from(`${r.createdAt.toISOString()}|${r.id}`).toString("base64url");
function decodeCursor(c: string | undefined): { createdAt: Date; id: string } | null {
  if (!c) return null;
  try {
    const [iso, id] = Buffer.from(c, "base64url").toString("utf8").split("|");
    const createdAt = new Date(iso ?? "");
    if (Number.isNaN(createdAt.getTime()) || !id || !/^[0-9a-f-]{36}$/.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
const keyset = (c: { createdAt: Date; id: string } | null) => (c ? { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] } : {});
const ORDER = [{ createdAt: "desc" as const }, { id: "desc" as const }];

function page<T extends { createdAt: Date; id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, nextCursor: hasMore ? encodeCursor(data[data.length - 1]!) : null };
}

const common = {
  org: z.string().uuid().optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
  from: z.coerce.date().optional().catch(undefined),
  to: z.coerce.date().optional().catch(undefined),
  currency: z.string().regex(/^[A-Z]{3}$/).optional().catch(undefined),
  limit: z.coerce.number().int().min(10).max(200).default(50).catch(50),
  cursor: z.string().max(200).optional().catch(undefined),
};
const range = (f: { from?: Date; to?: Date }) => (f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {});

async function orgNames(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map<string, { name: string; slug: string }>();
  const rows = await db().organization.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, slug: true } });
  return new Map(rows.map((r) => [r.id, { name: r.name, slug: r.slug }]));
}

/** Where the data comes from, for the explorers' data-source / freshness indicator. */
export async function mirrorStatus() {
  const [lastEvent, invoices, payments, lastInvoice, lastPayment] = await Promise.all([
    db().stripeEvent.findFirst({ orderBy: { processedAt: "desc" }, select: { processedAt: true, type: true } }),
    db().platformInvoice.count(),
    db().platformPayment.count(),
    db().platformInvoice.findFirst({ orderBy: { syncedAt: "desc" }, select: { syncedAt: true } }),
    db().platformPayment.findFirst({ orderBy: { syncedAt: "desc" }, select: { syncedAt: true } }),
  ]);
  const synced = [lastInvoice?.syncedAt, lastPayment?.syncedAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return { lastEventAt: lastEvent?.processedAt ?? null, lastEventType: lastEvent?.type ?? null, lastSyncedAt: synced, invoices, payments };
}

// ───────────── Failed-payment recovery (moved here from Platform ops) ─────────────

/**
 * Subscriptions in dunning (PAST_DUE, UNPAID, INCOMPLETE), latest failed payment first, with a link to the Stripe
 * subscription or customer. Recovery itself happens in Stripe; this is the follow-up list. Bounded to 100 rows.
 */
export async function failedPaymentRecovery(ctx: RequestContext) {
  await requireAnyPlatform(ctx, BILLING_READ);
  const rows = await db().subscription.findMany({
    where: { status: { in: ["PAST_DUE", "UNPAID", "INCOMPLETE"] } },
    orderBy: [{ lastPaymentFailedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: 100,
    select: { id: true, organizationId: true, status: true, currency: true, lastPaymentFailedAt: true, currentPeriodEnd: true, stripeSubscriptionId: true, plan: { select: { name: true } }, organization: { select: { name: true, billingProfile: { select: { stripeCustomerId: true } } } }, items: { select: { quantity: true, unitAmountMinor: true } } },
  });
  return rows.map((s) => ({
    id: s.id,
    organizationId: s.organizationId,
    organizationName: s.organization.name,
    status: s.status,
    plan: s.plan.name,
    amountMinor: s.items.reduce((a, i) => a + i.unitAmountMinor * BigInt(i.quantity), 0n),
    currency: s.currency,
    lastPaymentFailedAt: s.lastPaymentFailedAt,
    currentPeriodEnd: s.currentPeriodEnd,
    stripeUrl: s.stripeSubscriptionId ? `https://dashboard.stripe.com/subscriptions/${s.stripeSubscriptionId}` : s.organization.billingProfile?.stripeCustomerId ? `https://dashboard.stripe.com/customers/${s.organization.billingProfile.stripeCustomerId}` : null,
  }));
}

// ───────────── Invoices ─────────────

export const invoiceFilters = z.object({ ...common, status: z.enum(INVOICE_STATUSES).optional().catch(undefined), overdue: z.enum(["1"]).optional().catch(undefined) });

function invoiceWhere(f: z.infer<typeof invoiceFilters>): Prisma.PlatformInvoiceWhereInput {
  const q = f.q;
  return {
    ...(f.org ? { organizationId: f.org } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.currency ? { currency: f.currency } : {}),
    ...(f.overdue ? { status: "open", dueAt: { lt: new Date() } } : {}),
    ...range(f),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" as const } }, { stripeInvoiceId: q }, { stripeCustomerId: q }, { stripeSubscriptionId: q }] } : {}),
  };
}

export async function listPlatformInvoices(ctx: RequestContext, raw: Record<string, unknown> = {}) {
  await requireAnyPlatform(ctx, BILLING_READ);
  const f = invoiceFilters.parse(raw);
  const where = invoiceWhere(f);
  const [rows, byStatus] = await Promise.all([
    db().platformInvoice.findMany({ where: { AND: [where, keyset(decodeCursor(f.cursor))] }, orderBy: ORDER, take: f.limit + 1 }),
    db().platformInvoice.groupBy({ by: ["status"], where: f.org ? { organizationId: f.org } : {}, _count: { _all: true } }),
  ]);
  const p = page(rows, f.limit);
  const orgs = await orgNames(p.data.map((r) => r.organizationId));
  return {
    filters: f,
    page: { ...p, data: p.data.map((r) => ({ ...r, organization: r.organizationId ? (orgs.get(r.organizationId) ?? null) : null })) },
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) as Record<string, number>,
  };
}

export async function getPlatformInvoice(ctx: RequestContext, id: string) {
  await requireAnyPlatform(ctx, BILLING_READ);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound("Invoice");
  const inv = await db().platformInvoice.findUnique({ where: { id } });
  if (!inv) throw notFound("Invoice");
  const [payments, org, sub, events] = await Promise.all([
    db().platformPayment.findMany({ where: { stripeInvoiceId: inv.stripeInvoiceId }, orderBy: { createdAt: "desc" }, take: 50 }),
    inv.organizationId ? db().organization.findUnique({ where: { id: inv.organizationId }, select: { id: true, name: true, slug: true } }) : null,
    inv.subscriptionId ? db().subscription.findUnique({ where: { id: inv.subscriptionId }, select: { id: true, status: true, plan: { select: { key: true, name: true } } } }) : null,
    inv.organizationId ? db().stripeEvent.findMany({ where: { organizationId: inv.organizationId, type: { startsWith: "invoice." }, processedAt: { gte: new Date(inv.createdAt.getTime() - 60_000) } }, orderBy: { processedAt: "desc" }, take: 30 }) : [],
  ]);
  const refunds = payments.length ? await db().platformRefund.findMany({ where: { paymentId: { in: payments.map((p) => p.id) } }, orderBy: { createdAt: "desc" } }) : [];
  return { invoice: inv, payments, refunds, organization: org, subscription: sub, events };
}

// ───────────── Payments ─────────────

export const paymentFilters = z.object({ ...common, status: z.enum(PAYMENT_STATUSES).optional().catch(undefined) });

function paymentWhere(f: z.infer<typeof paymentFilters>): Prisma.PlatformPaymentWhereInput {
  const q = f.q;
  return {
    ...(f.org ? { organizationId: f.org } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.currency ? { currency: f.currency } : {}),
    ...range(f),
    ...(q ? { OR: [{ stripeChargeId: q }, { stripePaymentIntentId: q }, { stripeInvoiceId: q }, { stripeCustomerId: q }, { last4: q }] } : {}),
  };
}

export async function listPlatformPayments(ctx: RequestContext, raw: Record<string, unknown> = {}) {
  await requireAnyPlatform(ctx, BILLING_READ);
  const f = paymentFilters.parse(raw);
  const [rows, byStatus] = await Promise.all([
    db().platformPayment.findMany({ where: { AND: [paymentWhere(f), keyset(decodeCursor(f.cursor))] }, orderBy: ORDER, take: f.limit + 1 }),
    db().platformPayment.groupBy({ by: ["status"], where: f.org ? { organizationId: f.org } : {}, _count: { _all: true } }),
  ]);
  const p = page(rows, f.limit);
  const orgs = await orgNames(p.data.map((r) => r.organizationId));
  return {
    filters: f,
    page: { ...p, data: p.data.map((r) => ({ ...r, organization: r.organizationId ? (orgs.get(r.organizationId) ?? null) : null })) },
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) as Record<string, number>,
  };
}

export async function getPlatformPayment(ctx: RequestContext, id: string) {
  await requireAnyPlatform(ctx, BILLING_READ);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound("Payment");
  const p = await db().platformPayment.findUnique({ where: { id } });
  if (!p) throw notFound("Payment");
  const [refunds, disputes, invoice, org, audit] = await Promise.all([
    db().platformRefund.findMany({ where: { OR: [{ paymentId: p.id }, ...(p.stripeChargeId ? [{ stripeChargeId: p.stripeChargeId }] : [])] }, orderBy: { createdAt: "desc" } }),
    db().platformDispute.findMany({ where: { OR: [{ paymentId: p.id }, ...(p.stripeChargeId ? [{ stripeChargeId: p.stripeChargeId }] : [])] }, orderBy: { createdAt: "desc" } }),
    p.stripeInvoiceId ? db().platformInvoice.findUnique({ where: { stripeInvoiceId: p.stripeInvoiceId } }) : null,
    p.organizationId ? db().organization.findUnique({ where: { id: p.organizationId }, select: { id: true, name: true, slug: true } }) : null,
    db().auditLog.findMany({ where: { resourceType: "payment", resourceId: p.id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, action: true, actorId: true, reason: true, createdAt: true, newValue: true } }),
  ]);
  const pendingOrDone = refunds.filter((r) => ["pending", "requires_action", "succeeded"].includes(r.status)).reduce((a, r) => a + r.amountMinor, 0n);
  const used = pendingOrDone > p.refundedMinor ? pendingOrDone : p.refundedMinor;
  return { payment: p, refunds, disputes, invoice, organization: org, audit, refundableMinor: p.amountMinor > used ? p.amountMinor - used : 0n };
}

// ───────────── Refunds and disputes ─────────────

export const refundFilters = z.object({ ...common, status: z.enum(REFUND_STATUSES).optional().catch(undefined), source: z.enum(["console", "external"]).optional().catch(undefined) });

export async function listPlatformRefunds(ctx: RequestContext, raw: Record<string, unknown> = {}) {
  await requireAnyPlatform(ctx, BILLING_READ);
  const f = refundFilters.parse(raw);
  const where: Prisma.PlatformRefundWhereInput = {
    ...(f.org ? { organizationId: f.org } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.currency ? { currency: f.currency } : {}),
    ...(f.source === "console" ? { createdById: { not: null } } : f.source === "external" ? { createdById: null } : {}),
    ...range(f),
    ...(f.q ? { OR: [{ stripeRefundId: f.q }, { stripeChargeId: f.q }, { stripePaymentIntentId: f.q }] } : {}),
  };
  const rows = await db().platformRefund.findMany({ where: { AND: [where, keyset(decodeCursor(f.cursor))] }, orderBy: ORDER, take: f.limit + 1 });
  const p = page(rows, f.limit);
  const [orgs, admins] = await Promise.all([
    orgNames(p.data.map((r) => r.organizationId)),
    db().user.findMany({ where: { id: { in: [...new Set(p.data.map((r) => r.createdById).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
  ]);
  return {
    filters: f,
    page: { ...p, data: p.data.map((r) => ({ ...r, organization: r.organizationId ? (orgs.get(r.organizationId) ?? null) : null, admin: admins.find((a) => a.id === r.createdById)?.name ?? null })) },
  };
}

export const disputeFilters = z.object({ ...common, status: z.enum(DISPUTE_STATUSES).optional().catch(undefined), open: z.enum(["1"]).optional().catch(undefined) });

export async function listPlatformDisputes(ctx: RequestContext, raw: Record<string, unknown> = {}) {
  await requireAnyPlatform(ctx, BILLING_READ);
  const f = disputeFilters.parse(raw);
  const where: Prisma.PlatformDisputeWhereInput = {
    ...(f.org ? { organizationId: f.org } : {}),
    ...(f.status ? { status: f.status } : f.open ? { status: { in: OPEN_DISPUTE_STATUSES } } : {}),
    ...(f.currency ? { currency: f.currency } : {}),
    ...range(f),
    ...(f.q ? { OR: [{ stripeDisputeId: f.q }, { stripeChargeId: f.q }] } : {}),
  };
  const soon = new Date(Date.now() + 3 * 86_400_000);
  const [rows, dueSoon] = await Promise.all([
    db().platformDispute.findMany({ where: { AND: [where, keyset(decodeCursor(f.cursor))] }, orderBy: ORDER, take: f.limit + 1 }),
    db().platformDispute.findMany({ where: { status: { in: OPEN_DISPUTE_STATUSES }, evidenceDueBy: { lte: soon } }, orderBy: { evidenceDueBy: "asc" }, take: 20 }),
  ]);
  const p = page(rows, f.limit);
  const orgs = await orgNames([...p.data, ...dueSoon].map((r) => r.organizationId));
  const withOrg = <T extends { organizationId: string | null }>(r: T) => ({ ...r, organization: r.organizationId ? (orgs.get(r.organizationId) ?? null) : null });
  return { filters: f, page: { ...p, data: p.data.map(withOrg) }, dueSoon: dueSoon.map(withOrg) };
}

export async function getPlatformDispute(ctx: RequestContext, id: string) {
  await requireAnyPlatform(ctx, BILLING_READ);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound("Dispute");
  const d = await db().platformDispute.findUnique({ where: { id } });
  if (!d) throw notFound("Dispute");
  const [payment, org] = await Promise.all([
    d.paymentId ? db().platformPayment.findUnique({ where: { id: d.paymentId } }) : d.stripeChargeId ? db().platformPayment.findUnique({ where: { stripeChargeId: d.stripeChargeId } }) : null,
    d.organizationId ? db().organization.findUnique({ where: { id: d.organizationId }, select: { id: true, name: true, slug: true } }) : null,
  ]);
  return { dispute: d, payment, organization: org };
}

// ───────────── CSV export ─────────────

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
const csv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

const EXPORT_MAX = 5_000;

/** CSV of the filtered invoices (at most 5,000 rows, newest first). */
export async function exportInvoicesCsv(ctx: RequestContext, raw: Record<string, unknown>) {
  await requireAnyPlatform(ctx, BILLING_READ);
  const f = invoiceFilters.parse(raw);
  const rows = await db().platformInvoice.findMany({ where: invoiceWhere(f), orderBy: ORDER, take: EXPORT_MAX });
  return csv(
    ["stripe_invoice_id", "number", "organization_id", "status", "currency", "subtotal_minor", "discount_minor", "tax_minor", "tax_known", "total_minor", "amount_paid_minor", "amount_remaining_minor", "created_at", "due_at", "paid_at", "livemode"],
    rows.map((r) => [r.stripeInvoiceId, r.number, r.organizationId, r.status, r.currency, r.subtotalMinor, r.discountMinor, r.taxMinor, r.taxKnown, r.totalMinor, r.amountPaidMinor, r.amountRemainingMinor, r.createdAt, r.dueAt, r.paidAt, r.livemode]),
  );
}

/** CSV of the filtered payments (at most 5,000 rows). Card data is limited to brand and last 4, as Stripe exposes it. */
export async function exportPaymentsCsv(ctx: RequestContext, raw: Record<string, unknown>) {
  await requireAnyPlatform(ctx, BILLING_READ);
  const f = paymentFilters.parse(raw);
  const rows = await db().platformPayment.findMany({ where: paymentWhere(f), orderBy: ORDER, take: EXPORT_MAX });
  return csv(
    ["stripe_charge_id", "stripe_payment_intent_id", "stripe_invoice_id", "organization_id", "status", "currency", "amount_minor", "refunded_minor", "failure_code", "payment_method", "brand", "last4", "created_at", "livemode"],
    rows.map((r) => [r.stripeChargeId, r.stripePaymentIntentId, r.stripeInvoiceId, r.organizationId, r.status, r.currency, r.amountMinor, r.refundedMinor, r.failureCode, r.paymentMethodType, r.paymentMethodBrand, r.last4, r.createdAt, r.livemode]),
  );
}
