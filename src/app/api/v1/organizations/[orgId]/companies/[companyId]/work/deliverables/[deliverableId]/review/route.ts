import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { reviewDeliverable, reviewDeliverableInput } from "@/server/modules/work/deliverables";

type P = { orgId: string; companyId: string; deliverableId: string };

/** Accept or reject a submitted deliverable. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/deliverables/:deliverableId/review", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, deliverableId }) => reviewDeliverable(ctx, orgId, companyId, deliverableId, await body(req, reviewDeliverableInput)),
);
