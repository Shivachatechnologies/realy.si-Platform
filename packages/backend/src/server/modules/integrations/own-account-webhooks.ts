import "server-only";
import { systemContext } from "@/server/core/context";
import { hmacSha256, safeEqual } from "@/server/core/crypto";
import { env } from "@/server/core/env";
import { logger } from "@/server/core/logger";
import { consume } from "@/server/core/rate-limit";
import { securityEvent } from "@/server/core/telemetry";
import { connectionForPhoneNumberId, connectionsForRazorpayAccount, connectionsForStripeAccount, markDeauthorized } from "./own-accounts";
import { receiveRoutedProviderEvent } from "./provider-webhooks";
import { verifyHookSignature } from "./webhook-signatures";

/**
 * Platform-level webhooks of the customer's own accounts (docs/integrations.md §7). Realy's platform apps receive one
 * stream for every connected customer; each event is verified with the platform's signing secret (Admin → Platform
 * keys), then routed to the right company by the account id it names:
 *
 *   POST /api/v1/webhooks/stripe-connect   Stripe Connect ("Events on connected accounts"), `account` → stripeAccountId.
 *                                           account.application.deauthorized disconnects the connection.
 *   POST /api/v1/webhooks/razorpay         Razorpay partner webhook, `account_id` → razorpayAccountId.
 *                                           account.app.authorization_revoked disconnects the connection.
 *   GET|POST /api/v1/webhooks/whatsapp     Meta app webhook (WhatsApp Business accounts subscribed at Embedded Signup),
 *                                           each change's `metadata.phone_number_id` → phoneNumberId.
 *
 * Realy's own subscription billing keeps its separate endpoint (/api/v1/webhooks/stripe, STRIPE_WEBHOOK_SECRET).
 * Events for an unknown account are acknowledged (200) and dropped: they must never land in another tenant.
 */

export interface RoutedResult {
  status: number;
  body: Record<string, unknown> | string;
  text?: boolean;
}

const MAX_BODY = 1024 * 1024;
const LIMIT = { name: "own-account-webhook", limit: 1200, windowMs: 60_000 };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const parse = (raw: string): Record<string, unknown> | null => {
  try {
    return obj(JSON.parse(raw));
  } catch {
    return null;
  }
};

async function limited(source: string): Promise<boolean> {
  const r = await consume(LIMIT, source).catch(() => ({ allowed: true }));
  return !r.allowed;
}

// ───────────────────────────── Stripe Connect ─────────────────────────────

export async function receiveStripeConnectWebhook(raw: string, signature: string | null): Promise<RoutedResult> {
  const secret = env().STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) return { status: 501, body: { error: "not_configured" } };
  if (Buffer.byteLength(raw) > MAX_BODY) return { status: 413, body: { error: "payload_too_large" } };
  const headers = new Headers(signature ? { "stripe-signature": signature } : {});
  const v = verifyHookSignature({ verification: "STRIPE", secret, raw, headers, query: new URLSearchParams(), signatureHeader: "", url: "" });
  if (!v.ok) {
    securityEvent("integrations.stripe_connect_signature_invalid", {});
    return { status: 400, body: { error: "invalid_signature" } };
  }
  if (await limited("stripe-connect")) return { status: 429, body: { error: "rate_limited" } };
  const event = parse(raw);
  const account = typeof event?.account === "string" ? event.account : null;
  if (!event || !account) return { status: 200, body: { received: true, routed: 0 } };
  const rows = await connectionsForStripeAccount(account);
  const type = typeof event.type === "string" ? event.type : "unknown";
  if (type === "account.application.deauthorized") {
    for (const row of rows) await markDeauthorized(systemContext(), row, type);
    return { status: 200, body: { received: true, routed: rows.length } };
  }
  try {
    for (const row of rows) await receiveRoutedProviderEvent(row, event, raw);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : "handler failed" }, "stripe connect webhook handler failed");
    return { status: 500, body: { error: "handler_failed" } };
  }
  return { status: 200, body: { received: true, routed: rows.length } };
}

// ───────────────────────────── Razorpay partner ─────────────────────────────

/** X-Razorpay-Signature = hex HMAC-SHA256(webhook secret, raw body). */
export function verifyRazorpaySignature(secret: string, raw: string, signature: string | null): boolean {
  const sig = (signature ?? "").trim().toLowerCase();
  return !!sig && !!secret && safeEqual(sig, hmacSha256(secret, raw).toString("hex"));
}

