import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import { systemContext } from "@/server/core/context";
import { randomToken, sha256 } from "@/server/core/crypto";
import { AppError, notFound } from "@/server/core/errors";
import { isModuleEnabled, isOrganizationSuspended } from "@/server/core/platform-controls";
import { writeAudit } from "@/server/modules/audit/service";
import { closestLocale, type AppLocale } from "@/i18n/config";
import { originAllowed } from "./common";
import { addEvent, handOff } from "./actions";
import { chatAiConfigured, generateAiReply } from "./agent";
import { appOrigin } from "./settings";
import { closeConversationTx } from "./lifecycle";

/**
 * Public widget API (no session): every call carries the company's public key and comes from an allowed website origin
 * (checked by the route against the key's allow-list). Visitors are identified by a random token kept in their browser;
 * only its hash is stored. Bots that fill the honeypot get a normal-looking answer and nothing is stored.
 */

const MAX_MESSAGES_PER_CONVERSATION = 200;
const visitorTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
export const keySchema = z.string().regex(/^lc_[A-Za-z0-9]{8,40}$/);

export const sessionInput = z.object({
  visitorToken: visitorTokenSchema.optional(),
  locale: z.string().max(35).optional(),
  pageUrl: z.string().max(1000).optional(),
  referrer: z.string().max(1000).optional(),
  website: z.string().max(200).optional(),
});
export const messageInput = z.object({
  visitorToken: visitorTokenSchema,
  body: z.string().trim().min(1).max(2000),
  locale: z.string().max(35).optional(),
  pageUrl: z.string().max(1000).optional(),
  /** Honeypot: humans never fill it. */
  website: z.string().max(200).optional(),
});
export const pollInput = z.object({ visitorToken: visitorTokenSchema, after: z.string().datetime().optional() });
export const contactInput = z.object({
  visitorToken: visitorTokenSchema,
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(254),
  consent: z.literal(true),
  /** The consent sentence exactly as shown to the visitor (stored as proof). */
  consentText: z.string().trim().min(10).max(600),
  website: z.string().max(200).optional(),
});
export const visitorActionInput = z.object({ visitorToken: visitorTokenSchema });

export interface Widget {
  settings: NonNullable<Awaited<ReturnType<typeof loadByKey>>>;
}

async function loadByKey(key: string) {
  if (!keySchema.safeParse(key).success) return null;
  return db().livechatSettings.findUnique({ where: { publicKey: key }, include: { company: { select: { id: true, name: true, status: true, deletedAt: true, defaultLocale: true } } } });
}

/** Origin allowed for this key (CORS); used by OPTIONS and every call. Never throws. */
export async function allowedOriginFor(key: string, origin: string | null): Promise<boolean> {
  const s = await loadByKey(key).catch(() => null);
  return !!s && originAllowed(origin, s.allowedOrigins, appOrigin());
}

/** The widget behind a key, if it may serve this origin now (enabled, company active, not suspended, support module on). */
export async function resolveWidget(key: string, origin: string | null) {
  const s = await loadByKey(key);
  if (!s || s.company.deletedAt || s.company.status !== "ACTIVE") throw notFound("Chat");
  if (!originAllowed(origin, s.allowedOrigins, appOrigin())) throw new AppError("forbidden", "This website is not allowed to use this chat", { reason: "livechat_origin_not_allowed" });
  if (await isOrganizationSuspended(s.organizationId)) throw new AppError("not_available", "Chat unavailable", { reason: "livechat_unavailable" });
  if (!(await isModuleEnabled(s.organizationId, "support"))) throw new AppError("not_available", "Chat unavailable", { reason: "livechat_unavailable" });
  // The app's own origin may preview a disabled widget (settings page); websites only see an enabled one.
  const preview = origin?.toLowerCase() === appOrigin().toLowerCase();
  if (!s.enabled && !preview) throw new AppError("not_available", "Chat is turned off", { reason: "livechat_disabled" });
  return s;
}

export type ResolvedWidget = Awaited<ReturnType<typeof resolveWidget>>;

export function pickLocale(requested: string | undefined, fallback: string): AppLocale {
  return closestLocale(requested || fallback);
}

