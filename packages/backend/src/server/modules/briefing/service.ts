import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import type { BriefingChannel, BriefingKind } from "@/generated/prisma/enums";
import { userContext, type RequestContext } from "@/server/core/context";
import { encryptSecret, randomToken, sha256 } from "@/server/core/crypto";
import { db, transaction } from "@/server/core/db";
import { env } from "@/server/core/env";
import { AppError, conflict, isAppError, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { pageInput, prismaPage, toPage } from "@/server/core/pagination";
import { isOrganizationSuspended } from "@/server/core/platform-controls";
import { createTask } from "@/server/modules/agents/service";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { profileByKey } from "@/server/modules/agents/profiles";
import { decideApproval } from "@/server/modules/approvals/service";
import { writeAudit } from "@/server/modules/audit/service";
import { whatsappChannel } from "@/server/modules/integrations/services/whatsapp";
import { requirePermission, can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { composeBriefing } from "./compose";
import { deliverReport } from "./deliver";
import { SUMMARY_SUBJECT, factsFor, summaryInstructions, acceptSummary } from "./summary";
import { TIME_RE, periodFor, validTimeZone } from "./time";
import type { BriefingData } from "./types";

export const E164 = /^\+[1-9]\d{6,14}$/;
const isUuid = (v: string) => z.string().uuid().safeParse(v).success;
/** How long delivery waits for the AI summary before sending without it. */
export const SUMMARY_WAIT_MS = 10 * 60_000;
const TEST_LIMIT_PER_DAY = 10;
const CODE_TTL_MS = 15 * 60_000;
export const SUMMARY_PROFILE = "briefing_writer";

export const subscriptionInput = z.object({
  enabled: z.boolean(),
  timezone: z.string().trim().min(1).max(64).refine(validTimeZone, "Unknown time zone"),
  locale: z.string().trim().min(2).max(10).optional(),
  morningTime: z.string().regex(TIME_RE),
  days: z.array(z.number().int().min(0).max(6)).max(7).transform((d) => [...new Set(d)].sort()),
  eveningEnabled: z.boolean(),
  eveningTime: z.string().regex(TIME_RE),
  weeklyEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  whatsappEnabled: z.boolean(),
  aiSummary: z.boolean(),
  whatsappNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s()-]/g, ""))
    .refine((v) => v === "" || E164.test(v), "Use the international format, e.g. +15551234567")
    .optional(),
  completeSetup: z.boolean().optional(),
});

export const channelConfigInput = z.object({
  metaAppSecret: z.string().trim().max(200).optional(),
  metaTemplateName: z.string().trim().regex(/^[a-z0-9_]{1,512}$/).or(z.literal("")).optional(),
  metaTemplateLanguage: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/).or(z.literal("")).optional(),
  twilioContentSid: z.string().trim().regex(/^HX[a-f0-9]{32}$/).or(z.literal("")).optional(),
});

export const testInput = z.object({ channels: z.array(z.enum(["IN_APP", "EMAIL", "WHATSAPP"])).min(1).max(3).optional() });
export const decideByTokenInput = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{40,64}$/), decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).optional() });

function requireUser(ctx: RequestContext): string {
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw new AppError("unauthenticated", "Sign in required");
  return ctx.actor.id;
}

/** Briefings show company analytics: the reader needs analytics.read at the company. */
async function authorize(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, "analytics.read", chain);
  return chain;
}

// ───────────── Subscription ─────────────

export async function getSubscription(ctx: RequestContext, organizationId: string, companyId: string) {
  const userId = requireUser(ctx);
  await authorize(ctx, organizationId, companyId);
  const row = await db().briefingSubscription.findFirst({ where: { organizationId, companyId, userId } });
  if (row) return { ...row, saved: true as const, whatsappCodeHash: undefined };
  const user = await db().user.findUnique({ where: { id: userId }, select: { timezone: true, locale: true } });
  const company = await db().company.findFirst({ where: { id: companyId, organizationId }, select: { timezone: true } });
  return {
    saved: false as const,
    enabled: true,
    timezone: user?.timezone && user.timezone !== "UTC" ? user.timezone : (company?.timezone ?? "UTC"),
    locale: user?.locale ?? "en-US",
    morningTime: "07:30",
    days: [1, 2, 3, 4, 5],
    eveningEnabled: false,
    eveningTime: "18:00",
    weeklyEnabled: true,
    emailEnabled: true,
    whatsappEnabled: false,
    aiSummary: true,
    whatsappNumber: null as string | null,
    whatsappVerifiedAt: null as Date | null,
    whatsappLastInboundAt: null as Date | null,
    setupCompletedAt: null as Date | null,
  };
}
export type SubscriptionView = Awaited<ReturnType<typeof getSubscription>>;

