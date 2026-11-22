import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, notFound } from "@/server/core/errors";
import { env } from "@/server/core/env";
import { writeAudit } from "@/server/modules/audit/service";
import { emailProvider } from "@/server/modules/email/provider";
import { EMAIL_WEBHOOK_PROVIDERS, emailWebhookConfigured } from "@/server/modules/email/events";
import { normalizeEmail } from "@/server/modules/email/suppression";
import { fromAddress, smtpSettings } from "@/server/modules/email/smtp";
import { sendPlainEmail } from "@/server/modules/email/service";
import { daysAgo, isUuid, reasonSchema, requireAnyPlatform } from "./access";
import { testPlatformSecret } from "./platform-secrets";

/**
 * Email & communication (Admin → Email, stream F): platform provider and SMTP status, sender verification, delivery
 * log (`email_messages`) with provider events (`email_events`), bounce and complaint rates, the suppression list, a
 * connection test and a test send.
 *
 * Honesty rules: SENT = accepted by the provider. Delivered / bounced / complained come only from signed provider
 * webhooks; without the webhook secret those rates are "not tracked", never 0 %.
 */

/** Same permissions as the `email` console section. */
const READ = ["platform.controls.manage", "platform.security.read", "platform.audit.read", "platform.content.manage", "platform.support.read"];
const MANAGE = ["platform.controls.manage", "platform.security.manage"];

const domainOf = (from: string | undefined) => {
  if (!from) return null;
  const at = fromAddress(from).split("@")[1];
  return at ? at.toLowerCase() : null;
};

/** Provider configuration as the admin may see it: ids, sender, whether secrets are set — never their values. */
export function emailProviderStatus() {
  const e = env();
  const configured = emailProvider();
  const smtp = e.EMAIL_PROVIDER === "smtp" ? smtpSettings(e) : null;
  return {
    provider: e.EMAIL_PROVIDER ?? null,
    configured: !!configured,
    from: e.EMAIL_FROM ?? null,
    senderDomain: domainOf(e.EMAIL_FROM),
    apiKeySet: !!e.EMAIL_API_KEY,
    smtp: smtp ? { host: smtp.host, port: smtp.port, secure: smtp.secure, authenticated: !!smtp.user } : null,
    webhooks: EMAIL_WEBHOOK_PROVIDERS.map((p) => ({ provider: p, configured: emailWebhookConfigured(p), path: `/api/v1/webhooks/email/${p}` })),
  };
}

