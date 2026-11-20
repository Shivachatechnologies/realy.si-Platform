import { db, transaction } from "@/server/core/db";
import { env } from "@/server/core/env";
import { hmacSha256, safeEqual } from "@/server/core/crypto";
import { systemContext } from "@/server/core/context";
import { writeAudit } from "@/server/modules/audit/service";
import { isUuid, normalizeEmail } from "./common";

/**
 * Signed tokens for public email links (unsubscribe, open pixel, click redirect). HMAC-SHA256 with a key derived from
 * the platform master key and a purpose label, so a token for one purpose cannot be replayed for another.
 */
function key(purpose: string) {
  return hmacSha256(Buffer.from(env().REALY_ENCRYPTION_KEY, "base64"), `realy:marketing:${purpose}`);
}
function sign(purpose: string, payload: string) {
  return hmacSha256(key(purpose), payload).toString("base64url").slice(0, 32);
}

export interface UnsubscribePayload {
  o: string;
  c: string;
  e: string;
  /** Send id, when the link came from a tracked email. */
  s?: string;
}

export function unsubscribeToken(p: UnsubscribePayload): string {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${body}.${sign("unsubscribe", body)}`;
}

export function verifyUnsubscribeToken(token: string | null | undefined): UnsubscribePayload | null {
  if (!token || token.length > 1000) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(sig, sign("unsubscribe", body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UnsubscribePayload;
    if (!isUuid(p.o) || !isUuid(p.c) || typeof p.e !== "string" || !p.e.includes("@") || (p.s && !isUuid(p.s))) return null;
    return p;
  } catch {
    return null;
  }
}

const appUrl = () => env().APP_URL.replace(/\/$/, "");

export function unsubscribeUrl(p: UnsubscribePayload) {
  return `${appUrl()}/api/public/unsubscribe?token=${encodeURIComponent(unsubscribeToken(p))}`;
}
export function openPixelUrl(sendId: string) {
  return `${appUrl()}/api/public/marketing/open/${sendId}?sig=${sign("open", sendId)}`;
}
export function clickUrl(sendId: string, target: string) {
  return `${appUrl()}/api/public/marketing/click?s=${sendId}&u=${encodeURIComponent(target)}&sig=${sign("click", `${sendId}|${target}`)}`;
}
export const verifyOpen = (sendId: string, sig: string | null) => isUuid(sendId) && !!sig && safeEqual(sig, sign("open", sendId));
export const verifyClick = (sendId: string, target: string, sig: string | null) => isUuid(sendId) && !!sig && safeEqual(sig, sign("click", `${sendId}|${target}`));

/** Rewrite http(s) links in a plain-text body to signed click-tracking redirects. */
export function trackLinks(text: string, sendId: string) {
  return text.replace(/https?:\/\/[^\s<>()"']+/g, (url) => {
    const clean = url.replace(/[.,;:!?]+$/, "");
    const tail = url.slice(clean.length);
    return clickUrl(sendId, clean) + tail;
  });
}

/**
 * One-click unsubscribe: suppress the address company-wide, clear consent on matching CRM contacts, stop active
 * nurture enrollments and mark the send. Idempotent.
 */
export async function unsubscribe(p: UnsubscribePayload): Promise<{ email: string; companyName: string; locale: string } | null> {
  const email = normalizeEmail(p.e);
  if (!email) return null;
  const company = await db().company.findFirst({ where: { id: p.c, organizationId: p.o }, select: { id: true, name: true, defaultLocale: true } });
  if (!company) return null;
  const ctx = systemContext();
  await transaction(async (tx) => {
    const now = new Date();
    await tx.marketingSuppression.upsert({
      where: { companyId_emailNormalized: { companyId: p.c, emailNormalized: email } },
      create: { organizationId: p.o, companyId: p.c, emailNormalized: email, reason: "unsubscribe_link" },
      update: {},
    });
    const contacts = await tx.contact.updateMany({
      where: { organizationId: p.o, companyId: p.c, OR: [{ emailNormalized: email }, { email: { equals: email, mode: "insensitive" } }] },
      data: { marketingConsent: false, unsubscribedAt: now },
    });
    await tx.marketingSequenceEnrollment.updateMany({ where: { companyId: p.c, emailNormalized: email, status: "ACTIVE" }, data: { status: "UNSUBSCRIBED", nextRunAt: null } });
    if (p.s) {
      const send = await tx.marketingEmailSend.findFirst({ where: { id: p.s, companyId: p.c }, select: { id: true, unsubscribedAt: true } });
      if (send && !send.unsubscribedAt) {
        await tx.marketingEmailSend.update({ where: { id: send.id }, data: { unsubscribedAt: now } });
        await tx.marketingEmailEvent.create({ data: { organizationId: p.o, companyId: p.c, sendId: send.id, type: "unsubscribe" } });
      }
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId: p.o, action: "marketing.unsubscribed", resourceType: "marketing_suppression", resourceId: null, newValue: { contacts: contacts.count, sendId: p.s ?? null } });
  });
  return { email, companyName: company.name, locale: company.defaultLocale };
}

export async function recordOpen(sendId: string) {
  const send = await db().marketingEmailSend.findUnique({ where: { id: sendId }, select: { id: true, organizationId: true, companyId: true, openedAt: true } });
  if (!send) return;
  await db().$transaction([
    db().marketingEmailSend.update({ where: { id: send.id }, data: { openCount: { increment: 1 }, ...(send.openedAt ? {} : { openedAt: new Date() }) } }),
    db().marketingEmailEvent.create({ data: { organizationId: send.organizationId, companyId: send.companyId, sendId: send.id, type: "open" } }),
  ]);
}

export async function recordClick(sendId: string, url: string) {
  const send = await db().marketingEmailSend.findUnique({ where: { id: sendId }, select: { id: true, organizationId: true, companyId: true, clickedAt: true } });
  if (!send) return;
  await db().$transaction([
    db().marketingEmailSend.update({ where: { id: send.id }, data: { clickCount: { increment: 1 }, ...(send.clickedAt ? {} : { clickedAt: new Date() }) } }),
    db().marketingEmailEvent.create({ data: { organizationId: send.organizationId, companyId: send.companyId, sendId: send.id, type: "click", url: url.slice(0, 2000) } }),
  ]);
}