export async function saveSubscription(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof subscriptionInput>) {
  const userId = requireUser(ctx);
  const input = subscriptionInput.parse(raw);
  await authorize(ctx, organizationId, companyId);
  return transaction(async (tx) => {
    const prev = await tx.briefingSubscription.findFirst({ where: { organizationId, companyId, userId } });
    const number = input.whatsappNumber === undefined ? (prev?.whatsappNumber ?? null) : input.whatsappNumber || null;
    const numberChanged = number !== (prev?.whatsappNumber ?? null);
    const verified = numberChanged ? null : (prev?.whatsappVerifiedAt ?? null);
    if (input.whatsappEnabled && !verified) throw conflict("Verify your WhatsApp number first", { reason: "briefing_whatsapp_unverified" });
    const data = {
      enabled: input.enabled,
      timezone: input.timezone,
      locale: input.locale ?? prev?.locale ?? "en-US",
      morningTime: input.morningTime,
      days: input.days,
      eveningEnabled: input.eveningEnabled,
      eveningTime: input.eveningTime,
      weeklyEnabled: input.weeklyEnabled,
      emailEnabled: input.emailEnabled,
      whatsappEnabled: input.whatsappEnabled,
      aiSummary: input.aiSummary,
      whatsappNumber: number,
      ...(numberChanged ? { whatsappVerifiedAt: null, whatsappCodeHash: null, whatsappCodeExpiresAt: null, whatsappLastInboundAt: null } : {}),
      ...(input.completeSetup && !prev?.setupCompletedAt ? { setupCompletedAt: new Date() } : {}),
    };
    const row = prev ? await tx.briefingSubscription.update({ where: { id: prev.id }, data }) : await tx.briefingSubscription.create({ data: { organizationId, companyId, userId, ...data } });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: prev ? "briefing.settings_updated" : "briefing.subscribed",
      resourceType: "briefing_subscription",
      resourceId: row.id,
      newValue: { companyId, enabled: row.enabled, morningTime: row.morningTime, days: row.days, timezone: row.timezone, email: row.emailEnabled, whatsapp: row.whatsappEnabled, evening: row.eveningEnabled, weekly: row.weeklyEnabled, numberChanged },
    });
    return { ...row, whatsappCodeHash: undefined };
  });
}

/**
 * Start number verification: the founder sends "REALY <code>" from their WhatsApp to the company's business number.
 * The inbound webhook (signature-verified) then marks the number verified, which proves ownership of the number and
 * opens WhatsApp's 24-hour window.
 */