/** What the widget needs to render (no tenant internals). */
export function publicConfig(s: ResolvedWidget) {
  return {
    company: s.company.name,
    assistantName: s.assistantName,
    brandColor: s.brandColor,
    position: s.position,
    greeting: s.greeting,
    privacyUrl: s.privacyUrl,
    ai: s.aiEnabled && chatAiConfigured(),
    preview: !s.enabled,
  };
}

const hashToken = (t: string) => sha256(`livechat:${t}`);

async function visitorFor(s: ResolvedWidget, token: string) {
  const v = await db().livechatVisitor.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!v || v.companyId !== s.companyId) throw notFound("Visitor");
  return v;
}

async function openConversation(companyId: string, visitorId: string) {
  return db().livechatConversation.findFirst({ where: { companyId, visitorId, status: { not: "CLOSED" } }, orderBy: { createdAt: "desc" } });
}

const publicMessage = (m: { id: string; author: string; kind: string; body: string; meta: unknown; createdAt: Date }) => ({
  id: m.id,
  author: m.author,
  kind: m.kind,
  // Event codes and contact requests are localized by the widget; the AI's internal action log stays private.
  body: m.body,
  number: m.kind === "event" && m.meta && typeof m.meta === "object" ? ((m.meta as Record<string, unknown>).number ?? null) : null,
  createdAt: m.createdAt.toISOString(),
});

async function conversationState(companyId: string, conversationId: string, after?: Date) {
  const c = await db().livechatConversation.findFirst({ where: { id: conversationId, companyId }, select: { id: true, status: true, agentTypingAt: true, aiBusyUntil: true } });
  if (!c) return null;
  const messages = await db().livechatMessage.findMany({
    where: { conversationId, companyId, ...(after ? { createdAt: { gt: after } } : {}) },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, author: true, kind: true, body: true, meta: true, createdAt: true },
  });
  const now = Date.now();
  return {
    conversationId: c.id,
    status: c.status,
    typing: (c.agentTypingAt && now - c.agentTypingAt.getTime() < 6_000) || (c.aiBusyUntil && c.aiBusyUntil.getTime() > now) ? true : false,
    messages: messages.map(publicMessage),
  };
}

export async function startSession(s: ResolvedWidget, raw: z.input<typeof sessionInput>, meta: { ip: string | null; userAgent: string | null }) {
  const input = sessionInput.parse(raw);
  const locale = pickLocale(input.locale, s.company.defaultLocale);
  if (input.website) return { visitorToken: randomToken(24), locale, conversation: null };
  if (input.visitorToken) {
    const v = await db().livechatVisitor.findUnique({ where: { tokenHash: hashToken(input.visitorToken) } });
    if (v && v.companyId === s.companyId) {
      await db().livechatVisitor.update({ where: { id: v.id }, data: { lastSeenAt: new Date(), locale } });
      const open = await openConversation(s.companyId, v.id);
      return { visitorToken: input.visitorToken, locale, contactShared: !!(v.email && v.consentAt), conversation: open ? await conversationState(s.companyId, open.id) : null };
    }
  }
  const token = randomToken(24);
  await db().livechatVisitor.create({
    data: { organizationId: s.organizationId, companyId: s.companyId, tokenHash: hashToken(token), locale, ipHash: meta.ip ? sha256(`ip:${meta.ip}`).slice(0, 32) : null, userAgent: meta.userAgent?.slice(0, 300) ?? null },
  });
  return { visitorToken: token, locale, contactShared: false, conversation: null };
}

