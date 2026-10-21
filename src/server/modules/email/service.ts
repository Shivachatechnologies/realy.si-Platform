import type { EmailStatus } from "@/generated/prisma/enums";
import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { captureException } from "@/server/core/telemetry";
import { closestLocale } from "@/i18n/config";
import { createTranslator, type Messages } from "@/i18n/translate";
import { emailProvider } from "./provider";
import enUS from "@/i18n/messages/en-US.json";
import hiIN from "@/i18n/messages/hi-IN.json";
import arAE from "@/i18n/messages/ar-AE.json";
import deDE from "@/i18n/messages/de-DE.json";
import zhCN from "@/i18n/messages/zh-CN.json";

const CATALOGS: Record<string, Messages> = { "en-US": enUS, "hi-IN": hiIN as Messages, "ar-AE": arAE as Messages, "de-DE": deDE as Messages, "zh-CN": zhCN as Messages };

export type EmailTemplate = "invitation" | "verify_email" | "password_reset";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Localized subject/text/html for a template. `link` carries the one-time token and is never persisted or logged. */
export function renderEmail(template: EmailTemplate, locale: string, vars: Record<string, string>, link: string) {
  const l = closestLocale(locale);
  const t = createTranslator(l, CATALOGS[l]);
  const subject = t(`email.${template}.subject`, vars);
  const lines = [t(`email.${template}.body`, vars), "", link, "", t(`email.${template}.footer`, vars)];
  const dir = l.startsWith("ar") ? "rtl" : "ltr";
  const html = `<!doctype html><html lang="${l}" dir="${dir}"><body style="font-family:system-ui,sans-serif;line-height:1.5">
<p>${escapeHtml(t(`email.${template}.body`, vars))}</p>
<p><a href="${escapeHtml(link)}">${escapeHtml(t(`email.${template}.cta`, vars))}</a></p>
<p style="color:#666;font-size:12px">${escapeHtml(t(`email.${template}.footer`, vars))}</p></body></html>`;
  return { subject, text: lines.join("\n"), html };
}

export interface SendResult {
  status: EmailStatus;
  messageId: string | null;
}

/**
 * Send (or truthfully not send) a transactional email and record the outcome in `email_messages`.
 * Never throws for delivery problems; never logs or stores the body/link.
 */
export async function sendEmail(args: {
  to: string;
  template: EmailTemplate;
  locale: string;
  vars: Record<string, string>;
  link: string;
  organizationId?: string | null;
  userId?: string | null;
}): Promise<SendResult> {
  const configured = emailProvider();
  let status: EmailStatus = "NOT_CONFIGURED";
  let messageId: string | null = null;
  let error: string | null = null;
  if (configured) {
    try {
      const rendered = renderEmail(args.template, args.locale, args.vars, args.link);
      const r = await configured.provider.send({ ...rendered, to: args.to, from: configured.from });
      status = "SENT";
      messageId = r.messageId;
    } catch (err) {
      status = "FAILED";
      error = err instanceof Error ? err.message.slice(0, 300) : "send failed";
      logger.warn({ template: args.template, provider: configured.provider.id, error }, "email delivery failed");
      captureException(err, { template: args.template });
    }
  }
  await db().emailMessage.create({
    data: {
      organizationId: args.organizationId ?? null,
      userId: args.userId ?? null,
      toEmail: args.to,
      template: args.template,
      locale: closestLocale(args.locale),
      status,
      provider: configured?.provider.id ?? null,
      providerMessageId: messageId,
      error,
    },
  });
  return { status, messageId };
}

export const emailConfigured = () => emailProvider() !== null;

/**
 * Send a plain-text message written by a person (or approved AI draft) and record the outcome in `email_messages`.
 * Returns NOT_CONFIGURED when no provider is set up — callers must never report such a message as sent.
 */
export async function sendPlainEmail(args: { to: string; subject: string; text: string; template: string; organizationId: string; userId?: string | null; locale?: string }): Promise<SendResult> {
  const configured = emailProvider();
  let status: EmailStatus = "NOT_CONFIGURED";
  let messageId: string | null = null;
  let error: string | null = null;
  if (configured) {
    try {
      const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">${args.text
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
        .join("")}</body></html>`;
      const r = await configured.provider.send({ to: args.to, from: configured.from, subject: args.subject, text: args.text, html });
      status = "SENT";
      messageId = r.messageId;
    } catch (err) {
      status = "FAILED";
      error = err instanceof Error ? err.message.slice(0, 300) : "send failed";
      logger.warn({ template: args.template, provider: configured.provider.id, error }, "email delivery failed");
      captureException(err, { template: args.template });
    }
  }
  await db().emailMessage.create({
    data: {
      organizationId: args.organizationId,
      userId: args.userId ?? null,
      toEmail: args.to,
      template: args.template,
      locale: closestLocale(args.locale ?? "en-US"),
      status,
      provider: configured?.provider.id ?? null,
      providerMessageId: messageId,
      error,
    },
  });
  return { status, messageId };
}
