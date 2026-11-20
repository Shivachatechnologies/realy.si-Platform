import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { assignInput, assignNumber } from "@/server/modules/voice/numbers";

type P = { orgId: string; companyId: string; numberId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/voice/numbers/:numberId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, numberId }) => assignNumber(ctx, orgId, companyId, numberId, await body(req, assignInput)),
);
