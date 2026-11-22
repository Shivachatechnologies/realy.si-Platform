import "server-only";
import { systemContext, userContext } from "@/server/core/context";
import { decryptSecret, safeEqual, sha256 } from "@/server/core/crypto";
import { db, transaction } from "@/server/core/db";
import { env } from "@/server/core/env";
import { isAppError } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { isOrganizationSuspended } from "@/server/core/platform-controls";
import { closestLocale } from "@/i18n/config";
import { writeAudit } from "@/server/modules/audit/service";
import { sendWhatsApp } from "@/server/modules/integrations/services/messaging";
import { usableConnection, str } from "@/server/modules/integrations/services/common";
import { parseMetaInbound, parseTwilioInbound, twimlMessage, verifyMetaSignature, verifyTwilioSignature, type InboundWhatsApp } from "@/server/modules/integrations/services/whatsapp";
import { translatorFor } from "./render";
import { decideTokenRow, metaSecretPurpose } from "./service";

/**
 * WhatsApp replies to briefings. Authenticity: the provider signature (Twilio auth token / Meta app secret) over the
 * exact request, on a per-company secret webhook path. Authorization: the sender number must be a number the founder
 * verified (by sending a one-time join code from it); decisions then run as that founder through the regular approval
 * flow, only for approvals listed in their briefing (single-use token by reference number) and never for actions that
 * need two-factor confirmation (those get a link instead). Replies are deduplicated by provider message id.
 */

type Provider = "twilio" | "whatsapp";

const webhookUrl = (provider: "twilio" | "whatsapp", key: string) => `${env().APP_URL.replace(/\/+$/, "")}/api/v1/webhooks/briefing/${provider}/${key}`;

async function configByKey(key: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(key)) return null;
  return db().briefingChannelConfig.findUnique({ where: { webhookKey: key } });
}

/** Twilio inbound webhook: verify X-Twilio-Signature, handle the message, answer with TwiML. */
export async function handleTwilioWebhook(key: string, params: Record<string, string>, signature: string | null): Promise<{ status: number; twiml: string }> {
  const cfg = await configByKey(key);
  if (!cfg) return { status: 404, twiml: twimlMessage(null) };
  const conn = await usableConnection(cfg.organizationId, cfg.companyId, "twilio");
  if (!conn || !verifyTwilioSignature(conn.accessToken, webhookUrl("twilio", key), params, signature)) return { status: 403, twiml: twimlMessage(null) };
  if (params.AccountSid && str(conn.config.accountSid) && params.AccountSid !== conn.config.accountSid) return { status: 403, twiml: twimlMessage(null) };
  const msg = parseTwilioInbound(params);
  if (!msg) return { status: 200, twiml: twimlMessage(null) };
  const reply = await handleMessage("twilio", cfg.organizationId, cfg.companyId, msg);
  return { status: 200, twiml: twimlMessage(reply) };
}

/** Meta webhook verification handshake (GET): echo hub.challenge when the verify token matches. */
export async function handleMetaVerify(key: string, query: URLSearchParams): Promise<{ status: number; body: string }> {
  const cfg = await configByKey(key);
  if (!cfg) return { status: 404, body: "" };
  const token = query.get("hub.verify_token") ?? "";
  if (query.get("hub.mode") !== "subscribe" || !token || !safeEqual(token, cfg.metaVerifyToken)) return { status: 403, body: "" };
  return { status: 200, body: (query.get("hub.challenge") ?? "").slice(0, 200) };
}

