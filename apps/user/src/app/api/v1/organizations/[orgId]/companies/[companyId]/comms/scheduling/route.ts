import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { suggestInput, suggestSlots } from "@/server/modules/comms/meetings";

type P = { orgId: string; companyId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/scheduling", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId }) => suggestSlots(ctx, orgId, companyId, await body(req, suggestInput)),
);
