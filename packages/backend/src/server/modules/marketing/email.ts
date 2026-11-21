import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { MarketingEmailCampaignStatus } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { companyEmailProvider } from "@/server/modules/email/provider";
import { sendPlainEmail } from "@/server/modules/email/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { actorId, authorize, enumParam, instant, isUuid, PAGE_SIZE, pageParam, param, renderMergeTags, requireOwned, toInstant, uuid } from "./common";
import { segmentRecipients } from "./segments";
import { renderMarketingHtml, sendMarketingEmail } from "./mailer";
import { loadBrandKit } from "./brand";
import { EMAIL_PROVIDERS } from "./providers/email";
import { getMarketingConnection, isUsable } from "./connections-bridge";
import { checkLimit, recordUsage } from "@/server/modules/entitlements/service";
import { upsertRecommendation } from "./recommendations";

export const EMAIL_CAMPAIGN_STATUSES = ["DRAFT", "SCHEDULED", "SENDING", "SENT", "FAILED", "CANCELLED"] as const;
export const MERGE_TAGS = ["firstName", "lastName", "email", "company", "sender"] as const;

export const templateInput = z.object({
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(250),
  body: z.string().trim().min(1).max(50_000),
});
export const updateTemplateInput = templateInput.partial();

export const emailCampaignInput = z.object({
  name: z.string().trim().min(1).max(200),
  subject: z.string().trim().max(250).default(""),
  body: z.string().max(50_000).default(""),
  templateId: uuid.or(z.literal("")).nullable().optional(),
  segmentId: uuid.or(z.literal("")).nullable().optional(),
  campaignId: uuid.or(z.literal("")).nullable().optional(),
  provider: z.enum(EMAIL_PROVIDERS).optional(),
});
const abFields = {
  provider: z.enum(EMAIL_PROVIDERS).optional(),
  abEnabled: z.boolean().optional(),
  abTestPercent: z.number().int().min(5).max(50).optional(),
  abMetric: z.enum(["open", "click"]).optional(),
  abWaitHours: z.number().int().min(1).max(72).optional(),
};
export const variantInput = z.object({ label: z.string().trim().min(1).max(20), subject: z.string().trim().min(1).max(250), body: z.string().trim().min(1).max(50_000) });
export const updateEmailCampaignInput = z.object({
  ...abFields,
  name: z.string().trim().min(1).max(200).optional(),
  subject: z.string().trim().max(250).optional(),
  body: z.string().max(50_000).optional(),
  segmentId: uuid.or(z.literal("")).nullable().optional(),
  campaignId: uuid.or(z.literal("")).nullable().optional(),
});
export const emailActionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send_now") }),
  z.object({ action: z.literal("schedule"), scheduledAt: instant }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("retry") }),
  z.object({ action: z.literal("test") }),
]);

export interface EmailCampaignFilters {
  q?: string;
  status?: MarketingEmailCampaignStatus;
  page: number;
}
export function parseEmailFilters(raw: Record<string, string | string[] | undefined>): EmailCampaignFilters {
  return { q: param(raw, "q"), status: enumParam(raw, "status", EMAIL_CAMPAIGN_STATUSES), page: pageParam(raw) };
}

// ── Templates ──

export async function listTemplates(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  return db().marketingEmailTemplate.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { updatedAt: "desc" }, take: 200 });
}

export async function createTemplate(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof templateInput>) {
  const input = templateInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const t = await tx.marketingEmailTemplate.create({ data: { organizationId, companyId, ...input, createdById: actorId(ctx, organizationId) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.template.created", resourceType: "marketing_email_template", resourceId: t.id, newValue: { name: t.name } });
    return t;
  });
}

export async function updateTemplate(ctx: RequestContext, organizationId: string, companyId: string, templateId: string, raw: z.input<typeof updateTemplateInput>) {
  const input = updateTemplateInput.parse(raw);
  if (!isUuid(templateId)) throw notFound("Template");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingEmailTemplate.updateMany({ where: { id: templateId, organizationId, companyId, archivedAt: null }, data: input });
    if (!count) throw notFound("Template");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.template.updated", resourceType: "marketing_email_template", resourceId: templateId, newValue: { name: input.name } });
    return { ok: true };
  });
}

