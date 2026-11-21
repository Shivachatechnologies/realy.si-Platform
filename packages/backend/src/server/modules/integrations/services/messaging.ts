import "server-only";
import { providerFetch } from "../client";
import { providerWebhookUrl } from "../provider-webhooks";
import { FLAT_COST_MICROS, recordUsage } from "../usage";
import { ensureOk, errorText, str, usableConnection, type ServiceResult } from "./common";

/**
 * SMS (Twilio) and WhatsApp (Twilio WhatsApp sender, or the WhatsApp Business Cloud API connection). The status is the
 * provider's own ("queued", "accepted", "sent", "failed"): a message is never reported delivered on our side.
 */

export interface SentMessage {
  messageId: string;
  /** Provider status at acceptance time. */
  status: string;
}

const E164 = /^\+[1-9]\d{6,14}$/;

async function twilioSend(organizationId: string, companyId: string, channel: "sms" | "whatsapp", to: string, body: string): Promise<ServiceResult<SentMessage>> {
  const conn = await usableConnection(organizationId, companyId, "twilio");
  if (!conn) return { ok: false, code: "not_connected", error: "Twilio is not connected", providerId: "twilio", attempts: [{ providerId: "twilio", outcome: "not_connected" }] };
  const sid = str(conn.config.accountSid);
  const from = channel === "sms" ? str(conn.config.fromNumber) : str(conn.config.whatsappFrom);
  if (!sid || !/^AC[a-f0-9]{32}$/.test(sid)) return { ok: false, code: "not_connected", error: "Twilio account SID missing", providerId: "twilio", attempts: [] };
  if (!from) return { ok: false, code: "not_connected", error: channel === "sms" ? "Set a Twilio sender number (or messaging service) on the connection" : "Set a Twilio WhatsApp sender on the connection", providerId: "twilio", attempts: [] };
  // Delivery status (sent / delivered / failed) comes back signed to the connection's provider-webhook URL.
  const form: Record<string, string> = { To: channel === "whatsapp" ? `whatsapp:${to}` : to, Body: body, StatusCallback: providerWebhookUrl("twilio", conn.id) };
  if (from.startsWith("MG")) form.MessagingServiceSid = from;
  else form.From = channel === "whatsapp" ? `whatsapp:${from}` : from;
  const operation = channel === "sms" ? "sms.send" : "whatsapp.send";
  try {
    const res = await providerFetch<{ sid?: string; status?: string; num_segments?: string }>(conn, `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { form, retries: 1 });
    ensureOk(res, "Twilio message");
    if (!res.data?.sid) throw new Error("Twilio returned no message SID");
    const segments = Number(res.data.num_segments ?? 1) || 1;
    await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "twilio", operation, units: segments, unit: "message", estimatedCostMicros: (FLAT_COST_MICROS[`twilio.${channel}`] ?? 0) * segments, status: "SUCCEEDED", meta: { messageSid: res.data.sid } });
    return { ok: true, providerId: "twilio", attempts: [{ providerId: "twilio", outcome: "ok" }], data: { messageId: res.data.sid, status: res.data.status ?? "queued" } };
  } catch (err) {
    await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "twilio", operation, units: 0, unit: "message", status: "FAILED", error: errorText(err) });
    return { ok: false, code: "provider_error", error: errorText(err), providerId: "twilio", attempts: [{ providerId: "twilio", outcome: "error", error: errorText(err) }] };
  }
}

function validate(to: string, body: string): string | null {
  if (!E164.test(to)) return "Recipient must be an E.164 phone number (+15551234567)";
  if (!body.trim()) return "Message is empty";
  if (body.length > 1600) return "Message is too long (max 1600 characters)";
  return null;
}

export async function sendSms(organizationId: string, companyId: string, input: { to: string; body: string }): Promise<ServiceResult<SentMessage>> {
  const bad = validate(input.to, input.body);
  if (bad) return { ok: false, code: "invalid_input", error: bad, providerId: null, attempts: [] };
  return twilioSend(organizationId, companyId, "sms", input.to, input.body);
}

/** WhatsApp text message: Twilio (when a WhatsApp sender is configured) else the WhatsApp Business connection. */
export async function sendWhatsApp(organizationId: string, companyId: string, input: { to: string; body: string }): Promise<ServiceResult<SentMessage>> {
  const bad = validate(input.to, input.body);
  if (bad) return { ok: false, code: "invalid_input", error: bad, providerId: null, attempts: [] };
  const twilio = await usableConnection(organizationId, companyId, "twilio");
  if (twilio && str(twilio.config.whatsappFrom)) return twilioSend(organizationId, companyId, "whatsapp", input.to, input.body);
  const conn = await usableConnection(organizationId, companyId, "whatsapp");
  if (!conn) return { ok: false, code: "not_connected", error: "Connect WhatsApp Business or a Twilio WhatsApp sender", providerId: null, attempts: [{ providerId: "twilio", outcome: "not_connected" }, { providerId: "whatsapp", outcome: "not_connected" }] };
  const phoneId = str(conn.config.phoneNumberId);
  if (!phoneId || !/^\d{5,25}$/.test(phoneId)) return { ok: false, code: "not_connected", error: "WhatsApp phone number id missing", providerId: "whatsapp", attempts: [] };
  try {
    const res = await providerFetch<{ messages?: { id?: string; message_status?: string }[] }>(conn, `https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      json: { messaging_product: "whatsapp", recipient_type: "individual", to: input.to.slice(1), type: "text", text: { body: input.body, preview_url: false } },
      retries: 1,
    });
    ensureOk(res, "WhatsApp message");
    const msg = res.data?.messages?.[0];
    if (!msg?.id) throw new Error("WhatsApp returned no message id");
    await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "whatsapp", operation: "whatsapp.send", units: 1, unit: "message", estimatedCostMicros: null, status: "SUCCEEDED", meta: { messageId: msg.id } });
    return { ok: true, providerId: "whatsapp", attempts: [{ providerId: "whatsapp", outcome: "ok" }], data: { messageId: msg.id, status: msg.message_status ?? "accepted" } };
  } catch (err) {
    await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "whatsapp", operation: "whatsapp.send", units: 0, unit: "message", status: "FAILED", error: errorText(err) });
    return { ok: false, code: "provider_error", error: errorText(err), providerId: "whatsapp", attempts: [{ providerId: "whatsapp", outcome: "error", error: errorText(err) }] };
  }
}
