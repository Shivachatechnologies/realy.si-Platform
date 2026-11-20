// Marketing email delivery helpers. SendGrid sends go through the core email module (companyEmailProvider →
// sendgridProvider over the Integrations client); Mailchimp Transactional (Mandrill) sends go through the Integrations
// provider client here. Delivery webhooks are verified and parsed below.
import { createHmac, createPublicKey, verify } from "node:crypto";
import type { ProviderConnection } from "../connections-bridge";
import { recordUsage } from "@/server/modules/integrations/usage";
import { call, cfg, ProviderError, str } from "./http";

export const EMAIL_PROVIDERS = ["platform", "sendgrid", "mailchimp"] as const;
export type EmailProviderChoice = (typeof EMAIL_PROVIDERS)[number];

type Conn = ProviderConnection & { accessToken: string };

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
  sendId: string;
  fromName: string;
}

/** Sends one email through Mailchimp Transactional; returns the provider message id. Throws ProviderError when it was not accepted. */
export async function sendViaMailchimp(c: Conn, m: OutgoingEmail): Promise<string> {
  const fromEmail = cfg(c, "fromEmail", "from");
  if (!fromEmail) throw new ProviderError("account_not_configured", "Sender address (fromEmail) missing");
  const fromName = cfg(c, "fromName") ?? m.fromName;
  // Mandrill authenticates with the key in the body.
  const res = await call(c, "https://mandrillapp.com/api/1.0/messages/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    noAuth: true,
    body: JSON.stringify({ key: c.accessToken, message: { subject: m.subject, text: m.text, html: m.html, from_email: fromEmail, from_name: fromName, to: [{ email: m.to, type: "to" }], headers: m.headers, metadata: { sendId: m.sendId } } }),
  });
  const first = (res.json.items as { _id?: string; status?: string; reject_reason?: string }[] | undefined)?.[0];
  const accepted = !!first?._id && first.status !== "rejected" && first.status !== "invalid";
  if (c.organizationId && c.companyId) {
    await recordUsage({ organizationId: c.organizationId, companyId: c.companyId, connectionId: c.id, provider: "mailchimp", operation: "email.send", unit: "message", estimatedCostMicros: null, status: accepted ? "SUCCEEDED" : "FAILED", error: accepted ? null : (first?.reject_reason ?? first?.status ?? "rejected") });
  }
  if (!accepted) throw new ProviderError("provider_rejected", first?.reject_reason ?? first?.status ?? "rejected");
  return first!._id!;
}

export interface DeliveryEvent {
  sendId: string | null;
  messageId: string | null;
  email: string | null;
  type: "bounce" | "complaint" | "unsubscribe" | "open" | "click" | "delivered" | "other";
}

/** SendGrid Signed Event Webhook (ECDSA P-256 over timestamp + raw body). */
export function verifySendgrid(c: Conn | ProviderConnection, rawBody: string, signature: string | null, timestamp: string | null): boolean {
  const key = str(c.config.webhookPublicKey);
  if (!key || !signature || !timestamp) return false;
  try {
    const pub = createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" });
    return verify("sha256", Buffer.from(timestamp + rawBody), { key: pub, dsaEncoding: "der" }, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** Mandrill webhook signature: base64(HMAC-SHA1(key, url + sorted key/value pairs)). */
export function verifyMandrill(c: Conn | ProviderConnection, url: string, params: Record<string, string>, signature: string | null): boolean {
  const key = str(c.config.webhookKey);
  if (!key || !signature) return false;
  const signed = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", key).update(signed).digest("base64") === signature;
}

export function parseSendgridEvents(rawBody: string): DeliveryEvent[] {
  let arr: unknown;
  try {
    arr = JSON.parse(rawBody);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 1000).map((e: Record<string, unknown>) => {
    const ev = String(e.event ?? "");
    const type: DeliveryEvent["type"] = ev === "bounce" || ev === "dropped" ? "bounce" : ev === "spamreport" ? "complaint" : ev === "unsubscribe" || ev === "group_unsubscribe" ? "unsubscribe" : ev === "open" ? "open" : ev === "click" ? "click" : ev === "delivered" ? "delivered" : "other";
    return { sendId: str(e.sendId), messageId: str(e.sg_message_id)?.split(".")[0] ?? null, email: str(e.email), type };
  });
}

export function parseMandrillEvents(eventsJson: string): DeliveryEvent[] {
  let arr: unknown;
  try {
    arr = JSON.parse(eventsJson);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 1000).map((e: Record<string, unknown>) => {
    const ev = String(e.event ?? "");
    const msg = (e.msg ?? {}) as { _id?: string; email?: string; metadata?: { sendId?: string } };
    const type: DeliveryEvent["type"] = ev === "hard_bounce" || ev === "soft_bounce" || ev === "reject" ? "bounce" : ev === "spam" ? "complaint" : ev === "unsub" ? "unsubscribe" : ev === "open" ? "open" : ev === "click" ? "click" : ev === "send" ? "delivered" : "other";
    return { sendId: msg.metadata?.sendId ?? null, messageId: msg._id ?? null, email: msg.email ?? null, type };
  });
}