export async function archiveTemplate(ctx: RequestContext, organizationId: string, companyId: string, templateId: string) {
  if (!isUuid(templateId)) throw notFound("Template");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingEmailTemplate.updateMany({ where: { id: templateId, organizationId, companyId, archivedAt: null }, data: { archivedAt: new Date() } });
    if (!count) throw notFound("Template");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.template.archived", resourceType: "marketing_email_template", resourceId: templateId });
    return { ok: true };
  });
}

// ── Campaigns ──

export async function listEmailCampaigns(ctx: RequestContext, organizationId: string, companyId: string, f: EmailCampaignFilters = { page: 1 }) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const where: Prisma.MarketingEmailCampaignWhereInput = { organizationId, companyId };
  if (f.status) where.status = f.status;
  if (f.q) where.OR = [{ name: { contains: f.q, mode: "insensitive" } }, { subject: { contains: f.q, mode: "insensitive" } }];
  const [total, data] = await Promise.all([
    db().marketingEmailCampaign.count({ where }),
    db().marketingEmailCampaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { segment: { select: { id: true, name: true } }, campaign: { select: { id: true, name: true } } },
    }),
  ]);
  return { total, pageSize: PAGE_SIZE, data };
}

export async function getEmailCampaign(ctx: RequestContext, organizationId: string, companyId: string, id: string, sendFilter?: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(id)) throw notFound("Email campaign");
  const c = await db().marketingEmailCampaign.findFirst({
    where: { id, organizationId, companyId },
    include: { segment: true, campaign: { select: { id: true, name: true, code: true } }, template: { select: { id: true, name: true } }, variants: { orderBy: { label: "asc" } } },
  });
  if (!c) throw notFound("Email campaign");
  const variantStats = await variantResults(c.id, c.companyId);
  const statusFilter = (["SENT", "FAILED", "NOT_CONFIGURED", "PENDING"] as const).find((s) => s === sendFilter);
  const [stats, opened, clicked, unsubscribed, sends, audience] = await Promise.all([
    db().marketingEmailSend.groupBy({ by: ["status"], where: { companyId, emailCampaignId: id }, _count: { _all: true } }),
    db().marketingEmailSend.count({ where: { companyId, emailCampaignId: id, openedAt: { not: null } } }),
    db().marketingEmailSend.count({ where: { companyId, emailCampaignId: id, clickedAt: { not: null } } }),
    db().marketingEmailSend.count({ where: { companyId, emailCampaignId: id, unsubscribedAt: { not: null } } }),
    db().marketingEmailSend.findMany({ where: { companyId, emailCampaignId: id, ...(statusFilter ? { status: statusFilter } : {}) }, orderBy: { createdAt: "desc" }, take: 200 }),
    c.segment ? segmentRecipients(db(), c.segment).then((r) => r.length) : Promise.resolve(0),
  ]);
  const by = Object.fromEntries(stats.map((s) => [s.status, s._count._all])) as Partial<Record<string, number>>;
  return {
    campaign: c,
    stats: { sent: by.SENT ?? 0, failed: by.FAILED ?? 0, notConfigured: by.NOT_CONFIGURED ?? 0, pending: by.PENDING ?? 0, opened, clicked, unsubscribed },
    sends,
    audience,
    variantStats,
    providerReady: await providerReady(organizationId, companyId, c.provider),
  };
}

