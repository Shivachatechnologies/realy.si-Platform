import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createEntity, createEntityInput } from "@/server/modules/graph/service";

export const POST = route<{ orgId: string; companyId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/graph/entities", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createEntity(ctx, orgId, companyId, await body(req, createEntityInput)),
);
