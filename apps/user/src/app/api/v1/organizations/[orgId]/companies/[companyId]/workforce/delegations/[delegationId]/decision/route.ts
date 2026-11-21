import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { decideDelegation, decideDelegationInput } from "@/server/modules/workforce/delegation";

type P = { orgId: string; companyId: string; delegationId: string };

/** Approve (creates the sub-task) or reject a delegation proposal. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/delegations/:id/decision", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, delegationId }) => decideDelegation(ctx, orgId, companyId, delegationId, await body(req, decideDelegationInput)),
);
