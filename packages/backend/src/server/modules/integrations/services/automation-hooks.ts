import "server-only";
import { providerFetch } from "../client";
import { signPayload } from "../webhooks";
import { recordUsage } from "../usage";
import { ensureOk, errorText, str, usableConnection, type ServiceResult } from "./common";

/**
 * Trigger a Zapier Zap, Make scenario or n8n workflow: POST a JSON event to the connection's catch-hook URL, signed
 * like Realy's outbound webhooks (x-realy-signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>) when a
 * signing secret is set. Inbound (the tool calling Realy) uses Integrations → Webhooks (incoming hooks).
 * This is an external action: callers gate it (workflow step / SUPERVISED tool).
 */

export const AUTOMATION_PROVIDERS = ["zapier", "make", "n8n"] as const;
export type AutomationProvider = (typeof AUTOMATION_PROVIDERS)[number];

export async function triggerAutomation(
  organizationId: string,
  companyId: string,
  provider: AutomationProvider,
  event: string,
  data: Record<string, unknown>,
): Promise<ServiceResult<{ status: number; deliveryId: string }>> {
  if (!/^[a-z0-9_.-]{1,80}$/.test(event)) return { ok: false, code: "invalid_input", error: "Invalid event name", providerId: null, attempts: [] };
  const conn = await usableConnection(organizationId, companyId, provider);
  if (!conn) return { ok: false, code: "not_connected", error: `${provider} is not connected`, providerId: provider, attempts: [{ providerId: provider, outcome: "not_connected" }] };
  const deliveryId = crypto.randomUUID();
  const body = JSON.stringify({ id: deliveryId, event, sentAt: new Date().toISOString(), companyId, data });
  if (body.length > 256 * 1024) return { ok: false, code: "invalid_input", error: "Payload too large (max 256 KB)", providerId: provider, attempts: [] };
  const secret = str(conn.config.signingSecret);
  try {
    // The connection's "API key" is the catch-hook URL itself (validated on connect).
    const res = await providerFetch(conn, conn.accessToken, {
      raw: body,
      headers: { "content-type": "application/json", "x-realy-event": event, "x-realy-delivery": deliveryId, ...(secret ? { "x-realy-signature": signPayload(secret, body) } : {}) },
      method: "POST",
      noAuth: true,
      retries: 2,
      timeoutMs: 15_000,
    });
    ensureOk(res, `${provider} webhook`);
    await recordUsage({ organizationId, companyId, connectionId: conn.id, provider, operation: "automation.trigger", status: "SUCCEEDED", meta: { event, deliveryId } });
    return { ok: true, data: { status: res.status, deliveryId }, providerId: provider, attempts: [{ providerId: provider, outcome: "ok" }] };
  } catch (err) {
    await recordUsage({ organizationId, companyId, connectionId: conn.id, provider, operation: "automation.trigger", units: 0, status: "FAILED", error: errorText(err), meta: { event } });
    return { ok: false, code: "provider_error", error: errorText(err), providerId: provider, attempts: [{ providerId: provider, outcome: "error", error: errorText(err) }] };
  }
}
