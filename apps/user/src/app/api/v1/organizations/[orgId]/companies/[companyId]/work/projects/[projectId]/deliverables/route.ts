import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createDeliverable, deliverableInput, listDeliverables } from "@/server/modules/work/deliverables";

type P = { orgId: string; companyId: string; projectId: string };

export const GET = route<P>({ auth: "required", name: "GET /organizations/:orgId/companies/:companyId/work/projects/:projectId/deliverables" }, async ({ ctx }, { orgId, companyId, projectId }) => ({ data: await listDeliverables(ctx, orgId, companyId, projectId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/projects/:projectId/deliverables", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, projectId }) => createDeliverable(ctx, orgId, companyId, projectId, await body(req, deliverableInput)),
);
