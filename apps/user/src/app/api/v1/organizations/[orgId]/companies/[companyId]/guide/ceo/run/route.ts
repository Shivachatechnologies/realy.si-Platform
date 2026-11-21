import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { runCeoNow } from "@/server/modules/guide/ceo";

type P = { orgId: string; companyId: string };

/** POST — run today's AI CEO review now (agents.manage), within the same daily caps as the scheduled loop. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/guide/ceo/run", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId }) => runCeoNow(ctx, orgId, companyId),
);
