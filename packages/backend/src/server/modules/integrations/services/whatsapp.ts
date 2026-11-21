import "server-only";
import { createHmac } from "node:crypto";
import { hmacSha256, safeEqual } from "@/server/core/crypto";
import { providerFetch } from "../client";
import { FLAT_COST_MICROS, recordUsage } from "../usage";
import { ensureOk, errorText, str, usableConnection, type ServiceResult } from "./common";
import type { SentMessage } from "./messaging";

/**
 * WhatsApp helpers beyond plain text sending (./messaging.ts → sendWhatsApp): which provider a company can use,
 * approved template messages (needed outside WhatsApp's 24-hour customer service window), and verification + parsing
 * of inbound messages from Twilio (X-Twilio-Signature) and the WhatsApp Business Cloud API (X-Hub-Signature-256).
 * Additive: other modules may use these for any inbound/outbound WhatsApp feature.
 */

export type WhatsAppProvider = "twilio" | "whatsapp";

/** The provider sendWhatsApp would use, with its sender, or null when none is connected and configured. */
export async function whatsappChannel(organizationId: string, companyId: string): Promise<{ provider: WhatsAppProvider; sender: string; accountSid?: string; authToken?: string } | null> {
  const twilio = await usableConnection(organizationId, companyId, "twilio");
  const from = twilio ? str(twilio.config.whatsappFrom) : null;
  const sid = twilio ? str(twilio.config.accountSid) : null;
  if (twilio && from && sid) return { provider: "twilio", sender: from, accountSid: sid, authToken: twilio.accessToken };
  const meta = await usableConnection(organizationId, companyId, "whatsapp");
  const phoneId = meta ? str(meta.config.phoneNumberId) : null;
  if (meta && phoneId) return { provider: "whatsapp", sender: phoneId };
  return null;
}

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Send an approved template message. Meta: `templateName` + `language` with body parameters; Twilio: a Content
 * template (`contentSid`, HX…) with numbered variables. Returns not_connected when the provider or template is missing.
 */
export async function sendWhatsAppTemplate(
  organizationId: string,
  companyId: string,
  input: { to: string; variables: string[]; metaTemplate?: { name: string; language: string } | null; twilioContentSid?: string | null },
): Promise<ServiceResult<SentMessage>> {
  if (!E164.test(input.to)) return { ok: false, code: "invalid_input", error: "Recipient must be an E.164 phone number", providerId: null, attempts: [] };
  const vars = input.variables.map((v) => v.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").slice(0, 1000));
  const channel = await whatsappChannel(organizationId, companyId);
  if (!channel) return { ok: false, code: "not_connected", error: "Connect WhatsApp Business or a Twilio WhatsApp sender", providerId: null, attempts: [] };

  if (channel.provider === "twilio") {
    const conn = (await usableConnection(organizationId, companyId, "twilio"))!;
    if (!input.twilioContentSid || !/^HX[a-f0-9]{32}$/.test(input.twilioContentSid)) return { ok: false, code: "not_connected", error: "No approved Twilio content template configured", providerId: "twilio", attempts: [] };
    const form: Record<string, string> = { To: `whatsapp:${input.to}`, ContentSid: input.twilioContentSid, ContentVariables: JSON.stringify(Object.fromEntries(vars.map((v, i) => [String(i + 1), v]))) };
    if (channel.sender.startsWith("MG")) form.MessagingServiceSid = channel.sender;
    else form.From = `whatsapp:${channel.sender}`;
    try {
      const res = await providerFetch<{ sid?: string; status?: string }>(conn, `https://api.twilio.com/2010-04-01/Accounts/${channel.accountSid}/Messages.json`, { form, retries: 1 });
      ensureOk(res, "Twilio template message");
      if (!res.data?.sid) throw new Error("Twilio returned no message SID");
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "twilio", operation: "whatsapp.template", units: 1, unit: "message", estimatedCostMicros: FLAT_COST_MICROS["twilio.whatsapp"] ?? 0, status: "SUCCEEDED", meta: { messageSid: res.data.sid } });
      return { ok: true, providerId: "twilio", attempts: [{ providerId: "twilio", outcome: "ok" }], data: { messageId: res.data.sid, status: res.data.status ?? "queued" } };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "twilio", operation: "whatsapp.template", units: 0, unit: "message", status: "FAILED", error: errorText(err) });
      return { ok: false, code: "provider_error", error: errorText(err), providerId: "twilio", attempts: [{ providerId: "twilio", outcome: "error", error: errorText(err) }] };
    }
  }

  const conn = (await usableConnection(organizationId, companyId, "whatsapp"))!;
  const tpl = input.metaTemplate;
  if (!tpl || !/^[a-z0-9_]{1,512}$/.test(tpl.name) || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(tpl.language)) return { ok: false, code: "not_connected", error: "No approved WhatsApp template configured", providerId: "whatsapp", attempts: [] };
  try {
    const res = await providerFetch<{ messages?: { id?: string; message_status?: string }[] }>(conn, `https://graph.facebook.com/v21.0/${channel.sender}/messages`, {
      json: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to.slice(1),
        type: "template",
        template: { name: tpl.name, language: { code: tpl.language }, ...(vars.length ? { components: [{ type: "body", parameters: vars.map((text) => ({ type: "text", text })) }] } : {}) },
      },
      retries: 1,
    });
    ensureOk(res, "WhatsApp template message");
    const msg = res.data?.messages?.[0];
    if (!msg?.id) throw new Error("WhatsApp returned no message id");
    await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "whatsapp", operation: "whatsapp.template", units: 1, unit: "message", estimatedCostMicros: null, status: "SUCCEEDED", meta: { messageId: msg.id } });
    return { ok: true, providerId: "whatsapp", attempts: [{ providerId: "whatsapp", outcome: "ok" }], data: { messageId: msg.id, status: msg.message_status ?? "accepted" } };
  } catch (err) {
    await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "whatsapp", operation: "whatsapp.template", units: 0, unit: "message", status: "FAILED", error: errorText(err) });
    return { ok: false, code: "provider_error", error: errorText(err), providerId: "whatsapp", attempts: [{ providerId: "whatsapp", outcome: "error", error: errorText(err) }] };
  }
}

