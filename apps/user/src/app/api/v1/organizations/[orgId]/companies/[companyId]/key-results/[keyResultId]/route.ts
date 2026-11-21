import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteKeyResult, updateKeyResult, updateKeyResultInput } from "@/server/modules/objectives/key-results";

type P = { orgId: string; companyId: string; keyResultId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/key-results/:id", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, keyResultId }) => updateKeyResult(ctx, orgId, companyId, keyResultId, await body(req, updateKeyResultInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/key-results/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, keyResultId }) => deleteKeyResult(ctx, orgId, companyId, keyResultId),
);
