import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { selectContext } from "@/server/modules/brain/context";
import { MEMORY_LAYERS, MEMORY_SCOPES } from "@/server/modules/brain/memory-policy";

type P = { orgId: string; companyId: string };

const contextInput = z.object({
  query: z.string().trim().min(1).max(2000),
  scopes: z.array(z.enum(MEMORY_SCOPES)).max(4).optional(),
  layers: z.array(z.enum(MEMORY_LAYERS)).max(10).optional(),
  tokenBudget: z.number().int().min(50).max(32_000).default(2000),
  employeeId: z.string().uuid().nullish(),
  taskId: z.string().uuid().nullish(),
  departmentId: z.string().uuid().nullish(),
});

/** Preview what an AI task would receive from the shared memory for a query (read-only; same rules as the runtime). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/brain/memory/context", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId }) => selectContext(ctx, orgId, companyId, contextInput.parse(await body(req, contextInput))),
);
