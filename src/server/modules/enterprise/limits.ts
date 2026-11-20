import type { RouteRateLimit } from "@/server/core/http";

/** Rate limit for heavy downloads (data and audit exports). */
export const LIMITS_EXPORT: RouteRateLimit[] = [
  {
    name: "enterprise-export:principal",
    limit: 10,
    windowMs: 15 * 60_000,
    by: "principal",
  },
];
