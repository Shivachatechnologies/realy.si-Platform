import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { startFirstSprint } from "@/server/modules/work/product-flow";

type P = { orgId: string; companyId: string; productId: string };

/** POST — plan and start the first sprint from the highest-priority backlog tasks. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/products/:productId/flow/sprint", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, productId }) => startFirstSprint(ctx, orgId, companyId, productId),
);
