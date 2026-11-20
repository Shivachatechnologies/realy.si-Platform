import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addMemory, listMemories, memoryInput } from "@/server/modules/workforce/service";

type P = { orgId: string; companyId: string; employeeId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, employeeId }) => ({ data: await listMemories(ctx, orgId, companyId, employeeId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/employees/:id/memory", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, employeeId }) => addMemory(ctx, orgId, companyId, employeeId, await body(req, memoryInput)),
);