export async function pollMessages(s: ResolvedWidget, raw: z.input<typeof pollInput>) {
  const input = pollInput.parse(raw);
  const v = await visitorFor(s, input.visitorToken);
  const open = await db().livechatConversation.findFirst({ where: { companyId: s.companyId, visitorId: v.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
  if (!open) return { conversation: null };
  if (open.status !== "CLOSED") await db().livechatConversation.update({ where: { id: open.id }, data: { visitorSeenAt: new Date() } });
  return { conversation: await conversationState(s.companyId, open.id, input.after ? new Date(input.after) : undefined) };
}

/** Store a visitor message, then (while the AI is in charge) generate the AI reply before answering. */
export async function postVisitorMessage(s: ResolvedWidget, raw: z.input<typeof messageInput>, after?: string) {
  const input = messageInput.parse(raw);
  if (input.website) return { conversation: null };
  const v = await visitorFor(s, input.visitorToken);
  const locale = pickLocale(input.locale, v.locale);
  let conv = await openConversation(s.companyId, v.id);
  if (conv && conv.messageCount >= MAX_MESSAGES_PER_CONVERSATION) throw new AppError("rate_limited", "This conversation is too long; please start a new one", { reason: "livechat_conversation_limit" });
  const ctx = systemContext();
  const sentAt = new Date();
  conv = await transaction(async (tx) => {
    let c = conv;
    if (!c) {
      c = await tx.livechatConversation.create({
        data: { organizationId: s.organizationId, companyId: s.companyId, visitorId: v.id, locale, pageUrl: input.pageUrl?.slice(0, 1000) || null, status: s.aiEnabled ? "AI_ACTIVE" : "WAITING_HUMAN" },
      });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId: s.organizationId, action: "livechat.conversation.started", resourceType: "livechat_conversation", resourceId: c.id });
    }
    await tx.livechatMessage.create({ data: { organizationId: s.organizationId, companyId: s.companyId, conversationId: c.id, author: "VISITOR", body: input.body, createdAt: sentAt } });
    await tx.livechatVisitor.update({ where: { id: v.id }, data: { lastSeenAt: sentAt, locale } });
    return tx.livechatConversation.update({ where: { id: c.id }, data: { lastMessageAt: sentAt, messageCount: { increment: 1 }, visitorSeenAt: sentAt } });
  });
  if (conv.messageCount === 1 && conv.status === "WAITING_HUMAN") {
    // AI turned off: the team is notified about the new chat.
    await handOffNotifyOnly(conv);
  }
  if (conv.status === "AI_ACTIVE") await generateAiReply(conv, s);
  return { conversation: await conversationState(s.companyId, conv.id, after && !Number.isNaN(Date.parse(after)) ? new Date(after) : new Date(sentAt.getTime() - 1)) };
}

async function handOffNotifyOnly(conv: { id: string; organizationId: string; companyId: string }) {
  const { notifyUsers, usersWithPermission } = await import("@/server/modules/notifications/service");
  await transaction(async (tx) => {
    const recipients = await usersWithPermission(tx, conv.organizationId, conv.companyId, "support.manage");
    await notifyUsers(tx, conv.organizationId, recipients, "livechat.new_chat", { companyId: conv.companyId, title: "Website chat", href: `/livechat/${conv.id}` });
  });
}

/** The visitor shares name + email with explicit consent (stored with the consent text). */
export async function submitContact(s: ResolvedWidget, raw: z.input<typeof contactInput>) {
  const input = contactInput.parse(raw);
  if (input.website) return { ok: true };
  const v = await visitorFor(s, input.visitorToken);
  const ctx = systemContext();
  const conv = await openConversation(s.companyId, v.id);
  await transaction(async (tx) => {
    await tx.livechatVisitor.update({ where: { id: v.id }, data: { name: input.name, email: input.email, emailNormalized: input.email, consentAt: new Date(), consentText: input.consentText } });
    if (conv) await addEvent(tx, conv, "contact_shared");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId: s.organizationId, action: "livechat.contact_shared", resourceType: "livechat_visitor", resourceId: v.id, newValue: { consent: true } });
  });
  // Let the AI continue (e.g. record the lead it was waiting for).
  if (conv?.status === "AI_ACTIVE") await generateAiReply(conv, s);
  return { ok: true, conversation: conv ? await conversationState(s.companyId, conv.id) : null };
}

export async function visitorRequestsHuman(s: ResolvedWidget, raw: z.input<typeof visitorActionInput>) {
  const input = visitorActionInput.parse(raw);
  const v = await visitorFor(s, input.visitorToken);
  const conv = await openConversation(s.companyId, v.id);
  if (!conv) throw notFound("Conversation");
  await handOff(conv, s, { reason: "The visitor asked for a person", knowledgeGap: false });
  return { conversation: await conversationState(s.companyId, conv.id) };
}

export async function visitorCloses(s: ResolvedWidget, raw: z.input<typeof visitorActionInput>) {
  const input = visitorActionInput.parse(raw);
  const v = await visitorFor(s, input.visitorToken);
  const conv = await openConversation(s.companyId, v.id);
  if (!conv) return { ok: true };
  await transaction(async (tx) => {
    await closeConversationTx(tx, systemContext(), conv.id, conv.companyId, "visitor");
  });
  return { ok: true };
}

