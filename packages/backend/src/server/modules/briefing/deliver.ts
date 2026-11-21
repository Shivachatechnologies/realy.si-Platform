import "server-only";
import type { BriefingChannel, BriefingDeliveryStatus } from "@/generated/prisma/enums";
import { systemContext } from "@/server/core/context";
import { randomToken, sha256 } from "@/server/core/crypto";
import { db, transaction } from "@/server/core/db";
import { env } from "@/server/core/env";
import { logger } from "@/server/core/logger";
import { closestLocale } from "@/i18n/config";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { sendHtmlEmail } from "@/server/modules/email/service";
import { sendWhatsApp } from "@/server/modules/integrations/services/messaging";
import { sendWhatsAppTemplate } from "@/server/modules/integrations/services/whatsapp";
import { notifyUsers } from "@/server/modules/notifications/service";
import { renderHtml, renderText, renderWhatsApp, subjectOf, templateVariables, type RenderInput } from "./render";
import type { BriefingData } from "./types";

/** Decision links stay valid this long (never beyond the approval's own deadline). */
export const TOKEN_TTL_MS = 36 * 3_600_000;
/** WhatsApp lets businesses send free-form messages for 24 hours after the person's last message. */
export const WHATSAPP_WINDOW_MS = 24 * 3_600_000;

const appUrl = () => env().APP_URL.replace(/\/+$/, "");
export const reportLink = (locale: string, id: string) => `${appUrl()}/${closestLocale(locale)}/briefing/${id}`;
export const decideLink = (locale: string, token: string) => `${appUrl()}/${closestLocale(locale)}/briefing/decide/${token}`;
export const settingsLink = (locale: string) => `${appUrl()}/${closestLocale(locale)}/briefing/settings`;

interface ChannelResult {
  channel: BriefingChannel;
  status: BriefingDeliveryStatus;
  provider: string | null;
  providerMessageId: string | null;
  error: string | null;
}

/**
 * Deliver a report once (claimed atomically through deliveredAt): in-app notification always, email and WhatsApp when
 * the recipient enabled them. Decision tokens are minted here (one per still-pending approval, single-use, expiring,
 * bound to the recipient); only their hashes are stored. A channel is SENT only when its provider accepted the message.
 */
