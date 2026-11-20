import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { applyQualification } from "@/server/modules/crm/intel";

type P = { orgId: string; companyId: string; intelId: string };

/** Copy an AI qualification's BANT answers into the lead (a person decided to use them). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/intel/:intelId/apply", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, intelId }) => applyQualification(ctx, orgId, companyId, intelId),
);
