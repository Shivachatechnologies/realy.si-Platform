import "server-only";
import { isPlatformManaged, platformCredentialFields, providerInfo } from "@/server/modules/integrations/catalog";
import { IMAGE_PROVIDERS } from "@/server/modules/integrations/services/images";
import { SOCIAL_PROVIDER_KEYS } from "./connections-bridge";
import type { MarketingSocialProvider } from "@/generated/prisma/enums";

/**
 * Which platform key each marketing / creative capability needs (docs/platform-keys.md). Customers never enter provider
 * keys: creative, research, voice and video providers run on Realy's keys (Admin → Platform keys), social platforms
 * need Realy's OAuth app keys plus the customer's own Connect. This module only reports key NAMES — never values — so
 * the UI and the AI can say exactly what is missing instead of failing vaguely.
 */

const hasValue = (key: string) => {
  const v = process.env[key];
  return !!v && !!v.trim();
};

/** Platform key names a provider needs: required platform-managed fields, else the OAuth app's env vars. */
export function platformKeysOf(provider: string): string[] {
  const info = providerInfo(provider);
  if (!info) return [];
  if (isPlatformManaged(provider)) return platformCredentialFields(info).filter((f) => f.required).map((f) => f.envKey);
  return [...info.envVars];
}

/** The provider's platform keys that have no value right now (names only). */
export const missingPlatformKeys = (provider: string) => platformKeysOf(provider).filter((k) => !hasValue(k));

/**
 * The platform-key options that would enable one of these providers, e.g. ["OPENAI_API_KEY", "STABILITY_API_KEY",
 * "KLING_ACCESS_KEY + KLING_SECRET_KEY"]. Empty when some provider already has all its keys (then it is unavailable for
 * another reason: turned off by the platform or for the organization).
 */
export function platformKeyOptions(providers: readonly string[]): string[] {
  const opts = providers.map((p) => missingPlatformKeys(p));
  if (!opts.length || opts.some((k) => !k.length)) return [];
  return [...new Set(opts.map((k) => k.join(" + ")))];
}

/** Platform keys of the OAuth app behind each social platform that have no value (empty when Realy's app is set up). */
export function socialMissingKeys(): Record<MarketingSocialProvider, string[]> {
  return Object.fromEntries(Object.entries(SOCIAL_PROVIDER_KEYS).map(([p, key]) => [p, missingPlatformKeys(key)])) as Record<MarketingSocialProvider, string[]>;
}

/** One sentence for the AI (and errors) when no image provider is available. */
export function imageProvidersMissingText(): string {
  const options = platformKeyOptions(IMAGE_PROVIDERS);
  if (!options.length) return "image generation is turned off for this organization or platform; ask the Realy team to enable it.";
  return `no image provider is available. The Realy team must set one of these platform keys in Admin → Platform keys: ${options.join(" or ")}.`;
}