/** Sent / opened / clicked / rates per A/B variant. */
export async function variantResults(emailCampaignId: string, companyId: string) {
  const [sent, opened, clicked] = await Promise.all([
    db().marketingEmailSend.groupBy({ by: ["variantId"], where: { companyId, emailCampaignId, status: "SENT", variantId: { not: null } }, _count: { _all: true } }),
    db().marketingEmailSend.groupBy({ by: ["variantId"], where: { companyId, emailCampaignId, status: "SENT", variantId: { not: null }, openedAt: { not: null } }, _count: { _all: true } }),
    db().marketingEmailSend.groupBy({ by: ["variantId"], where: { companyId, emailCampaignId, status: "SENT", variantId: { not: null }, clickedAt: { not: null } }, _count: { _all: true } }),
  ]);
  const get = (rows: typeof sent, id: string) => rows.find((r) => r.variantId === id)?._count._all ?? 0;
  const ids = [...new Set(sent.map((r) => r.variantId!))];
  return Object.fromEntries(ids.map((id) => {
    const s = get(sent, id);
    return [id, { sent: s, opened: get(opened, id), clicked: get(clicked, id), openRate: s ? get(opened, id) / s : 0, clickRate: s ? get(clicked, id) / s : 0 }];
  })) as Record<string, { sent: number; opened: number; clicked: number; openRate: number; clickRate: number }>;
}

/** Whether marketing email can be delivered for the company (default path, or a campaign's chosen provider). */
export const emailDeliveryReady = (organizationId: string, companyId: string, provider = "platform") => providerReady(organizationId, companyId, provider);

/** Whether the campaign's delivery path can send: Mailchimp connection, the company's SendGrid sender, or any company/platform provider. */
async function providerReady(organizationId: string, companyId: string, provider: string) {
  if (provider === "mailchimp") return isUsable(await getMarketingConnection(organizationId, companyId, provider));
  const p = await companyEmailProvider(organizationId, companyId);
  return provider === "sendgrid" ? p?.scope === "company" : p !== null;
}

async function editableCampaign(tx: Prisma.TransactionClient, organizationId: string, companyId: string, id: string) {
  const c = await tx.marketingEmailCampaign.findFirst({ where: { id, organizationId, companyId } });
  if (!c) throw notFound("Email campaign");
  if (!["DRAFT", "SCHEDULED", "FAILED"].includes(c.status)) throw conflict("Only drafts and scheduled emails can be edited", { reason: "marketing_email_locked" });
  return c;
}

export async function addVariant(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof variantInput>) {
  const input = variantInput.parse(raw);
  if (!isUuid(id)) throw notFound("Email campaign");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    await editableCampaign(tx, organizationId, companyId, id);
    if ((await tx.marketingEmailVariant.count({ where: { emailCampaignId: id } })) >= 4) throw conflict("At most 4 variants", { reason: "marketing_email_variants_max" });
    if (await tx.marketingEmailVariant.findFirst({ where: { emailCampaignId: id, label: input.label } })) throw conflict("Label already used", { reason: "marketing_name_taken" });
    const v = await tx.marketingEmailVariant.create({ data: { organizationId, companyId, emailCampaignId: id, ...input } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.email_variant.created", resourceType: "marketing_email_campaign", resourceId: id, newValue: { label: v.label } });
    return v;
  });
}

export async function deleteVariant(ctx: RequestContext, organizationId: string, companyId: string, id: string, variantId: string) {
  if (!isUuid(id) || !isUuid(variantId)) throw notFound("Variant");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    await editableCampaign(tx, organizationId, companyId, id);
    const { count } = await tx.marketingEmailVariant.deleteMany({ where: { id: variantId, emailCampaignId: id, companyId } });
    if (!count) throw notFound("Variant");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.email_variant.deleted", resourceType: "marketing_email_campaign", resourceId: id });
    return { ok: true };
  });
}