export async function startWhatsAppVerification(ctx: RequestContext, organizationId: string, companyId: string) {
  const userId = requireUser(ctx);
  await authorize(ctx, organizationId, companyId);
  const sub = await db().briefingSubscription.findFirst({ where: { organizationId, companyId, userId } });
  if (!sub?.whatsappNumber) throw conflict("Save your WhatsApp number first", { reason: "briefing_whatsapp_no_number" });
  const channel = await whatsappChannel(organizationId, companyId);
  if (!channel) throw new AppError("not_configured", "Connect Twilio (WhatsApp sender) or WhatsApp Business first", { reason: "briefing_whatsapp_not_connected" });
  const code = String(randomInt(100000, 1000000));
  await transaction(async (tx) => {
    await tx.briefingSubscription.update({ where: { id: sub.id }, data: { whatsappCodeHash: sha256(`${sub.id}:${code}`), whatsappCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "briefing.whatsapp_verification_started", resourceType: "briefing_subscription", resourceId: sub.id, newValue: { companyId, provider: channel.provider } });
  });
  const businessNumber = E164.test(channel.sender) ? channel.sender : null;
  const text = `REALY ${code}`;
  return { code, text, provider: channel.provider, businessNumber, link: businessNumber ? `https://wa.me/${businessNumber.slice(1)}?text=${encodeURIComponent(text)}` : null, expiresAt: new Date(Date.now() + CODE_TTL_MS) };
}

// ───────────── Company channel settings (WhatsApp replies) ─────────────

async function ensureChannelConfig(organizationId: string, companyId: string) {
  const existing = await db().briefingChannelConfig.findFirst({ where: { organizationId, companyId } });
  if (existing) return existing;
  return db().briefingChannelConfig.upsert({
    where: { companyId },
    update: {},
    create: { organizationId, companyId, webhookKey: randomToken(24), metaVerifyToken: randomToken(24) },
  });
}

const webhookBase = () => `${env().APP_URL.replace(/\/+$/, "")}/api/v1/webhooks/briefing`;

/** WhatsApp channel status and reply-webhook settings (secrets never returned). */
export async function getChannelSettings(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await authorize(ctx, organizationId, companyId);
  const [canManage, canRead] = await Promise.all([can(ctx, "integrations.manage", chain), can(ctx, "integrations.read", chain)]);
  const channel = await whatsappChannel(organizationId, companyId);
  const cfg = canRead || canManage ? await ensureChannelConfig(organizationId, companyId) : await db().briefingChannelConfig.findFirst({ where: { organizationId, companyId } });
  return {
    connected: channel ? { provider: channel.provider, businessNumber: E164.test(channel.sender) ? channel.sender : null } : null,
    canManage,
    webhooks:
      cfg && (canRead || canManage)
        ? { twilio: `${webhookBase()}/twilio/${cfg.webhookKey}`, meta: `${webhookBase()}/whatsapp/${cfg.webhookKey}`, metaVerifyToken: canManage ? cfg.metaVerifyToken : null }
        : null,
    metaAppSecretSet: !!cfg?.metaAppSecretEnc,
    metaTemplateName: cfg?.metaTemplateName ?? null,
    metaTemplateLanguage: cfg?.metaTemplateLanguage ?? null,
    twilioContentSid: cfg?.twilioContentSid ?? null,
  };
}
export type ChannelSettings = Awaited<ReturnType<typeof getChannelSettings>>;

export const metaSecretPurpose = (companyId: string) => `briefing.meta_app_secret:${companyId}`;

export async function saveChannelSettings(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof channelConfigInput>) {
  const input = channelConfigInput.parse(raw);
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, "integrations.manage", chain);
  const cfg = await ensureChannelConfig(organizationId, companyId);
  await transaction(async (tx) => {
    await tx.briefingChannelConfig.update({
      where: { id: cfg.id },
      data: {
        ...(input.metaAppSecret ? { metaAppSecretEnc: encryptSecret(input.metaAppSecret, metaSecretPurpose(companyId)) } : {}),
        ...(input.metaTemplateName !== undefined ? { metaTemplateName: input.metaTemplateName || null } : {}),
        ...(input.metaTemplateLanguage !== undefined ? { metaTemplateLanguage: input.metaTemplateLanguage || null } : {}),
        ...(input.twilioContentSid !== undefined ? { twilioContentSid: input.twilioContentSid || null } : {}),
        updatedById: ctx.actor.id,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "briefing.channel_settings_updated", resourceType: "briefing_channel_config", resourceId: cfg.id, newValue: { companyId, metaAppSecretChanged: !!input.metaAppSecret, metaTemplateName: input.metaTemplateName, twilioContentSid: input.twilioContentSid } });
  });
  return getChannelSettings(ctx, organizationId, companyId);
}

// ───────────── Reports ─────────────

export async function listReports(ctx: RequestContext, organizationId: string, companyId: string, raw: { limit?: number | string; cursor?: string; kind?: string } = {}) {
  const userId = requireUser(ctx);
  await authorize(ctx, organizationId, companyId);
  const page = pageInput.parse({ limit: Number(raw.limit) || 20, cursor: raw.cursor });
  const kind = z.enum(["MORNING", "EVENING", "WEEKLY", "TEST"]).optional().catch(undefined).parse(raw.kind);
  const rows = await db().briefingReport.findMany({
    where: { organizationId, companyId, userId, ...(kind ? { kind } : {}) },
    orderBy: { id: "desc" },
    select: { id: true, kind: true, localDate: true, status: true, summaryStatus: true, channels: true, createdAt: true, deliveredAt: true },
    ...prismaPage(page),
  });
  return toPage(rows, page);
}

export async function getReport(ctx: RequestContext, organizationId: string, companyId: string, reportId: string) {
  const userId = requireUser(ctx);
  await authorize(ctx, organizationId, companyId);
  if (!isUuid(reportId)) throw notFound("Briefing");
  const r = await db().briefingReport.findFirst({ where: { id: reportId, organizationId, companyId, userId }, include: { deliveries: { orderBy: { createdAt: "asc" } } } });
  if (!r) throw notFound("Briefing");
  return { ...r, data: r.data as unknown as BriefingData };
}

export async function latestReport(ctx: RequestContext, organizationId: string, companyId: string) {
  const userId = requireUser(ctx);
  await authorize(ctx, organizationId, companyId);
  const r = await db().briefingReport.findFirst({ where: { organizationId, companyId, userId }, orderBy: { id: "desc" }, include: { deliveries: true } });
  return r ? { ...r, data: r.data as unknown as BriefingData } : null;
}

/**
 * Build a report for one subscription and either hand the summary to AI (delivery waits for it, at most
 * SUMMARY_WAIT_MS) or deliver right away. Idempotent per dedupe key.
 */
export async function buildReport(
  sub: { organizationId: string; companyId: string; userId: string; timezone: string; locale: string; aiSummary: boolean },
  kind: BriefingKind,
  dedupeKey: string,
  opts: { now?: Date; channels?: BriefingChannel[] } = {},
): Promise<string | null> {
  const now = opts.now ?? new Date();
  const { organizationId, companyId, userId } = sub;
  const existing = await db().briefingReport.findUnique({ where: { dedupeKey }, select: { id: true } });
  if (existing) return existing.id;
  const ctx = userContext(userId);
  const period = periodFor(kind, now, sub.timezone);
  const data = await composeBriefing(ctx, organizationId, companyId, { kind, from: period.from, to: period.to, days: period.days, timezone: sub.timezone, now });
  let report: { id: string };
  try {
    report = await db().briefingReport.create({
      data: { organizationId, companyId, userId, kind, dedupeKey, localDate: period.localDate, timezone: sub.timezone, periodStart: period.from, periodEnd: period.to, data: data as unknown as object, status: "SUMMARIZING" },
      select: { id: true },
    });
  } catch (err) {
    const again = await db().briefingReport.findUnique({ where: { dedupeKey }, select: { id: true } });
    if (again) return again.id;
    throw err;
  }

  let waiting = false;
  if (sub.aiSummary && aiConfigured()) {
    try {
      const company = await db().company.findFirst({ where: { id: companyId, organizationId }, select: { name: true } });
      const profile = profileByKey(SUMMARY_PROFILE) ? SUMMARY_PROFILE : "bi_analyst";
      const task = await createTask(ctx, organizationId, companyId, {
        profile,
        title: `Briefing summary — ${period.localDate}`,
        instructions: summaryInstructions(data, sub.locale, company?.name ?? "").slice(0, 8000),
        subject: { type: SUMMARY_SUBJECT, id: report.id },
      });
      await db().briefingReport.update({ where: { id: report.id }, data: { summaryTaskId: task.id, summaryStatus: "pending", deliverAfter: new Date(Date.now() + SUMMARY_WAIT_MS) } });
      waiting = true;
    } catch (err) {
      logger.info({ reportId: report.id, reason: isAppError(err) ? err.details?.reason ?? err.code : "error" }, "briefing summary not started");
      await db().briefingReport.update({ where: { id: report.id }, data: { summaryStatus: "failed" } });
    }
  }
  if (!waiting) await deliverReport(report.id, { channels: opts.channels });
  else if (opts.channels) await db().briefingReport.update({ where: { id: report.id }, data: { channels: opts.channels } });
  return report.id;
}

/** "Send me a test briefing": a report of yesterday, delivered now on the chosen (or enabled) channels. */
export async function sendTestBriefing(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof testInput>) {
  const userId = requireUser(ctx);
  const input = testInput.parse(raw);
  await authorize(ctx, organizationId, companyId);
  if (await isOrganizationSuspended(organizationId)) throw new AppError("forbidden", "This organization is suspended");
  const recent = await db().briefingReport.count({ where: { organizationId, companyId, userId, kind: "TEST", createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
  if (recent >= TEST_LIMIT_PER_DAY) throw new AppError("rate_limited", "You sent ten test briefings today; try again tomorrow", { reason: "briefing_test_limit" });
  const sub = await getSubscription(ctx, organizationId, companyId);
  const reportId = await buildReport(
    { organizationId, companyId, userId, timezone: sub.timezone, locale: sub.locale, aiSummary: false },
    "TEST",
    `test:${companyId}:${userId}:${Date.now()}:${randomToken(6)}`,
    { channels: input.channels ?? (["IN_APP", ...(sub.emailEnabled ? ["EMAIL"] : []), ...(sub.whatsappEnabled ? ["WHATSAPP"] : [])] as BriefingChannel[]) },
  );
  await transaction((tx) => writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "briefing.test_sent", resourceType: "briefing_report", resourceId: reportId, newValue: { companyId } }));
  return getReport(ctx, organizationId, companyId, reportId!);
}

/** Deliver a report whose AI summary arrived (or failed / timed out). */
export async function finishSummary(reportId: string, outcome: { output: string | null; status: "ready" | "failed" | "timeout" }) {
  const r = await db().briefingReport.findUnique({ where: { id: reportId }, select: { id: true, data: true, deliveredAt: true, organizationId: true, companyId: true, userId: true, channels: true } });
  if (!r || r.deliveredAt) return;
  let summary: string | null = null;
  let status: string = outcome.status;
  if (outcome.status === "ready") {
    const [sub, company] = await Promise.all([
      db().briefingSubscription.findFirst({ where: { organizationId: r.organizationId, companyId: r.companyId, userId: r.userId }, select: { locale: true } }),
      db().company.findFirst({ where: { id: r.companyId, organizationId: r.organizationId }, select: { name: true } }),
    ]);
    summary = acceptSummary(outcome.output, factsFor(r.data as unknown as BriefingData, sub?.locale ?? "en-US", company?.name ?? ""));
    if (!summary) status = "rejected";
  }
  await db().briefingReport.update({ where: { id: r.id }, data: { summary, summaryStatus: status } });
  await deliverReport(r.id, r.channels.length ? { channels: r.channels } : {});
}

// ───────────── Decision tokens ─────────────

async function tokenRow(token: string) {
  return db().briefingActionToken.findUnique({ where: { tokenHash: sha256(token) } });
}

/** What a decision link points at, for the signed-in recipient only. */
export async function peekDecisionToken(ctx: RequestContext, token: string) {
  const userId = requireUser(ctx);
  if (!decideByTokenInput.shape.token.safeParse(token).success) return { state: "invalid" as const };
  const row = await tokenRow(token);
  if (!row) return { state: "invalid" as const };
  if (row.userId !== userId) return { state: "wrong_user" as const };
  const approval = await db().approval.findFirst({ where: { id: row.approvalId, organizationId: row.organizationId, companyId: row.companyId }, select: { id: true, summary: true, risk: true, autonomy: true, status: true, expiresAt: true, requestedByProfile: true, tool: true } });
  if (!approval) return { state: "invalid" as const };
  const base = { organizationId: row.organizationId, companyId: row.companyId, approval, ref: row.ref, reportId: row.reportId };
  if (row.usedAt) return { state: "used" as const, ...base, decision: row.decision };
  if (row.expiresAt < new Date()) return { state: "expired" as const, ...base };
  if (approval.status !== "PENDING") return { state: "decided" as const, ...base };
  return { state: "ready" as const, ...base };
}

/**
 * Decide an approval through a briefing link: the session's user must be the token's recipient, the token unused and
 * unexpired. The token is claimed atomically, then the regular approval flow runs as that user (permissions, MFA for
 * risky actions, single execution). If the decision cannot happen (e.g. MFA needed), the token is released.
 */
export async function decideByToken(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof decideByTokenInput>, via: "link" | "app" = "link") {
  const userId = requireUser(ctx);
  const input = decideByTokenInput.parse(raw);
  const row = await tokenRow(input.token);
  if (!row || row.organizationId !== organizationId || row.companyId !== companyId) throw notFound("Decision link");
  if (row.userId !== userId) throw new AppError("forbidden", "This link was sent to someone else", { reason: "briefing_token_wrong_user" });
  return decideTokenRow(ctx, row, input.decision, input.note, via);
}

export async function decideTokenRow(
  ctx: RequestContext,
  row: { id: string; organizationId: string; companyId: string; approvalId: string },
  decision: "approve" | "reject",
  note: string | undefined,
  via: "link" | "app" | "whatsapp",
) {
  const claimed = await db().briefingActionToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date(), usedVia: via, decision } });
  if (!claimed.count) throw conflict("This link was already used or has expired", { reason: "briefing_token_used" });
  try {
    const result = await decideApproval(ctx, row.organizationId, row.companyId, row.approvalId, { decision, note: note ?? (via === "whatsapp" ? "Decided by WhatsApp reply to the daily briefing" : "Decided from the daily briefing") });
    // Other tokens for the same approval (older briefings) can no longer be used.
    await db().briefingActionToken.updateMany({ where: { approvalId: row.approvalId, usedAt: null }, data: { usedAt: new Date(), usedVia: "superseded" } });
    return result;
  } catch (err) {
    const still = await db().approval.findFirst({ where: { id: row.approvalId, status: "PENDING" }, select: { id: true } });
    if (still) await db().briefingActionToken.updateMany({ where: { id: row.id }, data: { usedAt: null, usedVia: null, decision: null } });
    throw err;
  }
}
