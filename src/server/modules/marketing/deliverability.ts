import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { authorize, isUuid, normalizeEmail, PAGE_SIZE } from "./common";
import { getMarketingConnection } from "./connections-bridge";
import { parseMandrillEvents, parseSendgridEvents, verifyMandrill, verifySendgrid, type DeliveryEvent } from "./providers/email";

export const suppressionInput = z.object({ email: z.string().trim().email().max(320), reason: z.string().trim().max(100).default("manual") });

export async function listSuppressions(ctx: RequestContext, organizationId: string, companyId: string, q?: string, page = 1) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const where = { organizationId, companyId, ...(q ? { emailNormalized: { contains: q.toLowerCase() } } : {}) };
  const [total, data] = await Promise.all([
    db().marketingSuppression.count({ where }),
    db().marketingSuppression.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  return { total, pageSize: PAGE_SIZE, data };
}

export async function addSuppression(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof suppressionInput>) {
  const input = suppressionInput.parse(raw);
  const email = normalizeEmail(input.email)!;
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const s = await tx.marketingSuppression.upsert({ where: { companyId_emailNormalized: { companyId, emailNormalized: email } }, create: { organizationId, companyId, emailNormalized: email, reason: input.reason }, update: { reason: input.reason } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.suppression.added", resourceType: "marketing_suppression", resourceId: s.id, newValue: { reason: input.reason } });
    return s;
  });
}

export async function removeSuppression(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Suppression");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingSuppression.deleteMany({ where: { id, organizationId, companyId } });
    if (!count) throw notFound("Suppression");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.suppression.removed", resourceType: "marketing_suppression", resourceId: id });
    return { ok: true };
  });
}

async function applyEvent(organizationId: string, companyId: string, e: DeliveryEvent) {
  const send = e.sendId && isUuid(e.sendId)
    ? await db().marketingEmailSend.findFirst({ where: { id: e.sendId, companyId } })
    : e.messageId
      ? await db().marketingEmailSend.findFirst({ where: { companyId, providerMessageId: e.messageId } })
      : null;
  const email = normalizeEmail(e.email ?? send?.email);
  if (e.type === "bounce" || e.type === "complaint" || e.type === "unsubscribe") {
    if (send) await db().marketingEmailSend.update({ where: { id: send.id }, data: e.type === "bounce" ? { bouncedAt: new Date() } : e.type === "complaint" ? { complainedAt: new Date() } : { unsubscribedAt: new Date() } });
    if (email) {
      await db().marketingSuppression.upsert({
        where: { companyId_emailNormalized: { companyId, emailNormalized: email } },
        create: { organizationId, companyId, emailNormalized: email, reason: e.type },
        update: {},
      });
    }
  } else if (send && e.type === "open" && !send.openedAt) {
    await db().marketingEmailSend.update({ where: { id: send.id }, data: { openedAt: new Date(), openCount: { increment: 1 } } });
  } else if (send && e.type === "click" && !send.clickedAt) {
    await db().marketingEmailSend.update({ where: { id: send.id }, data: { clickedAt: new Date(), clickCount: { increment: 1 } } });
  }
}

/**
 * Provider event webhooks (bounces, complaints, unsubscribes, opens, clicks). Signatures are verified with the secret
 * stored on the company's connection (sendgrid: config.webhookPublicKey; mailchimp: config.webhookKey).
 */
export async function handleEmailWebhook(provider: string, companyId: string, req: { url: string; rawBody: string; headers: Headers }): Promise<{ ok: boolean; processed: number }> {
  if (!isUuid(companyId) || (provider !== "sendgrid" && provider !== "mailchimp")) return { ok: false, processed: 0 };
  const company = await db().company.findUnique({ where: { id: companyId }, select: { organizationId: true } });
  if (!company) return { ok: false, processed: 0 };
  const conn = await getMarketingConnection(company.organizationId, companyId, provider);
  if (!conn) return { ok: false, processed: 0 };
  let events: DeliveryEvent[] = [];
  if (provider === "sendgrid") {
    if (!verifySendgrid(conn, req.rawBody, req.headers.get("x-twilio-email-event-webhook-signature"), req.headers.get("x-twilio-email-event-webhook-timestamp"))) return { ok: false, processed: 0 };
    events = parseSendgridEvents(req.rawBody);
  } else {
    const params = Object.fromEntries(new URLSearchParams(req.rawBody));
    if (!verifyMandrill(conn, req.url, params, req.headers.get("x-mandrill-signature"))) return { ok: false, processed: 0 };
    events = parseMandrillEvents(params.mandrill_events ?? "[]");
  }
  let n = 0;
  for (const e of events) {
    try {
      await applyEvent(company.organizationId, companyId, e);
      n++;
    } catch (err) {
      logger.warn({ provider, companyId, err: String(err) }, "email webhook event failed");
    }
  }
  return { ok: true, processed: n };
}
