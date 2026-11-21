import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { priorityStatusInput, setPriorityStatus } from "@/server/modules/guide/ceo";

type P = { orgId: string; companyId: string; priorityId: string };

/** PATCH — drop a weekly priority (or bring it back). */
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/guide/ceo/priorities/:id", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, priorityId }) => setPriorityStatus(ctx, orgId, companyId, priorityId, await body(req, priorityStatusInput)),
);