export async function deliverReport(reportId: string, opts: { channels?: BriefingChannel[] } = {}): Promise<ChannelResult[] | null> {
  const claimed = await db().briefingReport.updateMany({ where: { id: reportId, deliveredAt: null }, data: { deliveredAt: new Date() } });
  if (!claimed.count) return null;
  const report = await db().briefingReport.findUniqueOrThrow({ where: { id: reportId } });
  const { organizationId, companyId, userId } = report;
  const [sub, user, company, channelCfg, member] = await Promise.all([
    db().briefingSubscription.findFirst({ where: { organizationId, companyId, userId } }),
    db().user.findUnique({ where: { id: userId }, select: { email: true, locale: true, status: true } }),
    db().company.findFirst({ where: { id: companyId, organizationId }, select: { name: true } }),
    db().briefingChannelConfig.findFirst({ where: { organizationId, companyId } }),
    db().membership.findFirst({ where: { organizationId, userId, status: "ACTIVE" }, select: { id: true } }),
  ]);
  const ctx = systemContext();
  if (!user || user.status !== "ACTIVE" || !member) {
    await db().briefingReport.update({ where: { id: reportId }, data: { status: "FAILED" } });
    return [];
  }
  const locale = sub?.locale ?? user.locale;
  const data = report.data as unknown as BriefingData;
  const wanted: BriefingChannel[] = opts.channels ?? ["IN_APP", ...(sub?.emailEnabled ? (["EMAIL"] as const) : []), ...(sub?.whatsappEnabled ? (["WHATSAPP"] as const) : [])];

  // Mint decision tokens for approvals that are still pending.
  const links = new Map<number, string>();
  const items = data.approvals?.items ?? [];
  if (items.length) {
    const live = await db().approval.findMany({ where: { id: { in: items.map((i) => i.id) }, organizationId, companyId, status: "PENDING", expiresAt: { gt: new Date() } }, select: { id: true, expiresAt: true } });
    const byId = new Map(live.map((a) => [a.id, a]));
    const rows = items.flatMap((i) => {
      const a = byId.get(i.id);
      if (!a) return [];
      const raw = randomToken(32);
      links.set(i.ref, decideLink(locale, raw));
      return [{ organizationId, companyId, reportId, userId, approvalId: i.id, ref: i.ref, tokenHash: sha256(raw), expiresAt: new Date(Math.min(a.expiresAt.getTime(), Date.now() + TOKEN_TTL_MS)) }];
    });
    if (rows.length) await db().briefingActionToken.createMany({ data: rows, skipDuplicates: true });
  }

  const input: RenderInput = { data, summary: report.summary, companyName: company?.name ?? "", locale, reportUrl: reportLink(locale, reportId), settingsUrl: settingsLink(locale), links };
  const results: ChannelResult[] = [];

  if (wanted.includes("IN_APP")) {
    await transaction((tx) => notifyUsers(tx, organizationId, [userId], `briefing.${data.kind === "WEEKLY" ? "weekly" : data.kind === "EVENING" ? "evening" : "ready"}`, { companyId, title: company?.name ?? "", href: `/briefing/${reportId}` }));
    results.push({ channel: "IN_APP", status: "SENT", provider: "realy", providerMessageId: null, error: null });
  }

  if (wanted.includes("EMAIL")) {
    try {
      const r = await sendHtmlEmail({ to: user.email, subject: subjectOf(input), text: renderText(input), html: renderHtml(input), template: "briefing", organizationId, userId, locale, companyId });
      results.push({ channel: "EMAIL", status: r.status === "SENT" ? "SENT" : r.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED", provider: null, providerMessageId: r.messageId, error: r.status === "SENT" ? null : r.status === "NOT_CONFIGURED" ? "No email provider is configured" : "The email provider refused the message" });
    } catch (err) {
      results.push({ channel: "EMAIL", status: "FAILED", provider: null, providerMessageId: null, error: err instanceof Error ? err.message.slice(0, 300) : "send failed" });
    }
  }

  if (wanted.includes("WHATSAPP")) {
    if (!sub?.whatsappNumber || !sub.whatsappVerifiedAt) {
      results.push({ channel: "WHATSAPP", status: "NOT_CONFIGURED", provider: null, providerMessageId: null, error: "WhatsApp number not verified" });
    } else {
      const inWindow = !!sub.whatsappLastInboundAt && Date.now() - sub.whatsappLastInboundAt.getTime() < WHATSAPP_WINDOW_MS;
      const hasTemplate = !!(channelCfg?.twilioContentSid || (channelCfg?.metaTemplateName && channelCfg.metaTemplateLanguage));
      if (!inWindow && !hasTemplate) {
        results.push({ channel: "WHATSAPP", status: "NOT_CONFIGURED", provider: null, providerMessageId: null, error: "Outside WhatsApp's 24-hour window and no approved template is configured" });
      } else {
        const r = inWindow
          ? await sendWhatsApp(organizationId, companyId, { to: sub.whatsappNumber, body: renderWhatsApp(input) })
          : await sendWhatsAppTemplate(organizationId, companyId, {
              to: sub.whatsappNumber,
              variables: templateVariables(input),
              metaTemplate: channelCfg?.metaTemplateName && channelCfg.metaTemplateLanguage ? { name: channelCfg.metaTemplateName, language: channelCfg.metaTemplateLanguage } : null,
              twilioContentSid: channelCfg?.twilioContentSid ?? null,
            });
        results.push(
          r.ok
            ? { channel: "WHATSAPP", status: "SENT", provider: r.providerId, providerMessageId: r.data.messageId, error: null }
            : { channel: "WHATSAPP", status: r.code === "not_connected" ? "NOT_CONFIGURED" : "FAILED", provider: r.providerId, providerMessageId: null, error: r.error.slice(0, 300) },
        );
      }
    }
  }

  const external = results.filter((r) => r.channel !== "IN_APP");
  const status = external.every((r) => r.status === "SENT") ? "DELIVERED" : "PARTIAL";
  await transaction(async (tx) => {
    if (results.length) await tx.briefingDelivery.createMany({ data: results.map((r) => ({ organizationId, companyId, reportId, ...r })) });
    await tx.briefingReport.update({ where: { id: reportId }, data: { status, channels: results.filter((r) => r.status === "SENT").map((r) => r.channel) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "briefing.delivered", resourceType: "briefing_report", resourceId: reportId, newValue: { companyId, userId, kind: data.kind, channels: results.map((r) => `${r.channel}:${r.status}`) } });
    const sent = results.filter((r) => r.status === "SENT").map((r) => r.channel);
    await emitDomainEvent(tx, ctx, "briefing.delivered", { organizationId, companyId, entityType: "briefing_report", entityId: reportId, data: { kind: data.kind, status, userId, channels: sent.join(",") } });
  });
  if (external.some((r) => r.status === "FAILED")) logger.warn({ reportId, results: external.map((r) => `${r.channel}:${r.status}`) }, "briefing delivery partly failed");
  return results;
}