export async function createEmailCampaign(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof emailCampaignInput>) {
  const input = emailCampaignInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const templateId = await requireOwned(tx, "marketingEmailTemplate", companyId, input.templateId || null, "Template");
    const template = templateId ? await tx.marketingEmailTemplate.findUnique({ where: { id: templateId } }) : null;
    const c = await tx.marketingEmailCampaign.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        subject: input.subject || template?.subject || "",
        body: input.body || template?.body || "",
        templateId,
        segmentId: await requireOwned(tx, "marketingSegment", companyId, input.segmentId || null, "Segment"),
        campaignId: await requireOwned(tx, "marketingCampaign", companyId, input.campaignId || null, "Campaign"),
        provider: input.provider ?? "platform",
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.email_campaign.created", resourceType: "marketing_email_campaign", resourceId: c.id, newValue: { name: c.name } });
    return c;
  });
}

export async function updateEmailCampaign(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateEmailCampaignInput>) {
  const input = updateEmailCampaignInput.parse(raw);
  if (!isUuid(id)) throw notFound("Email campaign");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const c = await tx.marketingEmailCampaign.findFirst({ where: { id, organizationId, companyId } });
    if (!c) throw notFound("Email campaign");
    if (!["DRAFT", "SCHEDULED", "FAILED"].includes(c.status)) throw conflict("Only drafts and scheduled emails can be edited", { reason: "marketing_email_locked" });
    const data: Prisma.MarketingEmailCampaignUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.subject !== undefined) data.subject = input.subject;
    if (input.body !== undefined) data.body = input.body;
    if (input.segmentId !== undefined) data.segmentId = await requireOwned(tx, "marketingSegment", companyId, input.segmentId || null, "Segment");
    if (input.campaignId !== undefined) data.campaignId = await requireOwned(tx, "marketingCampaign", companyId, input.campaignId || null, "Campaign");
    for (const k of ["provider", "abEnabled", "abTestPercent", "abMetric", "abWaitHours"] as const) if (input[k] !== undefined) (data as Record<string, unknown>)[k] = input[k];
    const updated = await tx.marketingEmailCampaign.update({ where: { id }, data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.email_campaign.updated", resourceType: "marketing_email_campaign", resourceId: id, newValue: { name: input.name, subject: input.subject } });
    return updated;
  });
}

export async function deleteEmailCampaign(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Email campaign");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const c = await tx.marketingEmailCampaign.findFirst({ where: { id, organizationId, companyId }, select: { status: true, name: true } });
    if (!c) throw notFound("Email campaign");
    if (c.status !== "DRAFT" && c.status !== "CANCELLED") throw conflict("Only drafts and cancelled emails can be deleted", { reason: "marketing_email_locked" });
    await tx.marketingEmailCampaign.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.email_campaign.deleted", resourceType: "marketing_email_campaign", resourceId: id, oldValue: { name: c.name } });
    return { ok: true };
  });
}

function requireReady(c: { subject: string; body: string; segmentId: string | null }) {
  if (!c.subject.trim() || !c.body.trim()) throw invalid("Subject and body are required", { reason: "marketing_email_incomplete" });
  if (!c.segmentId) throw invalid("Choose an audience segment", { reason: "marketing_email_no_segment" });
}

async function requireEmailProvider(organizationId: string, companyId: string) {
  if (!(await companyEmailProvider(organizationId, companyId))) throw new AppError("not_configured", "Email provider not configured", { reason: "marketing_email_not_configured" });
}

