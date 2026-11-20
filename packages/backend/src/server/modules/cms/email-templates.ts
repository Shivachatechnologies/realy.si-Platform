import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { closestLocale, LOCALES } from "@/i18n/config";
import { createTranslator, type Messages } from "@/i18n/translate";
import enUS from "@/i18n/messages/en-US.json";
import hiIN from "@/i18n/messages/hi-IN.json";
import arAE from "@/i18n/messages/ar-AE.json";
import deDE from "@/i18n/messages/de-DE.json";
import zhCN from "@/i18n/messages/zh-CN.json";
import { writeAudit } from "@/server/modules/audit/service";
import { emailProvider } from "@/server/modules/email/provider";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { requireAnyPlatform } from "@/server/modules/admin/access";
import { EMAIL_TEMPLATE_DEFS, EMAIL_TEMPLATE_KEYS, fillTemplate, isEmailTemplateKey, type EmailTemplateKey } from "./schemas";

/**
 * Platform transactional email templates (Admin → Content → Email templates): per key and locale, `{{variable}}`
 * placeholders, draft → published, preview and test-send through the platform email provider. The email service
 * (email/service.ts sendEmail) uses the published template when one exists, else its built-in catalog text.
 */

const MANAGE = "platform.content.manage";
const CATALOGS: Record<string, Messages> = { "en-US": enUS as Messages, "hi-IN": hiIN as Messages, "ar-AE": arAE as Messages, "de-DE": deDE as Messages, "zh-CN": zhCN as Messages };
const localeSchema = z.enum(LOCALES);

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Built-in text (the email.* catalog) used until a template is published; empty for keys without catalog text. */
export function builtInTemplate(key: EmailTemplateKey, locale: string) {
  const l = closestLocale(locale);
  const t = createTranslator(l, CATALOGS[l]);
  const k = `email.${key}`;
  const has = (s: string) => {
    const v = t(`${k}.${s}`);
    return v && v !== `${k}.${s}` ? v : "";
  };
  const body = [has("body"), "{{link}}", has("footer")].filter(Boolean).join("\n\n");
  return { subject: has("subject"), body: has("body") ? body : "" };
}

