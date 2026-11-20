import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteSalesTask, salesTaskPatch, updateSalesTask } from "@/server/modules/crm/tasks";

type P = { orgId: string; companyId: string; taskId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/crm/sales-tasks/:taskId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, taskId }) => updateSalesTask(ctx, orgId, companyId, taskId, await body(req, salesTaskPatch)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/crm/sales-tasks/:taskId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, taskId }) => deleteSalesTask(ctx, orgId, companyId, taskId),
);