export async function emailCampaignAction(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof emailActionInput>) {
  const input = emailActionInput.parse(raw);
  if (!isUuid(id)) throw notFound("Email campaign");
  if (input.action === "test") return sendTest(ctx, organizationId, companyId, id);
  if (input.action === "send_now" || input.action === "retry") {
    const c = await db().marketingEmailCampaign.findFirst({ where: { id, organizationId, companyId }, select: { provider: true, abEnabled: true } });
    if (c && !(await providerReady(organizationId, companyId, c.provider))) throw new AppError("not_configured", "Email provider not configured", { reason: "marketing_email_not_configured" });
    if (c?.abEnabled && (await db().marketingEmailVariant.count({ where: { emailCampaignId: id } })) < 2) throw invalid("Add at least two variants for an A/B test", { reason: "marketing_email_ab_variants" });
  }
  const result = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const c = await tx.marketingEmailCampaign.findFirst({ where: { id, organizationId, companyId } });
    if (!c) throw notFound("Email campaign");
    let data: Prisma.MarketingEmailCampaignUncheckedUpdateInput;
    if (input.action === "send_now") {
      if (!["DRAFT", "SCHEDULED"].includes(c.status)) throw conflict("This email was already sent", { reason: "marketing_email_locked" });
      requireReady(c);
      data = { status: "SENDING", scheduledAt: new Date(), startedAt: new Date() };
    } else if (input.action === "schedule") {
      if (!["DRAFT", "SCHEDULED"].includes(c.status)) throw conflict("This email was already sent", { reason: "marketing_email_locked" });
      requireReady(c);
      const at = toInstant(input.scheduledAt);
      if (!at || at.getTime() < Date.now() - 60_000) throw invalid("Schedule time must be in the future", { reason: "marketing_schedule_past" });
      data = { status: "SCHEDULED", scheduledAt: at };
    } else if (input.action === "cancel") {
      if (!["SCHEDULED", "SENDING"].includes(c.status)) throw conflict("Only scheduled or sending emails can be cancelled", { reason: "marketing_email_locked" });
      data = { status: c.status === "SCHEDULED" ? "DRAFT" : "CANCELLED", ...(c.status === "SCHEDULED" ? { scheduledAt: null } : { finishedAt: new Date() }) };
    } else {
      if (c.status !== "FAILED" && c.status !== "CANCELLED") throw conflict("Only failed or cancelled emails can be retried", { reason: "marketing_email_locked" });
      // Recipients whose delivery was not accepted get another attempt; accepted ones are never re-sent.
      await tx.marketingEmailSend.deleteMany({ where: { companyId, emailCampaignId: id, status: { in: ["FAILED", "NOT_CONFIGURED"] } } });
      data = { status: "SENDING", startedAt: new Date(), finishedAt: null };
    }
    const updated = await tx.marketingEmailCampaign.update({ where: { id }, data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `marketing.email_campaign.${input.action}`, resourceType: "marketing_email_campaign", resourceId: id, oldValue: { status: c.status }, newValue: { status: updated.status, scheduledAt: updated.scheduledAt } });
    return updated;
  });
  // First batch right away so the sender sees progress; the worker continues with the rest.
  if (result.status === "SENDING") await processEmailCampaign(id, 25);
  return db().marketingEmailCampaign.findUniqueOrThrow({ where: { id } });
}

/** Send the rendered email to the acting user only (not logged as a campaign send). */
async function sendTest(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  await requireEmailProvider(organizationId, companyId);
  const c = await db().marketingEmailCampaign.findFirst({ where: { id, organizationId, companyId }, include: { company: { select: { name: true } } } });
  if (!c) throw notFound("Email campaign");
  if (!c.subject.trim() || !c.body.trim()) throw invalid("Subject and body are required", { reason: "marketing_email_incomplete" });
  const user = ctx.actor.id ? await db().user.findUnique({ where: { id: ctx.actor.id }, select: { email: true, name: true, locale: true } }) : null;
  if (!user) throw new AppError("unauthenticated", "Sign in required");
  const vars = { firstName: user.name.split(" ")[0] ?? "", lastName: "", email: user.email, company: "", sender: c.company.name };
  const body = renderMergeTags(c.body, vars);
  const locale = user.locale ?? "en-US";
  // Same HTML layout as real sends, without tracking pixel / click redirects / unsubscribe token.
  const html = renderMarketingHtml({ body, sendId: null, locale, footer: c.company.name, unsubLabel: "", unsubscribeLink: "#", brand: await loadBrandKit(db(), companyId) });
  const r = await sendPlainEmail({ to: user.email, subject: `[TEST] ${renderMergeTags(c.subject, vars)}`, text: body, html, template: "marketing_test", organizationId, companyId, userId: ctx.actor.id, locale });
  return { status: r.status };
}

