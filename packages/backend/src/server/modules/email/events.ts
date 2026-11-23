import { createHmac } from "node:crypto";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import { toJson } from "@/server/core/json";
import { safeEqual } from "@/server/core/crypto";
import { logger } from "@/server/core/logger";
import { securityEvent } from "@/server/core/telemetry";
import { suppressAddress } from "./suppression";

/**
 * Platform email provider webhooks (POST /api/v1/webhooks/email/<provider>, user app): Resend (Svix signature) and
 * Postmark (HTTP Basic credentials on the webhook URL). Each verified event becomes one `email_events` row
 * (deduplicated on provider, provider message id, type and time) linked to its `email_messages` row by the provider
 * message id. Hard bounces and complaints add the address to `email_suppressions`.
 *
 * Truthfulness: `email_messages.status = SENT` only means the provider accepted the message. "Delivered" is claimed only
 * from a `delivered` event here.
 */

export const EMAIL_WEBHOOK_PROVIDERS = ["resend", "postmark"] as const;
export type EmailWebhookProvider = (typeof EMAIL_WEBHOOK_PROVIDERS)[number];
export const isEmailWebhookProvider = (p: string): p is EmailWebhookProvider => (EMAIL_WEBHOOK_PROVIDERS as readonly string[]).includes(p);

export type EmailEventType = "delivered" | "bounced" | "complained" | "opened" | "clicked" | "deferred";

export interface ParsedEmailEvent {
  type: EmailEventType;
  providerMessageId: string | null;
  recipient: string;
  occurredAt: Date;
  /** Hard (permanent) bounce: the address is suppressed. */
  hard: boolean;
  detail: Record<string, unknown>;
}

const secretFor = (p: EmailWebhookProvider) => process.env[p === "resend" ? "EMAIL_WEBHOOK_SECRET_RESEND" : "EMAIL_WEBHOOK_SECRET_POSTMARK"]?.trim() || null;
export const emailWebhookConfigured = (p: EmailWebhookProvider) => !!secretFor(p);

const SVIX_TOLERANCE_S = 5 * 60;

/** Svix (Resend) signature: base64 HMAC-SHA256 of `${id}.${timestamp}.${body}` with the base64 secret after "whsec_". */
export function verifySvix(secret: string, headers: Headers, body: string, nowS = Math.floor(Date.now() / 1000)): boolean {
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sigs = headers.get("svix-signature");
  if (!id || !ts || !sigs || !/^\d{1,12}$/.test(ts)) return false;
  if (Math.abs(nowS - Number(ts)) > SVIX_TOLERANCE_S) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return sigs.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    return version === "v1" && !!sig && safeEqual(sig, expected);
  });
}