// ───────────── Inbound ─────────────

export interface InboundWhatsApp {
  /** Provider message id (dedupe key). */
  messageId: string;
  /** Sender in E.164 (+15551234567). */
  from: string;
  text: string;
}

/**
 * Twilio request validation (https://www.twilio.com/docs/usage/security#validating-requests): base64 HMAC-SHA1 with
 * the account's auth token over the full public URL followed by every POST parameter (sorted by name) as name+value.
 */
export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | null): boolean {
  if (!signature || !authToken) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  return safeEqual(expected, signature.trim());
}

/** Meta webhook validation: X-Hub-Signature-256 = "sha256=" + hex HMAC-SHA256(app secret, raw body). */
export function verifyMetaSignature(appSecret: string, raw: string, header: string | null): boolean {
  const sig = (header ?? "").trim().replace(/^sha256=/i, "").toLowerCase();
  return !!sig && !!appSecret && safeEqual(sig, hmacSha256(appSecret, raw).toString("hex"));
}

const toE164 = (v: string) => {
  const digits = v.replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
  const e = digits.startsWith("+") ? digits : `+${digits}`;
  return E164.test(e) ? e : null;
};

/** A Twilio inbound WhatsApp message (form fields), or null for status callbacks and non-WhatsApp messages. */
export function parseTwilioInbound(params: Record<string, string>): InboundWhatsApp | null {
  const sid = params.MessageSid ?? params.SmsMessageSid;
  if (!sid || !/^(SM|MM)[a-f0-9]{32}$/.test(sid) || !/^whatsapp:/i.test(params.From ?? "")) return null;
  const from = toE164(params.From!);
  const text = params.ButtonPayload || params.ButtonText || params.Body || "";
  return from ? { messageId: sid, from, text: text.slice(0, 500) } : null;
}

/** Text (and quick-reply button) messages of a WhatsApp Cloud API webhook body; statuses and other types are skipped. */
export function parseMetaInbound(body: unknown): { phoneNumberId: string | null; messages: InboundWhatsApp[] } {
  const out: InboundWhatsApp[] = [];
  let phoneNumberId: string | null = null;
  const entries = (body as { entry?: unknown[] } | null)?.entry;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    for (const change of Array.isArray(changes) ? changes : []) {
      const value = (change as { value?: Record<string, unknown> })?.value ?? {};
      const meta = value.metadata as { phone_number_id?: unknown } | undefined;
      if (typeof meta?.phone_number_id === "string") phoneNumberId = meta.phone_number_id;
      const msgs = value.messages;
      for (const m of Array.isArray(msgs) ? (msgs as Record<string, unknown>[]) : []) {
        const id = typeof m.id === "string" ? m.id : null;
        const from = typeof m.from === "string" ? toE164(m.from) : null;
        let text = "";
        if (m.type === "text") text = String((m.text as { body?: unknown })?.body ?? "");
        else if (m.type === "button") text = String((m.button as { payload?: unknown; text?: unknown })?.payload ?? (m.button as { text?: unknown })?.text ?? "");
        else if (m.type === "interactive") {
          const i = m.interactive as { button_reply?: { id?: unknown; title?: unknown }; list_reply?: { id?: unknown } } | undefined;
          text = String(i?.button_reply?.id ?? i?.button_reply?.title ?? i?.list_reply?.id ?? "");
        }
        if (id && from && text) out.push({ messageId: id.slice(0, 200), from, text: text.slice(0, 500) });
      }
    }
  }
  return { phoneNumberId, messages: out };
}

/** TwiML reply for Twilio's webhook response (escaped). */
export function twimlMessage(text: string | null): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${text ? `<Message>${esc(text.slice(0, 1600))}</Message>` : ""}</Response>`;
}
