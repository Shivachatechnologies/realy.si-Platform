import type { RequestContext } from "@/server/core/context";
import { can } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { aiSearch } from "./providers/ai";
import { billingSearch } from "./providers/billing";
import { opsSearch } from "./providers/ops";
import { peopleSearch } from "./providers/people";
import { platformSearch } from "./providers/platform";
import type { SearchProvider } from "./types";

/**
 * Global admin search (stream A): runs every stream's provider (`./providers/*.ts`) in parallel and merges their
 * result groups. Each group appears only when the admin may read it. Streams register a new group by editing ONLY
 * their own provider file; the provider list below is fixed (one entry per stream).
 */
const PROVIDERS = [peopleSearch, aiSearch, billingSearch, opsSearch, platformSearch] as const;

type Merge<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
type ProviderResult<P> = P extends SearchProvider<infer T> ? T : never;
export type AdminSearchGroups = Merge<ProviderResult<(typeof PROVIDERS)[number]>>;
export type AdminSearchResult = { q: string } & AdminSearchGroups;

async function runProvider<T extends Record<string, unknown[]>>(ctx: RequestContext, p: SearchProvider<T>, q: string): Promise<T> {
  const allowed = await Promise.all(p.perms.map((perm) => can(ctx, perm, platformChain())));
  return allowed.some(Boolean) ? p.search(ctx, q) : p.empty;
}

export async function adminSearch(ctx: RequestContext, rawQ: string): Promise<AdminSearchResult> {
  const q = rawQ.trim().slice(0, 200);
  const empty = Object.assign({ q }, ...PROVIDERS.map((p) => p.empty)) as AdminSearchResult;
  if (q.length < 2) return empty;
  const parts = await Promise.all(PROVIDERS.map((p) => runProvider(ctx, p as SearchProvider<Record<string, unknown[]>>, q)));
  return Object.assign({ q }, ...PROVIDERS.map((p) => p.empty), ...parts) as AdminSearchResult;
}
