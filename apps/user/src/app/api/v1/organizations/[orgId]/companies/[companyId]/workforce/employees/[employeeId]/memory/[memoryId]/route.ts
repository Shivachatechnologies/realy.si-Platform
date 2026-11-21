import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteMemory, memoryUpdateInput, updateMemory } from "@/server/modules/workforce/service";

type P = { orgId: string; companyId: string; employeeId: string; memoryId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/workforce/employees/:id/memory/:memoryId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, employeeId, memoryId }) => updateMemory(ctx, orgId, companyId, employeeId, memoryId, await body(req, memoryUpdateInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/workforce/employees/:id/memory/:memoryId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, employeeId, memoryId }) => deleteMemory(ctx, orgId, companyId, employeeId, memoryId),
);