/** Postmark: `Authorization: Basic base64(user:password)` must equal the configured credentials. */
export function verifyPostmarkBasic(secret: string, headers: Headers): boolean {
  const auth = headers.get("authorization") ?? "";
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(auth);
  if (!m) return false;
  return safeEqual(Buffer.from(m[1]!, "base64").toString("utf8"), secret);
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const date = (v: unknown) => {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : new Date();
};

/** Resend event → normalized event (null for types that are not tracked, e.g. email.sent). */
export function parseResend(body: unknown): ParsedEmailEvent | null {
  const e = (body ?? {}) as { type?: string; created_at?: string; data?: Record<string, unknown> };
  const data = e.data ?? {};
  const map: Record<string, EmailEventType> = { "email.delivered": "delivered", "email.bounced": "bounced", "email.complained": "complained", "email.opened": "opened", "email.clicked": "clicked", "email.delivery_delayed": "deferred" };
  const type = map[e.type ?? ""];
  if (!type) return null;
  const to = Array.isArray(data.to) ? data.to : [data.to];
  const recipient = str(to[0])?.toLowerCase();
  if (!recipient) return null;
  const bounce = (data.bounce ?? {}) as { type?: string; subType?: string; message?: string };
  const hard = type === "bounced" && !/transient|temporary|soft/i.test(`${bounce.type ?? ""} ${bounce.subType ?? ""}`);
  return { type, providerMessageId: str(data.email_id), recipient, occurredAt: date(e.created_at ?? data.created_at), hard, detail: { event: e.type, ...(type === "bounced" ? { bounceType: bounce.type ?? null, bounceSubType: bounce.subType ?? null, message: str(bounce.message)?.slice(0, 300) ?? null } : {}) } };
}

/** Postmark webhook (RecordType) → normalized event. */
export function parsePostmark(body: unknown): ParsedEmailEvent | null {
  const e = (body ?? {}) as Record<string, unknown>;
  const record = str(e.RecordType);
  const map: Record<string, EmailEventType> = { Delivery: "delivered", Bounce: "bounced", SpamComplaint: "complained", Open: "opened", Click: "clicked" };
  let type = record ? map[record] : undefined;
  if (!type) return null;
  const bounceType = str(e.Type);
  // Postmark reports soft bounces and delays as Bounce records with Type SoftBounce / Transient.
  if (type === "bounced" && bounceType && /^(SoftBounce|Transient|DnsError)$/.test(bounceType)) type = "deferred";
  const recipient = (str(e.Recipient) ?? str(e.Email))?.toLowerCase();
  if (!recipient) return null;
  const at = e.DeliveredAt ?? e.BouncedAt ?? e.ReceivedAt ?? e.FirstOpen ?? null;
  const hard = type === "bounced" && (bounceType === "HardBounce" || bounceType === "BadEmailAddress" || bounceType === "ManuallyDeactivated" || bounceType === null);
  return { type, providerMessageId: str(e.MessageID), recipient, occurredAt: date(at), hard, detail: { record, ...(bounceType ? { bounceType } : {}), ...(str(e.Description) ? { message: str(e.Description)!.slice(0, 300) } : {}) } };
}

/**
 * Verify and store one provider webhook. Throws `unauthenticated` (401) for a missing/invalid signature and
 * `not_configured` when the provider's secret is unset (the endpoint never accepts unsigned events).
 */
export async function receiveEmailWebhook(provider: EmailWebhookProvider, raw: string, headers: Headers): Promise<{ stored: boolean; type: EmailEventType | null; suppressed: boolean }> {
  const secret = secretFor(provider);
  if (!secret) throw new AppError("not_configured", "Email webhook secret is not configured", { reason: "email_webhook_not_configured" });
  const valid = provider === "resend" ? verifySvix(secret, headers, raw) : verifyPostmarkBasic(secret, headers);
  if (!valid) {
    securityEvent("email_webhook.signature_rejected", { provider });
    throw new AppError("unauthenticated", "Invalid webhook signature");
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new AppError("validation_error", "Body must be JSON");
  }
  const event = provider === "resend" ? parseResend(body) : parsePostmark(body);
  if (!event) return { stored: false, type: null, suppressed: false };
  const message = event.providerMessageId ? await db().emailMessage.findFirst({ where: { provider, providerMessageId: event.providerMessageId }, select: { id: true } }) : null;
  const created = await db().emailEvent.createMany({
    data: [{ provider, providerMessageId: event.providerMessageId, type: event.type, recipient: event.recipient, occurredAt: event.occurredAt, emailMessageId: message?.id ?? null, detail: toJson(event.detail) }],
    skipDuplicates: true,
  });
  let suppressed = false;
  if (created.count && ((event.type === "bounced" && event.hard) || event.type === "complained")) {
    suppressed = await suppressAddress(event.recipient, event.type === "complained" ? "complaint" : "hard_bounce", `${provider}:${event.providerMessageId ?? "unknown"}`);
    logger.info({ provider, type: event.type }, "email address suppressed after provider event");
  }
  return { stored: created.count > 0, type: event.type, suppressed };
}
