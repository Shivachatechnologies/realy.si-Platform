import { getConnection } from "@/server/modules/integrations/connections";

/** Shape of an Integrations connection (contract of src/server/modules/integrations/connections.ts → getConnection). */
export interface ProviderConnection {
  id: string;
  provider: string;
  accessToken: string | null;
  config: Record<string, unknown>;
  status: "CONNECTED" | "ERROR" | "DISCONNECTED";
}

/** Integrations provider keys used by marketing. */
export const SOCIAL_PROVIDER_KEYS = { LINKEDIN: "linkedin", X: "x", INSTAGRAM: "instagram", FACEBOOK: "facebook" } as const;

/** The company's connection for a provider, from the Integrations module (fresh token, refreshed when near expiry). */
export async function getMarketingConnection(organizationId: string, companyId: string, providerKey: string): Promise<ProviderConnection | null> {
  return getConnection(organizationId, companyId, providerKey);
}

export const isUsable = (c: ProviderConnection | null): c is ProviderConnection & { accessToken: string } => !!c && c.status === "CONNECTED" && !!c.accessToken;