/** 7-day delivery picture: messages by status, provider events by type, rates over provider-accepted messages. */
export async function emailOverview(ctx: RequestContext) {
  await requireAnyPlatform(ctx, READ);
  const d7 = daysAgo(7);
  const status = emailProviderStatus();
  const [byStatus, byType, lastEvent, suppressions, byReason] = await Promise.all([
    db().emailMessage.groupBy({ by: ["status"], where: { createdAt: { gte: d7 } }, _count: { _all: true } }),
    db().emailEvent.groupBy({ by: ["type"], where: { occurredAt: { gte: d7 } }, _count: { _all: true } }),
    db().emailEvent.findFirst({ orderBy: { id: "desc" }, select: { createdAt: true, provider: true } }),
    db().emailSuppression.count(),
    db().emailSuppression.groupBy({ by: ["reason"], _count: { _all: true } }),
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const ev = (t: string) => byType.find((b) => b.type === t)?._count._all ?? 0;
  const sent = count("SENT");
  const webhookOn = status.webhooks.some((w) => w.provider === status.provider && w.configured);
  const tracked = webhookOn || !!lastEvent;
  const rate = (n: number) => (tracked && sent > 0 ? n / sent : null);
  return {
    status,
    messages: { sent, failed: count("FAILED"), notConfigured: count("NOT_CONFIGURED") },
    events: { delivered: ev("delivered"), bounced: ev("bounced"), complained: ev("complained"), deferred: ev("deferred"), opened: ev("opened"), clicked: ev("clicked") },
    eventsTracked: tracked,
    lastEventAt: lastEvent?.createdAt ?? null,
    rates: { delivered: rate(ev("delivered")), bounce: rate(ev("bounced")), complaint: rate(ev("complained")) },
    suppressions: { total: suppressions, byReason: byReason.map((r) => ({ reason: r.reason, count: r._count._all })) },
  };
}

const messageFilters = z.object({
  status: z.enum(["SENT", "FAILED", "NOT_CONFIGURED"]).optional().catch(undefined),
  template: z.string().trim().max(80).optional().catch(undefined),
  q: z.string().trim().max(254).optional().catch(undefined),
  org: z.string().uuid().optional().catch(undefined),
  outcome: z.enum(["delivered", "bounced", "complained", "deferred", "none"]).optional().catch(undefined),
  cursor: z.string().uuid().optional().catch(undefined),
  limit: z.coerce.number().int().min(10).max(200).default(50).catch(50),
});
export type EmailMessageFilters = Partial<Record<keyof z.input<typeof messageFilters>, unknown>>;

/** Delivery log: keyset pages of `email_messages`, each with the provider events received for it. */
export async function listEmailMessages(ctx: RequestContext, raw: EmailMessageFilters = {}) {
  await requireAnyPlatform(ctx, READ);
  const f = messageFilters.parse(raw);
  let ids: string[] | undefined;
  if (f.outcome && f.outcome !== "none") {
    const rows = await db().emailEvent.findMany({ where: { type: f.outcome, emailMessageId: { not: null }, occurredAt: { gte: daysAgo(90) } }, select: { emailMessageId: true }, orderBy: { id: "desc" }, take: 1000 });
    ids = [...new Set(rows.map((r) => r.emailMessageId!))];
  }
  const where: Prisma.EmailMessageWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.template ? { template: { startsWith: f.template } } : {}),
    ...(f.q ? { toEmail: { contains: f.q, mode: "insensitive" } } : {}),
    ...(f.org ? { organizationId: f.org } : {}),
    ...(ids ? { id: { in: ids } } : {}),
  };
  const rows = await db().emailMessage.findMany({ where, orderBy: { id: "desc" }, take: f.limit + 1, ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}) });
  const hasMore = rows.length > f.limit;
  const data = hasMore ? rows.slice(0, f.limit) : rows;
  const events = data.length ? await db().emailEvent.findMany({ where: { emailMessageId: { in: data.map((m) => m.id) } }, orderBy: { occurredAt: "asc" }, select: { emailMessageId: true, type: true, occurredAt: true } }) : [];
  const withEvents = data.map((m) => {
    const own = events.filter((e) => e.emailMessageId === m.id);
    return { ...m, events: own.map((e) => ({ type: e.type, occurredAt: e.occurredAt })), outcome: own.length ? own[own.length - 1]!.type : null };
  });
  const templates = await db().emailMessage.groupBy({ by: ["template"], where: { createdAt: { gte: daysAgo(30) } }, _count: { _all: true }, orderBy: { _count: { template: "desc" } }, take: 30 });
  return {
    filters: f,
    data: f.outcome === "none" ? withEvents.filter((m) => !m.outcome) : withEvents,
    nextCursor: hasMore ? rows[f.limit - 1]!.id : null,
    templates: templates.map((t) => ({ template: t.template, count: t._count._all })),
  };
}

/** One message with its events and suppression state (no body: bodies and links are never stored). */
export async function emailMessageDetail(ctx: RequestContext, id: string) {
  await requireAnyPlatform(ctx, READ);
  if (!isUuid(id)) throw notFound("Email");
  const m = await db().emailMessage.findUnique({ where: { id } });
  if (!m) throw notFound("Email");
  const [events, suppression, audit] = await Promise.all([
    db().emailEvent.findMany({ where: { OR: [{ emailMessageId: m.id }, ...(m.providerMessageId ? [{ providerMessageId: m.providerMessageId }] : [])] }, orderBy: { occurredAt: "asc" }, take: 50 }),
    db().emailSuppression.findUnique({ where: { email: normalizeEmail(m.toEmail) } }),
    db().auditLog.findMany({ where: { resourceType: "email_message", resourceId: m.id }, orderBy: { id: "desc" }, take: 10 }),
  ]);
  return { message: m, events, suppression, audit };
}

const suppressionFilters = z.object({
  q: z.string().trim().max(254).optional().catch(undefined),
  reason: z.enum(["hard_bounce", "complaint", "manual"]).optional().catch(undefined),
  cursor: z.string().max(254).optional().catch(undefined),
});

/** Suppression list: pages of 50 ordered by address (keyset on the primary key). */
export async function listSuppressions(ctx: RequestContext, raw: Partial<Record<keyof z.input<typeof suppressionFilters>, unknown>> = {}) {
  await requireAnyPlatform(ctx, READ);
  const f = suppressionFilters.parse(raw);
  const rows = await db().emailSuppression.findMany({
    where: { ...(f.q ? { email: { contains: f.q.toLowerCase() } } : {}), ...(f.reason ? { reason: f.reason } : {}), ...(f.cursor ? { email: { gt: f.cursor, ...(f.q ? { contains: f.q.toLowerCase() } : {}) } } : {}) },
    orderBy: { email: "asc" },
    take: 51,
  });
  const more = rows.length > 50;
  const data = more ? rows.slice(0, 50) : rows;
  return { filters: f, data, nextCursor: more ? data[data.length - 1]!.email : null };
}

export const suppressionInput = z.object({ email: z.string().trim().email().max(254), note: z.string().trim().max(300).optional(), reason: reasonSchema });

