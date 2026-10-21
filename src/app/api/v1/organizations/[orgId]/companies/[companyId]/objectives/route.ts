import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createObjective, createObjectiveInput, listObjectives } from "@/server/modules/objectives/service";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listObjectives(ctx, orgId, companyId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/objectives", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createObjective(ctx, orgId, companyId, await body(req, createObjectiveInput)),
);
