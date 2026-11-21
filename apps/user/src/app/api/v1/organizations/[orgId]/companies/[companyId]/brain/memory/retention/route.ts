import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { listRetention, retentionInput, setRetention } from "@/server/modules/brain/memory-store";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => listRetention(ctx, orgId, companyId));
export const PUT = route<P>(
  { auth: "required", name: "PUT /organizations/:orgId/companies/:companyId/brain/memory/retention", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId }) => setRetention(ctx, orgId, companyId, await body(req, retentionInput)),
);