export async function addSuppression(ctx: RequestContext, raw: z.input<typeof suppressionInput>) {
  const input = suppressionInput.parse(raw);
  const email = normalizeEmail(input.email);
  return transaction(async (tx) => {
    await requireAnyPlatform(ctx, MANAGE);
    const existing = await tx.emailSuppression.findUnique({ where: { email } });
    if (existing) throw conflict("The address is already suppressed");
    await tx.emailSuppression.create({ data: { email, reason: "manual", source: "admin", note: input.note ?? null, createdById: ctx.actor.id } });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "platform.email_suppressed", resourceType: "email_suppression", resourceId: email, newValue: { reason: "manual", note: input.note ?? null }, reason: input.reason });
    return { email };
  });
}

export const removeSuppressionInput = z.object({ reason: reasonSchema });

/** Remove an address from the list (e.g. after the recipient fixed their mailbox). */
export async function removeSuppression(ctx: RequestContext, email: string, raw: z.input<typeof removeSuppressionInput>) {
  const { reason } = removeSuppressionInput.parse(raw);
  const key = normalizeEmail(decodeURIComponent(email));
  return transaction(async (tx) => {
    await requireAnyPlatform(ctx, MANAGE);
    const row = await tx.emailSuppression.findUnique({ where: { email: key } });
    if (!row) throw notFound("Suppression");
    await tx.emailSuppression.delete({ where: { email: key } });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "platform.email_unsuppressed", resourceType: "email_suppression", resourceId: key, oldValue: { reason: row.reason, source: row.source, createdAt: row.createdAt }, reason });
    return { ok: true };
  });
}

/** Connection test: the platform-keys provider check of the active provider (API key, or SMTP login; nothing is sent). */
export async function testEmailConnection(ctx: RequestContext) {
  await requireAnyPlatform(ctx, MANAGE);
  const p = env().EMAIL_PROVIDER;
  if (!p) throw new AppError("not_configured", "No platform email provider is configured", { reason: "email_not_configured" });
  return testPlatformSecret(ctx, p === "smtp" ? "SMTP_HOST" : "EMAIL_API_KEY", {});
}

/**
 * Sender verification. Resend: the domain list of the account (`GET /domains`: name and status only). Postmark and
 * SMTP expose no sender status with the credentials Realy holds, so the answer is "check in the provider console".
 */
export async function checkSenderVerification(ctx: RequestContext) {
  await requireAnyPlatform(ctx, MANAGE);
  const s = emailProviderStatus();
  if (s.provider !== "resend" || !env().EMAIL_API_KEY) return { supported: false as const, provider: s.provider, senderDomain: s.senderDomain };
  try {
    const res = await fetch("https://api.resend.com/domains", { headers: { authorization: `Bearer ${env().EMAIL_API_KEY}`, accept: "application/json" }, signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { supported: true as const, provider: s.provider, senderDomain: s.senderDomain, status: res.status, domains: [] as { name: string; status: string }[], senderVerified: null };
    }
    const body = (await res.json().catch(() => ({}))) as { data?: { name?: unknown; status?: unknown }[] };
    const domains = (body.data ?? []).map((d) => ({ name: String(d.name ?? ""), status: String(d.status ?? "unknown") })).slice(0, 50);
    const match = domains.find((d) => d.name.toLowerCase() === s.senderDomain);
    return { supported: true as const, provider: s.provider, senderDomain: s.senderDomain, status: res.status, domains, senderVerified: match ? match.status === "verified" : false };
  } catch {
    return { supported: true as const, provider: s.provider, senderDomain: s.senderDomain, status: null, domains: [] as { name: string; status: string }[], senderVerified: null };
  }
}

export const testSendInput = z.object({ to: z.string().trim().email().max(254), reason: reasonSchema });

/** Send a short plain test message through the platform provider (recorded in `email_messages` as `test:connection`). */
export async function sendTestEmail(ctx: RequestContext, raw: z.input<typeof testSendInput>) {
  const input = testSendInput.parse(raw);
  await requireAnyPlatform(ctx, MANAGE);
  if (!emailProvider()) throw new AppError("not_configured", "No platform email provider is configured", { reason: "email_not_configured" });
  const r = await sendPlainEmail({ to: input.to, subject: "[TEST] Realy platform email", text: "This is a test message sent from the Realy Control Center (Admin → Email).\n\nIf you received it, the platform provider accepted and delivered it.", template: "test:connection", organizationId: null, userId: ctx.actor.id });
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", action: "platform.email_test_sent", resourceType: "email", resourceId: null, newValue: { status: r.status }, reason: input.reason }));
  if (r.status !== "SENT") throw new AppError("service_unavailable", r.status === "FAILED" ? "The provider refused the test message (or the address is suppressed)" : "Email is not configured", { reason: "email_send_failed", status: r.status });
  return r;
}
