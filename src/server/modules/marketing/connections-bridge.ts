import { activeAccount, getConnection, type Connection } from "@/server/modules/integrations/connections";

/** An Integrations connection (src/server/modules/integrations/connections.ts → getConnection). */
export type ProviderConnection = Connection;

/** Integrations provider keys used by marketing. */
export const SOCIAL_PROVIDER_KEYS = {
  LINKEDIN: "linkedin",
  X: "x",
  INSTAGRAM: "instagram",
  FACEBOOK: "facebook",
  YOUTUBE: "youtube",
  TIKTOK: "tiktok",
  THREADS: "threads",
  PINTEREST: "pinterest",
} as const;

/** The company's connection for a provider, from the Integrations module (fresh token, refreshed when near expiry). */
export async function getMarketingConnection(organizationId: string, companyId: string, providerKey: string): Promise<ProviderConnection | null> {
  return getConnection(organizationId, companyId, providerKey);
}

export const isUsable = (c: ProviderConnection | null): c is ProviderConnection & { accessToken: string } => !!c && c.status === "CONNECTED" && !!c.accessToken;

/**
 * Sub-account id to act on: the record's own external id when set, else the connection's selected sub-account
 * (Integrations activeAccount: page, channel, ad account, board, site), else the given config keys.
 */
export function accountIdFor(c: ProviderConnection, explicit: string | null | undefined, ...configKeys: string[]): string | null {
  if (explicit) return explicit;
  const active = activeAccount(c);
  if (active?.id) return active.id;
  for (const k of configKeys) {
    const v = c.config[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

/** Sub-accounts a connection exposes (pages, boards, channels, organizations): connection.config.accounts = [{ id, name }]. */
export function connectionAccounts(c: ProviderConnection | null): { id: string; name: string }[] {
  const raw = c?.config.accounts;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => (a && typeof a === "object" ? (a as Record<string, unknown>) : {}))
    .filter((a) => typeof a.id === "string" || typeof a.id === "number")
    .map((a) => ({ id: String(a.id), name: typeof a.name === "string" && a.name ? a.name : String(a.id) }))
    .slice(0, 200);
}
