import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createKeyResult, keyResultInput } from "@/server/modules/objectives/key-results";

export const POST = route<{ orgId: string; companyId: string; objectiveId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/objectives/:id/key-results", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, objectiveId }) => createKeyResult(ctx, orgId, companyId, objectiveId, await body(req, keyResultInput)),
);
