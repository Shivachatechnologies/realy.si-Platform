import "server-only";
import { createHash } from "node:crypto";
import { forbidden } from "@/server/core/errors";
import { isIntegrationEnabled } from "@/server/core/platform-controls";
import { isPlatformManaged, PLATFORM_MANAGED_PROVIDERS, platformCredentialFields, providerInfo } from "./catalog";
import type { Connection } from "./connections";

/**
 * Platform-managed providers (docs/integrations.md "Platform-managed providers"): AI, research, creative, voice, video
 * and telephony providers run on the platform's own account. Their credentials are platform keys set in
 * Admin → Platform keys (core/platform-secrets.ts overlays them onto process.env, ~30 s refresh); a company's own
 * connection rows for these providers are kept in the database but never read.
 *
 * A "platform connection" is the Connection shape every provider service already uses, built from those keys and
 * scoped to one organization + company, so plan meters (providerFetch → api.cost.month), integration usage and the
 * cost ledger stay attributed to the tenant. It has no database row: request-log and health writes are skipped.
 */

const value = (key: string) => {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
};

/** Platform key values of a provider: field key → value (only set ones). Never returned to clients. */
export function platformProviderValues(provider: string): Record<string, string> {
  const info = providerInfo(provider);
  if (!info) return {};
  const out: Record<string, string> = {};
  for (const f of platformCredentialFields(info)) {
    const v = value(f.envKey);
    if (v !== undefined) out[f.key] = v;
  }
  return out;
}

/** True when every required platform key of the provider has a value (it is "Available" to customers). */
export function isPlatformProviderConfigured(provider: string): boolean {
  const info = providerInfo(provider);
  if (!info || !isPlatformManaged(provider)) return false;
  return platformCredentialFields(info).every((f) => !f.required || value(f.envKey) !== undefined);
}

export type PlatformAvailability = "available" | "awaiting_platform" | "disabled";

/** Customer-facing availability of a platform-managed provider (no secret is read into the result). */
export async function platformAvailability(provider: string): Promise<PlatformAvailability> {
  if (!(await isIntegrationEnabled(provider))) return "disabled";
  return isPlatformProviderConfigured(provider) ? "available" : "awaiting_platform";
}

/** Availability of every platform-managed provider. */
export async function platformAvailabilityMap(): Promise<Record<string, PlatformAvailability>> {
  const out: Record<string, PlatformAvailability> = {};
  for (const p of PLATFORM_MANAGED_PROVIDERS) out[p] = await platformAvailability(p);
  return out;
}

/** Stable UUID of a company's platform connection to a provider (rate-limit key, circuit breaker, usage rows). */
export function platformConnectionId(provider: string, companyId: string): string {
  const h = createHash("sha256").update(`realy.platform-connection:${provider}:${companyId}`).digest("hex");
  // RFC 4122 layout, version 8 (custom), variant 10.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/**
 * The platform connection of a company to a platform-managed provider, or null when the platform has not configured
 * it (callers then report the honest "not available yet" state). Callers authorize the tenant first.
 */
export function platformConnection(organizationId: string, companyId: string, provider: string): Connection | null {
  if (!isPlatformManaged(provider) || !isPlatformProviderConfigured(provider)) return null;
  const values = platformProviderValues(provider);
  const { apiKey, ...config } = values;
  return { id: platformConnectionId(provider, companyId), provider, accessToken: apiKey ?? null, config, status: "CONNECTED", organizationId, companyId, platform: true };
}

/** Customer-facing endpoints that would store or change credentials of a platform-managed provider refuse with 403. */
export function assertNotPlatformManaged(provider: string): void {
  if (isPlatformManaged(provider)) {
    throw forbidden("This provider is managed by the platform. Customers cannot connect it or enter keys for it.", { reason: "integrations_platform_managed", provider });
  }
}

/** The given platform-managed providers that customers can use right now (configured and not switched off), in order. */
export async function availablePlatformProviders<P extends string>(providers: readonly P[]): Promise<P[]> {
  const out: P[] = [];
  for (const p of providers) if ((await platformAvailability(p)) === "available") out.push(p);
  return out;
}
