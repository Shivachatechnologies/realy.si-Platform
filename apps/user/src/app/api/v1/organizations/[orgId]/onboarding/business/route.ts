import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { onboardBusiness, onboardInput } from "@/server/modules/builder/service";

type P = { orgId: string };

/** POST { mode, brief, company } — onboarding / "add another business": creates the company and starts its builder run. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/onboarding/business", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId }) => onboardBusiness(ctx, orgId, await body(req, onboardInput)),
);