/**
 * Deliver up to `limit` pending recipients of a SENDING campaign (or a due SCHEDULED one). Finishes the campaign when no
 * recipients remain. Stops (FAILED) at the first NOT_CONFIGURED result so the audience is not burned without a provider.
 */
export async function processEmailCampaign(id: string, limit = 100): Promise<number> {
  const now = new Date();
  await db().marketingEmailCampaign.updateMany({ where: { id, status: "SCHEDULED", scheduledAt: { lte: now } }, data: { status: "SENDING", startedAt: now } });
  const c = await db().marketingEmailCampaign.findFirst({ where: { id, status: "SENDING" }, include: { segment: true, company: { select: { name: true, defaultLocale: true } } } });
  if (!c) return 0;
  if (!c.segment || c.segment.archivedAt) return finish(c.id, "FAILED");
  const already = new Set(
    (await db().marketingEmailSend.findMany({ where: { companyId: c.companyId, emailCampaignId: c.id }, select: { emailNormalized: true } })).map((s) => s.emailNormalized),
  );
  const all = await segmentRecipients(db(), c.segment);
  let pending = all.filter((r) => !already.has(r.email!.trim().toLowerCase())).slice(0, limit);
  // A/B test: a test share gets the variants round-robin; after the wait the winner goes to everyone else.
  const variants = c.abEnabled ? await db().marketingEmailVariant.findMany({ where: { emailCampaignId: c.id }, orderBy: { label: "asc" } }) : [];
  let content: (i: number) => { subject: string; body: string; variantId: string | null } = () => ({ subject: c.subject, body: c.body, variantId: null });
  if (variants.length >= 2) {
    const testSize = Math.max(variants.length, Math.ceil((all.length * c.abTestPercent) / 100));
    if (!c.abPhase || c.abPhase === "testing") {
      const testRemaining = testSize - already.size;
      if (testRemaining > 0) {
        if (!c.abPhase) await db().marketingEmailCampaign.update({ where: { id: c.id }, data: { abPhase: "testing" } });
        pending = pending.slice(0, testRemaining);
        content = (i) => {
          const v = variants[(already.size + i) % variants.length]!;
          return { subject: v.subject, body: v.body, variantId: v.id };
        };
      } else {
        await db().marketingEmailCampaign.update({ where: { id: c.id }, data: { abPhase: "waiting", abTestEndsAt: new Date(Date.now() + c.abWaitHours * 3_600_000) } });
        return 0;
      }
    } else if (c.abPhase === "waiting") {
      if (c.abTestEndsAt && c.abTestEndsAt > new Date()) return 0;
      const results = await variantResults(c.id, c.companyId);
      const metric = c.abMetric === "click" ? "clickRate" : "openRate";
      const winner = [...variants].sort((a, b) => (results[b.id]?.[metric] ?? 0) - (results[a.id]?.[metric] ?? 0))[0]!;
      await db().marketingEmailCampaign.update({ where: { id: c.id }, data: { abPhase: "decided", abWinnerVariantId: winner.id, subject: winner.subject, body: winner.body } });
      await transaction((tx) => writeAudit(tx, systemContext(), { category: "TENANT", organizationId: c.organizationId, action: "marketing.email_campaign.ab_winner", resourceType: "marketing_email_campaign", resourceId: c.id, newValue: { winner: winner.label, metric: c.abMetric, results } }));
      return 0;
    } else {
      const winner = variants.find((v) => v.id === c.abWinnerVariantId) ?? variants[0]!;
      content = () => ({ subject: winner.subject, body: winner.body, variantId: winner.id });
    }
  }
  if (!pending.length) return finish(c.id);
  // Plan email sends (background, no user ctx): send only what still fits; nothing fits → wait, with a daily notice.
  const allowance = await checkLimit(c.organizationId, "email.sends.month", pending.length);
  if (!allowance.allowed) {
    const room = allowance.state === "trial_expired" || allowance.limit === null ? 0 : Math.max(0, allowance.limit - allowance.used);
    if (room === 0) {
      await upsertRecommendation(c.organizationId, c.companyId, {
        dedupeKey: `plan:email.sends:${new Date().toISOString().slice(0, 10)}`,
        title: `Email campaign "${c.name}" paused: plan limit reached for email sends`,
        detail: `Used ${allowance.used} of ${allowance.limit ?? "unlimited"} email sends this month. Sending resumes when the allowance resets or the plan is upgraded.`,
        priority: "high",
        href: "/settings/billing",
      }).catch(() => false);
      return 0;
    }
    pending = pending.slice(0, room);
  }
  let processed = 0;
  for (const [i, r] of pending.entries()) {
    const v = content(i);
    // Stop if the campaign was cancelled meanwhile.
    if (processed % 20 === 0 && processed > 0 && !(await db().marketingEmailCampaign.findFirst({ where: { id, status: "SENDING" }, select: { id: true } }))) break;
    const status = await sendMarketingEmail(
      { organizationId: c.organizationId, companyId: c.companyId, companyName: c.company.name, locale: c.company.defaultLocale, subject: v.subject, body: v.body, emailCampaignId: c.id, userId: c.createdById, variantId: v.variantId, provider: c.provider },
      { email: r.email!, firstName: r.firstName, lastName: r.lastName, accountName: r.account?.name, contactId: r.id },
    );
    if (status) processed++;
    if (status === "SENT") await recordUsage(c.organizationId, "email.sends", 1, { companyId: c.companyId, idempotencyKey: `${c.id}:${r.email!.trim().toLowerCase()}` });
    if (status === "NOT_CONFIGURED") {
      await finish(c.id, "FAILED");
      break;
    }
  }
  return processed;
}