/** Meta (WhatsApp Cloud API) webhook: verify X-Hub-Signature-256 with the stored app secret, handle text messages. */
export async function handleMetaWebhook(key: string, raw: string, signature: string | null): Promise<{ status: number }> {
  const cfg = await configByKey(key);
  if (!cfg) return { status: 404 };
  // The company's own Meta app secret when it stored one; otherwise Realy's Meta app (WHATSAPP_APP_SECRET, used by
  // Embedded Signup). Connections made with Embedded Signup normally deliver to the app-level webhook instead
  // (/api/v1/webhooks/whatsapp, routed by phone_number_id — handleRoutedWhatsAppMessages below).
  let secret: string | null = process.env.WHATSAPP_APP_SECRET?.trim() || null;
  if (cfg.metaAppSecretEnc) {
    try {
      secret = decryptSecret(cfg.metaAppSecretEnc, metaSecretPurpose(cfg.companyId));
    } catch {
      return { status: 403 };
    }
  }
  if (!secret) return { status: 403 };
  if (!verifyMetaSignature(secret, raw, signature)) return { status: 403 };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { status: 400 };
  }
  const conn = await usableConnection(cfg.organizationId, cfg.companyId, "whatsapp");
  const parsed = parseMetaInbound(body);
  // The body must name this company's own phone number: Realy's Meta app signs every customer's events, so a payload
  // without (or with another) phone_number_id is never treated as this company's.
  if (!conn || !parsed.phoneNumberId || str(conn.config.phoneNumberId) !== parsed.phoneNumberId) return { status: 200 };
  for (const m of parsed.messages.slice(0, 20)) {
    const reply = await handleMessage("whatsapp", cfg.organizationId, cfg.companyId, m);
    if (reply) {
      const r = await sendWhatsApp(cfg.organizationId, cfg.companyId, { to: m.from, body: reply });
      if (!r.ok) logger.warn({ companyId: cfg.companyId, error: r.error }, "briefing whatsapp reply failed");
    }
  }
  return { status: 200 };
}

/**
 * WhatsApp messages that reached Realy's app-level webhook (integrations/own-account-webhooks.ts) and were routed to
 * this company by phone_number_id, after the platform signature was verified. Handled as briefing replies only when
 * the company set up briefing channels; the body holds only this company's changes.
 */
export async function handleRoutedWhatsAppMessages(organizationId: string, companyId: string, body: Record<string, unknown>): Promise<number> {
  const cfg = await db().briefingChannelConfig.findUnique({ where: { companyId }, select: { organizationId: true } });
  if (!cfg || cfg.organizationId !== organizationId) return 0;
  const parsed = parseMetaInbound(body);
  let handled = 0;
  for (const m of parsed.messages.slice(0, 20)) {
    const reply = await handleMessage("whatsapp", organizationId, companyId, m);
    handled++;
    if (reply) {
      const r = await sendWhatsApp(organizationId, companyId, { to: m.from, body: reply });
      if (!r.ok) logger.warn({ companyId, error: r.error }, "briefing whatsapp reply failed");
    }
  }
  return handled;
}

const wordsOf = (v: string) =>
  v
    .toLowerCase()
    .split("|")
    .map((w) => w.trim())
    .filter(Boolean);

/** Parse a reply against English and the reader's own keywords. */
export function parseCommand(text: string, locale: string): { kind: "join"; code: string } | { kind: "decide"; decision: "approve" | "reject"; ref: number } | { kind: "stop" } | { kind: "help" } {
  const s = text.trim().toLowerCase().replace(/\s+/g, " ");
  const join = /^realy ?(\d{6})$/.exec(s);
  if (join) return { kind: "join", code: join[1]! };
  const { t } = translatorFor(locale);
  const approve = new Set(["approve", "yes", "ok", ...wordsOf(t("briefing.whatsapp.words.approve"))]);
  const reject = new Set(["reject", "no", "decline", ...wordsOf(t("briefing.whatsapp.words.reject"))]);
  const stop = new Set(["stop", "unsubscribe", ...wordsOf(t("briefing.whatsapp.words.stop"))]);
  const m = /^(\S+) ?#?(\d{1,2})$/u.exec(s);
  if (m) {
    const ref = Number(m[2]);
    if (approve.has(m[1]!)) return { kind: "decide", decision: "approve", ref };
    if (reject.has(m[1]!)) return { kind: "decide", decision: "reject", ref };
  }
  if (stop.has(s)) return { kind: "stop" };
  return { kind: "help" };
}

async function record(provider: Provider, organizationId: string, companyId: string, msg: InboundWhatsApp): Promise<string | null> {
  try {
    const row = await db().briefingInboundMessage.create({ data: { organizationId, companyId, provider, providerMessageId: msg.messageId, result: "received" }, select: { id: true } });
    return row.id;
  } catch {
    return null; // duplicate delivery
  }
}

