import type { RequestContext } from "@/server/core/context";

/**
 * One global-search provider (stream-owned, `./providers/<stream>.ts`). `perms` lists the platform permissions of
 * which ANY lets the provider run; when the admin holds none, `search` is skipped and `empty` is returned instead.
 * `search` may narrow further per group (e.g. users vs organizations) and returns only its own result keys, which
 * are merged into the `/api/v1/admin/search` response. Keys must be unique across providers.
 */
export interface SearchProvider<T extends Record<string, unknown[]>> {
  /** Stable provider id (the stream's domain: "people", "ai", "billing", "ops", "platform"). */
  group: string;
  perms: readonly string[];
  /** The result keys this provider contributes, each an empty list. */
  empty: T;
  search(ctx: RequestContext, q: string): Promise<T>;
}

export const defineSearchProvider = <T extends Record<string, unknown[]>>(p: SearchProvider<T>) => p;

/** Case-insensitive `contains` filter used by the Prisma-backed providers. */
export const ciContains = (q: string) => ({ contains: q, mode: "insensitive" as const });
