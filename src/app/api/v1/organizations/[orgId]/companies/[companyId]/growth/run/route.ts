import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { runNow } from "@/server/modules/growth/service";

/** Evaluate the growth signals now (ignores the hourly interval). */
export const POST = route<{ orgId: string; companyId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/growth/run", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId }) => runNow(ctx, orgId, companyId),
);