async function finish(id: string, forced?: "FAILED"): Promise<number> {
  const c = await db().marketingEmailCampaign.findUnique({ where: { id } });
  if (!c || c.status !== "SENDING") return 0;
  const stats = await db().marketingEmailSend.groupBy({ by: ["status"], where: { companyId: c.companyId, emailCampaignId: id }, _count: { _all: true } });
  const n = (s: string) => stats.find((x) => x.status === s)?._count._all ?? 0;
  const status = forced ?? (n("SENT") > 0 || (n("FAILED") === 0 && n("NOT_CONFIGURED") === 0) ? "SENT" : "FAILED");
  const { count } = await db().marketingEmailCampaign.updateMany({
    where: { id, status: "SENDING" },
    data: { status, finishedAt: new Date(), sentCount: n("SENT"), failedCount: n("FAILED"), notConfiguredCount: n("NOT_CONFIGURED") },
  });
  if (count) {
    await transaction(async (tx) => {
      await writeAudit(tx, systemContext(), { category: "TENANT", organizationId: c.organizationId, action: "marketing.email_campaign.finished", resourceType: "marketing_email_campaign", resourceId: id, newValue: { status, sent: n("SENT"), failed: n("FAILED"), notConfigured: n("NOT_CONFIGURED") } });
      await notifyUsers(tx, c.organizationId, [c.createdById], status === "SENT" ? "marketing.email_sent" : "marketing.email_failed", { companyId: c.companyId, title: c.name, href: `/marketing/email/${id}` });
    });
  }
  return 0;
}

/** Worker: due scheduled + in-progress campaigns. */
export async function processDueEmailCampaigns(): Promise<number> {
  const due = await db().marketingEmailCampaign.findMany({
    where: { OR: [{ status: "SENDING" }, { status: "SCHEDULED", scheduledAt: { lte: new Date() } }] },
    select: { id: true },
    orderBy: { scheduledAt: "asc" },
    take: 10,
  });
  let n = 0;
  for (const c of due) n += await processEmailCampaign(c.id, 200);
  return n;
}
