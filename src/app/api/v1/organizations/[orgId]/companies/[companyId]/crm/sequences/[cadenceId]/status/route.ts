import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { cadenceStatusInput, setCadenceStatus } from "@/server/modules/crm/cadences";

type P = { orgId: string; companyId: string; cadenceId: string };

/** Activate (approves the step texts; autoSend sends them on schedule), pause or archive a sequence. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/sequences/:cadenceId/status", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, cadenceId }) => setCadenceStatus(ctx, orgId, companyId, cadenceId, await body(req, cadenceStatusInput)),
);
