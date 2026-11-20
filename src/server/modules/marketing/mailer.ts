import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type { MarketingSendStatus } from "@/generated/prisma/enums";
import { db } from "@/server/core/db";
import { closestLocale } from "@/i18n/config";
import { createTranslator, type Messages } from "@/i18n/translate";
import { sendPlainEmail } from "@/server/modules/email/service";
import enUS from "@/i18n/messages/en-US.json";
import hiIN from "@/i18n/messages/hi-IN.json";
import arAE from "@/i18n/messages/ar-AE.json";
import deDE from "@/i18n/messages/de-DE.json";
import zhCN from "@/i18n/messages/zh-CN.json";
import { normalizeEmail, renderMergeTags } from "./common";
import { trackLinks, unsubscribeUrl } from "./tracking";

const CATALOGS: Record<string, Messages> = { "en-US": enUS, "hi-IN": hiIN as Messages, "ar-AE": arAE as Messages, "de-DE": deDE as Messages, "zh-CN": zhCN as Messages };

export interface Recipient {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  accountName?: string | null;
  contactId?: string | null;
}

export interface MarketingMessage {
  organizationId: string;
  companyId: string;
  companyName: string;
  locale: string;
  subject: string;
  body: string;
  /** Exactly one of: emailCampaignId, or enrollmentId + stepId. */
  emailCampaignId?: string;
  enrollmentId?: string;
  stepId?: string;
  userId?: string | null;
}

/**
 * Claim, render and send one marketing email through the core email provider, and record the outcome per recipient.
 * The claim (a PENDING row unique per campaign/recipient or enrollment/step) prevents double sends across workers.
 * Returns null when another sender already claimed this recipient.
 */
export async function sendMarketingEmail(msg: MarketingMessage, to: Recipient): Promise<MarketingSendStatus | null> {
  const emailNormalized = normalizeEmail(to.email);
  if (!emailNormalized) return null;
  const id = randomUUID();
  try {
    await db().marketingEmailSend.create({
      data: {
        id,
        organizationId: msg.organizationId,
        companyId: msg.companyId,
        emailCampaignId: msg.emailCampaignId ?? null,
        enrollmentId: msg.enrollmentId ?? null,
        stepId: msg.stepId ?? null,
        contactId: to.contactId ?? null,
        email: to.email,
        emailNormalized,
        status: "PENDING",
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
    throw err;
  }
  const l = closestLocale(msg.locale);
  const t = createTranslator(l, CATALOGS[l]);
  const vars = { firstName: to.firstName ?? "", lastName: to.lastName ?? "", email: to.email, company: to.accountName ?? "", sender: msg.companyName };
  const subject = renderMergeTags(msg.subject, vars).slice(0, 300);
  const link = unsubscribeUrl({ o: msg.organizationId, c: msg.companyId, e: emailNormalized, s: id });
  const text = `${trackLinks(renderMergeTags(msg.body, vars), id)}\n\n—\n${t("marketing.email.footer", { company: msg.companyName })}\n${t("marketing.email.unsubscribeLine")}: ${link}`;
  const result = await sendPlainEmail({
    to: to.email,
    subject,
    text,
    template: msg.emailCampaignId ? "marketing_campaign" : "marketing_sequence",
    organizationId: msg.organizationId,
    userId: msg.userId ?? null,
    locale: l,
  });
  const status: MarketingSendStatus = result.status === "SENT" ? "SENT" : result.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED";
  await db().marketingEmailSend.update({
    where: { id },
    data: { status, providerMessageId: result.messageId, error: status === "SENT" ? null : status === "NOT_CONFIGURED" ? "not_configured" : "delivery_failed" },
  });
  return status;
}
