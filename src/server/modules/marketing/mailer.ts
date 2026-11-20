import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type { MarketingSendStatus } from "@/generated/prisma/enums";
import { db } from "@/server/core/db";
import { closestLocale } from "@/i18n/config";
import { createTranslator, type Messages } from "@/i18n/translate";
import { escapeHtml, sendHtmlEmail } from "@/server/modules/email/service";
import enUS from "@/i18n/messages/en-US.json";
import hiIN from "@/i18n/messages/hi-IN.json";
import arAE from "@/i18n/messages/ar-AE.json";
import deDE from "@/i18n/messages/de-DE.json";
import zhCN from "@/i18n/messages/zh-CN.json";
import { normalizeEmail, renderMergeTags } from "./common";
import { clickUrl, openPixelUrl, trackLinks, unsubscribeUrl } from "./tracking";
import { loadBrandKit, type BrandKit } from "./brand";
import { getMarketingConnection, isUsable } from "./connections-bridge";
import { sendViaProvider } from "./providers/email";
import { ProviderError } from "./providers/http";

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
  /** A/B variant the recipient got. */
  variantId?: string | null;
  /** Delivery provider: the platform email provider (default) or the company's sendgrid / mailchimp connection. */
  provider?: string | null;
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
        variantId: msg.variantId ?? null,
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
  const body = renderMergeTags(msg.body, vars);
  const footer = t("marketing.email.footer", { company: msg.companyName });
  const unsubLabel = t("marketing.email.unsubscribeLine");
  const text = `${trackLinks(body, id)}\n\n—\n${footer}\n${unsubLabel}: ${link}`;
  const brand = await loadBrandKit(db(), msg.companyId);
  const html = renderMarketingHtml({ body, sendId: id, locale: l, footer, unsubLabel, unsubscribeLink: link, brand });
  const headers = { "List-Unsubscribe": `<${link}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  if (msg.provider === "sendgrid" || msg.provider === "mailchimp") {
    const conn = await getMarketingConnection(msg.organizationId, msg.companyId, msg.provider);
    let status: MarketingSendStatus = "NOT_CONFIGURED";
    let messageId: string | null = null;
    let error: string | null = "not_configured";
    if (isUsable(conn)) {
      try {
        messageId = await sendViaProvider(msg.provider, conn, { to: to.email, subject, text, html, headers, sendId: id, fromName: msg.companyName });
        status = "SENT";
        error = null;
      } catch (err) {
        status = "FAILED";
        error = err instanceof ProviderError ? `${err.reason}${err.message !== err.reason ? `: ${err.message.slice(0, 200)}` : ""}` : "delivery_failed";
      }
    }
    await db().marketingEmailSend.update({ where: { id }, data: { status, providerMessageId: messageId, error } });
    return status;
  }
  const result = await sendHtmlEmail({
    to: to.email,
    subject,
    text,
    html,
    // RFC 2369 / RFC 8058 one-click unsubscribe: mail clients POST to the signed link.
    headers: { "List-Unsubscribe": `<${link}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
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

const URL_RE = /https?:\/\/[^\s<>()"']+/g;

/** Escape a paragraph and turn its URLs into click-tracked anchors. */
function linkify(text: string, sendId: string | null, color: string) {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0];
    const clean = raw.replace(/[.,;:!?]+$/, "");
    out += escapeHtml(text.slice(last, m.index));
    out += `<a href="${escapeHtml(sendId ? clickUrl(sendId, clean) : clean)}" style="color:${color}">${escapeHtml(clean)}</a>`;
    last = m.index! + clean.length;
  }
  return out + escapeHtml(text.slice(last));
}

/**
 * HTML part of a marketing email: brand header (logo / name), paragraphs with tracked links, footer with the signed
 * unsubscribe link, and the signed open-tracking pixel. Plain text stays the alternative part.
 */
export function renderMarketingHtml(a: { body: string; sendId: string | null; locale: string; footer: string; unsubLabel: string; unsubscribeLink: string; brand: BrandKit | null }) {
  const color = a.brand?.colors[0]?.hex ?? "#2563eb";
  const font = a.brand?.bodyFont ? `${escapeHtml(a.brand.bodyFont)},system-ui,sans-serif` : "system-ui,sans-serif";
  const dir = a.locale.startsWith("ar") ? "rtl" : "ltr";
  const header = a.brand?.logoUrl
    ? `<img src="${escapeHtml(a.brand.logoUrl)}" alt="${escapeHtml(a.brand.brandName)}" style="max-height:40px;max-width:200px" />`
    : a.brand
      ? `<strong style="font-size:18px;color:${color}">${escapeHtml(a.brand.brandName)}</strong>`
      : "";
  const paragraphs = a.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px">${linkify(p, a.sendId, color).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<!doctype html><html lang="${a.locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#f6f7f9;font-family:${font};line-height:1.55;color:#111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:8px;border-top:4px solid ${color}">
${header ? `<tr><td style="padding:20px 24px 0">${header}</td></tr>` : ""}
<tr><td style="padding:20px 24px">${paragraphs}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #eee;font-size:12px;color:#666">${escapeHtml(a.footer)}${a.unsubLabel ? `<br><a href="${escapeHtml(a.unsubscribeLink)}" style="color:#666">${escapeHtml(a.unsubLabel)}</a>` : ""}</td></tr>
</table></td></tr></table>
${a.sendId ? `<img src="${escapeHtml(openPixelUrl(a.sendId))}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px" />` : ""}
</body></html>`;
}
