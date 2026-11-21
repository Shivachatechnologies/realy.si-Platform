import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteMemory, getMemory, updateMemory, updateMemoryInput } from "@/server/modules/brain/memory";

type P = { orgId: string; companyId: string; memoryId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, memoryId }) => getMemory(ctx, orgId, companyId, memoryId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/brain/memory/:id", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, memoryId }) => updateMemory(ctx, orgId, companyId, memoryId, await body(req, updateMemoryInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/brain/memory/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, memoryId }) => deleteMemory(ctx, orgId, companyId, memoryId),
);