export async function receiveRazorpayPartnerWebhook(raw: string, signature: string | null): Promise<RoutedResult> {
  const secret = env().RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return { status: 501, body: { error: "not_configured" } };
  if (Buffer.byteLength(raw) > MAX_BODY) return { status: 413, body: { error: "payload_too_large" } };
  if (!verifyRazorpaySignature(secret, raw, signature)) {
    securityEvent("integrations.razorpay_signature_invalid", {});
    return { status: 400, body: { error: "invalid_signature" } };
  }
  if (await limited("razorpay")) return { status: 429, body: { error: "rate_limited" } };
  const event = parse(raw);
  const account = typeof event?.account_id === "string" ? event.account_id : null;
  if (!event || !account) return { status: 200, body: { received: true, routed: 0 } };
  const rows = await connectionsForRazorpayAccount(account);
  const type = typeof event.event === "string" ? event.event : "unknown";
  if (type === "account.app.authorization_revoked") {
    for (const row of rows) await markDeauthorized(systemContext(), row, type);
    return { status: 200, body: { received: true, routed: rows.length } };
  }
  try {
    for (const row of rows) await receiveRoutedProviderEvent(row, event, raw);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : "handler failed" }, "razorpay partner webhook handler failed");
    return { status: 500, body: { error: "handler_failed" } };
  }
  return { status: 200, body: { received: true, routed: rows.length } };
}

// ───────────────────────────── WhatsApp (Meta app) ─────────────────────────────

/** Meta's subscription handshake for the app-level callback URL. */
export function verifyWhatsAppAppSubscription(query: URLSearchParams): RoutedResult {
  const expected = env().WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const token = query.get("hub.verify_token") ?? "";
  if (!expected || query.get("hub.mode") !== "subscribe" || !token || !safeEqual(token, expected)) return { status: 403, body: "", text: true };
  return { status: 200, body: (query.get("hub.challenge") ?? "").slice(0, 200), text: true };
}

/** One routed slice of a WhatsApp webhook: the company's connection and the body holding only its changes. */
export interface RoutedWhatsApp {
  organizationId: string;
  companyId: string;
  connectionId: string;
  phoneNumberId: string;
  body: Record<string, unknown>;
}

/**
 * Split a WhatsApp Business webhook body by phone_number_id: each change goes to the slice of its number, so a body
 * that mixes several businesses can never leak one company's messages into another's.
 */
export function splitWhatsAppByPhoneNumber(body: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    const e = obj(entry);
    for (const change of Array.isArray(e.changes) ? e.changes : []) {
      const id = obj(obj(obj(change).value).metadata).phone_number_id;
      if (typeof id !== "string" || !/^\d{5,25}$/.test(id)) continue;
      const slice = out.get(id) ?? { object: body.object ?? "whatsapp_business_account", entry: [] as unknown[] };
      (slice.entry as unknown[]).push({ id: e.id, changes: [change] });
      out.set(id, slice);
    }
  }
  return out;
}

/**
 * Verify (X-Hub-Signature-256 with WHATSAPP_APP_SECRET), split by phone number, store each slice as a provider event
 * of the company that owns the number, and return the routed slices (the caller hands inbound messages to their
 * consumers, e.g. briefing replies). Numbers no company owns are dropped.
 */
export async function receiveWhatsAppAppWebhook(raw: string, signature: string | null): Promise<{ result: RoutedResult; routed: RoutedWhatsApp[] }> {
  const secret = env().WHATSAPP_APP_SECRET;
  if (!secret) return { result: { status: 501, body: { error: "not_configured" } }, routed: [] };
  if (Buffer.byteLength(raw) > MAX_BODY) return { result: { status: 413, body: { error: "payload_too_large" } }, routed: [] };
  const headers = new Headers(signature ? { "x-hub-signature-256": signature } : {});
  const v = verifyHookSignature({ verification: "META", secret, raw, headers, query: new URLSearchParams(), signatureHeader: "", url: "" });
  if (!v.ok) {
    securityEvent("integrations.whatsapp_signature_invalid", {});
    return { result: { status: 401, body: { error: "unauthenticated" } }, routed: [] };
  }
  if (await limited("whatsapp")) return { result: { status: 429, body: { error: "rate_limited" } }, routed: [] };
  const body = parse(raw);
  if (!body) return { result: { status: 400, body: { error: "invalid_json" } }, routed: [] };
  const routed: RoutedWhatsApp[] = [];
  try {
    for (const [phoneNumberId, slice] of splitWhatsAppByPhoneNumber(body)) {
      const row = await connectionForPhoneNumberId(phoneNumberId);
      if (!row) continue;
      // Dedupe per connection on the slice's own bytes (a retry of the same delivery produces the same slice).
      await receiveRoutedProviderEvent(row, slice, JSON.stringify(slice));
      routed.push({ organizationId: row.organizationId, companyId: row.companyId, connectionId: row.id, phoneNumberId, body: slice });
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : "handler failed" }, "whatsapp app webhook handler failed");
    return { result: { status: 500, body: { error: "handler_failed" } }, routed: [] };
  }
  return { result: { status: 200, body: { received: true, routed: routed.length } }, routed };
}
