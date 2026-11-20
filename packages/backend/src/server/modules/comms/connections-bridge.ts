import { getConnection as getIntegrationConnection } from "@/server/modules/integrations/connections";
/**
 * Provider connections come from the Integrations module (credentials encrypted at rest). Contract:
 * `getConnection(organizationId, companyId, providerKey)` from "@/server/modules/integrations/connections".
 *
 * Provider keys used by Communication: "gmail", "outlook" (Microsoft 365 mail), "slack", "microsoft_teams",
 * "google_calendar", "outlook_calendar".
 * Config used: slack → { channel }; microsoft_teams → { teamId, channelId }; others need only the access token.
 */
export interface ProviderConnection {
  id: string;
  provider: string;
  accessToken: string | null;
  config: Record<string, unknown>;
  status: "CONNECTED" | "ERROR" | "DISCONNECTED";
}

export const COMMS_PROVIDERS = ["gmail", "outlook", "slack", "microsoft_teams", "google_calendar", "outlook_calendar"] as const;
export type CommsProvider = (typeof COMMS_PROVIDERS)[number];

/** Comms feature → Integrations provider (one Google / Microsoft connection covers mail, calendar and Teams). */
const INTEGRATION_PROVIDER: Record<CommsProvider, string> = {
  gmail: "google",
  google_calendar: "google",
  outlook: "microsoft",
  outlook_calendar: "microsoft",
  microsoft_teams: "microsoft",
  slack: "slack",
};

/** The company's connection for a comms feature, from the Integrations module (fresh token, refreshed when near expiry). */
export async function getConnection(organizationId: string, companyId: string, providerKey: CommsProvider): Promise<ProviderConnection | null> {
  const c = await getIntegrationConnection(organizationId, companyId, INTEGRATION_PROVIDER[providerKey]);
  return c ? { ...c, provider: providerKey } : null;
}

export async function activeConnection(organizationId: string, companyId: string, providerKey: CommsProvider) {
  const c = await getConnection(organizationId, companyId, providerKey);
  return c && c.status === "CONNECTED" && c.accessToken ? (c as ProviderConnection & { accessToken: string }) : null;
}

/** Connected-or-not for every provider (settings and UI notices). */
export async function connectionStatuses(organizationId: string, companyId: string) {
  const out = {} as Record<CommsProvider, "CONNECTED" | "ERROR" | "DISCONNECTED">;
  for (const p of COMMS_PROVIDERS) {
    const c = await getConnection(organizationId, companyId, p);
    out[p] = c ? (c.status === "CONNECTED" && !c.accessToken ? "ERROR" : c.status) : "DISCONNECTED";
  }
  return out;
}