/** Returns the reply text (or null for no reply). */
async function handleMessage(provider: Provider, organizationId: string, companyId: string, msg: InboundWhatsApp): Promise<string | null> {
  const id = await record(provider, organizationId, companyId, msg);
  if (!id) return null;
  const finish = async (result: string, userId: string | null, command: string | null, reply: string | null) => {
    await db().briefingInboundMessage.update({ where: { id }, data: { result, userId, command } });
    return reply;
  };
  if (await isOrganizationSuspended(organizationId)) return finish("org_suspended", null, null, null);

  const subs = await db().briefingSubscription.findMany({ where: { organizationId, companyId, whatsappNumber: msg.from }, orderBy: { updatedAt: "desc" }, take: 5 });
  const first = subs[0];
  const cmd = parseCommand(msg.text, first?.locale ?? "en-US");

  if (cmd.kind === "join") {
    const now = new Date();
    const sub = subs.find((s) => s.whatsappCodeHash && s.whatsappCodeExpiresAt && s.whatsappCodeExpiresAt > now && safeEqual(s.whatsappCodeHash, sha256(`${s.id}:${cmd.code}`)));
    if (!sub) return finish("join_failed", null, "join", first ? translatorFor(first.locale).t("briefing.whatsapp.joinFailed") : null);
    await transaction(async (tx) => {
      await tx.briefingSubscription.update({ where: { id: sub.id }, data: { whatsappVerifiedAt: now, whatsappLastInboundAt: now, whatsappCodeHash: null, whatsappCodeExpiresAt: null } });
      await writeAudit(tx, userContext(sub.userId), { category: "TENANT", organizationId, action: "briefing.whatsapp_verified", resourceType: "briefing_subscription", resourceId: sub.id, newValue: { companyId, provider } });
    });
    return finish("verified", sub.userId, "join", translatorFor(sub.locale).t("briefing.whatsapp.verified"));
  }

  // Everything else only from a verified number.
  const sub = subs.find((s) => s.whatsappVerifiedAt);
  if (!sub) return finish("unknown_sender", null, cmd.kind, null);
  const member = await db().membership.findFirst({ where: { organizationId, userId: sub.userId, status: "ACTIVE" }, select: { id: true } });
  if (!member) return finish("not_member", sub.userId, cmd.kind, null);
  await db().briefingSubscription.update({ where: { id: sub.id }, data: { whatsappLastInboundAt: new Date() } });
  const { t } = translatorFor(sub.locale);

  if (cmd.kind === "stop") {
    await transaction(async (tx) => {
      await tx.briefingSubscription.update({ where: { id: sub.id }, data: { whatsappEnabled: false } });
      await writeAudit(tx, userContext(sub.userId), { category: "TENANT", organizationId, action: "briefing.whatsapp_stopped", resourceType: "briefing_subscription", resourceId: sub.id, newValue: { companyId } });
    });
    return finish("stopped", sub.userId, "stop", t("briefing.whatsapp.stopped"));
  }
  if (cmd.kind === "help") return finish("help", sub.userId, "help", t("briefing.whatsapp.help"));

  const token = await db().briefingActionToken.findFirst({ where: { organizationId, companyId, userId: sub.userId, ref: cmd.ref, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!token) return finish("no_token", sub.userId, `${cmd.decision} ${cmd.ref}`, t("briefing.whatsapp.unknownRef", { ref: cmd.ref }));
  const approval = await db().approval.findFirst({ where: { id: token.approvalId, organizationId, companyId }, select: { summary: true, risk: true, autonomy: true, status: true } });
  if (!approval || approval.status !== "PENDING") return finish("decided", sub.userId, `${cmd.decision} ${cmd.ref}`, t("briefing.whatsapp.alreadyDecided", { ref: cmd.ref }));
  if (cmd.decision === "approve" && (approval.risk === "HIGH" || approval.risk === "CRITICAL" || approval.autonomy === "FOUNDER_ONLY")) {
    return finish("needs_mfa", sub.userId, `${cmd.decision} ${cmd.ref}`, t("briefing.whatsapp.needsMfa", { ref: cmd.ref, link: `${env().APP_URL.replace(/\/+$/, "")}/${closestLocale(sub.locale)}/approvals` }));
  }
  const ctx = { ...userContext(sub.userId), requestId: systemContext().requestId };
  try {
    const r = await decideTokenRow(ctx, token, cmd.decision, undefined, "whatsapp");
    const key = r.status === "REJECTED" ? "briefing.whatsapp.rejected" : "briefing.whatsapp.approved";
    return finish(r.status.toLowerCase(), sub.userId, `${cmd.decision} ${cmd.ref}`, t(key, { summary: approval.summary.slice(0, 200) }));
  } catch (err) {
    const message = isAppError(err) ? err.message : "error";
    logger.info({ companyId, ref: cmd.ref, err: message }, "briefing whatsapp decision refused");
    return finish("refused", sub.userId, `${cmd.decision} ${cmd.ref}`, t("briefing.whatsapp.failed", { ref: cmd.ref, reason: message.slice(0, 200) }));
  }
}
