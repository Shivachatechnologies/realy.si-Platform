import "server-only";
import { providerFetch } from "../client";
import { ensureOk, str, withFallback, type ServiceResult } from "./common";

/**
 * Calendly adapter: event types and single-use scheduling links. Webhook subscriptions (invitee.created / canceled →
 * CRM meetings) are managed by the connection lifecycle (../lifecycle.ts) and received in ../provider-webhooks.ts.
 */

const API = "https://api.calendly.com";

export interface CalendlyEventType {
  uri: string;
  name: string;
  durationMinutes: number | null;
  schedulingUrl: string | null;
  active: boolean;
}

export async function listCalendlyEventTypes(organizationId: string, companyId: string): Promise<ServiceResult<CalendlyEventType[]>> {
  return withFallback(organizationId, companyId, ["calendly"], async (conn) => {
    const user = str(conn.config.userUri);
    if (!user) throw new Error("Calendly user unknown; run a connection test");
    const res = await providerFetch<{ collection?: { uri: string; name?: string; duration?: number; scheduling_url?: string; active?: boolean }[] }>(conn, `${API}/event_types?${new URLSearchParams({ user, count: "100" })}`, { retries: 2 });
    ensureOk(res, "Calendly event types");
    return (res.data?.collection ?? []).map((e) => ({ uri: e.uri, name: e.name ?? "Event", durationMinutes: e.duration ?? null, schedulingUrl: e.scheduling_url ?? null, active: e.active !== false }));
  });
}

/** A single-use booking link for one event type (what an agent sends a prospect to book a meeting). */
export async function createCalendlySchedulingLink(organizationId: string, companyId: string, eventTypeUri: string): Promise<ServiceResult<{ bookingUrl: string }>> {
  if (!/^https:\/\/api\.calendly\.com\/event_types\/[A-Za-z0-9-]{8,64}$/.test(eventTypeUri)) return { ok: false, code: "invalid_input", error: "Invalid Calendly event type", providerId: null, attempts: [] };
  return withFallback(organizationId, companyId, ["calendly"], async (conn) => {
    const res = await providerFetch<{ resource?: { booking_url?: string } }>(conn, `${API}/scheduling_links`, { json: { max_event_count: 1, owner: eventTypeUri, owner_type: "EventType" }, retries: 1 });
    ensureOk(res, "Calendly scheduling link");
    const url = res.data?.resource?.booking_url;
    if (!url) throw new Error("Calendly returned no booking URL");
    return { bookingUrl: url };
  });
}