/** Render subject/text/html from a template body. Lines that are only a URL become a button-styled link. */
export function renderTemplate(subject: string, body: string, locale: string, vars: Record<string, string>) {
  const l = closestLocale(locale);
  const text = fillTemplate(body, vars);
  const dir = l.startsWith("ar") ? "rtl" : "ltr";
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) =>
      /^https?:\/\/\S+$/.test(p)
        ? `<p><a href="${escapeHtml(p)}" style="display:inline-block;background:#1764ff;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${escapeHtml(vars.cta || p)}</a></p>`
        : `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
  const html = `<!doctype html><html lang="${l}" dir="${dir}"><body style="font-family:Inter,system-ui,sans-serif;line-height:1.5;color:#0b1220">${paragraphs}</body></html>`;
  return { subject: fillTemplate(subject, vars).replace(/[\r\n]+/g, " ").slice(0, 300), text, html };
}

// ───────────── Hook used by the email service ─────────────

const cache = new Map<string, { at: number; value: { subject: string; body: string } | null }>();
const TTL = 60_000;

/** Published template for a key/locale (falls back to en-US), or null. Never throws. */
export async function publishedEmail(template: string, locale: string, vars: Record<string, string>) {
  if (!isEmailTemplateKey(template)) return null;
  try {
    const l = closestLocale(locale);
    const key = `${template}|${l}`;
    let hit = cache.get(key);
    if (!hit || Date.now() - hit.at > TTL) {
      const rows = await db().platformEmailTemplate.findMany({ where: { key: template, locale: { in: [l, "en-US"] }, publishedBody: { not: null } } });
      const row = rows.find((r) => r.locale === l) ?? rows.find((r) => r.locale === "en-US");
      hit = { at: Date.now(), value: row?.publishedBody && row.publishedSubject ? { subject: row.publishedSubject, body: row.publishedBody } : null };
      cache.set(key, hit);
    }
    return hit.value ? renderTemplate(hit.value.subject, hit.value.body, l, vars) : null;
  } catch (err) {
    logger.warn({ template, err: err instanceof Error ? err.message : String(err) }, "published email template unavailable; using built-in text");
    return null;
  }
}

// ───────────── Admin ─────────────

export async function listEmailTemplates(ctx: RequestContext) {
  await requireAnyPlatform(ctx, [MANAGE, "platform.controls.manage"]);
  const rows = await db().platformEmailTemplate.findMany({ select: { key: true, locale: true, status: true, publishedAt: true, updatedAt: true, version: true, publishedBody: true, body: true, subject: true, publishedSubject: true } });
  return {
    configured: emailProvider() !== null,
    templates: EMAIL_TEMPLATE_KEYS.map((key) => ({
      key,
      vars: EMAIL_TEMPLATE_DEFS[key].vars,
      locales: LOCALES.map((locale) => {
        const r = rows.find((x) => x.key === key && x.locale === locale);
        return { locale, exists: !!r, published: !!r?.publishedBody, dirty: !!r && (r.body !== r.publishedBody || r.subject !== r.publishedSubject), publishedAt: r?.publishedAt ?? null, version: r?.version ?? 0 };
      }),
    })),
  };
}

export async function getEmailTemplate(ctx: RequestContext, key: string, locale: string) {
  await requireAnyPlatform(ctx, [MANAGE, "platform.controls.manage"]);
  if (!isEmailTemplateKey(key)) throw notFound("Template");
  const l = localeSchema.parse(locale);
  const row = await db().platformEmailTemplate.findUnique({ where: { key_locale: { key, locale: l } } });
  const builtIn = builtInTemplate(key, l);
  return {
    key,
    locale: l,
    vars: EMAIL_TEMPLATE_DEFS[key].vars as readonly string[],
    subject: row?.subject ?? builtIn.subject,
    body: row?.body ?? builtIn.body,
    status: row?.status ?? null,
    publishedAt: row?.publishedAt ?? null,
    publishedSubject: row?.publishedSubject ?? null,
    publishedBody: row?.publishedBody ?? null,
    version: row?.version ?? 0,
    builtIn,
    configured: emailProvider() !== null,
  };
}

export const templateInput = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(20_000) });

export async function saveEmailTemplate(ctx: RequestContext, key: string, locale: string, raw: z.input<typeof templateInput>) {
  if (!isEmailTemplateKey(key)) throw notFound("Template");
  const l = localeSchema.parse(locale);
  const input = templateInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, MANAGE, platformChain(), tx);
    const row = await tx.platformEmailTemplate.upsert({
      where: { key_locale: { key, locale: l } },
      create: { key, locale: l, subject: input.subject, body: input.body, updatedById: ctx.actor.id! },
      update: { subject: input.subject, body: input.body, updatedById: ctx.actor.id! },
    });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "email_template.saved", resourceType: "email_template", resourceId: `${key}:${l}` });
    return { id: row.id };
  });
}

export const templateActionInput = z.object({ reason: z.string().trim().max(500).default(""), to: z.string().trim().email().max(254).optional() });

/** publish (draft → live), unpublish (back to built-in text) or test (send the draft to an address). */
export async function emailTemplateAction(ctx: RequestContext, key: string, locale: string, action: "publish" | "unpublish" | "test", raw: z.input<typeof templateActionInput>) {
  if (!isEmailTemplateKey(key)) throw notFound("Template");
  const l = localeSchema.parse(locale);
  const input = templateActionInput.parse(raw);
  if (action === "test") return testSend(ctx, key, l, input.to);
  const result = await transaction(async (tx) => {
    await requirePermission(ctx, MANAGE, platformChain(), tx);
    const row = await tx.platformEmailTemplate.findUnique({ where: { key_locale: { key, locale: l } } });
    if (!row) throw notFound("Template");
    if (action === "publish") {
      await tx.platformEmailTemplate.update({ where: { id: row.id }, data: { status: "PUBLISHED", publishedSubject: row.subject, publishedBody: row.body, publishedAt: new Date(), version: row.version + 1, updatedById: ctx.actor.id! } });
    } else {
      await tx.platformEmailTemplate.update({ where: { id: row.id }, data: { status: "DRAFT", publishedSubject: null, publishedBody: null, publishedAt: null, updatedById: ctx.actor.id! } });
    }
    await writeAudit(tx, ctx, { category: "ADMIN", action: `email_template.${action}ed`.replace("unpublisheded", "unpublished").replace("publisheded", "published"), resourceType: "email_template", resourceId: `${key}:${l}`, newValue: { version: action === "publish" ? row.version + 1 : row.version }, reason: input.reason || null });
    return { ok: true };
  });
  cache.clear();
  return result;
}

const SAMPLE: Record<string, string> = { name: "Ana Novak", inviter: "Ana Novak", organization: "Acme d.o.o.", company: "Acme", summary: "3 approvals waiting, revenue +4% this week.", subject: "Invoice question", ticket: "T-1042", title: "Scheduled maintenance", body: "We will upgrade the platform on Sunday 02:00–03:00 UTC." };

/** Sample variables for previews and test sends (the link points at the user app). */
export function sampleVars(key: EmailTemplateKey) {
  const base = process.env.USER_APP_URL ?? "https://app.realy.si";
  return Object.fromEntries(EMAIL_TEMPLATE_DEFS[key].vars.map((v) => [v, v === "link" ? `${base}/` : (SAMPLE[v] ?? v)]));
}

async function testSend(ctx: RequestContext, key: EmailTemplateKey, locale: string, to?: string) {
  await requirePermission(ctx, MANAGE, platformChain());
  if (!to) throw invalid("Enter an address for the test email");
  const t = await getEmailTemplate(ctx, key, locale);
  const configured = emailProvider();
  if (!configured) throw new AppError("not_configured", "No platform email provider is configured (RESEND_API_KEY or POSTMARK_SERVER_TOKEN).", { reason: "email_not_configured" });
  const rendered = renderTemplate(`[TEST] ${t.subject}`, t.body, locale, sampleVars(key));
  let status: "SENT" | "FAILED" = "SENT";
  let messageId: string | null = null;
  let error: string | null = null;
  try {
    messageId = (await configured.provider.send({ ...rendered, to, from: configured.from })).messageId;
  } catch (err) {
    status = "FAILED";
    error = err instanceof Error ? err.message.slice(0, 300) : "send failed";
  }
  await transaction(async (tx) => {
    await tx.emailMessage.create({ data: { organizationId: null, userId: ctx.actor.id, toEmail: to, template: `test:${key}`, locale, status, provider: configured.provider.id, providerMessageId: messageId, error } });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "email_template.test_sent", resourceType: "email_template", resourceId: `${key}:${locale}`, newValue: { status } });
  });
  if (status === "FAILED") throw new AppError("service_unavailable", `The email provider refused the message: ${error}`, { reason: "email_send_failed" });
  return { status, messageId };
}
