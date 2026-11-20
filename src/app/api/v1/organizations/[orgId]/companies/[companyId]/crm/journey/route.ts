import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getJourney, journeyPatchInput, updateJourney } from "@/server/modules/crm/guided";

/** Guided "Start selling" journey: saved progress, AI tasks and records it created. */
export const GET = route<{ orgId: string; companyId: string }>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => getJourney(ctx, orgId, companyId));

export const PATCH = route<{ orgId: string; companyId: string }>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/crm/journey", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId }) => updateJourney(ctx, orgId, companyId, await body(req, journeyPatchInput)),
);
